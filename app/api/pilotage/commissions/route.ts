import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, scopePayload } from "@/lib/permissions";
import { commissionData, commissionMonths, primeRateOf, PRIME_DEFAULT_START } from "@/lib/commissions";

/**
 * GET /api/pilotage/commissions?slp=MM
 *
 * DÉTAIL DES FACTURES derrière la PRIME d'un commercial — la preuve du calcul,
 * plus l'ÉCHÉANCIER MENSUEL (la prime est payée TOUS LES MOIS sur le bulletin,
 * au fur et à mesure : prime(mois) = taux × base retenue du mois).
 *
 * Moteur unique lib/commissions (cadeaux neutralisés, plancher 0 par facture,
 * avoirs repris sans déficit, transport par position) — mêmes chiffres que la
 * page Effectif et que la ligne automatique des éléments de salaires.
 *
 * Droits : un non-admin ne peut demander QUE son propre trigramme.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Nb max de lignes renvoyées par liste (les totaux restent calculés sur tout). */
const MAX_ROWS = 400;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const scope = await getAccessScope(session);
  const url = new URL(req.url);
  const asked = (url.searchParams.get("slp") ?? "").trim();
  // Non-admin : périmètre forcé sur son propre trigramme, quoi qu'il demande.
  const slp = scope.all ? asked : (scope.slpName ?? "");
  if (!slp) return NextResponse.json({ error: "Commercial non précisé" }, { status: 400 });

  const { cfg, invoices, creditNotes } = await commissionData(slp);
  const rate = primeRateOf(cfg, slp);
  const since = cfg.get(slp)?.since ?? PRIME_DEFAULT_START;
  const byMonth = commissionMonths(invoices, creditNotes, rate);

  const r2 = (v: number) => Math.round(v * 100) / 100;
  // La prime CUMULÉE = Σ des primes mensuelles (ce qui est réellement versé).
  const base = byMonth.reduce((s, m) => s + m.base, 0);
  const prime = byMonth.reduce((s, m) => s + m.prime, 0);

  return NextResponse.json({
    slpName: slp,
    rate,
    since: since.toISOString(),
    totals: {
      invoices: invoices.length,
      creditNotes: creditNotes.length,
      caHt: r2(invoices.reduce((s, r) => s + r.caHt, 0) - creditNotes.reduce((s, r) => s + r.caHt, 0)),
      margeBrute: r2(invoices.reduce((s, r) => s + r.margeBrute, 0) - creditNotes.reduce((s, r) => s + r.margeBrute, 0)),
      transport: r2(invoices.reduce((s, r) => s + r.transport, 0)),
      cadeauxExclus: r2(invoices.reduce((s, r) => s + r.cadeaux, 0)),
      planchers: invoices.filter((r) => r.plancher).length,
      avoirs: r2(creditNotes.reduce((s, r) => s + r.margeBrute, 0)),
      /** Base RETENUE cumulée = Σ des bases mensuelles (chaque mois ≥ 0). */
      margeNette: r2(base),
      prime: r2(prime),
    },
    /** Échéancier : la prime de chaque mois, telle que versée sur le bulletin. */
    byMonth,
    truncated: invoices.length > MAX_ROWS || creditNotes.length > MAX_ROWS,
    invoices: invoices.slice(0, MAX_ROWS).map((f) => ({
      docEntry: f.docEntry,
      docNum: f.docNum,
      docDate: f.docDate.toISOString(),
      cardCode: f.cardCode,
      cardName: f.cardName,
      caHt: f.caHt,
      margeBrute: f.margeBrute,
      cadeaux: f.cadeaux,
      kg: f.kg,
      transport: f.transport,
      carrier: f.carrier,
      mode: f.mode,
      fromDoc: f.fromDoc,
      margeNette: f.margeNette,
      plancher: f.plancher,
      prime: r2(Math.max(0, f.margeNette) * rate),
    })),
    creditNotes: creditNotes.slice(0, MAX_ROWS).map((n) => ({
      docEntry: n.docEntry,
      docNum: n.docNum,
      docDate: n.docDate.toISOString(),
      cardCode: n.cardCode,
      cardName: n.cardName,
      caHt: n.caHt,
      margeBrute: n.margeBrute,
      prime: -r2(n.margeBrute * rate),
    })),
    scope: scopePayload(scope),
  });
}
