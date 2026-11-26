import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, budgets, categories } from "@/db";
import { requireUserSession } from "@/lib/session";
import { unauthorizedResponse } from "@/lib/auth-guard";
import { getBudgetsWithProgress } from "@/lib/queries";
import { getCurrentMonthKey } from "@/lib/format";
import { ensureBaseSeed } from "@/db/seed";

const upsertBudgetSchema = z.object({
  categoryId: z.string().uuid(),
  referenceMonth: z.string().default("DEFAULT"),
  limitCents: z.number().int().positive(),
});

export async function GET(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const db = getDb();
  await ensureBaseSeed();
  const month = req.nextUrl.searchParams.get("month") || getCurrentMonthKey();

  const [progress, expenseCategories] = await Promise.all([
    getBudgetsWithProgress(month),
    db.select().from(categories).where(eq(categories.type, "EXPENSE")),
  ]);

  return NextResponse.json({
    monthKey: month,
    budgets: progress,
    categories: expenseCategories,
  });
}

export async function POST(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const body = await req.json();
  const parsed = upsertBudgetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 }
    );
  }

  const db = getDb();
  const [saved] = await db
    .insert(budgets)
    .values({
      categoryId: parsed.data.categoryId,
      referenceMonth: parsed.data.referenceMonth,
      limitCents: parsed.data.limitCents,
    })
    .onConflictDoUpdate({
      target: [budgets.categoryId, budgets.referenceMonth],
      set: {
        limitCents: parsed.data.limitCents,
        updatedAt: new Date(),
      },
    })
    .returning();

  return NextResponse.json({ budget: saved }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const db = getDb();
  await db.delete(budgets).where(eq(budgets.id, id));
  return NextResponse.json({ ok: true });
}
