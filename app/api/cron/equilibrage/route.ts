import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { runEquilibrage } from "@/lib/heuresEquilibrageRun";

/**
 * GET /api/cron/equilibrage — ARBITRAGE QUOTIDIEN récup / CP.
 *
 * Déclenché tous les jours à 12h par le cron système (cf.
 * deploy/cron/televent.cron → `televent-cron-call /api/cron/equilibrage`, auth
 * machine `x-cron-secret`). Idempotent : les semaines déjà en récup et les
 * congés déjà convertis ne sont pas retouchés. Chaque passage est JOURNALISÉ
 * (historique immuable `rheqlog:`), y compris ce déclenchement machine.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  try {
    const log = await runEquilibrage({ by: "cron", source: "cron" });
    return NextResponse.json({ ok: true, runId: log.runId, totals: log.totals });
  } catch (e) {
    console.error("[cron/equilibrage]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
