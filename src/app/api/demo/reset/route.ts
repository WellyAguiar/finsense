import { NextResponse } from "next/server";
import {
  getDb,
  transactions,
  creditCardBills,
  budgets,
  goals,
  recurringItems,
  aiInsights,
  documents,
  accounts,
  connections,
} from "@/db";
import { requireUserSession } from "@/lib/session";
import { unauthorizedResponse } from "@/lib/auth-guard";
import { ensureBaseSeed } from "@/db/seed";

/**
 * Remove contas, transações, faturas, orçamentos, metas e insights (útil para limpar dados demo
 * antes de conectar suas contas reais), preservando todas as categorias e regras padrão.
 */
export async function POST() {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const db = getDb();
  await db.delete(transactions);
  await db.delete(creditCardBills);
  await db.delete(budgets);
  await db.delete(goals);
  await db.delete(recurringItems);
  await db.delete(aiInsights);
  await db.delete(documents);
  await db.delete(accounts);
  await db.delete(connections);
  await ensureBaseSeed();

  return NextResponse.json({
    ok: true,
    message: "Dados limpos! Categorias e regras padrão preservadas.",
  });
}
