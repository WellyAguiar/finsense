import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __finsenseDb: PostgresJsDatabase<typeof schema> | undefined;
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (globalThis.__finsenseDb) {
    return globalThis.__finsenseDb;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL não configurada. Copie .env.example para .env.local e informe a string PostgreSQL (Neon ou Supabase)."
    );
  }

  const client = postgres(url, {
    prepare: false, // Compatível com poolers serverless (Neon / Supabase PgBouncer)
    max: process.env.NODE_ENV === "production" ? 3 : 5,
  });

  const db = drizzle(client, { schema });
  globalThis.__finsenseDb = db;
  return db;
}

export * from "./schema";
