import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, transactions, accounts, categories } from "@/db";
import { requireUserSession } from "@/lib/session";
import { unauthorizedResponse } from "@/lib/auth-guard";
import { buildTransactionFingerprint, parseInstallmentInfo } from "@/lib/finance-engine";
import { learnCategorizationRule } from "@/lib/ai/categorizer";
import { ensureBaseSeed } from "@/db/seed";

const createTxSchema = z.object({
  accountId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  kind: z.enum(["INCOME", "EXPENSE", "TRANSFER", "CC_PAYMENT"]),
  amountCents: z.number().int().positive(),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cleanMerchant: z.string().min(1).max(160),
  rawDescription: z.string().optional(),
  notes: z.string().max(500).nullable().optional(),
  installmentNumber: z.number().int().positive().nullable().optional(),
  installmentTotal: z.number().int().positive().nullable().optional(),
});

const patchTxSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  cleanMerchant: z.string().min(1).max(160).optional(),
  kind: z.enum(["INCOME", "EXPENSE", "TRANSFER", "CC_PAYMENT"]).optional(),
  notes: z.string().max(500).nullable().optional(),
  reviewed: z.boolean().optional(),
  learnRule: z.boolean().optional(),
  rulePattern: z.string().optional(),
  applyRetroactively: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const db = getDb();
  await ensureBaseSeed();

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const accountId = sp.get("accountId");
  const categoryId = sp.get("categoryId");
  const kind = sp.get("kind");
  const startDate = sp.get("startDate");
  const endDate = sp.get("endDate");
  const onlyUnreviewed = sp.get("unreviewed") === "1";
  const limit = Math.min(Number(sp.get("limit") || 150), 500);

  const conditions = [];
  if (q) {
    conditions.push(
      or(
        ilike(transactions.cleanMerchant, `%${q}%`),
        ilike(transactions.rawDescription, `%${q}%`),
        ilike(transactions.notes, `%${q}%`)
      )
    );
  }
  if (accountId) conditions.push(eq(transactions.accountId, accountId));
  if (categoryId) conditions.push(eq(transactions.categoryId, categoryId));
  if (kind) conditions.push(eq(transactions.kind, kind));
  if (startDate) conditions.push(gte(transactions.occurredAt, startDate));
  if (endDate) conditions.push(lte(transactions.occurredAt, endDate));
  if (onlyUnreviewed) conditions.push(eq(transactions.reviewed, false));

  const [rows, allAccounts, allCategories] = await Promise.all([
    db
      .select({
        tx: transactions,
        accountName: accounts.name,
        accountType: accounts.type,
        categoryName: categories.name,
        categoryColor: categories.color,
      })
      .from(transactions)
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt))
      .limit(limit),
    db.select().from(accounts).where(eq(accounts.isArchived, false)),
    db.select().from(categories),
  ]);

  return NextResponse.json({
    transactions: rows.map((r) => ({
      ...r.tx,
      accountName: r.accountName ?? "Conta",
      accountType: r.accountType ?? "CHECKING",
      categoryName: r.categoryName ?? null,
      categoryColor: r.categoryColor ?? "#94a3b8",
    })),
    accounts: allAccounts,
    categories: allCategories,
  });
}

export async function POST(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const body = await req.json();
  const parsed = createTxSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 }
    );
  }

  const db = getDb();
  const data = parsed.data;
  const rawDescription = data.rawDescription?.trim() || data.cleanMerchant;
  const parsedInst = parseInstallmentInfo(rawDescription);

  const fingerprint = buildTransactionFingerprint({
    accountId: data.accountId,
    amountCents: data.amountCents,
    occurredAt: data.occurredAt,
    rawDescription,
  });

  const [created] = await db
    .insert(transactions)
    .values({
      accountId: data.accountId,
      categoryId: data.kind === "TRANSFER" || data.kind === "CC_PAYMENT" ? null : (data.categoryId ?? null),
      source: "MANUAL",
      kind: data.kind,
      amountCents: data.amountCents,
      occurredAt: data.occurredAt,
      rawDescription,
      cleanMerchant: data.cleanMerchant,
      notes: data.notes ?? null,
      installmentNumber: data.installmentNumber ?? parsedInst?.installmentNumber ?? null,
      installmentTotal: data.installmentTotal ?? parsedInst?.installmentTotal ?? null,
      fingerprint,
      reviewed: true,
    })
    .returning();

  return NextResponse.json({ transaction: created }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const body = await req.json();
  const parsed = patchTxSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 }
    );
  }

  const db = getDb();
  const data = parsed.data;

  const [existing] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, data.id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Transação não encontrada" }, { status: 404 });
  }

  const nextKind = data.kind ?? existing.kind;
  const nextCategoryId =
    nextKind === "TRANSFER" || nextKind === "CC_PAYMENT"
      ? null
      : data.categoryId !== undefined
        ? data.categoryId
        : existing.categoryId;

  const [updated] = await db
    .update(transactions)
    .set({
      categoryId: nextCategoryId,
      cleanMerchant: data.cleanMerchant ?? existing.cleanMerchant,
      kind: nextKind,
      notes: data.notes !== undefined ? data.notes : existing.notes,
      reviewed: data.reviewed ?? true,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, data.id))
    .returning();

  let learned = null;
  if (data.learnRule && nextCategoryId) {
    const pattern = data.rulePattern?.trim() || existing.rawDescription.slice(0, 28);
    learned = await learnCategorizationRule({
      pattern,
      cleanMerchant: updated.cleanMerchant,
      categoryId: nextCategoryId,
      kindOverride: nextKind !== "EXPENSE" && nextKind !== "INCOME" ? nextKind : null,
      applyRetroactively: data.applyRetroactively ?? true,
    });
  }

  return NextResponse.json({ transaction: updated, learned });
}

export async function DELETE(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const db = getDb();
  await db.delete(transactions).where(eq(transactions.id, id));
  return NextResponse.json({ ok: true });
}
