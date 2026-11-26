import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, recurringItems } from "@/db";
import { requireUserSession } from "@/lib/session";
import { unauthorizedResponse } from "@/lib/auth-guard";
import { getRecurringOverview } from "@/lib/queries";

const createRecurringSchema = z.object({
  merchantName: z.string().min(1).max(120),
  categoryId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  expectedCents: z.number().int().positive(),
  expectedDay: z.number().int().min(1).max(31).default(5),
  frequency: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY"),
});

const patchRecurringSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]).optional(),
  expectedCents: z.number().int().positive().optional(),
  expectedDay: z.number().int().min(1).max(31).optional(),
});

export async function GET() {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const data = await getRecurringOverview();
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const body = await req.json();
  const parsed = createRecurringSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 }
    );
  }

  const db = getDb();
  const [created] = await db
    .insert(recurringItems)
    .values({
      merchantName: parsed.data.merchantName,
      categoryId: parsed.data.categoryId ?? null,
      accountId: parsed.data.accountId ?? null,
      expectedCents: parsed.data.expectedCents,
      expectedDay: parsed.data.expectedDay,
      frequency: parsed.data.frequency,
    })
    .returning();

  return NextResponse.json({ item: created }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const body = await req.json();
  const parsed = patchRecurringSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 }
    );
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(recurringItems)
    .where(eq(recurringItems.id, parsed.data.id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Item recorrente não encontrado" }, { status: 404 });
  }

  const [updated] = await db
    .update(recurringItems)
    .set({
      status: parsed.data.status ?? existing.status,
      expectedCents: parsed.data.expectedCents ?? existing.expectedCents,
      previousCents:
        parsed.data.expectedCents && parsed.data.expectedCents !== existing.expectedCents
          ? existing.expectedCents
          : existing.previousCents,
      expectedDay: parsed.data.expectedDay ?? existing.expectedDay,
      updatedAt: new Date(),
    })
    .where(eq(recurringItems.id, parsed.data.id))
    .returning();

  return NextResponse.json({ item: updated });
}

export async function DELETE(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const db = getDb();
  await db.delete(recurringItems).where(eq(recurringItems.id, id));
  return NextResponse.json({ ok: true });
}
