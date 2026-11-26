import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, accounts } from "@/db";
import { requireUserSession } from "@/lib/session";
import { unauthorizedResponse } from "@/lib/auth-guard";
import { getCreditCardsOverview } from "@/lib/queries";
import { getCurrentMonthKey } from "@/lib/format";

const createAccountSchema = z.object({
  name: z.string().min(2).max(80),
  institutionName: z.string().min(1).max(80).default("Manual"),
  type: z.enum(["CHECKING", "SAVINGS", "CREDIT_CARD", "CASH"]),
  balanceCents: z.number().int().default(0),
  creditLimitCents: z.number().int().nonnegative().nullable().optional(),
  closingDay: z.number().int().min(1).max(31).nullable().optional(),
  dueDay: z.number().int().min(1).max(31).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const db = getDb();
  const month = req.nextUrl.searchParams.get("month") || getCurrentMonthKey();
  const [allAccounts, cardsOverview] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.isArchived, false)),
    getCreditCardsOverview(month),
  ]);

  return NextResponse.json({
    accounts: allAccounts,
    ...cardsOverview,
  });
}

export async function POST(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const body = await req.json();
  const parsed = createAccountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 }
    );
  }

  const db = getDb();
  const data = parsed.data;
  const [created] = await db
    .insert(accounts)
    .values({
      name: data.name,
      institutionName: data.institutionName,
      type: data.type,
      balanceCents: data.balanceCents,
      creditLimitCents: data.type === "CREDIT_CARD" ? (data.creditLimitCents ?? 0) : null,
      availableCreditLimitCents:
        data.type === "CREDIT_CARD" ? (data.creditLimitCents ?? 0) : null,
      closingDay: data.closingDay ?? null,
      dueDay: data.dueDay ?? null,
    })
    .returning();

  return NextResponse.json({ account: created }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const db = getDb();
  await db
    .update(accounts)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(eq(accounts.id, id));

  return NextResponse.json({ ok: true });
}
