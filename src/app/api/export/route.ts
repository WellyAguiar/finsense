import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import {
  getDb,
  accounts,
  categories,
  transactions,
  budgets,
  goals,
  recurringItems,
  categorizationRules,
  aiInsights,
} from "@/db";
import { requireUserSession } from "@/lib/session";
import { unauthorizedResponse } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const session = await requireUserSession();
  if (!session) return unauthorizedResponse();

  const format = req.nextUrl.searchParams.get("format") || "json";
  const db = getDb();

  const [
    allAccounts,
    allCategories,
    allTransactions,
    allBudgets,
    allGoals,
    allRecurring,
    allRules,
    allInsights,
  ] = await Promise.all([
    db.select().from(accounts),
    db.select().from(categories),
    db.select().from(transactions).orderBy(desc(transactions.occurredAt)),
    db.select().from(budgets),
    db.select().from(goals),
    db.select().from(recurringItems),
    db.select().from(categorizationRules),
    db.select().from(aiInsights).orderBy(desc(aiInsights.createdAt)),
  ]);

  const dateTag = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const accountMap = new Map(allAccounts.map((a) => [a.id, a.name]));
    const catMap = new Map(allCategories.map((c) => [c.id, c.name]));

    const header = [
      "data",
      "tipo",
      "valor_brl",
      "estabelecimento",
      "descricao_original",
      "categoria",
      "conta",
      "parcela",
      "origem",
    ].join(";");

    const lines = allTransactions.map((tx) =>
      [
        tx.occurredAt,
        tx.kind,
        (tx.amountCents / 100).toFixed(2).replace(".", ","),
        escapeCsv(tx.cleanMerchant),
        escapeCsv(tx.rawDescription),
        escapeCsv(tx.categoryId ? (catMap.get(tx.categoryId) ?? "") : ""),
        escapeCsv(accountMap.get(tx.accountId) ?? ""),
        tx.installmentTotal ? `${tx.installmentNumber}/${tx.installmentTotal}` : "",
        tx.source,
      ].join(";")
    );

    const csv = `\uFEFF${header}\n${lines.join("\n")}`;
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="finsense-transacoes-${dateTag}.csv"`,
      },
    });
  }

  const backup = {
    exportedAt: new Date().toISOString(),
    version: "1.0",
    accounts: allAccounts,
    categories: allCategories,
    transactions: allTransactions,
    budgets: allBudgets,
    goals: allGoals,
    recurringItems: allRecurring,
    categorizationRules: allRules,
    aiInsights: allInsights,
  };

  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="finsense-backup-${dateTag}.json"`,
    },
  });
}

function escapeCsv(val: string): string {
  const safe = val.replace(/"/g, '""');
  return `"${safe}"`;
}
