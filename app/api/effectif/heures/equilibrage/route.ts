import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope } from "@/lib/permissions";
import { runEquilibrage, listEquilibrageLog } from "@/lib/heuresEquilibrageRun";

/**
 * ÉQUILIBRAGE récup / CP — déclenchement MANUEL + historique.
 *
 *   GET                       → historique des runs (cron + manuels)
 *   POST { dryRun: true }     → APERÇU (ne modifie rien) — bouton « prévisualiser »
 *   POST {}                   → APPLIQUE l'équilibrage maintenant + journalise
 *
 * Réservé aux MANAGERS (admin OU direction — `getAccessScope.all`, même porte
 * que la vue équipe du planning). Le cron quotidien passe, lui, par
 * /api/cron/equilibrage (auth machine).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function requireDir() {
  const session = await auth();
  if (!session?.user) return { error: "Non autorisé", status: 401 as const, email: "" };
  const email = (session.user.email ?? "").trim().toLowerCase();
  if (!email) return { error: "Non autorisé", status: 401 as const, email: "" };
  if (!(await getAccessScope(session)).all) return { error: "Réservé aux managers", status: 403 as const, email };
  return { email };
}

export async function GET() {
  const c = await requireDir();
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: c.status });
  const logs = await listEquilibrageLog(50);
  return NextResponse.json({ ok: true, logs });
}

export async function POST(req: NextRequest) {
  const c = await requireDir();
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: c.status });

  let dryRun = false;
  try { const b = await req.json(); dryRun = b?.dryRun === true; } catch { /* corps vide → appliquer */ }

  try {
    const log = await runEquilibrage({ by: c.email, source: "manual", dryRun });
    return NextResponse.json({ ok: true, dryRun, log });
  } catch (e) {
    console.error("[equilibrage/manual]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
