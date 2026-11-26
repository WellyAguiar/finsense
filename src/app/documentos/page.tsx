"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { formatBRL, formatDateBR } from "@/lib/format";

interface ExtractedItem {
  occurredAt: string;
  amountCents: number;
  rawDescription: string;
  cleanMerchant: string;
  kind: "INCOME" | "EXPENSE" | "TRANSFER" | "CC_PAYMENT";
  categoryId: string | null;
  categoryName: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  possibleDuplicate: {
    transactionId: string;
    merchant: string;
    occurredAt: string;
    score: number;
  } | null;
  selected?: boolean;
}

interface ExtractedDoc {
  documentId: string;
  documentType: string;
  institutionOrIssuer: string;
  summaryNote: string;
  items: ExtractedItem[];
}

export default function DocumentosPage() {
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [history, setHistory] = useState<
    Array<{
      id: string;
      fileName: string;
      documentType: string;
      status: string;
      notes: string | null;
      createdAt: string;
    }>
  >([]);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedDoc | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const loadMeta = useCallback(async () => {
    const [accRes, docRes] = await Promise.all([
      fetch("/api/accounts"),
      fetch("/api/ai/documents"),
    ]);
    if (accRes.ok) {
      const aJson = await accRes.json();
      setAccounts(aJson.accounts ?? []);
      if (aJson.accounts?.length > 0) {
        setSelectedAccountId((prev) => prev || aJson.accounts[0].id);
      }
    }
    if (docRes.ok) {
      const dJson = await docRes.json();
      setHistory(dJson.documents ?? []);
    }
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage(null);
    setExtracted(null);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/ai/documents", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: json.error || "Erro ao processar arquivo" });
      } else {
        const doc: ExtractedDoc = json.extracted;
        // Desmarca automaticamente possíveis duplicidades de altíssima confiança
        doc.items = doc.items.map((it) => ({
          ...it,
          selected: !it.possibleDuplicate,
        }));
        setExtracted(doc);
        await loadMeta();
      }
    } catch {
      setMessage({ type: "error", text: "Falha de conexão ao enviar o arquivo." });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function toggleItem(idx: number) {
    setExtracted((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((it, i) =>
        i === idx ? { ...it, selected: !it.selected } : it
      );
      return { ...prev, items };
    });
  }

  async function handleConfirmImport() {
    if (!extracted || !selectedAccountId) return;
    const chosen = extracted.items.filter((i) => i.selected);
    if (chosen.length === 0) {
      setMessage({ type: "error", text: "Selecione ao menos um item para importar." });
      return;
    }

    setImporting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ai/documents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: extracted.documentId,
          accountId: selectedAccountId,
          items: chosen.map((it) => ({
            occurredAt: it.occurredAt,
            amountCents: it.amountCents,
            rawDescription: it.rawDescription,
            cleanMerchant: it.cleanMerchant,
            kind: it.kind,
            categoryId: it.categoryId,
            installmentNumber: it.installmentNumber,
            installmentTotal: it.installmentTotal,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: json.error || "Erro ao importar" });
      } else {
        setMessage({
          type: "ok",
          text: `${json.imported} lançamento(s) importado(s) com sucesso!`,
        });
        setExtracted(null);
        await loadMeta();
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Leitor IA de PDFs & Comprovantes
          </h1>
          <p className="text-sm text-slate-400">
            Envie faturas em PDF, notas fiscais, boletos ou prints de Pix — o Gemini extrai os lançamentos e alerta se já vieram pelo Open Finance
          </p>
        </div>

        {/* Upload Dropzone */}
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-700 bg-slate-900/50 p-10 text-center transition hover:border-indigo-500/60 hover:bg-slate-900">
          {uploading ? (
            <>
              <Loader2 className="mb-3 h-10 w-10 animate-spin text-indigo-400" />
              <div className="text-sm font-semibold text-white">
                Lendo documento com Gemini Multimodal...
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Extraindo valores, datas, parcelas e checando duplicidades
              </div>
            </>
          ) : (
            <>
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-400">
                <Upload className="h-6 w-6" />
              </div>
              <div className="text-sm font-semibold text-white">
                Clique para enviar PDF, PNG, JPG ou WEBP (até 4,5 MB)
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Suporta faturas de cartão, comprovantes de Pix, boletos e cupons fiscais
              </div>
            </>
          )}
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={handleFileChange}
            disabled={uploading}
            className="hidden"
          />
        </label>

        {message && (
          <div
            className={`rounded-xl border p-4 text-sm ${
              message.type === "ok"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/30 bg-rose-500/10 text-rose-200"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Revisão dos itens extraídos */}
        {extracted && (
          <div className="space-y-4 rounded-2xl border border-indigo-500/30 bg-slate-900/80 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase text-indigo-400">
                  <Sparkles className="h-3.5 w-3.5" />
                  {extracted.documentType} · {extracted.institutionOrIssuer}
                </div>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  {extracted.items.length} lançamento(s) extraído(s)
                </h2>
                <p className="text-xs text-slate-400">{extracted.summaryNote}</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  <option value="">Escolha a conta de destino...</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleConfirmImport}
                  disabled={importing || !selectedAccountId}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {importing ? "Importando..." : "Confirmar Importação"}
                </button>
              </div>
            </div>

            <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/50">
              {extracted.items.map((item, idx) => (
                <div
                  key={idx}
                  className="flex flex-wrap items-center justify-between gap-3 p-3.5 text-sm"
                >
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={Boolean(item.selected)}
                      onChange={() => toggleItem(idx)}
                      className="mt-1"
                    />
                    <div>
                      <div className="font-medium text-white">
                        {item.cleanMerchant}
                        {item.installmentTotal && (
                          <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                            {item.installmentNumber}/{item.installmentTotal}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">
                        {formatDateBR(item.occurredAt)} · {item.categoryName} · {item.rawDescription}
                      </div>
                      {item.possibleDuplicate && (
                        <div className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">
                          <AlertTriangle className="h-3 w-3" />
                          Possível duplicidade com &quot;{item.possibleDuplicate.merchant}&quot; em{" "}
                          {formatDateBR(item.possibleDuplicate.occurredAt)} (desmarcado por segurança)
                        </div>
                      )}
                    </div>
                  </label>

                  <div className="font-semibold text-white">
                    {formatBRL(item.amountCents)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Histórico de documentos */}
        {history.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Documentos Processados Recentemente
            </h2>
            <div className="space-y-2">
              {history.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-slate-400" />
                    <div>
                      <div className="font-medium text-slate-100">{doc.fileName}</div>
                      <div className="text-xs text-slate-500">
                        {doc.documentType} · {doc.notes || "Sem observações"}
                      </div>
                    </div>
                  </div>
                  <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] text-slate-300">
                    {doc.status === "IMPORTED" ? "Importado" : "Aguardando revisão"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
