import { NextRequest, NextResponse } from "next/server";
import { requireUserSession } from "@/lib/session";
import { unauthorizedResponse } from "@/lib/auth-guard";
import { getDashboardSummary } from "@/lib/queries";
import { getCurrentMonthKey } from "@/lib/format";
import { ensureBaseSeed } from "@/db/seed";

export async function GET(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  await ensureBaseSeed();
  const month = req.nextUrl.searchParams.get("month") || getCurrentMonthKey();
  const summary = await getDashboardSummary(month);
  return NextResponse.json(summary);
}
