import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { getDb, connections } from "@/db";
import { requireUserSession } from "@/lib/session";
import { unauthorizedResponse } from "@/lib/auth-guard";
import { syncAllPluggyConnections, syncPluggyItem } from "@/lib/pluggy";
import { isPluggyConfigured } from "@/lib/env";

export const maxDuration = 60;

const addConnectionSchema = z.object({
  pluggyItemId: z.string().min(6, "Informe um Item ID válido do Meu Pluggy").trim(),
  daysBack: z.number().int().min(7).max(365).optional(),
});

export async function GET() {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const db = getDb();
  const list = await db.select().from(connections).orderBy(desc(connections.updatedAt));
  return NextResponse.json({
    pluggyConfigured: isPluggyConfigured(),
    connections: list,
  });
}

export async function POST(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  if (!isPluggyConfigured()) {
    return NextResponse.json(
      { error: "Configure PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET nas variáveis de ambiente." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));

  if (body?.pluggyItemId) {
    const parsed = addConnectionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
    }
    try {
      const summary = await syncPluggyItem(parsed.data.pluggyItemId, parsed.data.daysBack ?? 90);
      return NextResponse.json({ ok: true, summary });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Erro ao sincronizar conexão Pluggy" },
        { status: 500 }
      );
    }
  }

  const result = await syncAllPluggyConnections(45);
  return NextResponse.json({ ok: true, ...result });
}

export async function DELETE(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Parâmetro id obrigatório" }, { status: 400 });
  }

  const db = getDb();
  await db.delete(connections).where(eq(connections.id, id));
  return NextResponse.json({ ok: true });
}
