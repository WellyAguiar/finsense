import { NextRequest, NextResponse } from "next/server";
import { requireUserSession } from "@/lib/session";
import { unauthorizedResponse } from "@/lib/auth-guard";
import { categorizePendingTransactions } from "@/lib/ai/categorizer";
import { ensureBaseSeed } from "@/db/seed";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  await ensureBaseSeed();
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body?.limit || 40), 100);

  try {
    const summary = await categorizePendingTransactions(limit);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao categorizar transações" },
      { status: 500 }
    );
  }
}
