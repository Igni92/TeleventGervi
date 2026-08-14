import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { KNOWN_CRONS, listCronRuns } from "@/lib/cronStatus";

/**
 * GET /api/admin/cron-status — état des tâches planifiées (cron) pour l'écran
 * Paramètres. Fusionne la liste des crons ATTENDUS avec la dernière exécution
 * journalisée (AppSetting `cronrun:*`). Réservé admin. GET (aucun effet de bord).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la direction / aux administrateurs" }, { status: 403 });
  }

  const runs = await listCronRuns();
  const crons = KNOWN_CRONS.map((c) => {
    const run = runs.get(c.name) ?? null;
    return {
      name: c.name,
      label: c.label,
      cadence: c.cadence,
      path: c.path,
      lastRun: run?.lastRun ?? null,
      ok: run?.ok ?? null,
      durationMs: run?.durationMs ?? null,
      detail: run?.detail ?? null,
    };
  });
  return NextResponse.json({ ok: true, crons, now: new Date().toISOString() });
}
