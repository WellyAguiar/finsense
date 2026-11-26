"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Link2,
  RefreshCw,
  Trash2,
  Download,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PluggyConnectButton } from "@/components/PluggyConnectButton";
import { cn } from "@/lib/format";

interface ConnectionItem {
  id: string;
  pluggyItemId: string;
  institutionName: string;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface EnvStatus {
  database: boolean;
  auth: boolean;
  gemini: boolean;
  pluggy: boolean;
  cronSecret: boolean;
  allowedEmail: string | null;
  geminiModel: string;
}

export default function ConfiguracoesPage() {
  const [connections, setConnections] = useState<ConnectionItem[]>([]);
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null);
  const [itemIdInput, setItemIdInput] = useState("");
  const [showManualId, setShowManualId] = useState(false);
  const [includeSandbox, setIncludeSandbox] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [syncRes, healthRes] = await Promise.all([
      fetch("/api/sync"),
      fetch("/api/health"),
    ]);
    if (syncRes.ok) {
      const sJson = await syncRes.json();
      setConnections(sJson.connections ?? []);
    }
    if (healthRes.ok) {
      const hJson = await healthRes.json();
      setEnvStatus(hJson.env ?? null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function syncAndCategorizeItem(pluggyItemId: string) {
    setSyncing(true);
    setMsg({ type: "ok", text: "Banco conectado! Importando contas, faturas e últimos 90 dias..." });
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pluggyItemId, daysBack: 90 }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: json.error || "Erro ao importar dados da conexão" });
        return;
      }

      // Dispara categorização automática com Gemini em seguida
      await fetch("/api/ai/categorize", { method: "POST" }).catch(() => null);

      setMsg({
        type: "ok",
        text: `Conectado a ${json.summary.institutionName}! ${json.summary.accountsSynced} conta(s) e ${json.summary.transactionsInserted} transação(ões) importada(s) e categorizadas.`,
      });
      await load();
    } finally {
      setSyncing(false);
    }
  }

  async function handleAddManualConnection(e: React.FormEvent) {
    e.preventDefault();
    if (!itemIdInput.trim()) return;
    await syncAndCategorizeItem(itemIdInput.trim());
    setItemIdInput("");
  }

  async function handleSyncAll() {
    setSyncing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: json.error || "Erro ao sincronizar" });
      } else {
        setMsg({
          type: "ok",
          text: `Sincronização concluída (${json.synced?.length ?? 0} instituição(ões) atualizada(s)).`,
        });
        await load();
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleResetDemo() {
    if (
      !confirm(
        "Isso apagará todas as contas, transações, orçamentos, metas e alertas atuais (mantendo as categorias e regras padrão). Deseja continuar?"
      )
    ) {
      return;
    }
    setResetting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: json.error || "Erro ao limpar dados" });
      } else {
        setMsg({
          type: "ok",
          text: "Dados limpos com sucesso! Agora clique em 'Conectar Banco (Open Finance)' para importar suas contas reais.",
        });
        await load();
      }
    } finally {
      setResetting(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Configurações</h1>
          <p className="text-sm text-slate-400">
            Open Finance Brasil (Pluggy Connect), status das integrações e backup integral dos seus dados
          </p>
        </div>

        {msg && (
          <div
            className={cn(
              "rounded-xl border p-4 text-sm",
              msg.type === "ok"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/30 bg-rose-500/10 text-rose-200"
            )}
          >
            {msg.text}
          </div>
        )}

        {/* Open Finance Pluggy Connect */}
        <section className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-white">
                <Link2 className="h-4 w-4 text-emerald-400" />
                Open Finance Brasil — Pluggy ({connections.length} instituição(ões) conectada(s))
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Clique no botão abaixo para abrir o widget oficial do Pluggy, escolher seu banco (Nubank, Itaú, Inter, Bradesco, BTG, etc.) e importar automaticamente contas, faturas e transações.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <PluggyConnectButton
                includeSandbox={includeSandbox}
                onConnected={syncAndCategorizeItem}
                onError={(err) => setMsg({ type: "error", text: err })}
              />
              {connections.length > 0 && (
                <button
                  onClick={handleSyncAll}
                  disabled={syncing}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-50"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
                  Sincronizar Todas
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3 text-xs text-slate-400">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={includeSandbox}
                onChange={(e) => setIncludeSandbox(e.target.checked)}
              />
              Mostrar banco de teste (Pluggy Sandbox) no widget
            </label>
            <button
              type="button"
              onClick={() => setShowManualId((v) => !v)}
              className="text-indigo-400 hover:underline"
            >
              {showManualId ? "Ocultar opção por Item ID" : "Já tenho um Item ID manual"}
            </button>
          </div>

          {showManualId && (
            <form onSubmit={handleAddManualConnection} className="flex flex-wrap gap-2">
              <input
                type="text"
                required
                placeholder="Cole o Pluggy Item ID (UUID)"
                value={itemIdInput}
                onChange={(e) => setItemIdInput(e.target.value)}
                className="min-w-[260px] flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white"
              />
              <button
                type="submit"
                disabled={syncing}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Importar (90 dias)
              </button>
            </form>
          )}

          {connections.length > 0 && (
            <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/50">
              {connections.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3.5 text-sm"
                >
                  <div>
                    <div className="font-medium text-white">{c.institutionName}</div>
                    <div className="text-xs text-slate-400">
                      Status:{" "}
                      <span
                        className={
                          c.status === "LOGIN_ERROR" ? "text-rose-400" : "text-emerald-400"
                        }
                      >
                        {c.status}
                      </span>
                      {c.lastSyncedAt && (
                        <> · Última sync: {new Date(c.lastSyncedAt).toLocaleString("pt-BR")}</>
                      )}
                    </div>
                    {c.lastError && (
                      <div className="mt-1 text-xs text-rose-400">{c.lastError}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <PluggyConnectButton
                      updateItemId={c.pluggyItemId}
                      label="Reconectar"
                      includeSandbox={includeSandbox}
                      onConnected={syncAndCategorizeItem}
                      onError={(err) => setMsg({ type: "error", text: err })}
                    />
                    <button
                      onClick={async () => {
                        await fetch(`/api/sync?id=${c.id}`, { method: "DELETE" });
                        await load();
                      }}
                      title="Remover conexão"
                      className="rounded-lg p-2 text-slate-500 hover:bg-rose-500/20 hover:text-rose-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Status do Ambiente */}
        {envStatus && (
          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="flex items-center gap-2 text-base font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-indigo-400" />
              Status das Integrações & Segurança
            </h2>
            <div className="grid grid-cols-1 gap-2.5 text-sm sm:grid-cols-2">
              <EnvRow ok={envStatus.database} label="PostgreSQL (Neon São Paulo)" />
              <EnvRow
                ok={envStatus.auth}
                label={`Google OAuth (${envStatus.allowedEmail ?? "pendente"})`}
              />
              <EnvRow
                ok={envStatus.gemini}
                label={`Google Gemini API (${envStatus.geminiModel})`}
              />
              <EnvRow ok={envStatus.pluggy} label="Open Finance Brasil (Pluggy)" />
              <EnvRow ok={envStatus.cronSecret} label="Vercel Cron Secret (Sync Diário)" />
            </div>
          </section>
        )}

        {/* Backup & Limpeza de Dados Demo */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="flex items-center gap-2 text-base font-semibold text-white">
              <Download className="h-4 w-4 text-emerald-400" />
              Backup & Portabilidade dos Seus Dados
            </h2>
            <p className="text-xs text-slate-400">
              Seus dados financeiros pertencem exclusivamente a você. Exporte a qualquer momento em formato aberto.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <a
                href="/api/export?format=json"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-xs font-semibold text-slate-100 hover:bg-slate-800"
              >
                <Download className="h-4 w-4 text-emerald-400" />
                Backup Completo (JSON)
              </a>
              <a
                href="/api/export?format=csv"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-xs font-semibold text-slate-100 hover:bg-slate-800"
              >
                <Download className="h-4 w-4 text-indigo-400" />
                Transações (CSV / Excel)
              </a>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-amber-500/25 bg-slate-900/60 p-6">
            <h2 className="flex items-center gap-2 text-base font-semibold text-white">
              <Sparkles className="h-4 w-4 text-amber-400" />
              Trocar de Dados Demo para Dados Reais
            </h2>
            <p className="text-xs text-slate-400">
              Quando estiver pronto para usar apenas suas contas reais do Pluggy, clique abaixo para zerar os lançamentos demo mantendo suas categorias e regras.
            </p>
            <button
              onClick={handleResetDemo}
              disabled={resetting}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              {resetting ? "Limpando..." : "Limpar Dados Demo / Zerar Base"}
            </button>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function EnvRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-800/80 bg-slate-950/50 px-3.5 py-2.5">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
      ) : (
        <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
      )}
      <span className={ok ? "text-slate-200" : "text-slate-400"}>{label}</span>
    </div>
  );
}
