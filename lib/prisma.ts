import { PrismaClient } from "@prisma/client";

/**
 * Normalise l'URL du pooler Supabase pour un runtime SERVERLESS (Vercel).
 *
 * Problème : si DATABASE_URL vise le pooler en mode SESSION (port 5432), chaque
 * connexion reste dédiée à son client pour toute sa durée de vie. Avec plusieurs
 * instances/lambda concurrentes, on dépasse vite la limite du pool
 * (« FATAL: (EMAXCONNSESSION) max clients reached in session mode … pool_size: 15 »)
 * → TOUTES les requêtes Prisma échouent (brutes comme typées).
 *
 * Correctif : mode TRANSACTION (port 6543) + pgbouncer=true + connection_limit=1.
 * Les connexions sont rendues au pool après chaque transaction → adapté au
 * serverless. On le fait au runtime (sans dépendre d'une correction manuelle de
 * la variable d'env, et sans toucher au mot de passe : seuls le port et la
 * query string — situés APRÈS le mot de passe — sont réécrits). Idempotent.
 */
function resolveDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw || !raw.includes("pooler.supabase.com")) return raw;
  // Session (5432) → Transaction (6543) sur le même hôte pooler.
  const url = raw.replace("pooler.supabase.com:5432", "pooler.supabase.com:6543");
  const [base, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.set("pgbouncer", "true"); // requis en mode transaction (désactive les prepared statements)
  params.set("connection_limit", "1"); // 1 connexion par instance serverless
  params.delete("pool_timeout");
  return `${base}?${params.toString()}`;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const databaseUrl = resolveDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
