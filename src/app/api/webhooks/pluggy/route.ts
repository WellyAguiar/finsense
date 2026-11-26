import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, connections } from "@/db";
import { isDbConfigured, isPluggyConfigured } from "@/lib/env";
import { syncPluggyItem } from "@/lib/pluggy";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isDbConfigured() || !isPluggyConfigured()) {
    return NextResponse.json({ received: true, skipped: true });
  }

  const event = await req.json().catch(() => null);
  const eventName = typeof event?.event === "string" ? event.event : "";
  const itemId = typeof event?.itemId === "string" ? event.itemId : "";

  if (!eventName || !itemId) {
    return NextResponse.json({ received: true, ignored: true });
  }

  try {
    if (eventName === "item/created" || eventName === "item/updated") {
      // syncPluggyItem busca dados diretamente na API autenticada do Pluggy usando nossas chaves
      await syncPluggyItem(itemId, 90);
    } else if (eventName === "item/error") {
      const db = getDb();
      const errMsg =
        typeof event?.error?.message === "string"
          ? event.error.message
          : "Erro reportado pelo Pluggy";
      await db
        .update(connections)
        .set({ status: "LOGIN_ERROR", lastError: errMsg, updatedAt: new Date() })
        .where(eq(connections.pluggyItemId, itemId));
    }
  } catch (err) {
    console.error("Pluggy webhook error:", err);
  }

  return NextResponse.json({ received: true });
}
