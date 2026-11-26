"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Search,
  Sparkles,
  Plus,
  CheckCircle2,
  Trash2,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { cn, formatBRL, formatDateBR, parseBRLToCents } from "@/lib/format";

interface TxRow {
  id: string;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string;
  source: string;
  kind: "INCOME" | "EXPENSE" | "TRANSFER" | "CC_PAYMENT";
  amountCents: number;
  occurredAt: string;
  rawDescription: string;
  cleanMerchant: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  reviewed: boolean;
}

interface SimpleAccount {
  id: string;
  name: string;
  type: string;
}

interface SimpleCategory {
  id: string;
  name: string;
  type: string;
  color: string;
}

const KIND_LABELS: Record<string, { label: string; style: string }> = {
  INCOME: { label: "Entrada", style: "bg-emerald-500/15 text-emerald-300" },
  EXPENSE: { label: "Saída", style: "bg-rose-500/15 text-rose-300" },
  TRANSFER: { label: "Transferência", style: "bg-slate-700/60 text-slate-300" },
  CC_PAYMENT: { label: "Pag. Fatura", style: "bg-indigo-500/15 text-indigo-300" },
};

export default function TransacoesPage() {
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [accounts, setAccounts] = useState<SimpleAccount[]>([]);
  const [categories, setCategories] = useState<SimpleCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);

  const [categorizing, setCategorizing] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({
    accountId: "",
    categoryId: "",
    kind: "EXPENSE" as "INCOME" | "EXPENSE" | "TRANSFER" | "CC_PAYMENT",
    amount: "",
    occurredAt: new Date().toISOString().slice(0, 10),
    cleanMerchant: "",
  });

  const [editing, setEditing] = useState<TxRow | null>(null);
  const [editForm, setEditForm] = useState({
    cleanMerchant: "",
    categoryId: "",
    kind: "EXPENSE" as TxRow["kind"],
    learnRule: true,
    rulePattern: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (kindFilter) params.set("kind", kindFilter);
    if (accountFilter) params.set("accountId", accountFilter);
    if (onlyUnreviewed) params.set("unreviewed", "1");

    try {
      const res = await fetch(`/api/transactions?${params.toString()}`);
      const json = await res.json();
      if (res.ok) {
        setTxs(json.transactions ?? []);
        setAccounts(json.accounts ?? []);
        setCategories(json.categories ?? []);
        if (json.accounts?.length > 0) {
          setNewForm((f) => (f.accountId ? f : { ...f, accountId: json.accounts[0].id }));
        }
      }
    } finally {
      setLoading(false);
    }
  }, [q, kindFilter, accountFilter, onlyUnreviewed]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRunAiCategorization() {
    setCategorizing(true);
    setBanner(null);
    try {
      const res = await fetch("/api/ai/categorize", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setBanner(json.error || "Erro ao categorizar");
      } else {
        const s = json.summary;
        const remainingMsg =
          s.remainingUncategorized > 0
            ? ` · Restam ${s.remainingUncategorized} sem categoria (clique novamente para o próximo lote).`
            : " · Todas as transações estão categorizadas!";
        setBanner(
          `Concluído: ${s.matchedByRules} por regras locais + ${s.categorizedByAi} pela IA Gemini${remainingMsg}`
        );
        await load();
      }
    } finally {
      setCategorizing(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = parseBRLToCents(newForm.amount);
    if (!newForm.accountId || amountCents <= 0 || !newForm.cleanMerchant.trim()) return;

    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: newForm.accountId,
        categoryId: newForm.categoryId || null,
        kind: newForm.kind,
        amountCents,
        occurredAt: newForm.occurredAt,
        cleanMerchant: newForm.cleanMerchant.trim(),
      }),
    });

    if (res.ok) {
      setShowNew(false);
      setNewForm((f) => ({ ...f, amount: "", cleanMerchant: "" }));
      await load();
    }
  }

  function openEdit(tx: TxRow) {
    setEditing(tx);
    setEditForm({
      cleanMerchant: tx.cleanMerchant,
      categoryId: tx.categoryId ?? "",
      kind: tx.kind,
      learnRule: true,
      rulePattern: tx.rawDescription.slice(0, 24),
    });
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const res = await fetch("/api/transactions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editing.id,
        cleanMerchant: editForm.cleanMerchant,
        categoryId: editForm.categoryId || null,
        kind: editForm.kind,
        reviewed: true,
        learnRule: editForm.learnRule && Boolean(editForm.categoryId),
        rulePattern: editForm.rulePattern,
        applyRetroactively: true,
      }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.learned?.updatedCount) {
        setBanner(
          `Regra aprendida! ${json.learned.updatedCount} lançamento(s) atualizado(s) automaticamente.`
        );
      }
      setEditing(null);
      await load();
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover esta transação?")) return;
    await fetch(`/api/transactions?id=${id}`, { method: "DELETE" });
    setTxs((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Transações</h1>
            <p className="text-sm text-slate-400">
              Extrato unificado com limpeza de nomes e categorização inteligente Gemini
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleRunAiCategorization}
              disabled={categorizing}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {categorizing ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Categorizar Pendentes com IA
            </button>
            <button
              onClick={() => setShowNew((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500"
            >
              <Plus className="h-4 w-4" />
              Novo Lançamento
            </button>
          </div>
        </div>

        {banner && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200">
            {banner}
          </div>
        )}

        {/* Formulário de Novo Lançamento */}
        {showNew && (
          <form
            onSubmit={handleCreate}
            className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 sm:grid-cols-2 lg:grid-cols-6"
          >
            <input
              type="text"
              required
              placeholder="Descrição / Estabelecimento"
              value={newForm.cleanMerchant}
              onChange={(e) => setNewForm({ ...newForm, cleanMerchant: e.target.value })}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white lg:col-span-2"
            />
            <input
              type="text"
              required
              placeholder="Valor (ex: 89,90)"
              value={newForm.amount}
              onChange={(e) => setNewForm({ ...newForm, amount: e.target.value })}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
            <input
              type="date"
              required
              value={newForm.occurredAt}
              onChange={(e) => setNewForm({ ...newForm, occurredAt: e.target.value })}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
            <select
              value={newForm.kind}
              onChange={(e) =>
                setNewForm({ ...newForm, kind: e.target.value as TxRow["kind"] })
              }
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="EXPENSE">Saída</option>
              <option value="INCOME">Entrada</option>
              <option value="TRANSFER">Transferência</option>
              <option value="CC_PAYMENT">Pag. Fatura</option>
            </select>
            <select
              value={newForm.accountId}
              required
              onChange={(e) => setNewForm({ ...newForm, accountId: e.target.value })}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="">Conta...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select
              value={newForm.categoryId}
              onChange={(e) => setNewForm({ ...newForm, categoryId: e.target.value })}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white lg:col-span-2"
            >
              <option value="">Categoria (opcional)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2 lg:col-span-4 lg:justify-end">
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Salvar Lançamento
              </button>
            </div>
          </form>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3.5">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar estabelecimento ou descrição..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500"
            />
          </div>
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          >
            <option value="">Todas as contas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          >
            <option value="">Todos os tipos</option>
            <option value="EXPENSE">Saídas</option>
            <option value="INCOME">Entradas</option>
            <option value="TRANSFER">Transferências</option>
            <option value="CC_PAYMENT">Pag. Fatura</option>
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={onlyUnreviewed}
              onChange={(e) => setOnlyUnreviewed(e.target.checked)}
              className="rounded border-slate-600"
            />
            Só pendentes
          </label>
        </div>

        {/* Tabela */}
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-950/60 text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Estabelecimento</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3">Conta</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                      Carregando transações...
                    </td>
                  </tr>
                ) : txs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                      Nenhuma transação encontrada. Sincronize o Meu Pluggy, envie um comprovante ou crie um lançamento manual.
                    </td>
                  </tr>
                ) : (
                  txs.map((tx) => {
                    const kindInfo = KIND_LABELS[tx.kind] ?? KIND_LABELS.EXPENSE;
                    return (
                      <tr key={tx.id} className="hover:bg-slate-800/35">
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-300">
                          {formatDateBR(tx.occurredAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 font-medium text-white">
                            <span>{tx.cleanMerchant}</span>
                            {tx.installmentTotal && (
                              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                                {tx.installmentNumber}/{tx.installmentTotal}
                              </span>
                            )}
                            {tx.reviewed && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500/70" />
                            )}
                          </div>
                          {tx.rawDescription !== tx.cleanMerchant && (
                            <div className="max-w-xs truncate text-[11px] text-slate-500">
                              {tx.rawDescription}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {tx.categoryName ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800/90 px-2.5 py-1 text-xs text-slate-200">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: tx.categoryColor }}
                              />
                              {tx.categoryName}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-300">
                          {tx.accountName}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-medium",
                              kindInfo.style
                            )}
                          >
                            {kindInfo.label}
                          </span>
                        </td>
                        <td
                          className={cn(
                            "whitespace-nowrap px-4 py-3 text-right font-semibold",
                            tx.kind === "INCOME"
                              ? "text-emerald-400"
                              : tx.kind === "EXPENSE"
                                ? "text-slate-100"
                                : "text-slate-400"
                          )}
                        >
                          {tx.kind === "INCOME" ? "+" : tx.kind === "EXPENSE" ? "-" : ""}
                          {formatBRL(tx.amountCents)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button
                            onClick={() => openEdit(tx)}
                            title="Editar e ensinar regra"
                            className="mr-1 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(tx.id)}
                            title="Excluir"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal de Edição + Aprendizado de Regra */}
        {editing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <form
              onSubmit={handleSaveEdit}
              className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Editar Transação</h3>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="rounded-xl bg-slate-950 p-3 text-xs text-slate-400">
                Original: <span className="font-mono text-slate-200">{editing.rawDescription}</span>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-400">Nome limpo</label>
                <input
                  type="text"
                  required
                  value={editForm.cleanMerchant}
                  onChange={(e) => setEditForm({ ...editForm, cleanMerchant: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Tipo</label>
                  <select
                    value={editForm.kind}
                    onChange={(e) =>
                      setEditForm({ ...editForm, kind: e.target.value as TxRow["kind"] })
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  >
                    <option value="EXPENSE">Saída</option>
                    <option value="INCOME">Entrada</option>
                    <option value="TRANSFER">Transferência</option>
                    <option value="CC_PAYMENT">Pag. Fatura</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Categoria</label>
                  <select
                    value={editForm.categoryId}
                    onChange={(e) => setEditForm({ ...editForm, categoryId: e.target.value })}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  >
                    <option value="">Sem categoria</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-indigo-500/25 bg-indigo-500/10 p-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-indigo-200">
                  <input
                    type="checkbox"
                    checked={editForm.learnRule}
                    onChange={(e) => setEditForm({ ...editForm, learnRule: e.target.checked })}
                  />
                  Aprender regra automática para futuras e passadas
                </label>
                {editForm.learnRule && (
                  <input
                    type="text"
                    value={editForm.rulePattern}
                    onChange={(e) => setEditForm({ ...editForm, rulePattern: e.target.value })}
                    placeholder="Texto-chave na descrição original"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                  />
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </AppShell>
  );
}
