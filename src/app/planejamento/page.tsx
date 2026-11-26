"use client";

import { useEffect, useState, useCallback } from "react";
import { PiggyBank, Repeat, Target, Plus, Trash2, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  cn,
  formatBRL,
  formatDateBR,
  getCurrentMonthKey,
  parseBRLToCents,
} from "@/lib/format";

interface BudgetProgress {
  budgetId: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  limitCents: number;
  spentCents: number;
  usageRatio: number;
  projectedCents: number;
  status: "OK" | "WARNING" | "OVER";
}

interface RecurringItem {
  id: string;
  merchantName: string;
  categoryName: string;
  accountName: string;
  expectedCents: number;
  previousCents: number | null;
  expectedDay: number;
  frequency: string;
  status: string;
  detectedByAi: boolean;
}

interface RecurringSuggestion {
  merchantName: string;
  latestCents: number;
  expectedDay: number;
  monthsDetected: number;
  categoryId: string | null;
  accountId: string;
}

interface GoalItem {
  id: string;
  name: string;
  description: string | null;
  targetCents: number;
  currentCents: number;
  targetDate: string | null;
  color: string;
  status: string;
}

export default function PlanejamentoPage() {
  const [tab, setTab] = useState<"budgets" | "recurring" | "goals">("budgets");
  const [monthKey] = useState(getCurrentMonthKey());

  const [budgets, setBudgets] = useState<BudgetProgress[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [recurring, setRecurring] = useState<RecurringItem[]>([]);
  const [suggestions, setSuggestions] = useState<RecurringSuggestion[]>([]);
  const [goals, setGoals] = useState<GoalItem[]>([]);

  const [budgetForm, setBudgetForm] = useState({ categoryId: "", limit: "" });
  const [recurringForm, setRecurringForm] = useState({
    merchantName: "",
    amount: "",
    expectedDay: "5",
  });
  const [goalForm, setGoalForm] = useState({
    name: "",
    target: "",
    current: "",
    targetDate: "",
  });

  const loadAll = useCallback(async () => {
    const [bRes, rRes, gRes] = await Promise.all([
      fetch(`/api/budgets?month=${monthKey}`),
      fetch("/api/recurring"),
      fetch("/api/goals"),
    ]);

    if (bRes.ok) {
      const bJson = await bRes.json();
      setBudgets(bJson.budgets ?? []);
      setCategories(bJson.categories ?? []);
    }
    if (rRes.ok) {
      const rJson = await rRes.json();
      setRecurring(rJson.items ?? []);
      setSuggestions(rJson.suggestions ?? []);
    }
    if (gRes.ok) {
      const gJson = await gRes.json();
      setGoals(gJson.goals ?? []);
    }
  }, [monthKey]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function handleSaveBudget(e: React.FormEvent) {
    e.preventDefault();
    const limitCents = parseBRLToCents(budgetForm.limit);
    if (!budgetForm.categoryId || limitCents <= 0) return;

    const res = await fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId: budgetForm.categoryId,
        referenceMonth: "DEFAULT",
        limitCents,
      }),
    });
    if (res.ok) {
      setBudgetForm({ categoryId: "", limit: "" });
      await loadAll();
    }
  }

  async function handleCreateRecurring(e: React.FormEvent) {
    e.preventDefault();
    const expectedCents = parseBRLToCents(recurringForm.amount);
    if (!recurringForm.merchantName.trim() || expectedCents <= 0) return;

    const res = await fetch("/api/recurring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantName: recurringForm.merchantName.trim(),
        expectedCents,
        expectedDay: Number(recurringForm.expectedDay) || 5,
      }),
    });
    if (res.ok) {
      setRecurringForm({ merchantName: "", amount: "", expectedDay: "5" });
      await loadAll();
    }
  }

  async function handleAcceptSuggestion(s: RecurringSuggestion) {
    await fetch("/api/recurring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantName: s.merchantName,
        categoryId: s.categoryId,
        accountId: s.accountId,
        expectedCents: s.latestCents,
        expectedDay: s.expectedDay,
      }),
    });
    await loadAll();
  }

  async function handleCreateGoal(e: React.FormEvent) {
    e.preventDefault();
    const targetCents = parseBRLToCents(goalForm.target);
    const currentCents = parseBRLToCents(goalForm.current || "0");
    if (!goalForm.name.trim() || targetCents <= 0) return;

    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: goalForm.name.trim(),
        targetCents,
        currentCents,
        targetDate: goalForm.targetDate || null,
      }),
    });
    if (res.ok) {
      setGoalForm({ name: "", target: "", current: "", targetDate: "" });
      await loadAll();
    }
  }

  async function handleContributeGoal(goal: GoalItem) {
    const input = prompt(`Quanto deseja somar à meta "${goal.name}"? (ex: 500,00)`);
    if (!input) return;
    const addCents = parseBRLToCents(input);
    if (addCents <= 0) return;

    await fetch("/api/goals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: goal.id, addCents }),
    });
    await loadAll();
  }

  const totalRecurringMonthly = recurring
    .filter((r) => r.status === "ACTIVE")
    .reduce(
      (acc, r) => acc + (r.frequency === "YEARLY" ? Math.round(r.expectedCents / 12) : r.expectedCents),
      0
    );

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Orçamentos, Assinaturas & Metas
          </h1>
          <p className="text-sm text-slate-400">
            Controle de tetos mensais, radar de contas fixas e acompanhamento de objetivos
          </p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
          <TabButton
            active={tab === "budgets"}
            onClick={() => setTab("budgets")}
            icon={<PiggyBank className="h-4 w-4" />}
            label={`Orçamentos (${budgets.length})`}
          />
          <TabButton
            active={tab === "recurring"}
            onClick={() => setTab("recurring")}
            icon={<Repeat className="h-4 w-4" />}
            label={`Assinaturas & Fixos (${recurring.length})`}
          />
          <TabButton
            active={tab === "goals"}
            onClick={() => setTab("goals")}
            icon={<Target className="h-4 w-4" />}
            label={`Metas (${goals.length})`}
          />
        </div>

        {/* TAB 1: Orçamentos */}
        {tab === "budgets" && (
          <div className="space-y-6">
            <form
              onSubmit={handleSaveBudget}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4"
            >
              <select
                required
                value={budgetForm.categoryId}
                onChange={(e) => setBudgetForm({ ...budgetForm, categoryId: e.target.value })}
                className="min-w-[200px] flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                <option value="">Escolha a categoria...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                placeholder="Limite mensal (ex: 800,00)"
                value={budgetForm.limit}
                onChange={(e) => setBudgetForm({ ...budgetForm, limit: e.target.value })}
                className="w-52 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                <Plus className="h-4 w-4" />
                Definir Orçamento
              </button>
            </form>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {budgets.map((b) => (
                <div
                  key={b.budgetId}
                  className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: b.categoryColor }}
                      />
                      <span className="font-semibold text-white">{b.categoryName}</span>
                    </div>
                    <button
                      onClick={async () => {
                        await fetch(`/api/budgets?id=${b.budgetId}`, { method: "DELETE" });
                        await loadAll();
                      }}
                      className="rounded-lg p-1 text-slate-500 hover:bg-rose-500/20 hover:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-lg font-bold text-white">
                      {formatBRL(b.spentCents)}
                    </span>
                    <span className="text-xs text-slate-400">
                      de {formatBRL(b.limitCents)} ({Math.round(b.usageRatio * 100)}%)
                    </span>
                  </div>

                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        b.status === "OVER"
                          ? "bg-rose-500"
                          : b.status === "WARNING"
                            ? "bg-amber-400"
                            : "bg-emerald-500"
                      )}
                      style={{ width: `${Math.min(100, Math.round(b.usageRatio * 100))}%` }}
                    />
                  </div>

                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Projeção de fechamento: {formatBRL(b.projectedCents)}</span>
                    <span
                      className={cn(
                        "font-medium",
                        b.status === "OVER"
                          ? "text-rose-400"
                          : b.status === "WARNING"
                            ? "text-amber-300"
                            : "text-emerald-400"
                      )}
                    >
                      {b.status === "OVER"
                        ? "Ultrapassado"
                        : b.status === "WARNING"
                          ? "Atenção ao ritmo"
                          : "No controle"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: Assinaturas & Contas Fixas */}
        {tab === "recurring" && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="text-xs text-slate-400">Custo fixo mensal mapeado</div>
              <div className="mt-1 text-2xl font-bold text-white">
                {formatBRL(totalRecurringMonthly)}{" "}
                <span className="text-sm font-normal text-slate-400">
                  / mês ({formatBRL(totalRecurringMonthly * 12)} / ano)
                </span>
              </div>
            </div>

            {suggestions.length > 0 && (
              <div className="space-y-2 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase text-indigo-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  Cobranças recorrentes detectadas no seu histórico
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s.merchantName}
                      onClick={() => handleAcceptSuggestion(s)}
                      className="rounded-xl border border-indigo-400/30 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-100 hover:bg-indigo-600"
                    >
                      + {s.merchantName} ({formatBRL(s.latestCents)} · {s.monthsDetected}m)
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form
              onSubmit={handleCreateRecurring}
              className="flex flex-wrap gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4"
            >
              <input
                type="text"
                required
                placeholder="Nome (ex: Internet Fibra, Academia)"
                value={recurringForm.merchantName}
                onChange={(e) =>
                  setRecurringForm({ ...recurringForm, merchantName: e.target.value })
                }
                className="min-w-[200px] flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <input
                type="text"
                required
                placeholder="Valor mensal (ex: 139,90)"
                value={recurringForm.amount}
                onChange={(e) => setRecurringForm({ ...recurringForm, amount: e.target.value })}
                className="w-44 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <input
                type="number"
                min={1}
                max={31}
                placeholder="Dia"
                value={recurringForm.expectedDay}
                onChange={(e) =>
                  setRecurringForm({ ...recurringForm, expectedDay: e.target.value })
                }
                className="w-24 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <button
                type="submit"
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Adicionar
              </button>
            </form>

            <div className="space-y-2">
              {recurring.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4"
                >
                  <div>
                    <div className="flex items-center gap-2 font-medium text-white">
                      <span>{r.merchantName}</span>
                      {r.previousCents && r.expectedCents > r.previousCents && (
                        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                          Subiu de {formatBRL(r.previousCents)}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">
                      {r.categoryName} · {r.accountName} · Todo dia {r.expectedDay}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-base font-semibold text-white">
                      {formatBRL(r.expectedCents)}
                    </span>
                    <button
                      onClick={async () => {
                        await fetch(`/api/recurring?id=${r.id}`, { method: "DELETE" });
                        await loadAll();
                      }}
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: Metas */}
        {tab === "goals" && (
          <div className="space-y-6">
            <form
              onSubmit={handleCreateGoal}
              className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:grid-cols-2 lg:grid-cols-5"
            >
              <input
                type="text"
                required
                placeholder="Nome da meta (ex: Reserva de Emergência)"
                value={goalForm.name}
                onChange={(e) => setGoalForm({ ...goalForm, name: e.target.value })}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white lg:col-span-2"
              />
              <input
                type="text"
                required
                placeholder="Alvo (ex: 30000,00)"
                value={goalForm.target}
                onChange={(e) => setGoalForm({ ...goalForm, target: e.target.value })}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <input
                type="text"
                placeholder="Já guardado (ex: 5000,00)"
                value={goalForm.current}
                onChange={(e) => setGoalForm({ ...goalForm, current: e.target.value })}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              <button
                type="submit"
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Criar Meta
              </button>
            </form>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {goals.map((g) => {
                const pct = Math.min(100, Math.round((g.currentCents / Math.max(1, g.targetCents)) * 100));
                return (
                  <div
                    key={g.id}
                    className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-semibold text-white">{g.name}</div>
                        {g.targetDate && (
                          <div className="text-xs text-slate-400">
                            Prazo: {formatDateBR(g.targetDate)}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleContributeGoal(g)}
                        className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25"
                      >
                        + Aporte
                      </button>
                    </div>

                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: g.color }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white">
                        {formatBRL(g.currentCents)} ({pct}%)
                      </span>
                      <span className="text-slate-400">Meta: {formatBRL(g.targetCents)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition",
        active
          ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
          : "bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
