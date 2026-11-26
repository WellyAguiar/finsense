import crypto from "crypto";

export interface InstallmentInfo {
  installmentNumber: number;
  installmentTotal: number;
}

export type TransactionKind = "INCOME" | "EXPENSE" | "TRANSFER" | "CC_PAYMENT";

export interface RuleCandidate {
  id: string;
  pattern: string;
  matchType: string;
  cleanMerchant: string;
  categoryId: string;
  kindOverride?: string | null;
  priority: number;
}

/**
 * Extrai informações de parcelamento de descrições bancárias brasileiras.
 * Ex: "MERCADOLIVRE PARC 02/10", "LOJA XYZ 3/6", "COMPRA PARCELA 4 DE 12".
 */
export function parseInstallmentInfo(description: string): InstallmentInfo | null {
  const normalized = description.toUpperCase();

  // Padrão explícito: PARC 02/10, PARCELA 2 DE 12, P 03/06
  const explicitMatch = normalized.match(
    /(?:PARC(?:ELA)?S?\.?\s*|P\s+)(\d{1,2})\s*(?:\/|DE)\s*(\d{1,2})/
  );
  if (explicitMatch) {
    const num = Number(explicitMatch[1]);
    const total = Number(explicitMatch[2]);
    if (isValidInstallment(num, total)) {
      return { installmentNumber: num, installmentTotal: total };
    }
  }

  // Padrão implícito no final ou isolado: "LOJA X 02/06" (evita datas tipo 12/05/2026)
  const genericMatch = normalized.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s|$|\)|-)/);
  if (genericMatch) {
    const num = Number(genericMatch[1]);
    const total = Number(genericMatch[2]);
    if (isValidInstallment(num, total)) {
      return { installmentNumber: num, installmentTotal: total };
    }
  }

  return null;
}

function isValidInstallment(num: number, total: number): boolean {
  return (
    Number.isInteger(num) &&
    Number.isInteger(total) &&
    total >= 2 &&
    total <= 60 &&
    num >= 1 &&
    num <= total
  );
}

const CC_PAYMENT_PATTERNS = [
  "PAGAMENTO DE FATURA",
  "PAGAMENTO FATURA",
  "PGTO FATURA",
  "PAG FATURA",
  "FATURA CARTAO",
  "FATURA NUBANK",
  "FATURA ITAU",
  "FATURA INTER",
  "FATURA BRADESCO",
  "FATURA SANTANDER",
  "FATURA XP",
  "FATURA BTG",
  "PAGAMENTO RECEBIDO",
];

const TRANSFER_PATTERNS = [
  "MESMA TITULARIDADE",
  "ENTRE CONTAS",
  "TRANSF PROPRIA",
  "TRANSFERENCIA PROPRIA",
  "RESGATE AUTOMATICO",
  "APLICACAO AUTOMATICA",
  "CONTA PROPRIA",
];

/**
 * Classifica o tipo contábil da transação evitando dupla contagem de faturas e transferências.
 */
export function detectTransactionKind(params: {
  accountType: string;
  rawAmount: number;
  description: string;
  pluggyType?: string | null;
}): TransactionKind {
  const upper = params.description.toUpperCase();

  if (CC_PAYMENT_PATTERNS.some((p) => upper.includes(p))) {
    return "CC_PAYMENT";
  }

  if (TRANSFER_PATTERNS.some((p) => upper.includes(p))) {
    return "TRANSFER";
  }

  if (params.accountType === "CREDIT_CARD") {
    // Em cartões de crédito no Pluggy: valores positivos geralmente representam compras (débito na fatura)
    // e valores negativos representam estornos ou pagamento recebido.
    if (params.pluggyType === "CREDIT" || params.rawAmount < 0) {
      if (upper.includes("PAGAMENTO") || upper.includes("PGTO")) {
        return "CC_PAYMENT";
      }
      return "INCOME"; // Estorno / cashback na fatura
    }
    return "EXPENSE";
  }

  if (params.pluggyType === "CREDIT") return "INCOME";
  if (params.pluggyType === "DEBIT") return "EXPENSE";

  return params.rawAmount >= 0 ? "INCOME" : "EXPENSE";
}

/**
 * Gera impressão digital estável para auxiliar na detecção de duplicidades.
 */
export function buildTransactionFingerprint(params: {
  accountId: string;
  amountCents: number;
  occurredAt: string;
  rawDescription: string;
}): string {
  const normDesc = params.rawDescription
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 24);
  const raw = `${params.accountId}|${Math.abs(params.amountCents)}|${params.occurredAt.slice(0, 10)}|${normDesc}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

/**
 * Encontra possíveis transações duplicadas (mesmo valor absoluto em janela de ±3 dias).
 */
export function findPotentialDuplicates<
  T extends { id: string; amountCents: number; occurredAt: string; cleanMerchant: string; rawDescription: string }
>(
  candidate: { amountCents: number; occurredAt: string; description?: string },
  existing: T[],
  maxDayDiff = 3
): Array<{ transaction: T; dayDiff: number; score: number }> {
  const candTime = new Date(`${candidate.occurredAt.slice(0, 10)}T12:00:00Z`).getTime();
  const candAmount = Math.abs(candidate.amountCents);
  const candTokens = tokenize(candidate.description ?? "");

  const matches: Array<{ transaction: T; dayDiff: number; score: number }> = [];

  for (const tx of existing) {
    if (Math.abs(tx.amountCents) !== candAmount) continue;
    const txTime = new Date(`${tx.occurredAt.slice(0, 10)}T12:00:00Z`).getTime();
    const dayDiff = Math.abs(Math.round((candTime - txTime) / (1000 * 60 * 60 * 24)));
    if (dayDiff > maxDayDiff) continue;

    let score = dayDiff === 0 ? 0.85 : dayDiff === 1 ? 0.72 : 0.6;
    if (candTokens.size > 0) {
      const txTokens = tokenize(`${tx.cleanMerchant} ${tx.rawDescription}`);
      const overlap = [...candTokens].filter((t) => txTokens.has(t)).length;
      if (overlap > 0) score = Math.min(0.99, score + 0.14);
    }

    matches.push({ transaction: tx, dayDiff, score });
  }

  return matches.sort((a, b) => b.score - a.score);
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
  );
}

/**
 * Aplica regras determinísticas de categorização ordenadas por prioridade (menor número = maior prioridade).
 */
export function applyCategorizationRules(
  rawDescription: string,
  rules: RuleCandidate[]
): RuleCandidate | null {
  const upper = rawDescription.toUpperCase().trim();
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    const pattern = rule.pattern.trim();
    if (!pattern) continue;

    if (rule.matchType === "EXACT") {
      if (upper === pattern.toUpperCase()) return rule;
    } else if (rule.matchType === "REGEX") {
      try {
        const re = new RegExp(pattern, "i");
        if (re.test(rawDescription)) return rule;
      } catch {
        continue;
      }
    } else {
      if (upper.includes(pattern.toUpperCase())) return rule;
    }
  }

  return null;
}

export interface BudgetPaceResult {
  usageRatio: number;
  expectedPaceRatio: number;
  projectedCents: number;
  remainingCents: number;
  status: "OK" | "WARNING" | "OVER";
}

/**
 * Calcula o ritmo de consumo de um orçamento mensal.
 */
export function computeBudgetPace(params: {
  spentCents: number;
  limitCents: number;
  dayOfMonth: number;
  daysInMonth: number;
}): BudgetPaceResult {
  const { spentCents, limitCents, dayOfMonth, daysInMonth } = params;
  if (limitCents <= 0) {
    return {
      usageRatio: 0,
      expectedPaceRatio: 0,
      projectedCents: spentCents,
      remainingCents: 0,
      status: "OK",
    };
  }

  const safeDay = Math.max(1, Math.min(dayOfMonth, daysInMonth));
  const usageRatio = spentCents / limitCents;
  const expectedPaceRatio = safeDay / daysInMonth;
  const projectedCents = Math.round((spentCents / safeDay) * daysInMonth);
  const remainingCents = limitCents - spentCents;

  let status: "OK" | "WARNING" | "OVER" = "OK";
  if (usageRatio >= 1) {
    status = "OVER";
  } else if (usageRatio >= 0.8 || (safeDay >= 5 && projectedCents > limitCents * 1.1)) {
    status = "WARNING";
  }

  return {
    usageRatio,
    expectedPaceRatio,
    projectedCents,
    remainingCents,
    status,
  };
}

export interface InstallmentProjectionMonth {
  monthKey: string;
  committedCents: number;
  items: Array<{
    cleanMerchant: string;
    amountCents: number;
    installmentNumber: number;
    installmentTotal: number;
  }>;
}

/**
 * Projeta compromissos futuros de faturas a partir das compras parceladas ativas no mês mais recente.
 */
export function projectCreditCardInstallments(
  txs: Array<{
    cleanMerchant: string;
    amountCents: number;
    occurredAt: string;
    installmentNumber: number | null;
    installmentTotal: number | null;
    kind: string;
  }>,
  baseMonthKey: string,
  monthsAhead = 6
): InstallmentProjectionMonth[] {
  // Agrupa por compra (cleanMerchant + amountCents + installmentTotal) mantendo a parcela mais recente
  const latestByPurchase = new Map<
    string,
    {
      cleanMerchant: string;
      amountCents: number;
      monthKey: string;
      installmentNumber: number;
      installmentTotal: number;
    }
  >();

  for (const tx of txs) {
    if (tx.kind !== "EXPENSE" || !tx.installmentNumber || !tx.installmentTotal) continue;
    if (tx.installmentNumber >= tx.installmentTotal) continue;

    const txMonth = tx.occurredAt.slice(0, 7);
    const key = `${tx.cleanMerchant.toLowerCase()}|${tx.amountCents}|${tx.installmentTotal}`;
    const existing = latestByPurchase.get(key);
    if (!existing || tx.installmentNumber > existing.installmentNumber) {
      latestByPurchase.set(key, {
        cleanMerchant: tx.cleanMerchant,
        amountCents: tx.amountCents,
        monthKey: txMonth,
        installmentNumber: tx.installmentNumber,
        installmentTotal: tx.installmentTotal,
      });
    }
  }

  const results: InstallmentProjectionMonth[] = [];
  const [baseY, baseM] = baseMonthKey.split("-").map(Number);

  for (let offset = 1; offset <= monthsAhead; offset++) {
    const targetDate = new Date(baseY, baseM - 1 + offset, 1);
    const targetKey = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, "0")}`;
    const items: InstallmentProjectionMonth["items"] = [];
    let committedCents = 0;

    for (const p of latestByPurchase.values()) {
      const [pY, pM] = p.monthKey.split("-").map(Number);
      const diffMonths = (targetDate.getFullYear() - pY) * 12 + (targetDate.getMonth() + 1 - pM);
      if (diffMonths <= 0) continue;
      const projectedNumber = p.installmentNumber + diffMonths;
      if (projectedNumber <= p.installmentTotal) {
        committedCents += p.amountCents;
        items.push({
          cleanMerchant: p.cleanMerchant,
          amountCents: p.amountCents,
          installmentNumber: projectedNumber,
          installmentTotal: p.installmentTotal,
        });
      }
    }

    results.push({ monthKey: targetKey, committedCents, items });
  }

  return results;
}

export interface DetectedRecurringCandidate {
  merchantName: string;
  latestCents: number;
  previousCents: number | null;
  priceChangeRatio: number | null;
  expectedDay: number;
  monthsDetected: number;
  categoryId: string | null;
  accountId: string;
  lastSeenAt: string;
}

/**
 * Detecta assinaturas e gastos fixos recorrentes com base no histórico de transações,
 * identificando também aumentos de preço recentes.
 */
export function detectRecurringPatterns(
  txs: Array<{
    cleanMerchant: string;
    amountCents: number;
    occurredAt: string;
    kind: string;
    installmentTotal: number | null;
    categoryId: string | null;
    accountId: string;
  }>
): DetectedRecurringCandidate[] {
  const byMerchant = new Map<string, typeof txs>();

  for (const tx of txs) {
    if (tx.kind !== "EXPENSE" || tx.installmentTotal) continue;
    const key = tx.cleanMerchant.trim().toLowerCase();
    if (!key) continue;
    const list = byMerchant.get(key) ?? [];
    list.push(tx);
    byMerchant.set(key, list);
  }

  const detected: DetectedRecurringCandidate[] = [];

  for (const list of byMerchant.values()) {
    const sorted = [...list].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    // Agrupa por mês (se aparece 1 vez por mês em 2+ meses distintos)
    const byMonth = new Map<string, (typeof sorted)[number]>();
    for (const item of sorted) {
      const m = item.occurredAt.slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, item);
    }

    if (byMonth.size < 2) continue;
    const monthlyItems = [...byMonth.values()];

    // Verifica consistência de valor (ou variação moderada típica de reajuste de assinatura)
    const latest = monthlyItems[monthlyItems.length - 1];
    const previous = monthlyItems[monthlyItems.length - 2];

    // Se houver muitos lançamentos no mesmo mês (ex: Uber/iFood todo dia), não é assinatura fixa
    if (list.length > byMonth.size * 1.6) continue;

    const diffRatio =
      previous.amountCents > 0
        ? (latest.amountCents - previous.amountCents) / previous.amountCents
        : 0;

    // Aceita valores estáveis ou reajustes de até 60%
    if (Math.abs(diffRatio) > 0.6) continue;

    const avgDay = Math.round(
      monthlyItems.reduce((acc, item) => acc + Number(item.occurredAt.slice(8, 10)), 0) /
        monthlyItems.length
    );

    detected.push({
      merchantName: latest.cleanMerchant,
      latestCents: latest.amountCents,
      previousCents: previous.amountCents !== latest.amountCents ? previous.amountCents : null,
      priceChangeRatio: previous.amountCents !== latest.amountCents ? diffRatio : null,
      expectedDay: Math.max(1, Math.min(28, avgDay)),
      monthsDetected: byMonth.size,
      categoryId: latest.categoryId,
      accountId: latest.accountId,
      lastSeenAt: latest.occurredAt,
    });
  }

  return detected.sort((a, b) => b.latestCents - a.latestCents);
}

export interface CategoryAnomaly {
  categoryId: string;
  categoryName: string;
  currentCents: number;
  historicalAvgCents: number;
  increaseRatio: number;
}

/**
 * Detecta categorias com gasto significativamente acima da média histórica.
 */
export function detectSpendingAnomalies(
  currentByCategory: Array<{ categoryId: string; categoryName: string; totalCents: number }>,
  historicalAvgByCategory: Map<string, number>,
  minDeltaCents = 10000,
  minIncreaseRatio = 0.35
): CategoryAnomaly[] {
  const anomalies: CategoryAnomaly[] = [];

  for (const item of currentByCategory) {
    const avg = historicalAvgByCategory.get(item.categoryId);
    if (!avg || avg <= 0) continue;

    const delta = item.totalCents - avg;
    const ratio = delta / avg;

    if (delta >= minDeltaCents && ratio >= minIncreaseRatio) {
      anomalies.push({
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        currentCents: item.totalCents,
        historicalAvgCents: Math.round(avg),
        increaseRatio: ratio,
      });
    }
  }

  return anomalies.sort((a, b) => b.increaseRatio - a.increaseRatio);
}
