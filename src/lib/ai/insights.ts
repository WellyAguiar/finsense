import { generateObject } from "ai";
import { z } from "zod";
import { and, eq, gte } from "drizzle-orm";
import { getDb, transactions, aiInsights, recurringItems } from "@/db";
import {
  detectRecurringPatterns,
  detectSpendingAnomalies,
} from "@/lib/finance-engine";
import {
  getBudgetsWithProgress,
  getPeriodTotals,
  getSpendingByCategory,
} from "@/lib/queries";
import {
  formatBRL,
  formatMonthLabel,
  getCurrentMonthKey,
  getMonthRange,
  shiftMonthKey,
} from "@/lib/format";
import { getGeminiModel } from "@/lib/ai/model";
import { isGeminiConfigured } from "@/lib/env";

const monthlyReportSchema = z.object({
  title: z.string(),
  summaryMd: z.string().describe("Resumo executivo objetivo em markdown (pt-BR), 3 a 5 bullets práticos"),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
});

/**
 * Executa o motor de detecção estatística + Gemini para gerar alertas proativos
 * (anomalias, reajustes de assinaturas, ritmo de orçamento e relatório mensal).
 */
export async function refreshProactiveInsights(monthKey = getCurrentMonthKey()) {
  const db = getDb();
  const { start, end } = getMonthRange(monthKey);

  // 1. Dados do mês atual e histórico de 4 meses anteriores
  const currentTotals = await getPeriodTotals(start, end);
  const currentByCat = await getSpendingByCategory(start, end);
  const budgetStatus = await getBudgetsWithProgress(monthKey);

  const historicalSums = new Map<string, { sum: number; months: number }>();
  for (let i = 1; i <= 4; i++) {
    const prevKey = shiftMonthKey(monthKey, -i);
    const range = getMonthRange(prevKey);
    const prevCats = await getSpendingByCategory(range.start, range.end);
    for (const c of prevCats) {
      const curr = historicalSums.get(c.categoryId) ?? { sum: 0, months: 0 };
      curr.sum += c.totalCents;
      curr.months += 1;
      historicalSums.set(c.categoryId, curr);
    }
  }
  const historicalAvgs = new Map<string, number>();
  for (const [catId, data] of historicalSums.entries()) {
    historicalAvgs.set(catId, data.sum / data.months);
  }

  const anomalies = detectSpendingAnomalies(currentByCat, historicalAvgs);

  // 2. Detecção de assinaturas e reajustes nos últimos 6 meses
  const sixMonthsStart = `${shiftMonthKey(monthKey, -6)}-01`;
  const recentTxs = await db
    .select()
    .from(transactions)
    .where(gte(transactions.occurredAt, sixMonthsStart));

  const recurringCandidates = detectRecurringPatterns(recentTxs);
  const priceHikes = recurringCandidates.filter(
    (c) => c.priceChangeRatio !== null && c.priceChangeRatio > 0.05
  );

  // Atualiza recurring_items detectados automaticamente se ainda não existirem
  const existingRecurring = await db.select().from(recurringItems);
  const existingNames = new Set(existingRecurring.map((r) => r.merchantName.toLowerCase()));
  for (const cand of recurringCandidates) {
    if (!existingNames.has(cand.merchantName.toLowerCase()) && cand.monthsDetected >= 3) {
      await db.insert(recurringItems).values({
        merchantName: cand.merchantName,
        categoryId: cand.categoryId,
        accountId: cand.accountId,
        expectedCents: cand.latestCents,
        previousCents: cand.previousCents,
        expectedDay: cand.expectedDay,
        frequency: "MONTHLY",
        lastSeenAt: cand.lastSeenAt,
        detectedByAi: true,
      });
    }
  }

  // Remove insights antigos do mesmo mês não descartados para regenerar limpo
  await db
    .delete(aiInsights)
    .where(and(eq(aiInsights.referenceMonth, monthKey), eq(aiInsights.dismissed, false)));

  const createdInsights: Array<{ type: string; title: string }> = [];

  // Alertas de Orçamento
  for (const b of budgetStatus.filter((x) => x.status !== "OK").slice(0, 3)) {
    const title =
      b.status === "OVER"
        ? `Orçamento de ${b.categoryName} ultrapassado (${Math.round(b.usageRatio * 100)}%)`
        : `Ritmo acelerado em ${b.categoryName} (${Math.round(b.usageRatio * 100)}%)`;

    const summaryMd =
      b.status === "OVER"
        ? `Você gastou **${formatBRL(b.spentCents)}** frente ao limite de **${formatBRL(b.limitCents)}** (excesso de ${formatBRL(Math.abs(b.remainingCents))}).`
        : `Já foram usados **${formatBRL(b.spentCents)}** de **${formatBRL(b.limitCents)}**. No ritmo atual, a projeção de fechamento é **${formatBRL(b.projectedCents)}**.`;

    await db.insert(aiInsights).values({
      type: "BUDGET_PACE",
      severity: b.status === "OVER" ? "CRITICAL" : "WARNING",
      title,
      summaryMd,
      referenceMonth: monthKey,
      metadata: { categoryId: b.categoryId, spentCents: b.spentCents, limitCents: b.limitCents },
    });
    createdInsights.push({ type: "BUDGET_PACE", title });
  }

  // Alertas de Anomalias
  for (const a of anomalies.slice(0, 2)) {
    const pct = Math.round(a.increaseRatio * 100);
    const title = `Gasto fora da curva em ${a.categoryName} (+${pct}%)`;
    const summaryMd = `Neste mês você já soma **${formatBRL(a.currentCents)}** em **${a.categoryName}**, contra média histórica de **${formatBRL(a.historicalAvgCents)}** (+${formatBRL(a.currentCents - a.historicalAvgCents)}).`;

    await db.insert(aiInsights).values({
      type: "ANOMALY",
      severity: pct >= 60 ? "CRITICAL" : "WARNING",
      title,
      summaryMd,
      referenceMonth: monthKey,
      metadata: { categoryId: a.categoryId, increaseRatio: a.increaseRatio },
    });
    createdInsights.push({ type: "ANOMALY", title });
  }

  // Alertas de Reajuste de Assinaturas
  for (const hike of priceHikes.slice(0, 2)) {
    const pct = Math.round((hike.priceChangeRatio ?? 0) * 100);
    const diff = hike.latestCents - (hike.previousCents ?? hike.latestCents);
    const title = `Reajuste detectado em ${hike.merchantName} (+${pct}%)`;
    const summaryMd = `A cobrança recorrente de **${hike.merchantName}** subiu de **${formatBRL(hike.previousCents ?? 0)}** para **${formatBRL(hike.latestCents)}** (+${formatBRL(diff)}/mês ou +${formatBRL(diff * 12)}/ano).`;

    await db.insert(aiInsights).values({
      type: "SUBSCRIPTION_ALERT",
      severity: "WARNING",
      title,
      summaryMd,
      referenceMonth: monthKey,
      metadata: { merchantName: hike.merchantName, diffCents: diff },
    });
    createdInsights.push({ type: "SUBSCRIPTION_ALERT", title });
  }

  // Relatório Executivo Mensal via Gemini (com fallback determinístico se sem chave)
  if (currentTotals.transactionCount > 0) {
    const monthLabel = formatMonthLabel(monthKey);
    if (isGeminiConfigured()) {
      try {
        const promptData = {
          mes: monthLabel,
          receitas: formatBRL(currentTotals.incomeCents),
          despesas: formatBRL(currentTotals.expenseCents),
          saldoLiquido: formatBRL(currentTotals.netCents),
          taxaPoupanca: `${(currentTotals.savingsRate * 100).toFixed(1)}%`,
          topCategorias: currentByCat.slice(0, 5).map((c) => ({
            categoria: c.categoryName,
            valor: formatBRL(c.totalCents),
            participacao: `${(c.share * 100).toFixed(1)}%`,
          })),
          anomalias: anomalies.map((a) => ({
            categoria: a.categoryName,
            atual: formatBRL(a.currentCents),
            media: formatBRL(a.historicalAvgCents),
          })),
          reajustesAssinaturas: priceHikes.map((h) => h.merchantName),
        };

        const { object } = await generateObject({
          model: getGeminiModel(),
          schema: monthlyReportSchema,
          system:
            "Você é um consultor financeiro pessoal direto, claro e encorajador. Analise os números EXATOS fornecidos (nunca invente valores) e escreva um diagnóstico executivo conciso em português do Brasil.",
          prompt: `Gere o relatório mensal para ${monthLabel} com base nestes dados reais:\n${JSON.stringify(promptData, null, 2)}`,
        });

        await db.insert(aiInsights).values({
          type: "MONTHLY_REPORT",
          severity: object.severity,
          title: object.title,
          summaryMd: object.summaryMd,
          referenceMonth: monthKey,
          metadata: { generatedBy: "gemini" },
        });
        createdInsights.push({ type: "MONTHLY_REPORT", title: object.title });
      } catch {
        await insertFallbackMonthlyReport(monthKey, monthLabel, currentTotals, currentByCat);
        createdInsights.push({ type: "MONTHLY_REPORT", title: `Resumo de ${monthLabel}` });
      }
    } else {
      await insertFallbackMonthlyReport(monthKey, monthLabel, currentTotals, currentByCat);
      createdInsights.push({ type: "MONTHLY_REPORT", title: `Resumo de ${monthLabel}` });
    }
  }

  return {
    monthKey,
    insightsCreated: createdInsights.length,
    anomaliesFound: anomalies.length,
    priceHikesFound: priceHikes.length,
    insights: createdInsights,
  };
}

async function insertFallbackMonthlyReport(
  monthKey: string,
  monthLabel: string,
  totals: Awaited<ReturnType<typeof getPeriodTotals>>,
  byCat: Awaited<ReturnType<typeof getSpendingByCategory>>
) {
  const db = getDb();
  const top = byCat[0];
  const summaryMd = [
    `- **Entradas:** ${formatBRL(totals.incomeCents)} | **Saídas:** ${formatBRL(totals.expenseCents)}`,
    `- **Resultado líquido:** ${formatBRL(totals.netCents, { showSign: true })} (taxa de poupança de ${(totals.savingsRate * 100).toFixed(1)}%)`,
    top
      ? `- **Maior categoria de gasto:** ${top.categoryName} com ${formatBRL(top.totalCents)} (${(top.share * 100).toFixed(1)}% das saídas).`
      : "- Sem despesas categorizadas neste mês.",
  ].join("\n");

  await db.insert(aiInsights).values({
    type: "MONTHLY_REPORT",
    severity: totals.netCents < 0 ? "WARNING" : "INFO",
    title: `Resumo Financeiro — ${monthLabel}`,
    summaryMd,
    referenceMonth: monthKey,
    metadata: { generatedBy: "deterministic" },
  });
}
