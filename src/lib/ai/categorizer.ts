import { generateObject } from "ai";
import { z } from "zod";
import { and, desc, inArray, isNull, ne, sql } from "drizzle-orm";
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
      groupKey: z.string(),
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
  uniqueGroupsClassified: number;
  skipped: number;
  remainingUncategorized: number;
}

function normalizeDescriptionKey(rawDescription: string, kind: string): string {
  const norm = rawDescription
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    // Remove números de parcela para agrupar parcelas da mesma compra
    .replace(/\bPARC(?:ELA)?S?\.?\s*\d{1,2}\s*(?:\/|DE)\s*\d{1,2}\b/g, "")
    .trim();
  return `${kind}|${norm}`;
}

/**
 * Pipeline híbrido inteligente com agrupamento por descrição única:
 * 1) Aplica regras locais determinísticas (custo zero) em todas as transações sem categoria.
 * 2) Agrupa as restantes por descrição única normalizada — envia cada empresa/descrição
 *    APENAS UMA VEZ ao Gemini e atualiza TODAS as ocorrências correspondentes no banco!
 */
export async function categorizePendingTransactions(
  uniqueGroupLimit = 30
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
      .orderBy(desc(transactions.occurredAt)),
    db.select().from(categories),
    db.select().from(categorizationRules),
  ]);

  let matchedByRules = 0;
  let categorizedByAi = 0;
  let uniqueGroupsClassified = 0;
  let skipped = 0;

  // Passo 1: aplica regras locais agrupando IDs por regra para updates rápidos
  const ruleBuckets = new Map<
    string,
    {
      rule: NonNullable<ReturnType<typeof applyCategorizationRules>>;
      ids: string[];
    }
  >();

  // Passo 2: agrupa transações sem match por descrição normalizada + kind
  const aiGroups = new Map<
    string,
    {
      groupKey: string;
      rawDescription: string;
      currentKind: string;
      sampleAmountCents: number;
      latestDate: string;
      ids: string[];
    }
  >();

  for (const tx of pending) {
    const rule = applyCategorizationRules(tx.rawDescription, rules);
    if (rule) {
      const bucket = ruleBuckets.get(rule.id) ?? { rule, ids: [] };
      bucket.ids.push(tx.id);
      ruleBuckets.set(rule.id, bucket);
      continue;
    }

    const key = normalizeDescriptionKey(tx.rawDescription, tx.kind);
    const existingGroup = aiGroups.get(key);
    if (existingGroup) {
      existingGroup.ids.push(tx.id);
    } else {
      aiGroups.set(key, {
        groupKey: key,
        rawDescription: tx.rawDescription,
        currentKind: tx.kind,
        sampleAmountCents: tx.amountCents,
        latestDate: tx.occurredAt,
        ids: [tx.id],
      });
    }
  }

  // Executa updates em lote das regras locais
  for (const { rule, ids } of ruleBuckets.values()) {
    const isNonCat =
      rule.kindOverride === "TRANSFER" || rule.kindOverride === "CC_PAYMENT";
    await db
      .update(transactions)
      .set({
        categoryId: isNonCat ? null : rule.categoryId,
        cleanMerchant: rule.cleanMerchant,
        ...(rule.kindOverride ? { kind: rule.kindOverride } : {}),
        aiConfidence: 1.0,
        reviewed: true,
        updatedAt: new Date(),
      })
      .where(inArray(transactions.id, ids));
    matchedByRules += ids.length;
  }

  // Ordena grupos por maior quantidade de ocorrências primeiro (maximiza impacto por lote!)
  const batchGroups = [...aiGroups.values()]
    .sort((a, b) => b.ids.length - a.ids.length)
    .slice(0, uniqueGroupLimit);

  if (batchGroups.length > 0 && isGeminiConfigured()) {
    const slugToId = new Map(allCategories.map((c) => [c.slug, c.id]));
    const fallbackExpenseId = slugToId.get("outros") ?? null;
    const fallbackIncomeId = slugToId.get("outras-receitas") ?? fallbackExpenseId;

    const categoryListText = allCategories
      .map((c) => `- ${c.slug} (${c.type === "INCOME" ? "Receita" : "Despesa"}): ${c.name}`)
      .join("\n");

    const payloadText = JSON.stringify(
      batchGroups.map((g) => ({
        groupKey: g.groupKey,
        rawDescription: g.rawDescription,
        sampleAmountBRL: (g.sampleAmountCents / 100).toFixed(2),
        occurrences: g.ids.length,
        currentKind: g.currentKind,
      }))
    );

    const { object } = await generateObject({
      model: getGeminiModel(),
      schema: batchSchema,
      system: `Você é um especialista em finanças pessoais brasileiras.
Sua tarefa é limpar descrições de extratos bancários e faturas de cartão e escolher a categoria mais adequada da lista abaixo.

Regras:
- Use APENAS os slugs de categoria listados.
- Retorne TODOS os groupKey enviados exatamente como recebidos.
- Se a descrição indicar transferência entre contas do próprio usuário, use kind="TRANSFER".
- Se indicar pagamento de fatura de cartão, use kind="CC_PAYMENT".
- Limpe o nome do estabelecimento deixando curto e humano em português.

Categorias disponíveis:
${categoryListText}`,
      prompt: `Categorize estes grupos de estabelecimentos/descrições:\n${payloadText}`,
    });

    const groupMap = new Map(batchGroups.map((g) => [g.groupKey, g]));

    for (const item of object.items) {
      const group = groupMap.get(item.groupKey);
      if (!group) continue;

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
        .where(inArray(transactions.id, group.ids));

      categorizedByAi += group.ids.length;
      uniqueGroupsClassified++;
    }
  } else {
    skipped = batchGroups.reduce((acc, g) => acc + g.ids.length, 0);
  }

  const [remainingRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(transactions)
    .where(uncategorizedFilter);

  return {
    matchedByRules,
    categorizedByAi,
    uniqueGroupsClassified,
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
    const matchingIds = allTxs
      .filter((tx) => tx.rawDescription.toUpperCase().includes(upperPattern))
      .map((tx) => tx.id);

    if (matchingIds.length > 0) {
      await db
        .update(transactions)
        .set({
          categoryId: params.categoryId,
          cleanMerchant: params.cleanMerchant.trim(),
          ...(params.kindOverride ? { kind: params.kindOverride } : {}),
          reviewed: true,
          updatedAt: new Date(),
        })
        .where(inArray(transactions.id, matchingIds));
      updatedCount = matchingIds.length;
    }
  }

  return { rule, updatedCount };
}
