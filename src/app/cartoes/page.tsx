"use client";

import { useEffect, useState, useCallback } from "react";
import { CreditCard, Landmark, Plus, Calendar } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  formatBRL,
  formatDateBR,
  formatMonthLabel,
  parseBRLToCents,
} from "@/lib/format";

interface AccountItem {
  id: string;
  name: string;
  institutionName: string;
  type: "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "CASH";
  balanceCents: number;
  creditLimitCents: number | null;
  availableCreditLimitCents: number | null;
  closingDay: number | null;
  dueDay: number | null;
}

interface CardWithBills extends AccountItem {
  bills: Array<{
    id: string;
    referenceMonth: string;
    dueDate: string;
    totalCents: number;
    status: string;
  }>;
}

interface ForecastMonth {
  monthKey: string;
  committedCents: number;
  items: Array<{
    cleanMerchant: string;
    amountCents: number;
    installmentNumber: number;
    installmentTotal: number;
  }>;
}

export default function CartoesPage() {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [cards, setCards] = useState<CardWithBills[]>([]);
  const [forecast, setForecast] = useState<ForecastMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const [form, setForm] = useState({
    name: "",
    institutionName: "",
    type: "CHECKING" as AccountItem["type"],
    balance: "",
    creditLimit: "",
    closingDay: "3",
    dueDay: "10",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/accounts");
      const json = await res.json();
      if (res.ok) {
        setAccounts(json.accounts ?? []);
        setCards(json.cards ?? []);
        setForecast(json.forecast ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        institutionName: form.institutionName || "Manual",
        type: form.type,
        balanceCents: parseBRLToCents(form.balance || "0"),
        creditLimitCents:
          form.type === "CREDIT_CARD" ? parseBRLToCents(form.creditLimit || "0") : null,
        closingDay: form.type === "CREDIT_CARD" ? Number(form.closingDay) : null,
        dueDay: form.type === "CREDIT_CARD" ? Number(form.dueDay) : null,
      }),
    });
    if (res.ok) {
      setShowNew(false);
      setForm({
        name: "",
        institutionName: "",
        type: "CHECKING",
        balance: "",
        creditLimit: "",
        closingDay: "3",
        dueDay: "10",
      });
      await load();
    }
  }

  const bankAccounts = accounts.filter((a) => a.type !== "CREDIT_CARD");

  return (
    <AppShell>
      <div className="space-y-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Contas & Cartões</h1>
            <p className="text-sm text-slate-400">
              Saldos consolidados, limites, faturas e projeção de parcelamentos futuros
            </p>
          </div>
          <button
            onClick={() => setShowNew((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
            Adicionar Conta / Cartão Manual
          </button>
        </div>

        {showNew && (
          <form
            onSubmit={handleCreate}
            className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 sm:grid-cols-2 lg:grid-cols-4"
          >
            <input
              type="text"
              required
              placeholder="Nome (ex: Nubank Ultravioleta)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
            <input
              type="text"
              placeholder="Instituição (ex: Nubank)"
              value={form.institutionName}
              onChange={(e) => setForm({ ...form, institutionName: e.target.value })}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as AccountItem["type"] })}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="CHECKING">Conta Corrente</option>
              <option value="SAVINGS">Poupança / Reserva</option>
              <option value="CREDIT_CARD">Cartão de Crédito</option>
              <option value="CASH">Carteira / Dinheiro</option>
            </select>
            {form.type === "CREDIT_CARD" ? (
              <input
                type="text"
                placeholder="Limite total (ex: 12000,00)"
                value={form.creditLimit}
                onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            ) : (
              <input
                type="text"
                placeholder="Saldo atual (ex: 4500,00)"
                value={form.balance}
                onChange={(e) => setForm({ ...form, balance: e.target.value })}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            )}
            <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-4">
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white"
              >
                Salvar
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="h-40 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
        ) : (
          <>
            {/* Contas Bancárias */}
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
                <Landmark className="h-4 w-4 text-emerald-400" />
                Contas Bancárias & Reservas
              </h2>
              {bankAccounts.length === 0 ? (
                <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
                  Nenhuma conta bancária cadastrada. Conecte seus bancos via Meu Pluggy em Configurações ou crie uma conta manual.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {bankAccounts.map((acc) => (
                    <div
                      key={acc.id}
                      className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
                    >
                      <div className="text-xs text-slate-400">{acc.institutionName}</div>
                      <div className="mt-0.5 text-base font-semibold text-white">{acc.name}</div>
                      <div className="mt-4 text-2xl font-bold text-emerald-400">
                        {formatBRL(acc.balanceCents)}
                      </div>
                      <div className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">
                        {acc.type === "SAVINGS"
                          ? "Reserva / Poupança"
                          : acc.type === "CASH"
                            ? "Dinheiro"
                            : "Conta Corrente"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Cartões de Crédito */}
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
                <CreditCard className="h-4 w-4 text-indigo-400" />
                Cartões de Crédito & Faturas
              </h2>
              {cards.length === 0 ? (
                <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
                  Nenhum cartão de crédito conectado ainda.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {cards.map((card) => {
                    const limit = card.creditLimitCents ?? 0;
                    const available = card.availableCreditLimitCents ?? Math.max(0, limit - Math.abs(card.balanceCents));
                    const used = Math.max(0, limit - available);
                    const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

                    return (
                      <div
                        key={card.id}
                        className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-xs text-slate-400">{card.institutionName}</div>
                            <div className="text-lg font-semibold text-white">{card.name}</div>
                          </div>
                          {card.dueDay && (
                            <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
                              Fecha dia {card.closingDay ?? "—"} · Vence dia {card.dueDay}
                            </span>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs">
                            <span className="text-slate-400">Limite utilizado ({pct}%)</span>
                            <span className="font-medium text-white">
                              {formatBRL(used)} / {formatBRL(limit)}
                            </span>
                          </div>
                          <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="text-xs text-emerald-400">
                            Disponível: {formatBRL(available)}
                          </div>
                        </div>

                        {card.bills.length > 0 && (
                          <div className="space-y-2 border-t border-slate-800 pt-3">
                            <div className="text-xs font-medium text-slate-400">Faturas recentes</div>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {card.bills.slice(0, 3).map((b) => (
                                <div
                                  key={b.id}
                                  className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 text-xs"
                                >
                                  <div className="text-slate-400">{formatDateBR(b.dueDate)}</div>
                                  <div className="mt-1 font-semibold text-white">
                                    {formatBRL(b.totalCents)}
                                  </div>
                                  <div className="mt-0.5 text-[10px] uppercase text-indigo-400">
                                    {b.status === "OPEN"
                                      ? "Aberta"
                                      : b.status === "PAID"
                                        ? "Paga"
                                        : "Fechada"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Projeção de Parcelas Futuras */}
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
                <Calendar className="h-4 w-4 text-amber-400" />
                Projeção de Parcelamentos Já Comprometidos (Próximos 6 Meses)
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {forecast.map((m) => (
                  <div
                    key={m.monthKey}
                    className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-400">
                        {formatMonthLabel(m.monthKey)}
                      </span>
                      <span className="text-sm font-bold text-amber-300">
                        {formatBRL(m.committedCents)}
                      </span>
                    </div>
                    {m.items.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">Nenhuma parcela prevista.</p>
                    ) : (
                      <ul className="mt-2.5 space-y-1 text-xs text-slate-300">
                        {m.items.slice(0, 4).map((it, idx) => (
                          <li key={idx} className="flex justify-between gap-2">
                            <span className="truncate">
                              {it.cleanMerchant}{" "}
                              <span className="text-slate-500">
                                ({it.installmentNumber}/{it.installmentTotal})
                              </span>
                            </span>
                            <span className="shrink-0 font-medium">
                              {formatBRL(it.amountCents)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
