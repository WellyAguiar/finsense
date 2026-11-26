import { describe, it, expect } from "vitest";
import {
  parseInstallmentInfo,
  detectTransactionKind,
  findPotentialDuplicates,
  applyCategorizationRules,
  computeBudgetPace,
  projectCreditCardInstallments,
  detectRecurringPatterns,
  detectSpendingAnomalies,
} from "@/lib/finance-engine";
import { formatBRL, parseBRLToCents } from "@/lib/format";
import { isAllowedEmail, isValidCronRequest } from "@/lib/auth-guard";

describe("format & currency precision", () => {
  it("converte strings brasileiras para centavos sem erro de float", () => {
    expect(parseBRLToCents("1.234,56")).toBe(123456);
    expect(parseBRLToCents("R$ 89,90")).toBe(8990);
    expect(parseBRLToCents("0,10")).toBe(10);
    expect(parseBRLToCents(19.99)).toBe(1999);
  });

  it("formata centavos em BRL corretamente", () => {
    expect(formatBRL(123456).replace(/\u00a0/g, " ")).toBe("R$ 1.234,56");
    expect(formatBRL(-5000).replace(/\u00a0/g, " ")).toBe("-R$ 50,00");
    expect(formatBRL(2500, { showSign: true }).replace(/\u00a0/g, " ")).toBe("+R$ 25,00");
  });
});

describe("auth guard (single-user lock)", () => {
  it("autoriza apenas o e-mail exato (case-insensitive e trim)", () => {
    expect(isAllowedEmail("Welly@Gmail.com ", "welly@gmail.com")).toBe(true);
    expect(isAllowedEmail("outro@gmail.com", "welly@gmail.com")).toBe(false);
    expect(isAllowedEmail(null, "welly@gmail.com")).toBe(false);
    expect(isAllowedEmail("welly@gmail.com", "")).toBe(false);
  });

  it("valida Bearer token do Cron Job", () => {
    process.env.CRON_SECRET = "super-secret-cron";
    expect(isValidCronRequest("Bearer super-secret-cron")).toBe(true);
    expect(isValidCronRequest("Bearer errado")).toBe(false);
    expect(isValidCronRequest(null)).toBe(false);
  });
});

describe("parseInstallmentInfo", () => {
  it("extrai padrões brasileiros de parcelamento", () => {
    expect(parseInstallmentInfo("MERCADOLIVRE PARC 02/10")).toEqual({
      installmentNumber: 2,
      installmentTotal: 10,
    });
    expect(parseInstallmentInfo("COMPRA PARCELA 4 DE 12")).toEqual({
      installmentNumber: 4,
      installmentTotal: 12,
    });
    expect(parseInstallmentInfo("LOJA RENNER 03/06")).toEqual({
      installmentNumber: 3,
      installmentTotal: 6,
    });
  });

  it("ignora descrições sem parcelamento válido", () => {
    expect(parseInstallmentInfo("IFD*RESTAURANTE CENTRAL")).toBeNull();
    expect(parseInstallmentInfo("PARC 10/03")).toBeNull();
    expect(parseInstallmentInfo("PAGAMENTO 1/1")).toBeNull();
  });
});

describe("detectTransactionKind", () => {
  it("classifica pagamento de fatura e transferência própria sem dupla contagem", () => {
    expect(
      detectTransactionKind({
        accountType: "CHECKING",
        rawAmount: -2500,
        description: "PAGAMENTO FATURA NUBANK",
      })
    ).toBe("CC_PAYMENT");

    expect(
      detectTransactionKind({
        accountType: "CHECKING",
        rawAmount: -1000,
        description: "PIX ENVIADO MESMA TITULARIDADE INTER",
      })
    ).toBe("TRANSFER");
  });

  it("classifica compras e estornos no cartão de crédito corretamente", () => {
    expect(
      detectTransactionKind({
        accountType: "CREDIT_CARD",
        rawAmount: 149.9,
        description: "AMAZON.COM.BR",
        pluggyType: "DEBIT",
      })
    ).toBe("EXPENSE");

    expect(
      detectTransactionKind({
        accountType: "CREDIT_CARD",
        rawAmount: -50,
        description: "ESTORNO COMPRA",
        pluggyType: "CREDIT",
      })
    ).toBe("INCOME");
  });
});

describe("findPotentialDuplicates", () => {
  it("identifica duplicidade dentro de ±3 dias com mesmo valor", () => {
    const existing = [
      {
        id: "tx-1",
        amountCents: 12990,
        occurredAt: "2026-11-10",
        cleanMerchant: "iFood",
        rawDescription: "IFD*BURGER HOUSE",
      },
      {
        id: "tx-2",
        amountCents: 12990,
        occurredAt: "2026-10-01",
        cleanMerchant: "iFood",
        rawDescription: "IFD*OUTRO",
      },
    ];

    const matches = findPotentialDuplicates(
      { amountCents: 12990, occurredAt: "2026-11-11", description: "iFood Burger" },
      existing
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].transaction.id).toBe("tx-1");
    expect(matches[0].dayDiff).toBe(1);
    expect(matches[0].score).toBeGreaterThan(0.8);
  });
});

describe("applyCategorizationRules", () => {
  it("respeita ordem de prioridade (menor número vence)", () => {
    const rules = [
      {
        id: "r2",
        pattern: "MERC",
        matchType: "CONTAINS",
        cleanMerchant: "Genérico",
        categoryId: "cat-other",
        priority: 50,
      },
      {
        id: "r1",
        pattern: "MERCADOLIVRE",
        matchType: "CONTAINS",
        cleanMerchant: "Mercado Livre",
        categoryId: "cat-shop",
        priority: 10,
      },
    ];

    const matched = applyCategorizationRules("MERCADOLIVRE*ELETRONICOS", rules);
    expect(matched?.id).toBe("r1");
    expect(matched?.cleanMerchant).toBe("Mercado Livre");
  });
});

describe("computeBudgetPace", () => {
  it("sinaliza WARNING quando projeção ultrapassa o teto e OVER quando já estourou", () => {
    const warning = computeBudgetPace({
      spentCents: 45000,
      limitCents: 60000,
      dayOfMonth: 10,
      daysInMonth: 30,
    });
    expect(warning.status).toBe("WARNING");
    expect(warning.projectedCents).toBe(135000);

    const over = computeBudgetPace({
      spentCents: 65000,
      limitCents: 60000,
      dayOfMonth: 20,
      daysInMonth: 30,
    });
    expect(over.status).toBe("OVER");
  });
});

describe("projectCreditCardInstallments", () => {
  it("projeta parcelas restantes nos meses futuros corretamente", () => {
    const txs = [
      {
        cleanMerchant: "Monitor",
        amountCents: 50000,
        occurredAt: "2026-11-12",
        installmentNumber: 4,
        installmentTotal: 6,
        kind: "EXPENSE",
      },
    ];

    const forecast = projectCreditCardInstallments(txs, "2026-11", 4);
    expect(forecast[0]).toMatchObject({ monthKey: "2026-12", committedCents: 50000 });
    expect(forecast[1]).toMatchObject({ monthKey: "2027-01", committedCents: 50000 });
    expect(forecast[2]).toMatchObject({ monthKey: "2027-02", committedCents: 0 });
  });
});

describe("detectRecurringPatterns & detectSpendingAnomalies", () => {
  it("detecta assinatura recorrente e aumento de preço", () => {
    const txs = [
      {
        cleanMerchant: "Netflix",
        amountCents: 4490,
        occurredAt: "2026-09-05",
        kind: "EXPENSE",
        installmentTotal: null,
        categoryId: "cat-sub",
        accountId: "acc-1",
      },
      {
        cleanMerchant: "Netflix",
        amountCents: 4490,
        occurredAt: "2026-10-05",
        kind: "EXPENSE",
        installmentTotal: null,
        categoryId: "cat-sub",
        accountId: "acc-1",
      },
      {
        cleanMerchant: "Netflix",
        amountCents: 5990,
        occurredAt: "2026-11-05",
        kind: "EXPENSE",
        installmentTotal: null,
        categoryId: "cat-sub",
        accountId: "acc-1",
      },
    ];

    const detected = detectRecurringPatterns(txs);
    expect(detected).toHaveLength(1);
    expect(detected[0].merchantName).toBe("Netflix");
    expect(detected[0].previousCents).toBe(4490);
    expect(detected[0].latestCents).toBe(5990);
    expect(detected[0].priceChangeRatio).toBeGreaterThan(0.3);
  });

  it("detecta anomalia de gasto por categoria acima da média histórica", () => {
    const anomalies = detectSpendingAnomalies(
      [{ categoryId: "cat-food", categoryName: "Alimentação", totalCents: 90000 }],
      new Map([["cat-food", 45000]])
    );
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].increaseRatio).toBeCloseTo(1.0);
  });
});
