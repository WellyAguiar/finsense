import { generateObject } from "ai";
import { z } from "zod";
import { eq, isNull, or } from "drizzle-orm";
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
}

/**
 * Pipeline híbrido:
 * 1) Aplica regras locais determinísticas (custo zero).
 * 2) Envia apenas transações pendentes sem match em lotes para o Gemini.
 */
export async function categorizePendingTransactions(
  limit = 40
): Promise<CategorizationSummary> {
  const db = getDb();

  const [pending, allCategories, rules] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(or(isNull(transactions.categoryId), eq(transactions.reviewed, false)))
      .limit(limit),
    db.select().from(categories),
    db.select().from(categorizationRules),
  ]);

  let matchedByRules = 0;
  let categorizedByAi = 0;
  let skipped = 0;

  const needsAi: typeof pending = [];

  for (const tx of pending) {
    if (tx.kind === "TRANSFER" || tx.kind === "CC_PAYMENT") {
      await db
        .update(transactions)
        .set({ reviewed: true, updatedAt: new Date() })
        .where(eq(transactions.id, tx.id));
      skipped++;
      continue;
    }

    const rule = applyCategorizationRules(tx.rawDescription, rules);
    if (rule) {
      await db
        .update(transactions)
        .set({
          categoryId: rule.categoryId,
          cleanMerchant: rule.cleanMerchant,
          kind: rule.kindOverride ?? tx.kind,
          aiConfidence: 1.0,
          reviewed: true,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, tx.id));
      matchedByRules++;
    } else if (!tx.categoryId) {
      needsAi.push(tx);
    } else {
      skipped++;
    }
  }

  if (needsAi.length === 0 || !isGeminiConfigured()) {
    return { matchedByRules, categorizedByAi, skipped: skipped + needsAi.length };
  }

  const slugToId = new Map(allCategories.map((c) => [c.slug, c.id]));
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
- Se a descrição indicar transferência entre contas do próprio usuário, use kind="TRANSFER".
- Se indicar pagamento de fatura de cartão, use kind="CC_PAYMENT".
- Limpe o nome do estabelecimento deixando curto e humano em português.

Categorias disponíveis:
${categoryListText}`,
    prompt: `Categorize estas transações:\n${payloadText}`,
  });

  for (const item of object.items) {
    const categoryId = slugToId.get(item.categorySlug) ?? slugToId.get("outros") ?? null;
    await db
      .update(transactions)
      .set({
        cleanMerchant: item.cleanMerchant,
        categoryId:
          item.kind === "TRANSFER" || item.kind === "CC_PAYMENT" ? null : categoryId,
        kind: item.kind,
        aiConfidence: item.confidence,
        reviewed: item.confidence >= 0.82,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, item.transactionId));
    categorizedByAi++;
  }

  return { matchedByRules, categorizedByAi, skipped };
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
