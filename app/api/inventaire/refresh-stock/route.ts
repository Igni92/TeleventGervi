import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { refreshInStockMirror } from "@/lib/stockSync";

export const dynamic = "force-dynamic";

/**
 * Auth machine pour cron Vercel : `Authorization: Bearer <CRON_SECRET>` ou
 * en-tête `x-cron-secret`. Désactivé si `CRON_SECRET` n'est pas défini.
 */
function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

/** Cœur du refresh, partagé entre déclenchement manuel (POST) et cron (GET). */
async function runRefreshStock() {
  try {
    const { refreshed, total, sapMs, dbMs } = await refreshInStockMirror();
    return NextResponse.json({ ok: true, refreshed, total, sapMs, dbMs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

/**
 * POST /api/inventaire/refresh-stock — import du stock SAP AVANT un comptage.
 *
 * Rafraîchit (depuis SAP) le stock des articles « en stock » pour que le
 * préparateur compte contre des quantités à jour. Accessible à tout compte
 * connecté (le préparateur déclenche au clic « Commencer »).
 *
 * PERF : on délègue à refreshInStockMirror() qui tire TOUS les articles en stock
 * en UN appel groupé (filtre serveur `QuantityOnStock gt 0`, pagination
 * parallèle) — au lieu d'une requête SAP par paquet de 20 codes. Même chemin
 * éprouvé que la synchro catalogue → quasi instantané.
 */
/** Déclenchement manuel (préparateur connecté) — contrôle session INCHANGÉ. */
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  return runRefreshStock();
}

/** Déclenchement machine (cron Vercel) — auth par CRON_SECRET, sans session. */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  return runRefreshStock();
}
