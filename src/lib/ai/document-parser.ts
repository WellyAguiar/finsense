import { generateObject } from "ai";
import { z } from "zod";
import { gte } from "drizzle-orm";
import { getDb, categories, transactions, documents } from "@/db";
import { getGeminiModel } from "@/lib/ai/model";
import { findPotentialDuplicates, parseInstallmentInfo } from "@/lib/finance-engine";

const extractedDocumentSchema = z.object({
  documentType: z.enum(["RECEIPT", "CREDIT_CARD_BILL", "PIX", "BOLETO", "INVOICE"]),
  institutionOrIssuer: z.string().describe("Banco, bandeira do cartão ou emissor do documento"),
  summaryNote: z.string().describe("Resumo breve do documento em português"),
  items: z.array(
    z.object({
      occurredAt: z.string().describe("Data no formato YYYY-MM-DD"),
      amountBRL: z.number().positive().describe("Valor em reais (sempre positivo, ex: 129.90)"),
      rawDescription: z.string().describe("Descrição original que aparece no documento"),
      cleanMerchant: z.string().describe("Nome limpo do estabelecimento ou recebedor"),
      kind: z.enum(["INCOME", "EXPENSE", "TRANSFER", "CC_PAYMENT"]),
      suggestedCategorySlug: z.string(),
      installmentNumber: z.number().int().positive().nullable().optional(),
      installmentTotal: z.number().int().positive().nullable().optional(),
    })
  ),
});

export type ExtractedDocumentResult = z.infer<typeof extractedDocumentSchema>;

/**
 * Usa Gemini multimodal para extrair transações estruturadas de PDFs de faturas,
 * notas fiscais, comprovantes de Pix ou boletos, já sinalizando possíveis duplicidades.
 */
export async function parseFinancialDocument(params: {
  fileName: string;
  mimeType: string;
  fileBuffer: Buffer;
}) {
  const db = getDb();
  const allCategories = await db.select().from(categories);
  const categoryListText = allCategories
    .map((c) => `- ${c.slug} (${c.type}): ${c.name}`)
    .join("\n");

  const today = new Date().toISOString().slice(0, 10);

  const { object } = await generateObject({
    model: getGeminiModel(),
    schema: extractedDocumentSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analise este documento financeiro brasileiro (pode ser comprovante Pix, nota fiscal, boleto ou fatura de cartão de crédito em PDF/imagem).
Data de referência de hoje: ${today}.

Extraia TODOS os lançamentos encontrados com precisão absoluta nos valores e datas.
- Datas sempre no formato YYYY-MM-DD.
- Valores sempre positivos em reais (ex: 54.90).
- Se for pagamento de fatura, use kind="CC_PAYMENT".
- Escolha suggestedCategorySlug exclusivamente dentre:
${categoryListText}`,
          },
          {
            type: "file",
            data: params.fileBuffer,
            mimeType: params.mimeType,
          },
        ],
      },
    ],
  });

  // Busca transações recentes para sinalizar possíveis duplicidades
  const dates = object.items.map((i) => i.occurredAt).sort();
  const earliest = dates[0] ?? today;
  const searchStart = new Date(`${earliest}T12:00:00Z`);
  searchStart.setDate(searchStart.getDate() - 5);
  const searchStartStr = searchStart.toISOString().slice(0, 10);

  const existingTxs = await db
    .select()
    .from(transactions)
    .where(gte(transactions.occurredAt, searchStartStr));

  const slugToCategory = new Map(allCategories.map((c) => [c.slug, c]));

  const enrichedItems = object.items.map((item) => {
    const amountCents = Math.round(item.amountBRL * 100);
    const parsedInst = parseInstallmentInfo(item.rawDescription);
    const duplicates = findPotentialDuplicates(
      {
        amountCents,
        occurredAt: item.occurredAt,
        description: `${item.cleanMerchant} ${item.rawDescription}`,
      },
      existingTxs,
      3
    );

    const cat = slugToCategory.get(item.suggestedCategorySlug) ?? slugToCategory.get("outros");

    return {
      occurredAt: item.occurredAt,
      amountCents,
      rawDescription: item.rawDescription,
      cleanMerchant: item.cleanMerchant,
      kind: item.kind,
      categoryId: cat?.id ?? null,
      categoryName: cat?.name ?? "Outros",
      installmentNumber: item.installmentNumber ?? parsedInst?.installmentNumber ?? null,
      installmentTotal: item.installmentTotal ?? parsedInst?.installmentTotal ?? null,
      possibleDuplicate: duplicates[0]
        ? {
            transactionId: duplicates[0].transaction.id,
            merchant: duplicates[0].transaction.cleanMerchant,
            occurredAt: duplicates[0].transaction.occurredAt,
            score: duplicates[0].score,
          }
        : null,
    };
  });

  const [docRecord] = await db
    .insert(documents)
    .values({
      fileName: params.fileName,
      mimeType: params.mimeType,
      fileSizeBytes: params.fileBuffer.byteLength,
      documentType: object.documentType,
      extractedPayload: {
        institutionOrIssuer: object.institutionOrIssuer,
        summaryNote: object.summaryNote,
        items: enrichedItems,
      },
      status: "PENDING_REVIEW",
      notes: object.summaryNote,
    })
    .returning();

  return {
    documentId: docRecord.id,
    documentType: object.documentType,
    institutionOrIssuer: object.institutionOrIssuer,
    summaryNote: object.summaryNote,
    items: enrichedItems,
  };
}
