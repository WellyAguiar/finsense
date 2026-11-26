"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Building2, Loader2 } from "lucide-react";

const PluggyConnect = dynamic(
  () => import("react-pluggy-connect").then((mod) => mod.PluggyConnect),
  { ssr: false }
);

export function PluggyConnectButton({
  updateItemId,
  label = "Conectar Banco (Open Finance)",
  includeSandbox = false,
  onConnected,
  onError,
}: {
  updateItemId?: string;
  label?: string;
  includeSandbox?: boolean;
  onConnected: (itemId: string) => Promise<void> | void;
  onError?: (msg: string) => void;
}) {
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleOpen() {
    setLoading(true);
    try {
      const res = await fetch("/api/pluggy/connect-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateItemId ? { itemId: updateItemId } : {}),
      });
      const json = await res.json();
      if (!res.ok || !json.accessToken) {
        onError?.(json.error || "Não foi possível iniciar o Pluggy Connect.");
        return;
      }
      setConnectToken(json.accessToken);
    } catch {
      onError?.("Falha de conexão ao solicitar token do Pluggy.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Building2 className="h-4 w-4" />
        )}
        {loading ? "Abrindo Open Finance..." : label}
      </button>

      {connectToken && (
        <PluggyConnect
          connectToken={connectToken}
          includeSandbox={includeSandbox}
          theme="dark"
          onSuccess={async (itemData) => {
            const itemId = itemData?.item?.id;
            setConnectToken(null);
            if (itemId) {
              await onConnected(itemId);
            }
          }}
          onError={(err) => {
            setConnectToken(null);
            onError?.(err?.message || "Erro durante a conexão com o banco.");
          }}
          onClose={() => {
            setConnectToken(null);
          }}
        />
      )}
    </>
  );
}
