import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { refreshBdfLegalRates } from "@/lib/relance/bdfLegalRate";

/**
 * GET /api/cron/legal-rate — rafraîchit le TAUX D'INTÉRÊT LÉGAL depuis l'API
 * Banque de France (série IFRLEGAL_PROF) et met à jour le cache AppSetting
 * (`relance_bdf_legal_rates`). Le taux ne change que deux fois par an (par
 * arrêté), donc un passage quotidien suffit largement.
 *
 * Le calcul de pénalités rafraîchit déjà le cache de façon paresseuse
 * (getLegalRateTable) ; ce cron garantit simplement que le nouveau taux
 * semestriel est en base dès sa publication, sans dépendre d'une relance.
 *
 * Auth machine (x-cron-secret / Bearer CRON_SECRET). GET idempotent.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const rates = await refreshBdfLegalRates();
  const semesters = Object.keys(rates).sort();
  const dernier = semesters[semesters.length - 1] ?? null;
  return NextResponse.json({
    ok: true,
    nbSemestres: semesters.length,
    dernier,
    tauxDernier: dernier ? rates[dernier] : null,
  });
}
