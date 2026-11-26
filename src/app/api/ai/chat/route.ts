import { NextRequest, NextResponse } from "next/server";
import { streamText, tool } from "ai";
import { z } from "zod";
import { and, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import { getDb, accounts, transactions, categories, goals } from "@/db";
import { requireUserSession } from "@/lib/session";
import { unauthorizedResponse } from "@/lib/auth-guard";
import { getGeminiModel } from "@/lib/ai/model";
import { isGeminiConfigured } from "@/lib/env";
import {
  getBudgetsWithProgress,
  getCreditCardsOverview,
  getMonthlyCashflowSeries,
  getPeriodTotals,
  getRecurringOverview,
  getSpendingByCategory,
} from "@/lib/queries";
import {
  formatBRL,
  getCurrentMonthKey,
  getMonthRange,
} from "@/lib/format";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  if (!isGeminiConfigured()) {
    return NextResponse.json(
      { error: "Configure GOOGLE_GENERATIVE_AI_API_KEY no .env.local para usar o Chat Financeiro." },
      { status: 400 }
    );
  }

  const { messages } = await req.json();
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = getCurrentMonthKey();

  const result = streamText({
    model: getGeminiModel(),
    maxSteps: 6,
    system: `Você é o FinSense AI, o analista financeiro pessoal do usuário.
Data de hoje: ${today} (mês atual: ${currentMonth}).

REGRAS OBRIGATÓRIAS:
1. NUNCA invente ou estime valores financeiros. Sempre consulte os dados reais usando as ferramentas disponíveis.
2. Transferências entre contas próprias (TRANSFER) e pagamento de fatura (CC_PAYMENT) já são excluídos automaticamente dos totais de receitas e despesas pelas ferramentas.
3. Responda sempre em português do Brasil, de forma clara, direta, prática e formatada em reais (R$ 1.234,56).
4. Sempre que a resposta envolver comparações entre meses, distribuição por categoria ou projeção de faturas, chame a ferramenta \`renderChart\` para exibir um gráfico visual interativo junto com sua explicação.
5. Ao responder perguntas como "posso parcelar X?", consulte saldo líquido, orçamento, projeção de faturas futuras e taxa de poupança antes de opinar.`,
    messages,
    tools: {
      getAccountsBalance: tool({
        description: "Lista todas as contas bancárias, saldos atuais e cartões de crédito com seus limites.",
        parameters: z.object({}),
        execute: async () => {
          const db = getDb();
          const list = await db.select().from(accounts).where(eq(accounts.isArchived, false));
          return list.map((a) => ({
            nome: a.name,
            instituicao: a.institutionName,
            tipo: a.type,
            saldo: formatBRL(a.balanceCents),
            saldoCents: a.balanceCents,
            limiteTotal: a.creditLimitCents ? formatBRL(a.creditLimitCents) : null,
            limiteDisponivel: a.availableCreditLimitCents
              ? formatBRL(a.availableCreditLimitCents)
              : null,
          }));
        },
      }),

      getPeriodSummary: tool({
        description:
          "Retorna entradas, saídas, saldo líquido e taxa de poupança para um intervalo de datas (YYYY-MM-DD) ou série mensal.",
        parameters: z.object({
          startDate: z.string().describe("Data inicial YYYY-MM-DD"),
          endDate: z.string().describe("Data final YYYY-MM-DD"),
        }),
        execute: async ({ startDate, endDate }) => {
          const totals = await getPeriodTotals(startDate, endDate);
          return {
            periodo: `${startDate} a ${endDate}`,
            entradas: formatBRL(totals.incomeCents),
            saidas: formatBRL(totals.expenseCents),
            resultadoLiquido: formatBRL(totals.netCents, { showSign: true }),
            taxaPoupancaPct: Number((totals.savingsRate * 100).toFixed(1)),
            quantidadeTransacoes: totals.transactionCount,
            entradasCents: totals.incomeCents,
            saidasCents: totals.expenseCents,
          };
        },
      }),

      getCashflowHistory: tool({
        description: "Retorna evolução mensal de entradas, saídas e economia líquida dos últimos N meses.",
        parameters: z.object({
          months: z.number().int().min(2).max(12).default(6),
        }),
        execute: async ({ months }) => {
          const series = await getMonthlyCashflowSeries(currentMonth, months);
          return series.map((s) => ({
            mes: s.label,
            monthKey: s.monthKey,
            entradasReais: Number((s.incomeCents / 100).toFixed(2)),
            saidasReais: Number((s.expenseCents / 100).toFixed(2)),
            liquidoReais: Number((s.netCents / 100).toFixed(2)),
          }));
        },
      }),

      getSpendingByCategory: tool({
        description: "Agrupa despesas por categoria em um período (YYYY-MM-DD).",
        parameters: z.object({
          startDate: z.string().describe("YYYY-MM-DD"),
          endDate: z.string().describe("YYYY-MM-DD"),
        }),
        execute: async ({ startDate, endDate }) => {
          const cats = await getSpendingByCategory(startDate, endDate);
          return cats.map((c) => ({
            categoria: c.categoryName,
            valor: formatBRL(c.totalCents),
            valorReais: Number((c.totalCents / 100).toFixed(2)),
            percentual: Number((c.share * 100).toFixed(1)),
            quantidade: c.count,
          }));
        },
      }),

      searchTransactions: tool({
        description:
          "Busca transações individuais por estabelecimento/descrição, período, tipo ou categoria.",
        parameters: z.object({
          query: z.string().optional().describe("Termo de busca (ex: iFood, Uber, farmácia)"),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          kind: z.enum(["INCOME", "EXPENSE", "TRANSFER", "CC_PAYMENT"]).optional(),
          limit: z.number().int().min(1).max(50).default(20),
        }),
        execute: async ({ query, startDate, endDate, kind, limit }) => {
          const db = getDb();
          const conditions = [];
          if (query) {
            conditions.push(
              or(
                ilike(transactions.cleanMerchant, `%${query}%`),
                ilike(transactions.rawDescription, `%${query}%`)
              )
            );
          }
          if (startDate) conditions.push(gte(transactions.occurredAt, startDate));
          if (endDate) conditions.push(lte(transactions.occurredAt, endDate));
          if (kind) conditions.push(eq(transactions.kind, kind));

          const rows = await db
            .select({
              tx: transactions,
              categoryName: categories.name,
              accountName: accounts.name,
            })
            .from(transactions)
            .leftJoin(categories, eq(transactions.categoryId, categories.id))
            .leftJoin(accounts, eq(transactions.accountId, accounts.id))
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(transactions.occurredAt))
            .limit(limit);

          const totalCents = rows.reduce((acc, r) => acc + r.tx.amountCents, 0);

          return {
            totalEncontrado: formatBRL(totalCents),
            quantidade: rows.length,
            transacoes: rows.map((r) => ({
              data: r.tx.occurredAt,
              estabelecimento: r.tx.cleanMerchant,
              valor: formatBRL(r.tx.amountCents),
              tipo: r.tx.kind,
              categoria: r.categoryName ?? "Sem categoria",
              conta: r.accountName ?? "Conta",
              parcela: r.tx.installmentTotal
                ? `${r.tx.installmentNumber}/${r.tx.installmentTotal}`
                : null,
            })),
          };
        },
      }),

      getCreditCardForecast: tool({
        description:
          "Retorna faturas atuais de cartões de crédito e projeção de parcelas já comprometidas para os próximos meses.",
        parameters: z.object({}),
        execute: async () => {
          const overview = await getCreditCardsOverview(currentMonth);
          return {
            cartoes: overview.cards.map((c) => ({
              nome: c.name,
              limiteTotal: formatBRL(c.creditLimitCents ?? 0),
              limiteDisponivel: formatBRL(c.availableCreditLimitCents ?? 0),
              faturaAtual: c.bills[0] ? formatBRL(c.bills[0].totalCents) : "R$ 0,00",
            })),
            parcelasFuturas: overview.forecast.map((f) => ({
              mes: f.monthKey,
              comprometido: formatBRL(f.committedCents),
              comprometidoReais: Number((f.committedCents / 100).toFixed(2)),
              itens: f.items.map(
                (i) => `${i.cleanMerchant} (${i.installmentNumber}/${i.installmentTotal}) — ${formatBRL(i.amountCents)}`
              ),
            })),
          };
        },
      }),

      getBudgetHealth: tool({
        description: "Retorna o status atual dos orçamentos mensais por categoria e projeção de estouro.",
        parameters: z.object({
          monthKey: z.string().optional().describe("YYYY-MM (padrão: mês atual)"),
        }),
        execute: async ({ monthKey }) => {
          const target = monthKey || currentMonth;
          const list = await getBudgetsWithProgress(target);
          return {
            mes: target,
            intervalo: getMonthRange(target),
            orcamentos: list.map((b) => ({
              categoria: b.categoryName,
              gasto: formatBRL(b.spentCents),
              limite: formatBRL(b.limitCents),
              usoPct: Math.round(b.usageRatio * 100),
              projecaoFimDoMes: formatBRL(b.projectedCents),
              status: b.status,
            })),
          };
        },
      }),

      getRecurringAndGoals: tool({
        description: "Lista assinaturas/contas fixas recorrentes e o progresso das metas financeiras.",
        parameters: z.object({}),
        execute: async () => {
          const db = getDb();
          const [rec, allGoals] = await Promise.all([
            getRecurringOverview(),
            db.select().from(goals),
          ]);

          return {
            assinaturasAtivas: rec.items
              .filter((i) => i.status === "ACTIVE")
              .map((i) => ({
                nome: i.merchantName,
                valor: formatBRL(i.expectedCents),
                valorAnterior: i.previousCents ? formatBRL(i.previousCents) : null,
                frequencia: i.frequency,
              })),
            metas: allGoals.map((g) => ({
              nome: g.name,
              atual: formatBRL(g.currentCents),
              alvo: formatBRL(g.targetCents),
              progressoPct: Math.round((g.currentCents / Math.max(1, g.targetCents)) * 100),
              prazo: g.targetDate,
            })),
          };
        },
      }),

      renderChart: tool({
        description:
          "Renderiza um gráfico interativo inline na conversa com o usuário. Use para categorias, fluxo mensal ou projeções.",
        parameters: z.object({
          chartType: z.enum(["bar", "line", "pie"]),
          title: z.string(),
          valuePrefix: z.string().default("R$ "),
          data: z.array(
            z.object({
              label: z.string(),
              value: z.number(),
              secondaryValue: z.number().optional(),
            })
          ),
          primaryLabel: z.string().default("Valor"),
          secondaryLabel: z.string().optional(),
        }),
        execute: async (chartSpec) => {
          return chartSpec;
        },
      }),
    },
  });

  return result.toDataStreamResponse();
}
