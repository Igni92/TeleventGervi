import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";

/**
 * GET /api/cron/sap-sync — CRON UNIQUE « synchro globale SAP ».
 *
 * Déclenché par le cron Vercel (cf. vercel.json, toutes les 30 min). Vercel
 * ajoute automatiquement `Authorization: Bearer <CRON_SECRET>` → auth machine.
 *
 * Enchaîne, EN SÉQUENCE (ménage le pool Supabase — le parallèle a déjà saturé
 * le pooler par le passé) :
 *   1. le miroir DOCUMENTS (BP, factures, commandes, **réceptions/EM**, avoirs,
 *      retours) — /api/sap/sync/mirror ; c'est lui qui alimente le COÛT réel des
 *      ventes (sans réceptions à jour, la marge du jour est costée sur des
 *      réceptions périmées) ;
 *   2. le catalogue PRODUITS + STOCK — /api/sap/sync/products.
 *
 * On appelle les deux endpoints existants (inchangés, chacun déjà idempotent et
 * borné en durée) via un fetch interne portant le `x-cron-secret`. Un échec de
 * l'un n'empêche pas l'autre (le miroir, prioritaire pour la marge, passe en
 * premier). Renvoie un récapitulatif des deux.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function call(url: string, init: RequestInit, secret: string) {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), "x-cron-secret": secret },
      cache: "no-store",
    });
    let body: unknown = null;
    try { body = await r.json(); } catch { /* réponse non-JSON */ }
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const secret = process.env.CRON_SECRET as string; // garanti non vide par isCronAuthorized
  const origin = req.nextUrl.origin;

  // 1) Documents/réceptions d'abord (coût des ventes), puis 2) produits/stock.
  const mirror = await call(`${origin}/api/sap/sync/mirror`, { method: "GET" }, secret);
  const products = await call(`${origin}/api/sap/sync/products`, { method: "POST" }, secret);

  const ok = mirror.ok && products.ok;
  return NextResponse.json({ ok, mirror, products }, { status: ok ? 200 : 207 });
}
