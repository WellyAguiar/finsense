import { generateObject } from "ai";
import { z } from "zod";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  getDb,
  transactions,
  categories,
  categorizationRules,
} from "@/db";
import { applyCategorizationRules } from "@/lib/finance-engine";
import { getGeminiModel } from "@/lib/ai/model";
import { isGeminiConfigured } from "@/lib/env";

const batchSchema = z.object({
  items: z.array(
    z.object({
      transactionId: z.string(),
      cleanMerchant: z
        .string()
        .describe("Nome limpo e legível do estabelecimento ou descrição em português"),
      categorySlug: z
        .string()
        .describe("Slug exato de uma das categorias disponíveis"),
      kind: z.enum(["INCOME", "EXPENSE", "TRANSFER", "CC_PAYMENT"]),
      confidence: z.number().min(0).max(1),
    })
  ),
});

export interface CategorizationSummary {
  matchedByRules: number;
  categorizedByAi: number;
  skipped: number;
  remainingUncategorized: number;
}

/**
 * Pipeline híbrido (dos lançamentos mais recentes para os mais antigos):
 * 1) Aplica regras locais determinísticas (custo zero) em TODAS as transações sem categoria.
 * 2) Envia até `limit` transações ainda sem categoria em lote para o Gemini.
 */
export async function categorizePendingTransactions(
  limit = 25
): Promise<CategorizationSummary> {
  const db = getDb();

  const uncategorizedFilter = and(
    isNull(transactions.categoryId),
    ne(transactions.kind, "TRANSFER"),
    ne(transactions.kind, "CC_PAYMENT")
  );

  const [pending, allCategories, rules] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(uncategorizedFilter)
      .orderBy(desc(transactions.occurredAt))
      .limit(Math.max(limit * 4, 100)),
    db.select().from(categories),
    db.select().from(categorizationRules),
  ]);

  let matchedByRules = 0;
  let categorizedByAi = 0;
  let skipped = 0;

  const needsAi: typeof pending = [];

  for (const tx of pending) {
    const rule = applyCategorizationRules(tx.rawDescription, rules);
    if (rule) {
      await db
        .update(transactions)
        .set({
          categoryId:
            rule.kindOverride === "TRANSFER" || rule.kindOverride === "CC_PAYMENT"
              ? null
              : rule.categoryId,
          cleanMerchant: rule.cleanMerchant,
          kind: rule.kindOverride ?? tx.kind,
          aiConfidence: 1.0,
          reviewed: true,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, tx.id));
      matchedByRules++;
    } else if (needsAi.length < limit) {
      needsAi.push(tx);
    }
  }

  if (needsAi.length > 0 && isGeminiConfigured()) {
    const slugToId = new Map(allCategories.map((c) => [c.slug, c.id]));
    const fallbackExpenseId = slugToId.get("outros") ?? null;
    const fallbackIncomeId = slugToId.get("outras-receitas") ?? fallbackExpenseId;

    const categoryListText = allCategories
      .map((c) => `- ${c.slug} (${c.type === "INCOME" ? "Receita" : "Despesa"}): ${c.name}`)
      .join("\n");

    const payloadText = JSON.stringify(
      needsAi.map((t) => ({
        transactionId: t.id,
        rawDescription: t.rawDescription,
        amountBRL: (t.amountCents / 100).toFixed(2),
        currentKind: t.kind,
        date: t.occurredAt,
      }))
    );

    const { object } = await generateObject({
      model: getGeminiModel(),
      schema: batchSchema,
      system: `Você é um especialista em finanças pessoais brasileiras.
Sua tarefa é limpar descrições confusas de extratos bancários e faturas de cartão (ex: "PAG*JoseDaSilva", "IFD*BURGER KING", "MP*MERCADOLIVRE") e escolher a categoria mais adequada da lista abaixo.

Regras:
- Use APENAS os slugs de categoria listados.
- Retorne TODOS os transactionId enviados.
- Se a descrição indicar transferência entre contas do próprio usuário, use kind="TRANSFER".
- Se indicar pagamento de fatura de cartão, use kind="CC_PAYMENT".
- Limpe o nome do estabelecimento deixando curto e humano em português.

Categorias disponíveis:
${categoryListText}`,
      prompt: `Categorize estas transações:\n${payloadText}`,
    });

    for (const item of object.items) {
      const categoryId =
        item.kind === "TRANSFER" || item.kind === "CC_PAYMENT"
          ? null
          : (slugToId.get(item.categorySlug) ??
              (item.kind === "INCOME" ? fallbackIncomeId : fallbackExpenseId));

      await db
        .update(transactions)
        .set({
          cleanMerchant: item.cleanMerchant,
          categoryId,
          kind: item.kind,
          aiConfidence: item.confidence,
          reviewed: item.confidence >= 0.75,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, item.transactionId));
      categorizedByAi++;
    }
  } else {
    skipped = needsAi.length;
  }

  const [remainingRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(transactions)
    .where(uncategorizedFilter);

  return {
    matchedByRules,
    categorizedByAi,
    skipped,
    remainingUncategorized: Number(remainingRow?.count ?? 0),
  };
}

/**
 * Cria uma regra de categorização a partir de uma correção do usuário
 * e opcionalmente aplica retroativamente às transações correspondentes.
 */
export async function learnCategorizationRule(params: {
  pattern: string;
  cleanMerchant: string;
  categoryId: string;
  kindOverride?: string | null;
  applyRetroactively?: boolean;
}) {
  const db = getDb();
  const cleanPattern = params.pattern.trim();
  if (!cleanPattern) throw new Error("Padrão da regra não pode ser vazio.");

  const [rule] = await db
    .insert(categorizationRules)
    .values({
      pattern: cleanPattern,
      matchType: "CONTAINS",
      cleanMerchant: params.cleanMerchant.trim(),
      categoryId: params.categoryId,
      kindOverride: params.kindOverride ?? null,
      priority: 5,
    })
    .returning();

  let updatedCount = 0;
  if (params.applyRetroactively) {
    const allTxs = await db.select().from(transactions);
    const upperPattern = cleanPattern.toUpperCase();
    for (const tx of allTxs) {
      if (tx.rawDescription.toUpperCase().includes(upperPattern)) {
        await db
          .update(transactions)
          .set({
            categoryId: params.categoryId,
            cleanMerchant: params.cleanMerchant.trim(),
            kind: params.kindOverride ?? tx.kind,
            reviewed: true,
            updatedAt: new Date(),
          })
          .where(eq(transactions.id, tx.id));
        updatedCount++;
      }
    }
  }

  return { rule, updatedCount };
}
