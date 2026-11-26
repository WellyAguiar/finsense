import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, documents, transactions } from "@/db";
import { requireUserSession } from "@/lib/session";
import { unauthorizedResponse } from "@/lib/auth-guard";
import { parseFinancialDocument } from "@/lib/ai/document-parser";
import { buildTransactionFingerprint } from "@/lib/finance-engine";
import { isGeminiConfigured } from "@/lib/env";
import { ensureBaseSeed } from "@/db/seed";

export const maxDuration = 60;

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const MAX_BYTES = 4.5 * 1024 * 1024; // 4.5 MB (limite serverless Vercel)

const confirmImportSchema = z.object({
  documentId: z.string().uuid(),
  accountId: z.string().uuid(),
  items: z.array(
    z.object({
      occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      amountCents: z.number().int().positive(),
      rawDescription: z.string().min(1),
      cleanMerchant: z.string().min(1),
      kind: z.enum(["INCOME", "EXPENSE", "TRANSFER", "CC_PAYMENT"]),
      categoryId: z.string().uuid().nullable().optional(),
      installmentNumber: z.number().int().positive().nullable().optional(),
      installmentTotal: z.number().int().positive().nullable().optional(),
    })
  ),
});

export async function GET() {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const db = getDb();
  const list = await db
    .select()
    .from(documents)
    .orderBy(desc(documents.createdAt))
    .limit(25);

  return NextResponse.json({
    geminiConfigured: isGeminiConfigured(),
    documents: list,
  });
}

export async function POST(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  if (!isGeminiConfigured()) {
    return NextResponse.json(
      { error: "Configure GOOGLE_GENERATIVE_AI_API_KEY no .env.local para ler PDFs e comprovantes." },
      { status: 400 }
    );
  }

  await ensureBaseSeed();
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo PDF ou imagem." }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Formato não suportado. Envie PDF, PNG, JPG ou WEBP." },
      { status: 400 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Arquivo muito grande. O limite é 4,5 MB." },
      { status: 400 }
    );
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const extracted = await parseFinancialDocument({
      fileName: file.name,
      mimeType: file.type,
      fileBuffer: buffer,
    });

    return NextResponse.json({ ok: true, extracted }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao extrair documento com Gemini" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const body = await req.json();
  const parsed = confirmImportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 }
    );
  }

  const db = getDb();
  const { documentId, accountId, items } = parsed.data;

  let imported = 0;
  for (const item of items) {
    const fingerprint = buildTransactionFingerprint({
      accountId,
      amountCents: item.amountCents,
      occurredAt: item.occurredAt,
      rawDescription: item.rawDescription,
    });

    await db.insert(transactions).values({
      accountId,
      documentId,
      categoryId:
        item.kind === "TRANSFER" || item.kind === "CC_PAYMENT"
          ? null
          : (item.categoryId ?? null),
      source: "DOCUMENT_AI",
      kind: item.kind,
      amountCents: item.amountCents,
      occurredAt: item.occurredAt,
      rawDescription: item.rawDescription,
      cleanMerchant: item.cleanMerchant,
      installmentNumber: item.installmentNumber ?? null,
      installmentTotal: item.installmentTotal ?? null,
      fingerprint,
      reviewed: true,
    });
    imported++;
  }

  await db
    .update(documents)
    .set({ status: "IMPORTED" })
    .where(eq(documents.id, documentId));

  return NextResponse.json({ ok: true, imported });
}
