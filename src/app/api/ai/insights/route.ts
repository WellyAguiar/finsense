import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, aiInsights } from "@/db";
import { requireUserSession } from "@/lib/session";
import { unauthorizedResponse } from "@/lib/auth-guard";
import { refreshProactiveInsights } from "@/lib/ai/insights";
import { getCurrentMonthKey } from "@/lib/format";

export const maxDuration = 60;

export async function GET() {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const db = getDb();
  const list = await db
    .select()
    .from(aiInsights)
    .orderBy(desc(aiInsights.createdAt))
    .limit(30);

  return NextResponse.json({ insights: list });
}

export async function POST(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const body = await req.json().catch(() => ({}));
  const monthKey = typeof body?.monthKey === "string" ? body.monthKey : getCurrentMonthKey();

  try {
    const result = await refreshProactiveInsights(monthKey);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao gerar diagnóstico" },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  dismissed: z.boolean(),
});

export async function PATCH(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const db = getDb();
  await db
    .update(aiInsights)
    .set({ dismissed: parsed.data.dismissed })
    .where(eq(aiInsights.id, parsed.data.id));

  return NextResponse.json({ ok: true });
}
