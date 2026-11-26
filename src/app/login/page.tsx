import { signIn } from "@/auth";
import { getEnvStatus } from "@/lib/env";
import { CheckCircle2, AlertCircle, ShieldCheck, Wallet } from "lucide-react";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; setup?: string; callbackUrl?: string }>;
}) {
  const params = await searchParams;
  const env = getEnvStatus();
  const canLogin = env.auth;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
            <Wallet className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">FinSense</h1>
            <p className="text-sm text-slate-400">
              Acesso privado e exclusivo às suas finanças pessoais
            </p>
          </div>
        </div>

        {params.error && (
          <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-sm text-rose-200">
            Acesso negado. Apenas o e-mail autorizado em <code className="font-mono">ALLOWED_EMAIL</code> pode entrar nesta instância.
          </div>
        )}

        {canLogin ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs text-slate-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <span>
                Protegido por Google OAuth com trava de usuário único
                {env.allowedEmail ? ` (${env.allowedEmail})` : ""}.
              </span>
            </div>

            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: params.callbackUrl || "/" });
              }}
            >
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
              >
                Entrar com Google
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
              <strong>Configuração inicial pendente:</strong> copie{" "}
              <code className="font-mono">.env.example</code> para{" "}
              <code className="font-mono">.env.local</code> (ou configure nas Environment Variables da Vercel) para habilitar o login.
            </div>

            <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm">
              <StatusRow ok={env.database} label="PostgreSQL (DATABASE_URL — Neon/Supabase)" />
              <StatusRow
                ok={env.auth}
                label="Google OAuth + Allowlist (AUTH_SECRET, AUTH_GOOGLE_ID/SECRET, ALLOWED_EMAIL)"
              />
              <StatusRow
                ok={env.gemini}
                label={`Google Gemini API (GOOGLE_GENERATIVE_AI_API_KEY — ${env.geminiModel})`}
              />
              <StatusRow
                ok={env.pluggy}
                label="Open Finance Meu Pluggy (PLUGGY_CLIENT_ID / SECRET)"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
      ) : (
        <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
      )}
      <span className={ok ? "text-slate-200" : "text-slate-400"}>{label}</span>
    </div>
  );
}
