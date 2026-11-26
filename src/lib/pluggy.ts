import { PluggyClient } from "pluggy-sdk";
import { eq, and, gte, lte, ne } from "drizzle-orm";
import {
  getDb,
  connections,
  accounts,
  creditCardBills,
  transactions,
  categorizationRules,
} from "@/db";
import { ensureBaseSeed } from "@/db/seed";
import {
  applyCategorizationRules,
  buildTransactionFingerprint,
  detectTransactionKind,
  parseInstallmentInfo,
} from "@/lib/finance-engine";

interface PluggyV2Transaction {
  id: string;
  description?: string | null;
  descriptionRaw?: string | null;
  amount: number;
  date: string;
  type?: string | null;
  category?: string | null;
  merchant?: { name?: string | null; businessName?: string | null } | null;
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
    billId?: string | null;
  } | null;
}

interface PluggyV2Page {
  results: PluggyV2Transaction[];
  next?: string | null;
}

function getPluggyCredentials() {
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET não configurados. Cadastre suas chaves do Pluggy no .env.local."
    );
  }
  return { clientId, clientSecret };
}

function getPluggyClient(): PluggyClient {
  return new PluggyClient(getPluggyCredentials());
}

async function getPluggyApiKey(): Promise<string> {
  const { clientId, clientSecret } = getPluggyCredentials();
  const res = await fetch("https://api.pluggy.ai/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Falha na autenticação Pluggy (${res.status}): ${txt}`);
  }
  const data = (await res.json()) as { apiKey?: string };
  if (!data.apiKey) throw new Error("Pluggy não retornou apiKey.");
  return data.apiKey;
}

/**
 * Busca transações pelo endpoint oficial /v2/transactions com paginação por cursor.
 */
async function fetchAccountTransactionsV2(
  apiKey: string,
  accountId: string,
  fromDateStr: string
): Promise<PluggyV2Transaction[]> {
  const all: PluggyV2Transaction[] = [];
  let nextUrl: string | null =
    `https://api.pluggy.ai/v2/transactions?accountId=${encodeURIComponent(accountId)}`;

  let safetyPages = 0;
  while (nextUrl && safetyPages < 15) {
    safetyPages++;
    const res = await fetch(nextUrl, {
      headers: { "X-API-KEY": apiKey },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Erro Pluggy /v2/transactions (${res.status}): ${txt}`);
    }
    const page = (await res.json()) as PluggyV2Page;
    if (Array.isArray(page.results)) {
      all.push(...page.results.filter((tx) => toISODate(tx.date) >= fromDateStr));
    }

    if (page.next) {
      nextUrl = page.next.startsWith("http")
        ? page.next
        : `https://api.pluggy.ai/v2/transactions?accountId=${encodeURIComponent(accountId)}&cursor=${encodeURIComponent(page.next)}`;
    } else {
      nextUrl = null;
    }
  }

  return all;
}

export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.codeDescription === "string") return obj.codeDescription;
    try {
      return JSON.stringify(obj).slice(0, 240);
    } catch {
      return "Erro ao comunicar com o Pluggy";
    }
  }
  return "Erro desconhecido ao sincronizar";
}

export interface SyncItemSummary {
  pluggyItemId: string;
  institutionName: string;
  accountsSynced: number;
  transactionsInserted: number;
  transactionsUpdated: number;
  transfersPaired: number;
}

function mapPluggyAccountType(type: string, subtype?: string | null): string {
  if (type === "CREDIT") return "CREDIT_CARD";
  if (subtype === "SAVINGS_ACCOUNT") return "SAVINGS";
  return "CHECKING";
}

function toISODate(dateValue: Date | string): string {
  if (dateValue instanceof Date) {
    return dateValue.toISOString().slice(0, 10);
  }
  return String(dateValue).slice(0, 10);
}

function inferInstitutionName(
  connectorName: string | undefined | null,
  pluggyAccounts: Array<{ name?: string | null; type?: string | null; marketingName?: string | null }>
): string {
  const base = connectorName?.trim() || "Instituição Conectada";
  if (base.toLowerCase() !== "meupluggy" && base.toLowerCase() !== "meu pluggy") {
    return base;
  }
  // Quando vem via MeuPluggy, extrai o nome real do banco a partir da conta bancária
  const bankAcc = pluggyAccounts.find((a) => a.type === "BANK" && a.name?.trim());
  if (bankAcc?.name?.trim()) return bankAcc.name.trim();
  const anyAcc = pluggyAccounts.find((a) => (a.marketingName || a.name)?.trim());
  if (anyAcc) return (anyAcc.marketingName || anyAcc.name || base).trim();
  return base;
}

/**
 * Sincroniza uma conexão (Item) do Pluggy de forma idempotente e rápida:
 * contas, faturas de cartão, transações (/v2/transactions) e pareamento de transferências próprias.
 */
export async function syncPluggyItem(
  pluggyItemId: string,
  daysBack = 90
): Promise<SyncItemSummary> {
  const client = getPluggyClient();
  const apiKey = await getPluggyApiKey();
  const db = getDb();
  await ensureBaseSeed();

  const item = await client.fetchItem(pluggyItemId);
  const pluggyAccountsRes = await client.fetchAccounts(pluggyItemId);
  const pluggyAccounts = pluggyAccountsRes.results ?? [];

  const institutionName = inferInstitutionName(item.connector?.name, pluggyAccounts);
  const institutionLogoUrl = item.connector?.imageUrl ?? null;

  const [conn] = await db
    .insert(connections)
    .values({
      pluggyItemId,
      institutionName,
      institutionLogoUrl,
      status: item.status ?? "CONNECTED",
      lastSyncedAt: new Date(),
      lastError: null,
    })
    .onConflictDoUpdate({
      target: connections.pluggyItemId,
      set: {
        institutionName,
        institutionLogoUrl,
        status: item.status ?? "CONNECTED",
        lastSyncedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      },
    })
    .returning();

  const rules = await db.select().from(categorizationRules);

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - daysBack);
  const fromStr = fromDate.toISOString().slice(0, 10);

  let accountsSynced = 0;
  let transactionsInserted = 0;
  let transactionsUpdated = 0;

  for (const pAcc of pluggyAccounts) {
    const accountType = mapPluggyAccountType(pAcc.type, pAcc.subtype);
    const balanceCents = Math.round((pAcc.balance ?? 0) * 100);
    const creditLimitCents =
      pAcc.creditData?.creditLimit != null
        ? Math.round(pAcc.creditData.creditLimit * 100)
        : null;
    const availableCreditLimitCents =
      pAcc.creditData?.availableCreditLimit != null
        ? Math.round(pAcc.creditData.availableCreditLimit * 100)
        : null;

    const closingDay = pAcc.creditData?.balanceCloseDate
      ? new Date(pAcc.creditData.balanceCloseDate).getDate()
      : null;
    const dueDay = pAcc.creditData?.balanceDueDate
      ? new Date(pAcc.creditData.balanceDueDate).getDate()
      : null;

    const rawAccName = pAcc.name?.trim();
    const displayAccountName =
      accountType === "CREDIT_CARD" && (!rawAccName || rawAccName.toUpperCase() === "BANDEIRADO")
        ? `Cartão ${institutionName}`
        : rawAccName || `${institutionName} ${accountType === "CREDIT_CARD" ? "Cartão" : "Conta"}`;

    const [localAccount] = await db
      .insert(accounts)
      .values({
        connectionId: conn.id,
        pluggyAccountId: pAcc.id,
        name: displayAccountName,
        institutionName,
        type: accountType,
        subtype: pAcc.subtype ?? null,
        balanceCents,
        creditLimitCents,
        availableCreditLimitCents,
        closingDay,
        dueDay,
        currencyCode: pAcc.currencyCode ?? "BRL",
      })
      .onConflictDoUpdate({
        target: accounts.pluggyAccountId,
        set: {
          connectionId: conn.id,
          name: displayAccountName,
          institutionName,
          balanceCents,
          creditLimitCents,
          availableCreditLimitCents,
          closingDay,
          dueDay,
          updatedAt: new Date(),
        },
      })
      .returning();

    accountsSynced++;

    // Sincroniza faturas de cartão de crédito se aplicável
    const billIdMap = new Map<string, string>();
    if (accountType === "CREDIT_CARD") {
      try {
        const billsRes = await client.fetchCreditCardBills(pAcc.id);
        for (const pBill of billsRes.results) {
          const dueDate = toISODate(pBill.dueDate);
          const referenceMonth = dueDate.slice(0, 7);
          const totalCents = Math.round(Math.abs(pBill.totalAmount ?? 0) * 100);
          const minimumPaymentCents =
            pBill.minimumPaymentAmount != null
              ? Math.round(Math.abs(pBill.minimumPaymentAmount) * 100)
              : null;

          const nowStr = new Date().toISOString().slice(0, 10);
          const status = dueDate < nowStr ? "CLOSED" : "OPEN";

          const [localBill] = await db
            .insert(creditCardBills)
            .values({
              accountId: localAccount.id,
              externalId: pBill.id,
              referenceMonth,
              dueDate,
              totalCents,
              minimumPaymentCents,
              status,
            })
            .onConflictDoUpdate({
              target: [creditCardBills.accountId, creditCardBills.referenceMonth],
              set: {
                externalId: pBill.id,
                dueDate,
                totalCents,
                minimumPaymentCents,
                updatedAt: new Date(),
              },
            })
            .returning();

          billIdMap.set(pBill.id, localBill.id);
        }
      } catch {
        // Nem todo conector retorna endpoint de bills — seguimos normalmente
      }
    }

    // Busca transações pelo endpoint /v2/transactions (cursor)
    const pTransactions = await fetchAccountTransactionsV2(apiKey, pAcc.id, fromStr);

    // Pré-carrega IDs já existentes nesta conta para evitar N+1 queries
    const existingRows = await db
      .select({ id: transactions.id, externalId: transactions.externalId })
      .from(transactions)
      .where(eq(transactions.accountId, localAccount.id));

    const existingExternalIds = new Set(
      existingRows.map((r) => r.externalId).filter((id): id is string => Boolean(id))
    );

    const toInsert: Array<typeof transactions.$inferInsert> = [];

    for (const pTx of pTransactions) {
      if (existingExternalIds.has(pTx.id)) {
        transactionsUpdated++;
        continue;
      }

      const rawDescription = (pTx.descriptionRaw || pTx.description || "Transação").trim();
      const occurredAt = toISODate(pTx.date);
      const amountCents = Math.round(Math.abs(pTx.amount) * 100);
      if (amountCents === 0) continue;

      const matchedRule = applyCategorizationRules(rawDescription, rules);
      const pluggyCatLower = (pTx.category ?? "").toLowerCase();

      let kind =
        matchedRule?.kindOverride ??
        detectTransactionKind({
          accountType,
          rawAmount: pTx.amount,
          description: rawDescription,
          pluggyType: pTx.type,
        });

      if (!matchedRule?.kindOverride) {
        if (pluggyCatLower.includes("credit card payment")) {
          kind = "CC_PAYMENT";
        } else if (pluggyCatLower.includes("same person transfer")) {
          kind = "TRANSFER";
        }
      }

      const installment = parseInstallmentInfo(rawDescription);
      const pluggyInstNumber =
        pTx.creditCardMetadata?.installmentNumber ?? installment?.installmentNumber ?? null;
      const pluggyInstTotal =
        pTx.creditCardMetadata?.totalInstallments ?? installment?.installmentTotal ?? null;

      const cleanMerchant =
        matchedRule?.cleanMerchant ??
        pTx.merchant?.name?.trim() ??
        pTx.merchant?.businessName?.trim() ??
        pTx.description?.trim() ??
        rawDescription;

      const billExternalId = pTx.creditCardMetadata?.billId;
      const localBillId = billExternalId ? (billIdMap.get(billExternalId) ?? null) : null;

      const fingerprint = buildTransactionFingerprint({
        accountId: localAccount.id,
        amountCents,
        occurredAt,
        rawDescription,
      });

      toInsert.push({
        accountId: localAccount.id,
        billId: localBillId,
        categoryId:
          kind === "TRANSFER" || kind === "CC_PAYMENT"
            ? null
            : (matchedRule?.categoryId ?? null),
        externalId: pTx.id,
        fingerprint,
        source: "PLUGGY",
        kind,
        amountCents,
        occurredAt,
        rawDescription,
        cleanMerchant,
        installmentNumber: pluggyInstNumber,
        installmentTotal: pluggyInstTotal,
        reviewed: Boolean(matchedRule || kind === "TRANSFER" || kind === "CC_PAYMENT"),
      });
    }

    // Inserção em lotes de 100 (super rápido no Neon serverless)
    const CHUNK = 100;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const slice = toInsert.slice(i, i + CHUNK);
      const inserted = await db
        .insert(transactions)
        .values(slice)
        .onConflictDoNothing({ target: transactions.externalId })
        .returning({ id: transactions.id });
      transactionsInserted += inserted.length;
    }
  }

  const transfersPaired = await pairInternalTransfers();

  return {
    pluggyItemId,
    institutionName,
    accountsSynced,
    transactionsInserted,
    transactionsUpdated,
    transfersPaired,
  };
}

/**
 * Pareia automaticamente transferências entre contas próprias do usuário
 * (mesmo valor absoluto em contas diferentes em janela de ±2 dias, sendo uma entrada e outra saída).
 */
export async function pairInternalTransfers(): Promise<number> {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const recent = await db
    .select()
    .from(transactions)
    .where(and(gte(transactions.occurredAt, cutoffStr)));

  const debits = recent.filter((t) => t.kind === "EXPENSE" && !t.transferPairId);
  const credits = recent.filter((t) => t.kind === "INCOME" && !t.transferPairId);

  const usedCredits = new Set<string>();
  let paired = 0;

  for (const debit of debits) {
    const debitDate = new Date(`${debit.occurredAt}T12:00:00Z`).getTime();
    const match = credits.find((c) => {
      if (usedCredits.has(c.id)) return false;
      if (c.accountId === debit.accountId) return false;
      if (c.amountCents !== debit.amountCents) return false;
      const creditDate = new Date(`${c.occurredAt}T12:00:00Z`).getTime();
      const dayDiff = Math.abs(Math.round((debitDate - creditDate) / (1000 * 60 * 60 * 24)));
      if (dayDiff > 2) return false;

      const combined = `${debit.rawDescription} ${c.rawDescription}`.toUpperCase();
      return (
        combined.includes("PIX") ||
        combined.includes("TED") ||
        combined.includes("DOC") ||
        combined.includes("TRANSF")
      );
    });

    if (match) {
      usedCredits.add(match.id);
      await db
        .update(transactions)
        .set({ kind: "TRANSFER", transferPairId: match.id, updatedAt: new Date() })
        .where(eq(transactions.id, debit.id));
      await db
        .update(transactions)
        .set({ kind: "TRANSFER", transferPairId: debit.id, updatedAt: new Date() })
        .where(eq(transactions.id, match.id));
      paired++;
    }
  }

  return paired;
}

/**
 * Sincroniza todas as conexões cadastradas no banco + eventuais PLUGGY_ITEM_IDS do ambiente.
 */
export async function syncAllPluggyConnections(daysBack = 90): Promise<{
  synced: SyncItemSummary[];
  errors: Array<{ pluggyItemId: string; error: string }>;
}> {
  const db = getDb();
  const dbConnections = await db.select().from(connections);
  const envItemIds = (process.env.PLUGGY_ITEM_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const uniqueItemIds = Array.from(
    new Set([...dbConnections.map((c) => c.pluggyItemId), ...envItemIds])
  );

  const synced: SyncItemSummary[] = [];
  const errors: Array<{ pluggyItemId: string; error: string }> = [];

  for (const itemId of uniqueItemIds) {
    try {
      const summary = await syncPluggyItem(itemId, daysBack);
      synced.push(summary);
    } catch (err) {
      const message = extractErrorMessage(err);
      errors.push({ pluggyItemId: itemId, error: message });
      await db
        .update(connections)
        .set({ status: "LOGIN_ERROR", lastError: message, updatedAt: new Date() })
        .where(and(eq(connections.pluggyItemId, itemId), ne(connections.status, "ARCHIVED")));
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  await db
    .update(creditCardBills)
    .set({ status: "CLOSED", updatedAt: new Date() })
    .where(and(eq(creditCardBills.status, "OPEN"), lte(creditCardBills.dueDate, todayStr)));

  return { synced, errors };
}
