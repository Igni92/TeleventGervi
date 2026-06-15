import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, pilotageSlpFilter, scopePayload } from "@/lib/permissions";
import {
  annualMatrix,
  topClients, topSuppliers, topSalespersons,
  invoiceWeightByCard, pdnWeightByCard, invoiceWeightBySlp,
} from "@/lib/pilotage";
import { groupCodesForSegment, parseSegment } from "@/lib/segments";
import { cached, invalidate } from "@/lib/ttlCache";

/**
 * GET /api/pilotage/annual?years=2&segment=ALL|GMS|CHR|EXPORT|RUNGIS[&refresh=1]
 *
 * Rapport annuel rétrospectif (Écran 2) — source SapInvoice/SapPdn.
 *
 * - Matrice mois × N+1 années (default N-2, N-1, N) — CA + marge + Poids/cell.
 * - Tops annuels enrichis avec `weightKg` pour le toggle CA/Poids.
 * - Filtre segment (cf. lib/segments) : clients/commerciaux/matrice filtrés ;
 *   les FOURNISSEURS restent globaux (segment = attribut client).
 *
 * Perf : agrégats 100 % SQL (GROUP BY) + cache mémoire HEBDO par segment —
 * demande utilisateur : « le rapport annuel comptable peut s'actualiser une
 * fois par semaine ». `?refresh=1` invalide la clé et force le recalcul
 * immédiat. NB : cache process-local (lib/ttlCache) → vidé à chaque restart
 * du serveur ; acceptable, le premier appel recalcule en quelques secondes
 * (agrégats SQL purs).
 */

// TTL hebdomadaire (7 jours) — le rapport annuel n'a pas besoin de fraîcheur
// intra-journalière, contrairement aux vues jour/semaine.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Droits : matrice + top clients scopés au slpName du non-admin ; top
  // fournisseurs et top commerciaux (vues transverses) réservés aux admins.
  const scope = await getAccessScope(session);
  const slp = pilotageSlpFilter(scope);
  const admin = scope.all;

  const url = new URL(req.url);
  const yearsBack = Number.parseInt(url.searchParams.get("years") ?? "2", 10);
  const years = Number.isFinite(yearsBack) ? yearsBack : 2;
  const segment = parseSegment(url.searchParams.get("segment"));

  // ⚠️ La clé de cache DOIT inclure le périmètre (slp) — sinon le rapport
  // scopé d'un commercial serait resservi à un autre / à un admin.
  const cacheKey = `pilotage:annual:${slp ?? "ALL"}:${segment}:${years}`;
  // ?refresh=1 → purge la clé avant lecture = recalcul garanti.
  if (url.searchParams.get("refresh") === "1") invalidate(cacheKey);

  const payload = await cached(cacheKey, WEEK_MS, async () => {
    const groupCodes = groupCodesForSegment(segment);
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd = new Date(now.getFullYear() + 1, 0, 1);

    const [matrix, clients, suppliers, salespersons] = await Promise.all([
      annualMatrix(years, groupCodes, slp),
      topClients(yearStart, yearEnd, 8, groupCodes, slp),
      admin ? topSuppliers(yearStart, yearEnd, 6) : Promise.resolve([]),
      admin ? topSalespersons(yearStart, yearEnd, 6, groupCodes) : Promise.resolve([]),
    ]);

    const [weightByClient, weightByVendor, weightBySlp] = await Promise.all([
      invoiceWeightByCard(yearStart, yearEnd, clients.map((c) => c.cardCode), slp),
      pdnWeightByCard(yearStart, yearEnd, suppliers.map((s) => s.cardCode)),
      invoiceWeightBySlp(yearStart, yearEnd, salespersons.map((s) => s.slpName), groupCodes),
    ]);

    return {
      currentYear: now.getFullYear(),
      matrix,
      clients: clients.map((c) => ({ ...c, weightKg: weightByClient.get(c.cardCode) ?? 0 })),
      suppliers: suppliers.map((s) => ({ ...s, weightKg: weightByVendor.get(s.cardCode) ?? 0 })),
      salespersons: salespersons.map((s) => ({ ...s, weightKg: weightBySlp.get(s.slpName) ?? 0 })),
      scope: scopePayload(scope),
    };
  });

  return NextResponse.json(payload);
}
