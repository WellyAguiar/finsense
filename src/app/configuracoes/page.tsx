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
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
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
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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

  async function handleAddConnection(e: React.FormEvent) {
    e.preventDefault();
    if (!itemIdInput.trim()) return;
    setSyncing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pluggyItemId: itemIdInput.trim(), daysBack: 90 }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json.error || "Erro ao conectar Item ID");
      } else {
        setMsg(
          `Conectado a ${json.summary.institutionName}: ${json.summary.accountsSynced} conta(s) e ${json.summary.transactionsInserted} transações importadas.`
        );
        setItemIdInput("");
        await load();
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleSyncAll() {
    setSyncing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json.error || "Erro ao sincronizar");
      } else {
        setMsg(
          `Sincronização concluída (${json.synced?.length ?? 0} instituição(ões) atualizada(s)).`
        );
        await load();
      }
    } finally {
      setSyncing(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Configurações</h1>
          <p className="text-sm text-slate-400">
            Open Finance (Meu Pluggy), status das integrações e backup integral dos seus dados
          </p>
        </div>

        {msg && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4 text-sm text-indigo-200">
            {msg}
          </div>
        )}

        {/* Meu Pluggy */}
        <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-white">
                <Link2 className="h-4 w-4 text-emerald-400" />
                Open Finance Brasil — Meu Pluggy ({connections.length}/5 conexões grátis)
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Conecte seus bancos em <code className="text-slate-200">meu.pluggy.ai</code>, copie o Item ID no <code className="text-slate-200">dashboard.pluggy.ai</code> e cole abaixo.
              </p>
            </div>
            <button
              onClick={handleSyncAll}
              disabled={syncing || connections.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
              Sincronizar Todas
            </button>
          </div>

          <form onSubmit={handleAddConnection} className="flex flex-wrap gap-2">
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
              Conectar & Importar (90 dias)
            </button>
          </form>

          {connections.length > 0 && (
            <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/50">
              {connections.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 p-3.5 text-sm">
                  <div>
                    <div className="font-medium text-white">{c.institutionName}</div>
                    <div className="text-xs text-slate-400">
                      Status: <span className="text-emerald-400">{c.status}</span> · Item:{" "}
                      <span className="font-mono">{c.pluggyItemId.slice(0, 12)}...</span>
                      {c.lastSyncedAt && (
                        <> · Última sync: {new Date(c.lastSyncedAt).toLocaleString("pt-BR")}</>
                      )}
                    </div>
                    {c.lastError && (
                      <div className="mt-1 text-xs text-rose-400">{c.lastError}</div>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      await fetch(`/api/sync?id=${c.id}`, { method: "DELETE" });
                      await load();
                    }}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/20 hover:text-rose-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
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
              <EnvRow ok={envStatus.database} label="PostgreSQL (Neon / Supabase)" />
              <EnvRow
                ok={envStatus.auth}
                label={`Google OAuth (${envStatus.allowedEmail ?? "pendente"})`}
              />
              <EnvRow
                ok={envStatus.gemini}
                label={`Google Gemini API (${envStatus.geminiModel})`}
              />
              <EnvRow ok={envStatus.pluggy} label="Meu Pluggy (Open Finance)" />
              <EnvRow ok={envStatus.cronSecret} label="Vercel Cron Secret (Sync Diário)" />
            </div>
          </section>
        )}

        {/* Exportação & Backup */}
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
              Baixar Backup Completo (JSON)
            </a>
            <a
              href="/api/export?format=csv"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-xs font-semibold text-slate-100 hover:bg-slate-800"
            >
              <Download className="h-4 w-4 text-indigo-400" />
              Exportar Transações (CSV / Excel)
            </a>
          </div>
        </section>
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
