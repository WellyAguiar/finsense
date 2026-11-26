export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("postgres"));
}

export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.AUTH_SECRET &&
      process.env.AUTH_GOOGLE_ID &&
      process.env.AUTH_GOOGLE_SECRET &&
      process.env.ALLOWED_EMAIL
  );
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}

export function isPluggyConfigured(): boolean {
  return Boolean(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET);
}

export function getGeminiModelName(): string {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

export function getEnvStatus() {
  return {
    database: isDbConfigured(),
    auth: isAuthConfigured(),
    gemini: isGeminiConfigured(),
    pluggy: isPluggyConfigured(),
    cronSecret: Boolean(process.env.CRON_SECRET),
    allowedEmail: process.env.ALLOWED_EMAIL ? maskEmail(process.env.ALLOWED_EMAIL) : null,
    geminiModel: getGeminiModelName(),
  };
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  const prefix = user.slice(0, Math.min(2, user.length));
  return `${prefix}***@${domain}`;
}
