"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ArrowLeftRight,
  CreditCard,
  PiggyBank,
  FileText,
  Sparkles,
  Settings,
  RefreshCw,
  LogOut,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/format";

const NAV_ITEMS = [
  { href: "/", label: "Visão Geral", icon: LayoutDashboard },
  { href: "/transacoes", label: "Transações", icon: ArrowLeftRight },
  { href: "/cartoes", label: "Contas & Cartões", icon: CreditCard },
  { href: "/planejamento", label: "Orçamentos & Metas", icon: PiggyBank },
  { href: "/documentos", label: "PDFs & Comprovantes", icon: FileText },
  { href: "/chat", label: "Chat IA", icon: Sparkles },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function AppShell({
  children,
  userEmail,
}: {
  children: React.ReactNode;
  userEmail?: string | null;
}) {
  const pathname = usePathname();
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function handleQuickSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSyncMsg(data.error || "Erro ao sincronizar");
      } else {
        const count = (data.synced ?? []).reduce(
          (acc: number, s: { transactionsInserted?: number }) => acc + (s.transactionsInserted ?? 0),
          0
        );
        setSyncMsg(`Sincronizado! ${count} nova(s) transação(ões).`);
        window.location.reload();
      }
    } catch {
      setSyncMsg("Falha de conexão ao sincronizar.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      {/* Sidebar Desktop */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800/80 bg-slate-900/60 lg:flex">
        <div className="flex items-center gap-3 border-b border-slate-800/80 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight text-white">FinSense</div>
            <div className="text-xs text-slate-400">Finanças Pessoais + IA</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25"
                    : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-slate-800/80 p-4">
          <button
            onClick={handleQuickSync}
            disabled={syncing}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            {syncing ? "Sincronizando..." : "Sincronizar Bancos"}
          </button>
          {syncMsg && (
            <p className="text-center text-xs text-slate-400">{syncMsg}</p>
          )}
          <div className="flex items-center justify-between gap-2 pt-1 text-xs text-slate-400">
            <span className="truncate">{userEmail || "Sessão pessoal"}</span>
            <Link
              href="/api/auth/signout"
              title="Sair"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-0">
        {/* Header Mobile */}
        <header className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/70 px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-emerald-400" />
            <span className="font-semibold text-white">FinSense</span>
          </div>
          <button
            onClick={handleQuickSync}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            Sync
          </button>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>

      {/* Bottom Nav Mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-slate-800 bg-slate-900/95 px-2 py-2 backdrop-blur lg:hidden">
        {NAV_ITEMS.slice(0, 6).map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg px-2 py-1 text-[10px]",
                active ? "text-emerald-400" : "text-slate-400"
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="max-w-[54px] truncate">{item.label.split(" ")[0]}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
