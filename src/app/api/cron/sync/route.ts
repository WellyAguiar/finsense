import { NextRequest, NextResponse } from "next/server";
import { isValidCronRequest, unauthorizedResponse } from "@/lib/auth-guard";
import { isDbConfigured, isPluggyConfigured, isGeminiConfigured } from "@/lib/env";
import { syncAllPluggyConnections } from "@/lib/pluggy";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isValidCronRequest(req.headers.get("authorization"))) {
    return unauthorizedResponse();
  }

  if (!isDbConfigured()) {
    return NextResponse.json({ skipped: true, reason: "DATABASE_URL não configurada" });
  }

  const results: Record<string, unknown> = {
    ranAt: new Date().toISOString(),
  };

  if (isPluggyConfigured()) {
    results.pluggy = await syncAllPluggyConnections(30);
  } else {
    results.pluggy = { skipped: true, reason: "Pluggy não configurado" };
  }

  if (isGeminiConfigured()) {
    try {
      const { categorizePendingTransactions } = await import("@/lib/ai/categorizer");
      results.categorization = await categorizePendingTransactions(40);
    } catch (err) {
      results.categorizationError = err instanceof Error ? err.message : String(err);
    }

    try {
      const { refreshProactiveInsights } = await import("@/lib/ai/insights");
      results.insights = await refreshProactiveInsights();
    } catch (err) {
      results.insightsError = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json({ ok: true, results });
}
