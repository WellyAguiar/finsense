import { NextRequest, NextResponse } from "next/server";
import { PluggyClient } from "pluggy-sdk";
import { requireUserSession } from "@/lib/session";
import { unauthorizedResponse } from "@/lib/auth-guard";
import { isPluggyConfigured } from "@/lib/env";

export async function POST(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  if (!isPluggyConfigured()) {
    return NextResponse.json(
      { error: "PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET não configurados." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const itemId = typeof body?.itemId === "string" && body.itemId.trim() ? body.itemId.trim() : undefined;

  try {
    const client = new PluggyClient({
      clientId: process.env.PLUGGY_CLIENT_ID!,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET!,
    });

    const origin = req.nextUrl.origin;
    const webhookUrl =
      origin && origin.startsWith("https://")
        ? `${origin}/api/webhooks/pluggy`
        : undefined;

    const data = await client.createConnectToken(itemId, {
      clientUserId: session.user?.email ?? "owner",
      ...(webhookUrl ? { webhookUrl } : {}),
    });

    return NextResponse.json({ accessToken: data.accessToken });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Erro ao gerar Connect Token no Pluggy",
      },
      { status: 500 }
    );
  }
}
