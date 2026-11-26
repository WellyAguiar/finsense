"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  CreditCard,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Info,
  X,
  RefreshCw,
  ArrowRight,
  Target,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { CashflowChart, CategoryBreakdownChart } from "@/components/DashboardCharts";
import { MarkdownText } from "@/components/MarkdownText";
import {
  cn,
  formatBRL,
  formatMonthLabel,
  formatPercent,
  getCurrentMonthKey,
  shiftMonthKey,
} from "@/lib/format";

interface DashboardData {
  monthKey: string;
  cashBalanceCents: number;
  openCreditCardCents: number;
  netWorthLiquidCents: number;
  currentTotals: {
    incomeCents: number;
    expenseCents: number;
    netCents: number;
    savingsRate: number;
    transactionCount: number;
  };
  previousTotals: {
    incomeCents: number;
    expenseCents: number;
  };
  byCategory: Array<{
    categoryId: string;
    categoryName: string;
    categoryColor: string;
    totalCents: number;
    share: number;
  }>;
  cashflow: Array<{
    monthKey: string;
    label: string;
    incomeCents: number;
    expenseCents: number;
    netCents: number;
  }>;
  budgetProgress: Array<{
    budgetId: string;
    categoryName: string;
    categoryColor: string;
    limitCents: number;
    spentCents: number;
    usageRatio: number;
    projectedCents: number;
    status: "OK" | "WARNING" | "OVER";
  }>;
  activeInsights: Array<{
    id: string;
    type: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
    title: string;
    summaryMd: string;
  }>;
  recurringMonthlyCents: number;
  activeRecurringCount: number;
  activeGoals: Array<{
    id: string;
    name: string;
    targetCents: number;
    currentCents: number;
    color: string;
  }>;
  pendingReviewCount: number;
  connectionsCount: number;
}

export default function DashboardPage() {
  const [monthKey, setMonthKey] = useState(getCurrentMonthKey());
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshingInsights, setRefreshingInsights] = useState(false);

  const load = useCallback(async (targetMonth: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard?month=${targetMonth}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao carregar dashboard");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(monthKey);
  }, [monthKey, load]);

  async function handleGenerateInsights() {
    setRefreshingInsights(true);
    try {
      await fetch("/api/ai/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthKey }),
      });
      await load(monthKey);
    } finally {
      setRefreshingInsights(false);
    }
  }

  async function handleDismissInsight(id: string) {
    await fetch("/api/ai/insights", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, dismissed: true }),
    });
    setData((prev) =>
      prev ? { ...prev, activeInsights: prev.activeInsights.filter((i) => i.id !== id) } : prev
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Topo + Seletor de Mês */}
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Visão Geral</h1>
            <p className="text-sm text-slate-400">
              Consolidado automático de contas, cartões, orçamento e diagnósticos da IA
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl border border-slate-800 bg-slate-900 p-1">
              <button
                onClick={() => setMonthKey((m) => shiftMonthKey(m, -1))}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[140px] text-center text-sm font-medium text-slate-100">
                {formatMonthLabel(monthKey)}
              </span>
              <button
                onClick={() => setMonthKey((m) => shiftMonthKey(m, 1))}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <button
              onClick={handleGenerateInsights}
              disabled={refreshingInsights}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {refreshingInsights ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Diagnóstico IA
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            {error}
          </div>
        )}

        {loading || !data ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60"
              />
            ))}
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                title="Saldo em Contas"
                value={formatBRL(data.cashBalanceCents)}
                subtitle={`Líquido pós-faturas: ${formatBRL(data.netWorthLiquidCents)}`}
                icon={<Wallet className="h-4 w-4 text-emerald-400" />}
              />
              <KpiCard
                title="Entradas do Mês"
                value={formatBRL(data.currentTotals.incomeCents)}
                subtitle={`Mês anterior: ${formatBRL(data.previousTotals.incomeCents)}`}
                icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
                accent="text-emerald-400"
              />
              <KpiCard
                title="Saídas do Mês"
                value={formatBRL(data.currentTotals.expenseCents)}
                subtitle={`Poupança: ${formatPercent(data.currentTotals.savingsRate)}`}
                icon={<TrendingDown className="h-4 w-4 text-rose-400" />}
                accent="text-rose-400"
              />
              <KpiCard
                title="Faturas em Aberto"
                value={formatBRL(data.openCreditCardCents)}
                subtitle={`Fixos/assinaturas: ${formatBRL(data.recurringMonthlyCents)}/mês`}
                icon={<CreditCard className="h-4 w-4 text-indigo-400" />}
              />
            </div>

            {/* Banner de conexão Open Finance quando ainda não há bancos Pluggy */}
            {data.connectionsCount === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                <span>
                  Nenhum banco real conectado ainda — conecte suas contas via Open Finance (Pluggy) ou limpe os dados demo em Configurações.
                </span>
                <Link
                  href="/configuracoes"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Conectar Bancos <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}

            {/* Banner de transações pendentes */}
            {data.pendingReviewCount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <span>
                  Você tem <strong>{data.pendingReviewCount}</strong> transação(ões) aguardando revisão ou categorização da IA.
                </span>
                <Link
                  href="/transacoes?unreviewed=1"
                  className="inline-flex items-center gap-1 font-semibold text-amber-300 hover:underline"
                >
                  Revisar agora <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}

            {/* Central de Alertas & Relatórios Proativos da IA */}
            {data.activeInsights.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
                    <Sparkles className="h-4 w-4 text-indigo-400" />
                    Insights & Alertas Proativos da IA
                  </h2>
                  <Link href="/chat" className="text-xs font-medium text-indigo-400 hover:underline">
                    Perguntar no Chat IA →
                  </Link>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {data.activeInsights.map((ins) => (
                    <div
                      key={ins.id}
                      className={cn(
                        "relative rounded-2xl border p-4",
                        ins.severity === "CRITICAL"
                          ? "border-rose-500/30 bg-rose-500/10"
                          : ins.severity === "WARNING"
                            ? "border-amber-500/30 bg-amber-500/10"
                            : "border-indigo-500/30 bg-indigo-500/10"
                      )}
                    >
                      <button
                        onClick={() => handleDismissInsight(ins.id)}
                        title="Dispensar"
                        className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 hover:bg-slate-800/70 hover:text-white"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                      <div className="mb-1.5 flex items-center gap-2 pr-6 text-sm font-semibold text-white">
                        {ins.severity === "INFO" ? (
                          <Info className="h-4 w-4 shrink-0 text-indigo-400" />
                        ) : (
                          <AlertTriangle
                            className={cn(
                              "h-4 w-4 shrink-0",
                              ins.severity === "CRITICAL" ? "text-rose-400" : "text-amber-400"
                            )}
                          />
                        )}
                        <span>{ins.title}</span>
                      </div>
                      <div className="text-xs leading-relaxed text-slate-200/90">
                        <MarkdownText content={ins.summaryMd} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Gráficos Principais */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <h2 className="mb-4 text-sm font-semibold text-white">
                  Fluxo de Caixa (Últimos 6 meses)
                </h2>
                <CashflowChart data={data.cashflow} />
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <h2 className="mb-4 text-sm font-semibold text-white">
                  Gastos por Categoria ({formatMonthLabel(monthKey)})
                </h2>
                <CategoryBreakdownChart data={data.byCategory} />
              </div>
            </div>

            {/* Orçamentos & Metas */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">Ritmo dos Orçamentos</h2>
                  <Link href="/planejamento" className="text-xs text-emerald-400 hover:underline">
                    Gerenciar
                  </Link>
                </div>
                {data.budgetProgress.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    Nenhum orçamento configurado ainda. Crie tetos mensais em Orçamentos & Metas.
                  </p>
                ) : (
                  <div className="space-y-3.5">
                    {data.budgetProgress.slice(0, 5).map((b) => (
                      <div key={b.budgetId} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-200">{b.categoryName}</span>
                          <span className="text-slate-300">
                            {formatBRL(b.spentCents)}{" "}
                            <span className="text-slate-500">/ {formatBRL(b.limitCents)}</span>
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              b.status === "OVER"
                                ? "bg-rose-500"
                                : b.status === "WARNING"
                                  ? "bg-amber-400"
                                  : "bg-emerald-500"
                            )}
                            style={{ width: `${Math.min(100, Math.round(b.usageRatio * 100))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Target className="h-4 w-4 text-emerald-400" />
                    Metas Financeiras
                  </h2>
                  <Link href="/planejamento" className="text-xs text-emerald-400 hover:underline">
                    Ver todas
                  </Link>
                </div>
                {data.activeGoals.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    Nenhuma meta criada ainda. Cadastre sua reserva de emergência ou próximos objetivos.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {data.activeGoals.slice(0, 4).map((g) => {
                      const pct = Math.min(100, Math.round((g.currentCents / Math.max(1, g.targetCents)) * 100));
                      return (
                        <div key={g.id} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-slate-100">{g.name}</span>
                            <span className="text-slate-400">{pct}%</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, backgroundColor: g.color }}
                            />
                          </div>
                          <div className="flex justify-between text-[11px] text-slate-400">
                            <span>{formatBRL(g.currentCents)}</span>
                            <span>Alvo: {formatBRL(g.targetCents)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  icon,
  accent = "text-white",
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400">{title}</span>
        {icon}
      </div>
      <div className={cn("text-2xl font-bold tracking-tight", accent)}>{value}</div>
      <div className="mt-1 text-xs text-slate-400">{subtitle}</div>
    </div>
  );
}
