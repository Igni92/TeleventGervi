import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * ⚠️ ROUTE DE DIAGNOSTIC TEMPORAIRE — à SUPPRIMER après usage.
 * Diagnostique la couche Prisma/DB en prod (sans login, protégée par clé) :
 * requête brute, requête typée, et une RAFALE concurrente (reproduit le
 * chargement du dashboard) pour faire ressortir un éventuel épuisement du
 * pool de connexions. N'expose PAS le mot de passe DB (masqué).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KEY = "tvd_9f3a7c2e1b4d8a";

function err(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 900);
}

export async function GET(req: NextRequest) {
  if (new URL(req.url).searchParams.get("key") !== KEY) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Forme de DATABASE_URL : hôte:port + query (pooler 6543 ? pgbouncer ? limit ?),
  // mot de passe masqué.
  let dbShape = "(unset)";
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    dbShape = `${u.protocol}//${u.username}:***@${u.host}${u.pathname}?${u.search.replace(/^\?/, "")}`;
  } catch (e) {
    dbShape = "(invalid) " + err(e);
  }

  const out: Record<string, unknown> = { dbShape };

  try {
    await prisma.$queryRaw`SELECT 1`;
    out.raw = "ok";
  } catch (e) {
    out.raw = err(e);
  }

  try {
    await prisma.client.findFirst({ select: { id: true } });
    out.typed = "ok";
  } catch (e) {
    out.typed = err(e);
  }

  // Rafale concurrente : ~12 requêtes en parallèle (comme le dashboard).
  try {
    await Promise.all(Array.from({ length: 12 }, () => prisma.client.count()));
    out.burst = "ok";
  } catch (e) {
    out.burst = err(e);
  }

  return NextResponse.json(out);
}
