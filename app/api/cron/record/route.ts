import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { recordCronRun } from "@/lib/cronStatus";

/**
 * GET /api/cron/record?route=/api/...&ok=1&ms=1234&detail=... — journalise
 * l'exécution d'un cron. Appelé par le helper televent-cron-call APRÈS chaque
 * appel (succès ou échec), pour l'écran « État des tâches planifiées ».
 *
 * Auth machine (x-cron-secret / Bearer CRON_SECRET). Idempotent (upsert).
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const route = sp.get("route")?.trim();
  if (!route) return NextResponse.json({ error: "route requis" }, { status: 400 });
  const ok = sp.get("ok") !== "0";
  const ms = Number(sp.get("ms") ?? 0) || 0;
  const detail = sp.get("detail")?.trim() || (ok ? "OK" : "échec");
  await recordCronRun(route, ok, detail, ms);
  return NextResponse.json({ ok: true });
}
