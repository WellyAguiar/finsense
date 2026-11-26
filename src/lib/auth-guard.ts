import { NextResponse } from "next/server";

/**
 * Valida se o e-mail autenticado corresponde exatamente ao único usuário permitido.
 */
export function isAllowedEmail(
  email: string | null | undefined,
  allowedEmail: string | null | undefined = process.env.ALLOWED_EMAIL
): boolean {
  if (!email || !allowedEmail) return false;
  return email.trim().toLowerCase() === allowedEmail.trim().toLowerCase();
}

/**
 * Valida o cabeçalho Bearer do Vercel Cron Job.
 */
export function isValidCronRequest(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader) return false;
  return authHeader === `Bearer ${secret}`;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
}
