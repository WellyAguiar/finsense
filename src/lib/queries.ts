import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  getDb,
  accounts,
  creditCardBills,
  transactions,
  categories,
  budgets,
  goals,
  recurringItems,
  aiInsights,
  connections,
} from "@/db";
import {
  computeBudgetPace,
  detectRecurringPatterns,
  projectCreditCardInstallments,
} from "@/lib/finance-engine";
import {
  formatShortMonth,
  getCurrentMonthKey,
  getMonthRange,
  shiftMonthKey,
} from "@/lib/format";

export async function getSpendingByCategory(startDate: string, endDate: string) {
  const db = getDb();
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryColor: categories.color,
      categoryIcon: categories.icon,
      categorySlug: categories.slug,
      totalCents: sql<number>`COALESCE(SUM(${transactions.amountCents}), 0)::bigint`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.kind, "EXPENSE"),
        gte(transactions.occurredAt, startDate),
        lte(transactions.occurredAt, endDate)
      )
    )
    .groupBy(
      transactions.categoryId,
      categories.name,
      categories.color,
      categories.icon,
      categories.slug
    )
    .orderBy(desc(sql`SUM(${transactions.amountCents})`));

  const grandTotal = rows.reduce((acc, r) => acc + Number(r.totalCents), 0);

  return rows.map((r) => {
    const total = Number(r.totalCents);
    return {
      categoryId: r.categoryId ?? "uncategorized",
      categoryName: r.categoryName ?? "Sem categoria",
      categoryColor: r.categoryColor ?? "#94a3b8",
      categoryIcon: r.categoryIcon ?? "tag",
      categorySlug: r.categorySlug ?? "sem-categoria",
      totalCents: total,
      count: Number(r.count),
      share: grandTotal > 0 ? total / grandTotal : 0,
    };
  });
}

export async function getPeriodTotals(startDate: string, endDate: string) {
  const db = getDb();
  const rows = await db
    .select({
      kind: transactions.kind,
      totalCents: sql<number>`COALESCE(SUM(${transactions.amountCents}), 0)::bigint`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(transactions)
    .where(and(gte(transactions.occurredAt, startDate), lte(transactions.occurredAt, endDate)))
    .groupBy(transactions.kind);

  let incomeCents = 0;
  let expenseCents = 0;
  let transferCents = 0;
  let ccPaymentCents = 0;
  let transactionCount = 0;

  for (const r of rows) {
    const total = Number(r.totalCents);
    transactionCount += Number(r.count);
    if (r.kind === "INCOME") incomeCents = total;
    else if (r.kind === "EXPENSE") expenseCents = total;
    else if (r.kind === "TRANSFER") transferCents = total;
    else if (r.kind === "CC_PAYMENT") ccPaymentCents = total;
  }

  const netCents = incomeCents - expenseCents;
  const savingsRate = incomeCents > 0 ? netCents / incomeCents : 0;

  return {
    incomeCents,
    expenseCents,
    netCents,
    savingsRate,
    transferCents,
    ccPaymentCents,
    transactionCount,
  };
}

export async function getMonthlyCashflowSeries(endMonthKey: string, monthsCount = 6) {
  const series = [];
  for (let i = monthsCount - 1; i >= 0; i--) {
    const monthKey = shiftMonthKey(endMonthKey, -i);
    const { start, end } = getMonthRange(monthKey);
    const totals = await getPeriodTotals(start, end);
    series.push({
      monthKey,
      label: formatShortMonth(monthKey),
      incomeCents: totals.incomeCents,
      expenseCents: totals.expenseCents,
      netCents: totals.netCents,
    });
  }
  return series;
}

export async function getBudgetsWithProgress(monthKey: string) {
  const db = getDb();
  const { start, end, daysInMonth } = getMonthRange(monthKey);
  const allCategories = await db.select().from(categories).where(eq(categories.type, "EXPENSE"));
  const allBudgets = await db.select().from(budgets);
  const spending = await getSpendingByCategory(start, end);
  const spentMap = new Map(spending.map((s) => [s.categoryId, s.totalCents]));

  // Prefere orçamento específico do mês; caso contrário usa DEFAULT
  const budgetByCat = new Map<string, { id: string; limitCents: number; referenceMonth: string }>();
  for (const b of allBudgets) {
    if (b.referenceMonth === "DEFAULT" && !budgetByCat.has(b.categoryId)) {
      budgetByCat.set(b.categoryId, {
        id: b.id,
        limitCents: b.limitCents,
        referenceMonth: b.referenceMonth,
      });
    }
    if (b.referenceMonth === monthKey) {
      budgetByCat.set(b.categoryId, {
        id: b.id,
        limitCents: b.limitCents,
        referenceMonth: b.referenceMonth,
      });
    }
  }

  const now = new Date();
  const currentMonth = getCurrentMonthKey(now);
  const dayOfMonth =
    monthKey === currentMonth
      ? now.getDate()
      : monthKey < currentMonth
        ? daysInMonth
        : 1;

  return allCategories
    .filter((c) => budgetByCat.has(c.id))
    .map((cat) => {
      const b = budgetByCat.get(cat.id)!;
      const spentCents = spentMap.get(cat.id) ?? 0;
      const pace = computeBudgetPace({
        spentCents,
        limitCents: b.limitCents,
        dayOfMonth,
        daysInMonth,
      });
      return {
        budgetId: b.id,
        categoryId: cat.id,
        categoryName: cat.name,
        categoryColor: cat.color,
        limitCents: b.limitCents,
        spentCents,
        referenceMonth: b.referenceMonth,
        ...pace,
      };
    })
    .sort((a, b) => b.usageRatio - a.usageRatio);
}

export async function getDashboardSummary(monthKey = getCurrentMonthKey()) {
  const db = getDb();
  const { start, end } = getMonthRange(monthKey);
  const prevMonthKey = shiftMonthKey(monthKey, -1);
  const prevRange = getMonthRange(prevMonthKey);

  const [
    allAccounts,
    openBills,
    currentTotals,
    previousTotals,
    byCategory,
    cashflow,
    budgetProgress,
    activeInsights,
    activeRecurring,
    activeGoals,
    allConnections,
    pendingReviewCountRow,
  ] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.isArchived, false)),
    db.select().from(creditCardBills).where(eq(creditCardBills.status, "OPEN")),
    getPeriodTotals(start, end),
    getPeriodTotals(prevRange.start, prevRange.end),
    getSpendingByCategory(start, end),
    getMonthlyCashflowSeries(monthKey, 6),
    getBudgetsWithProgress(monthKey),
    db
      .select()
      .from(aiInsights)
      .where(eq(aiInsights.dismissed, false))
      .orderBy(desc(aiInsights.createdAt))
      .limit(6),
    db.select().from(recurringItems).where(eq(recurringItems.status, "ACTIVE")),
    db.select().from(goals).where(eq(goals.status, "ACTIVE")),
    db.select().from(connections),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(transactions)
      .where(eq(transactions.reviewed, false)),
  ]);

  const cashBalanceCents = allAccounts
    .filter((a) => a.type !== "CREDIT_CARD")
    .reduce((acc, a) => acc + a.balanceCents, 0);

  const openCreditCardCents = openBills.reduce((acc, b) => acc + b.totalCents, 0);
  const recurringMonthlyCents = activeRecurring.reduce(
    (acc, r) => acc + (r.frequency === "YEARLY" ? Math.round(r.expectedCents / 12) : r.expectedCents),
    0
  );

  return {
    monthKey,
    cashBalanceCents,
    openCreditCardCents,
    netWorthLiquidCents: cashBalanceCents - openCreditCardCents,
    currentTotals,
    previousTotals,
    byCategory,
    cashflow,
    budgetProgress,
    activeInsights,
    recurringMonthlyCents,
    activeRecurringCount: activeRecurring.length,
    activeGoals,
    accounts: allAccounts,
    connectionsCount: allConnections.length,
    pendingReviewCount: Number(pendingReviewCountRow[0]?.count ?? 0),
  };
}

export async function getCreditCardsOverview(monthKey = getCurrentMonthKey()) {
  const db = getDb();
  const cards = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.type, "CREDIT_CARD"), eq(accounts.isArchived, false)));

  const bills = await db
    .select()
    .from(creditCardBills)
    .orderBy(desc(creditCardBills.referenceMonth));

  const sixMonthsAgo = `${shiftMonthKey(monthKey, -6)}-01`;
  const cardIds = new Set(cards.map((c) => c.id));
  const recentTxs = await db
    .select()
    .from(transactions)
    .where(gte(transactions.occurredAt, sixMonthsAgo));

  const cardTxs = recentTxs.filter((t) => cardIds.has(t.accountId));
  const forecast = projectCreditCardInstallments(cardTxs, monthKey, 6);

  return {
    cards: cards.map((card) => ({
      ...card,
      bills: bills.filter((b) => b.accountId === card.id).slice(0, 6),
    })),
    forecast,
  };
}

export async function getRecurringOverview() {
  const db = getDb();
  const items = await db
    .select({
      item: recurringItems,
      categoryName: categories.name,
      categoryColor: categories.color,
      accountName: accounts.name,
    })
    .from(recurringItems)
    .leftJoin(categories, eq(recurringItems.categoryId, categories.id))
    .leftJoin(accounts, eq(recurringItems.accountId, accounts.id))
    .orderBy(desc(recurringItems.expectedCents));

  const sixMonthsAgo = `${shiftMonthKey(getCurrentMonthKey(), -6)}-01`;
  const recentTxs = await db
    .select()
    .from(transactions)
    .where(gte(transactions.occurredAt, sixMonthsAgo));

  const detected = detectRecurringPatterns(recentTxs);
  const existingNames = new Set(items.map((i) => i.item.merchantName.toLowerCase()));
  const suggestions = detected.filter((d) => !existingNames.has(d.merchantName.toLowerCase()));

  return {
    items: items.map((r) => ({
      ...r.item,
      categoryName: r.categoryName ?? "Sem categoria",
      categoryColor: r.categoryColor ?? "#8b5cf6",
      accountName: r.accountName ?? "Conta",
    })),
    suggestions,
  };
}
