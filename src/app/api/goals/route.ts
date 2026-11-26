import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, goals } from "@/db";
import { requireUserSession } from "@/lib/session";
import { unauthorizedResponse } from "@/lib/auth-guard";

const createGoalSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(300).nullable().optional(),
  targetCents: z.number().int().positive(),
  currentCents: z.number().int().nonnegative().default(0),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  color: z.string().default("#10b981"),
});

const patchGoalSchema = z.object({
  id: z.string().uuid(),
  currentCents: z.number().int().nonnegative().optional(),
  addCents: z.number().int().optional(),
  targetCents: z.number().int().positive().optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).optional(),
});

export async function GET() {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const db = getDb();
  const list = await db.select().from(goals).orderBy(desc(goals.createdAt));
  return NextResponse.json({ goals: list });
}

export async function POST(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const body = await req.json();
  const parsed = createGoalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 }
    );
  }

  const db = getDb();
  const [created] = await db
    .insert(goals)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      targetCents: parsed.data.targetCents,
      currentCents: parsed.data.currentCents,
      targetDate: parsed.data.targetDate ?? null,
      color: parsed.data.color,
    })
    .returning();

  return NextResponse.json({ goal: created }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const body = await req.json();
  const parsed = patchGoalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 }
    );
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(goals)
    .where(eq(goals.id, parsed.data.id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Meta não encontrada" }, { status: 404 });
  }

  const nextCurrent =
    parsed.data.currentCents !== undefined
      ? parsed.data.currentCents
      : parsed.data.addCents !== undefined
        ? Math.max(0, existing.currentCents + parsed.data.addCents)
        : existing.currentCents;

  const nextTarget = parsed.data.targetCents ?? existing.targetCents;
  const autoStatus =
    parsed.data.status ?? (nextCurrent >= nextTarget ? "COMPLETED" : existing.status);

  const [updated] = await db
    .update(goals)
    .set({
      currentCents: nextCurrent,
      targetCents: nextTarget,
      status: autoStatus,
      updatedAt: new Date(),
    })
    .where(eq(goals.id, parsed.data.id))
    .returning();

  return NextResponse.json({ goal: updated });
}

export async function DELETE(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const db = getDb();
  await db.delete(goals).where(eq(goals.id, id));
  return NextResponse.json({ ok: true });
}
