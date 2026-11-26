"use client";

import { useChat } from "@ai-sdk/react";
import { Sparkles, Send, Database, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ChatInlineChart, type InlineChartSpec } from "@/components/ChatInlineChart";
import { MarkdownText } from "@/components/MarkdownText";
import { cn } from "@/lib/format";

const QUICK_PROMPTS = [
  "Faça um raio-x do meu mês atual com gráfico das principais categorias.",
  "Compare minhas entradas e saídas nos últimos 6 meses.",
  "Quanto já está comprometido de parcelas nos meus cartões nos próximos meses?",
  "Quais assinaturas ou contas fixas estão pesando mais no meu orçamento?",
  "Se eu parcelar uma compra de R$ 2.400 em 12x, cabe confortavelmente no meu fluxo?",
];

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, append, isLoading, error } =
    useChat({
      api: "/api/ai/chat",
    });

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-7rem)] flex-col lg:h-[calc(100vh-4rem)]">
        <div className="mb-4">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
            <Sparkles className="h-5 w-5 text-indigo-400" />
            Chat IA Financeiro
          </h1>
          <p className="text-sm text-slate-400">
            Converse com seus dados reais via Gemini — consultas SQL exatas em tempo real e gráficos interativos
          </p>
        </div>

        {/* Histórico de mensagens */}
        <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/40 p-4 sm:p-6">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-400">
                <Sparkles className="h-6 w-6" />
              </div>
              <h2 className="text-base font-semibold text-white">
                Pergunte qualquer coisa sobre sua vida financeira
              </h2>
              <p className="mt-1 max-w-md text-xs text-slate-400">
                O FinSense AI consulta suas contas, faturas, orçamentos e metas diretamente no PostgreSQL para responder sem chutes.
              </p>

              <div className="mt-6 flex max-w-2xl flex-wrap justify-center gap-2">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => append({ role: "user", content: prompt })}
                    className="rounded-xl border border-slate-800 bg-slate-900/90 px-3.5 py-2 text-left text-xs text-slate-200 transition hover:border-indigo-500/40 hover:bg-slate-800"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "flex",
                  m.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[78%]",
                    m.role === "user"
                      ? "bg-emerald-600 text-white"
                      : "border border-slate-800 bg-slate-900 text-slate-100"
                  )}
                >
                  {m.parts ? (
                    m.parts.map((part, idx) => {
                      if (part.type === "text") {
                        return m.role === "assistant" ? (
                          <MarkdownText key={idx} content={part.text} />
                        ) : (
                          <div key={idx} className="whitespace-pre-wrap">
                            {part.text}
                          </div>
                        );
                      }
                      if (part.type === "tool-invocation") {
                        const inv = part.toolInvocation;
                        if (inv.toolName === "renderChart" && inv.state === "result") {
                          return (
                            <ChatInlineChart
                              key={idx}
                              spec={inv.result as InlineChartSpec}
                            />
                          );
                        }
                        return (
                          <div
                            key={idx}
                            className="my-1.5 inline-flex items-center gap-1.5 rounded-lg bg-slate-950/70 px-2.5 py-1 text-[11px] text-slate-400"
                          >
                            <Database className="h-3 w-3 text-indigo-400" />
                            <span>Consultou: {inv.toolName}</span>
                          </div>
                        );
                      }
                      return null;
                    })
                  ) : (
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  )}
                </div>
              </div>
            ))
          )}

          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
              Analisando seus dados financeiros...
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
              {error.message}
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Ex: Quanto gastei no iFood nos últimos 3 meses?"
            className="flex-1 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Enviar
          </button>
        </form>
      </div>
    </AppShell>
  );
}
