import "dotenv/config";
import {
  getDb,
  accounts,
  creditCardBills,
  transactions,
  budgets,
  goals,
  recurringItems,
  aiInsights,
} from "./index";
import { ensureBaseSeed } from "./seed";
import { getCurrentMonthKey, shiftMonthKey } from "../lib/format";

async function seedDemo() {
  const db = getDb();
  const catMap = await ensureBaseSeed();

  const existingAccounts = await db.select().from(accounts);
  if (existingAccounts.length > 0) {
    console.log("Já existem contas cadastradas. Pulando seed demo para evitar duplicação.");
    return;
  }

  const [itau] = await db
    .insert(accounts)
    .values({
      name: "Conta Corrente Itaú",
      institutionName: "Itaú",
      type: "CHECKING",
      balanceCents: 1425080, // R$ 14.250,80
    })
    .returning();

  const [inter] = await db
    .insert(accounts)
    .values({
      name: "Reserva Inter",
      institutionName: "Banco Inter",
      type: "SAVINGS",
      balanceCents: 3850000, // R$ 38.500,00
    })
    .returning();

  const [nubankCard] = await db
    .insert(accounts)
    .values({
      name: "Nubank Ultravioleta",
      institutionName: "Nubank",
      type: "CREDIT_CARD",
      balanceCents: -284790,
      creditLimitCents: 1800000,
      availableCreditLimitCents: 1515210,
      closingDay: 3,
      dueDay: 10,
    })
    .returning();

  const currentMonth = getCurrentMonthKey();
  const months = [
    shiftMonthKey(currentMonth, -3),
    shiftMonthKey(currentMonth, -2),
    shiftMonthKey(currentMonth, -1),
    currentMonth,
  ];

  const cat = (slug: string) => catMap.get(slug) ?? null;

  for (let idx = 0; idx < months.length; idx++) {
    const m = months[idx];
    const [bill] = await db
      .insert(creditCardBills)
      .values({
        accountId: nubankCard.id,
        referenceMonth: m,
        closingDate: `${m}-03`,
        dueDate: `${m}-10`,
        totalCents: idx === 3 ? 284790 : 245000 + idx * 14000,
        status: idx === 3 ? "OPEN" : "PAID",
      })
      .returning();

    const isCurrent = idx === 3;
    const netflixPrice = idx >= 2 ? 5990 : 4490; // Simula reajuste de assinatura

    await db.insert(transactions).values([
      {
        accountId: itau.id,
        categoryId: cat("salario"),
        source: "MANUAL",
        kind: "INCOME",
        amountCents: 1150000,
        occurredAt: `${m}-05`,
        rawDescription: "CREDITO SALARIO EMPRESA TECH LTDA",
        cleanMerchant: "Salário — Empresa Tech",
        reviewed: true,
      },
      {
        accountId: itau.id,
        categoryId: cat("moradia"),
        source: "MANUAL",
        kind: "EXPENSE",
        amountCents: 285000,
        occurredAt: `${m}-06`,
        rawDescription: "PIX ENVIADO IMOBILIARIA CENTRAL",
        cleanMerchant: "Aluguel + Condomínio",
        reviewed: true,
      },
      {
        accountId: itau.id,
        categoryId: cat("utilidades"),
        source: "MANUAL",
        kind: "EXPENSE",
        amountCents: 21540 + idx * 1200,
        occurredAt: `${m}-08`,
        rawDescription: "DEB AUT ENEL ENERGIA SP",
        cleanMerchant: "Enel Energia",
        reviewed: true,
      },
      {
        accountId: itau.id,
        categoryId: cat("utilidades"),
        source: "MANUAL",
        kind: "EXPENSE",
        amountCents: 13990,
        occurredAt: `${m}-09`,
        rawDescription: "DEB AUT VIVO FIBRA",
        cleanMerchant: "Vivo Fibra",
        reviewed: true,
      },
      {
        accountId: itau.id,
        source: "MANUAL",
        kind: "TRANSFER",
        amountCents: 150000,
        occurredAt: `${m}-07`,
        rawDescription: "PIX ENVIADO CONTA INTER PROPRIA",
        cleanMerchant: "Transferência para Reserva Inter",
        reviewed: true,
      },
      {
        accountId: inter.id,
        source: "MANUAL",
        kind: "TRANSFER",
        amountCents: 150000,
        occurredAt: `${m}-07`,
        rawDescription: "PIX RECEBIDO ITAU MESMA TITULARIDADE",
        cleanMerchant: "Transferência de Conta Itaú",
        reviewed: true,
      },
      {
        accountId: itau.id,
        source: "MANUAL",
        kind: "CC_PAYMENT",
        amountCents: 245000,
        occurredAt: `${m}-10`,
        rawDescription: "PAGAMENTO FATURA NUBANK",
        cleanMerchant: "Pagamento Fatura Nubank",
        reviewed: true,
      },
      {
        accountId: nubankCard.id,
        billId: bill.id,
        categoryId: cat("assinaturas"),
        source: "MANUAL",
        kind: "EXPENSE",
        amountCents: netflixPrice,
        occurredAt: `${m}-04`,
        rawDescription: "NETFLIX.COM SAO PAULO BR",
        cleanMerchant: "Netflix",
        reviewed: true,
      },
      {
        accountId: nubankCard.id,
        billId: bill.id,
        categoryId: cat("assinaturas"),
        source: "MANUAL",
        kind: "EXPENSE",
        amountCents: 2190,
        occurredAt: `${m}-05`,
        rawDescription: "SPOTIFY P283910",
        cleanMerchant: "Spotify",
        reviewed: true,
      },
      {
        accountId: nubankCard.id,
        billId: bill.id,
        categoryId: cat("saude"),
        source: "MANUAL",
        kind: "EXPENSE",
        amountCents: 13990,
        occurredAt: `${m}-06`,
        rawDescription: "SMART FIT ACADEMIA",
        cleanMerchant: "Smart Fit",
        reviewed: true,
      },
      {
        accountId: nubankCard.id,
        billId: bill.id,
        categoryId: cat("supermercado"),
        source: "MANUAL",
        kind: "EXPENSE",
        amountCents: 89000 + idx * 4500,
        occurredAt: `${m}-11`,
        rawDescription: "CARREFOUR HIPER SP",
        cleanMerchant: "Carrefour",
        reviewed: true,
      },
      {
        accountId: nubankCard.id,
        billId: bill.id,
        categoryId: cat("alimentacao"),
        source: "MANUAL",
        kind: "EXPENSE",
        amountCents: isCurrent ? 64890 : 32000 + idx * 2500,
        occurredAt: `${m}-14`,
        rawDescription: "IFD*RESTAURANTES DIVERSOS",
        cleanMerchant: "iFood",
        reviewed: true,
      },
      {
        accountId: nubankCard.id,
        billId: bill.id,
        categoryId: cat("transporte"),
        source: "MANUAL",
        kind: "EXPENSE",
        amountCents: 28500 + idx * 1500,
        occurredAt: `${m}-15`,
        rawDescription: "UBER *TRIP HELP.UBER.COM",
        cleanMerchant: "Uber",
        reviewed: true,
      },
      {
        accountId: nubankCard.id,
        billId: bill.id,
        categoryId: cat("compras"),
        source: "MANUAL",
        kind: "EXPENSE",
        amountCents: 49900,
        occurredAt: `${m}-12`,
        rawDescription: `MERCADOLIVRE*ELETRONICOS PARC 0${idx + 1}/06`,
        cleanMerchant: "Mercado Livre — Monitor",
        installmentNumber: idx + 1,
        installmentTotal: 6,
        reviewed: true,
      },
    ]);
  }

  // Orçamentos padrão
  const defaultBudgets = [
    { slug: "supermercado", limitCents: 120000 },
    { slug: "alimentacao", limitCents: 60000 },
    { slug: "transporte", limitCents: 45000 },
    { slug: "lazer", limitCents: 50000 },
    { slug: "compras", limitCents: 70000 },
    { slug: "assinaturas", limitCents: 15000 },
  ];

  for (const b of defaultBudgets) {
    const categoryId = cat(b.slug);
    if (!categoryId) continue;
    await db
      .insert(budgets)
      .values({ categoryId, referenceMonth: "DEFAULT", limitCents: b.limitCents })
      .onConflictDoNothing();
  }

  // Assinaturas / Contas fixas
  await db.insert(recurringItems).values([
    {
      merchantName: "Aluguel + Condomínio",
      matchPattern: "ALUGUEL",
      categoryId: cat("moradia"),
      accountId: itau.id,
      expectedCents: 285000,
      expectedDay: 6,
      frequency: "MONTHLY",
    },
    {
      merchantName: "Netflix",
      matchPattern: "NETFLIX",
      categoryId: cat("assinaturas"),
      accountId: nubankCard.id,
      expectedCents: 5990,
      previousCents: 4490,
      expectedDay: 4,
      frequency: "MONTHLY",
      detectedByAi: true,
    },
    {
      merchantName: "Spotify",
      matchPattern: "SPOTIFY",
      categoryId: cat("assinaturas"),
      accountId: nubankCard.id,
      expectedCents: 2190,
      expectedDay: 5,
      frequency: "MONTHLY",
      detectedByAi: true,
    },
    {
      merchantName: "Smart Fit",
      matchPattern: "SMART FIT",
      categoryId: cat("saude"),
      accountId: nubankCard.id,
      expectedCents: 13990,
      expectedDay: 6,
      frequency: "MONTHLY",
      detectedByAi: true,
    },
    {
      merchantName: "Vivo Fibra",
      matchPattern: "VIVO",
      categoryId: cat("utilidades"),
      accountId: itau.id,
      expectedCents: 13990,
      expectedDay: 9,
      frequency: "MONTHLY",
    },
  ]);

  // Metas
  await db.insert(goals).values([
    {
      name: "Reserva de Emergência (6 meses)",
      description: "Cobertura de 6 meses de custo de vida em liquidez diária",
      targetCents: 4500000,
      currentCents: 3850000,
      targetDate: `${shiftMonthKey(currentMonth, 5)}-01`,
      linkedAccountId: inter.id,
      color: "#10b981",
      icon: "shield",
    },
    {
      name: "Viagem Internacional",
      description: "Passagens + hospedagem + câmbio",
      targetCents: 1800000,
      currentCents: 640000,
      targetDate: `${shiftMonthKey(currentMonth, 10)}-01`,
      color: "#3b82f6",
      icon: "plane",
    },
  ]);

  // Insight inicial de exemplo
  await db.insert(aiInsights).values([
    {
      type: "SUBSCRIPTION_ALERT",
      severity: "WARNING",
      title: "Reajuste detectado na Netflix (+33%)",
      summaryMd:
        "A cobrança recorrente da **Netflix** passou de **R$ 44,90** para **R$ 59,90** (+R$ 15,00/mês, equivalente a +R$ 180,00/ano).",
      referenceMonth: currentMonth,
    },
    {
      type: "BUDGET_PACE",
      severity: "CRITICAL",
      title: "Orçamento de Alimentação & Delivery ultrapassado",
      summaryMd:
        "Você já gastou **R$ 648,90** em Alimentação & Delivery este mês frente ao teto de **R$ 600,00** (108%).",
      referenceMonth: currentMonth,
    },
  ]);

  console.log("Seed demo concluído com sucesso!");
}

seedDemo()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Erro ao rodar seed demo:", err);
    process.exit(1);
  });
