import { PluggyClient } from "pluggy-sdk";
import { eq, and, gte, lte, ne } from "drizzle-orm";
import {
  getDb,
  connections,
  accounts,
  creditCardBills,
  transactions,
  categorizationRules,
} from "@/db";
import { ensureBaseSeed } from "@/db/seed";
import {
  applyCategorizationRules,
  buildTransactionFingerprint,
  detectTransactionKind,
  parseInstallmentInfo,
} from "@/lib/finance-engine";

function getPluggyClient(): PluggyClient {
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET não configurados. Cadastre suas chaves do Meu Pluggy no .env.local."
    );
  }
  return new PluggyClient({ clientId, clientSecret });
}

export interface SyncItemSummary {
  pluggyItemId: string;
  institutionName: string;
  accountsSynced: number;
  transactionsInserted: number;
  transactionsUpdated: number;
  transfersPaired: number;
}

function mapPluggyAccountType(type: string, subtype?: string | null): string {
  if (type === "CREDIT") return "CREDIT_CARD";
  if (subtype === "SAVINGS_ACCOUNT") return "SAVINGS";
  return "CHECKING";
}

function toISODate(dateValue: Date | string): string {
  if (dateValue instanceof Date) {
    return dateValue.toISOString().slice(0, 10);
  }
  return String(dateValue).slice(0, 10);
}

/**
 * Sincroniza uma conexão (Item) do Meu Pluggy de forma idempotente:
 * contas, faturas de cartão, transações e pareamento automático de transferências internas.
 */
export async function syncPluggyItem(
  pluggyItemId: string,
  daysBack = 90
): Promise<SyncItemSummary> {
  const client = getPluggyClient();
  const db = getDb();
  await ensureBaseSeed();

  const item = await client.fetchItem(pluggyItemId);
  const institutionName = item.connector?.name ?? "Instituição Conectada";
  const institutionLogoUrl = item.connector?.imageUrl ?? null;

  const [conn] = await db
    .insert(connections)
    .values({
      pluggyItemId,
      institutionName,
      institutionLogoUrl,
      status: item.status ?? "CONNECTED",
      lastSyncedAt: new Date(),
      lastError: null,
    })
    .onConflictDoUpdate({
      target: connections.pluggyItemId,
      set: {
        institutionName,
        institutionLogoUrl,
        status: item.status ?? "CONNECTED",
        lastSyncedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      },
    })
    .returning();

  const pluggyAccountsRes = await client.fetchAccounts(pluggyItemId);
  const rules = await db.select().from(categorizationRules);

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - daysBack);
  const fromStr = fromDate.toISOString().slice(0, 10);

  let accountsSynced = 0;
  let transactionsInserted = 0;
  let transactionsUpdated = 0;

  for (const pAcc of pluggyAccountsRes.results) {
    const accountType = mapPluggyAccountType(pAcc.type, pAcc.subtype);
    const balanceCents = Math.round((pAcc.balance ?? 0) * 100);
    const creditLimitCents =
      pAcc.creditData?.creditLimit != null
        ? Math.round(pAcc.creditData.creditLimit * 100)
        : null;
    const availableCreditLimitCents =
      pAcc.creditData?.availableCreditLimit != null
        ? Math.round(pAcc.creditData.availableCreditLimit * 100)
        : null;

    const closingDay = pAcc.creditData?.balanceCloseDate
      ? new Date(pAcc.creditData.balanceCloseDate).getDate()
      : null;
    const dueDay = pAcc.creditData?.balanceDueDate
      ? new Date(pAcc.creditData.balanceDueDate).getDate()
      : null;

    const [localAccount] = await db
      .insert(accounts)
      .values({
        connectionId: conn.id,
        pluggyAccountId: pAcc.id,
        name: pAcc.name || `${institutionName} ${accountType === "CREDIT_CARD" ? "Cartão" : "Conta"}`,
        institutionName,
        type: accountType,
        subtype: pAcc.subtype ?? null,
        balanceCents,
        creditLimitCents,
        availableCreditLimitCents,
        closingDay,
        dueDay,
        currencyCode: pAcc.currencyCode ?? "BRL",
      })
      .onConflictDoUpdate({
        target: accounts.pluggyAccountId,
        set: {
          connectionId: conn.id,
          name: pAcc.name || `${institutionName} ${accountType === "CREDIT_CARD" ? "Cartão" : "Conta"}`,
          institutionName,
          balanceCents,
          creditLimitCents,
          availableCreditLimitCents,
          closingDay,
          dueDay,
          updatedAt: new Date(),
        },
      })
      .returning();

    accountsSynced++;

    // Sincroniza faturas de cartão de crédito se aplicável
    const billIdMap = new Map<string, string>();
    if (accountType === "CREDIT_CARD") {
      try {
        const billsRes = await client.fetchCreditCardBills(pAcc.id);
        for (const pBill of billsRes.results) {
          const dueDate = toISODate(pBill.dueDate);
          const referenceMonth = dueDate.slice(0, 7);
          const totalCents = Math.round(Math.abs(pBill.totalAmount ?? 0) * 100);
          const minimumPaymentCents =
            pBill.minimumPaymentAmount != null
              ? Math.round(Math.abs(pBill.minimumPaymentAmount) * 100)
              : null;

          const nowStr = new Date().toISOString().slice(0, 10);
          const status = dueDate < nowStr ? "CLOSED" : "OPEN";

          const [localBill] = await db
            .insert(creditCardBills)
            .values({
              accountId: localAccount.id,
              externalId: pBill.id,
              referenceMonth,
              dueDate,
              totalCents,
              minimumPaymentCents,
              status,
            })
            .onConflictDoUpdate({
              target: [creditCardBills.accountId, creditCardBills.referenceMonth],
              set: {
                externalId: pBill.id,
                dueDate,
                totalCents,
                minimumPaymentCents,
                updatedAt: new Date(),
              },
            })
            .returning();

          billIdMap.set(pBill.id, localBill.id);
        }
      } catch {
        // Nem todo conector retorna endpoint de bills — seguimos normalmente com as transações
      }
    }

    // Busca paginada de transações
    let page = 1;
    let totalPages = 1;
    do {
      const txRes = await client.fetchTransactions(pAcc.id, {
        from: fromStr,
        pageSize: 100,
        page,
      });
      totalPages = txRes.totalPages ?? 1;

      for (const pTx of txRes.results) {
        const rawDescription = pTx.descriptionRaw || pTx.description || "Transação";
        const occurredAt = toISODate(pTx.date);
        const amountCents = Math.round(Math.abs(pTx.amount) * 100);

        const matchedRule = applyCategorizationRules(rawDescription, rules);
        const kind =
          matchedRule?.kindOverride ??
          detectTransactionKind({
            accountType,
            rawAmount: pTx.amount,
            description: rawDescription,
            pluggyType: pTx.type,
          });

        const installment = parseInstallmentInfo(rawDescription);
        const pluggyInstNumber = pTx.creditCardMetadata?.installmentNumber ?? installment?.installmentNumber ?? null;
        const pluggyInstTotal = pTx.creditCardMetadata?.totalInstallments ?? installment?.installmentTotal ?? null;

        const cleanMerchant =
          matchedRule?.cleanMerchant ??
          pTx.merchant?.name ??
          pTx.description?.trim() ??
          rawDescription;

        const ccMeta = pTx.creditCardMetadata as
          | (typeof pTx.creditCardMetadata & { billId?: string })
          | null
          | undefined;
        const billExternalId = ccMeta?.billId;
        const localBillId = billExternalId ? billIdMap.get(billExternalId) ?? null : null;

        const fingerprint = buildTransactionFingerprint({
          accountId: localAccount.id,
          amountCents,
          occurredAt,
          rawDescription,
        });

        const existing = await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.externalId, pTx.id))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(transactions)
            .set({
              amountCents,
              occurredAt,
              billId: localBillId,
              installmentNumber: pluggyInstNumber,
              installmentTotal: pluggyInstTotal,
              updatedAt: new Date(),
            })
            .where(eq(transactions.id, existing[0].id));
          transactionsUpdated++;
        } else {
          await db.insert(transactions).values({
            accountId: localAccount.id,
            billId: localBillId,
            categoryId: matchedRule?.categoryId ?? null,
            externalId: pTx.id,
            fingerprint,
            source: "PLUGGY",
            kind,
            amountCents,
            occurredAt,
            rawDescription,
            cleanMerchant,
            installmentNumber: pluggyInstNumber,
            installmentTotal: pluggyInstTotal,
            reviewed: Boolean(matchedRule),
          });
          transactionsInserted++;
        }
      }

      page++;
    } while (page <= totalPages && page <= 10);
  }

  const transfersPaired = await pairInternalTransfers();

  return {
    pluggyItemId,
    institutionName,
    accountsSynced,
    transactionsInserted,
    transactionsUpdated,
    transfersPaired,
  };
}

/**
 * Pareia automaticamente transferências entre contas próprias do usuário
 * (mesmo valor absoluto em contas diferentes em janela de ±2 dias, sendo uma entrada e outra saída).
 */
export async function pairInternalTransfers(): Promise<number> {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const recent = await db
    .select()
    .from(transactions)
    .where(and(gte(transactions.occurredAt, cutoffStr)));

  const debits = recent.filter((t) => t.kind === "EXPENSE" && !t.transferPairId);
  const credits = recent.filter((t) => t.kind === "INCOME" && !t.transferPairId);

  const usedCredits = new Set<string>();
  let paired = 0;

  for (const debit of debits) {
    const debitDate = new Date(`${debit.occurredAt}T12:00:00Z`).getTime();
    const match = credits.find((c) => {
      if (usedCredits.has(c.id)) return false;
      if (c.accountId === debit.accountId) return false;
      if (c.amountCents !== debit.amountCents) return false;
      const creditDate = new Date(`${c.occurredAt}T12:00:00Z`).getTime();
      const dayDiff = Math.abs(Math.round((debitDate - creditDate) / (1000 * 60 * 60 * 24)));
      if (dayDiff > 2) return false;

      const combined = `${debit.rawDescription} ${c.rawDescription}`.toUpperCase();
      return (
        combined.includes("PIX") ||
        combined.includes("TED") ||
        combined.includes("DOC") ||
        combined.includes("TRANSF")
      );
    });

    if (match) {
      usedCredits.add(match.id);
      await db
        .update(transactions)
        .set({ kind: "TRANSFER", transferPairId: match.id, updatedAt: new Date() })
        .where(eq(transactions.id, debit.id));
      await db
        .update(transactions)
        .set({ kind: "TRANSFER", transferPairId: debit.id, updatedAt: new Date() })
        .where(eq(transactions.id, match.id));
      paired++;
    }
  }

  return paired;
}

/**
 * Sincroniza todas as conexões cadastradas no banco + eventuais PLUGGY_ITEM_IDS do ambiente.
 */
export async function syncAllPluggyConnections(daysBack = 45): Promise<{
  synced: SyncItemSummary[];
  errors: Array<{ pluggyItemId: string; error: string }>;
}> {
  const db = getDb();
  const dbConnections = await db.select().from(connections);
  const envItemIds = (process.env.PLUGGY_ITEM_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const uniqueItemIds = Array.from(
    new Set([...dbConnections.map((c) => c.pluggyItemId), ...envItemIds])
  );

  const synced: SyncItemSummary[] = [];
  const errors: Array<{ pluggyItemId: string; error: string }> = [];

  for (const itemId of uniqueItemIds) {
    try {
      const summary = await syncPluggyItem(itemId, daysBack);
      synced.push(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido ao sincronizar";
      errors.push({ pluggyItemId: itemId, error: message });
      await db
        .update(connections)
        .set({ status: "LOGIN_ERROR", lastError: message, updatedAt: new Date() })
        .where(and(eq(connections.pluggyItemId, itemId), ne(connections.status, "ARCHIVED")));
    }
  }

  // Opcional: fecha faturas antigas já vencidas
  const todayStr = new Date().toISOString().slice(0, 10);
  await db
    .update(creditCardBills)
    .set({ status: "CLOSED", updatedAt: new Date() })
    .where(and(eq(creditCardBills.status, "OPEN"), lte(creditCardBills.dueDate, todayStr)));

  return { synced, errors };
}
