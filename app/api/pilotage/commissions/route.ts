import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessScope, scopePayload } from "@/lib/permissions";
import { getTransportModel, listCarrierTariffs } from "@/lib/transportCostStore";
import {
  computeTransportMetrics,
  transportPerKgForCarrier,
  isDirectCarrier,
  normCarrier,
  sanitizeClientPricing,
  type ClientCarrierPricing,
} from "@/lib/transportCost";
import { computePositionCost, resolveCarrierTariff } from "@/lib/carrierTariff";
import { departementOfZip } from "@/lib/geo/zip";
import { getClientTournees } from "@/lib/clientTournee";

/**
 * GET /api/pilotage/commissions?slp=MM
 *
 * DÉTAIL DES FACTURES derrière la PRIME d'un commercial — la preuve du calcul.
 *
 * Même règle que /api/commerciaux/sap (bloc PRIME), mais restituée FACTURE PAR
 * FACTURE au lieu d'un agrégat : pour chaque facture du PORTEFEUILLE du
 * commercial (Client.commercial = lui) depuis sa date de début de prime :
 *   CA HT · marge brute (grossProfit SAP) · poids livré · coût transport estimé
 *   (grille par position du transporteur habituel, repli prix position / €/kg
 *   legacy) · marge nette · prime de la facture (taux × marge nette).
 * Les AVOIRS de la même fenêtre sont listés (perte de marge, transport non
 * re-crédité — aligné sur l'agrégat).
 *
 * Droits : un non-admin ne peut demander QUE son propre trigramme.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PRIME_DEFAULT_RATE = 0.05;
const PRIME_DEFAULT_START = new Date(Date.UTC(2025, 10, 1)); // 1ᵉʳ novembre 2025
/** Nb max de lignes renvoyées par liste (les totaux restent calculés sur tout). */
const MAX_ROWS = 400;

interface InvoiceRow {
  docEntry: number;
  docNum: number | null;
  docDate: string;
  cardCode: string;
  cardName: string | null;
  caHt: number;
  margeBrute: number;
  kg: number;
  transport: number;
  margeNette: number;
  prime: number;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const scope = await getAccessScope(session);
  const url = new URL(req.url);
  const asked = (url.searchParams.get("slp") ?? "").trim();
  // Non-admin : périmètre forcé sur son propre trigramme, quoi qu'il demande.
  const slp = scope.all ? asked : (scope.slpName ?? "");
  if (!slp) return NextResponse.json({ error: "Commercial non précisé" }, { status: 400 });

  // Config de prime propre au commercial (table optionnelle → défauts).
  let rate = PRIME_DEFAULT_RATE;
  let since = PRIME_DEFAULT_START;
  try {
    const cfg = await prisma.$queryRaw<{ rate: number; since: Date }[]>(Prisma.sql`
      SELECT "rate"::float AS rate, "since" FROM "CommercialPrime" WHERE "slpName" = ${slp} LIMIT 1`);
    if (cfg[0]) { rate = Number(cfg[0].rate); since = new Date(cfg[0].since); }
  } catch { /* table absente → défauts */ }

  // Factures du portefeuille depuis la date de début, avec poids livré par
  // facture (grille par tranches ⇒ le coût dépend du poids de CHAQUE livraison).
  const [invRows, cnRows] = await Promise.all([
    prisma.$queryRaw<{
      de: number; dn: number | null; dd: Date; card: string; name: string | null;
      total: number; marge: number; cid: string; zip: string | null; kg: number;
    }[]>(Prisma.sql`
      SELECT i."docEntry" AS de, i."docNum" AS dn, i."docDate" AS dd, i."cardCode" AS card,
             i."cardName" AS name, i."docTotal"::float AS total,
             COALESCE(i."grossProfit", 0)::float AS marge,
             c."id" AS cid, c."zipCode" AS zip,
             COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS kg
      FROM "SapInvoice" i
      JOIN "Client" c ON c."code" = i."cardCode"
      LEFT JOIN "SapInvoiceLine" l ON l."docEntry" = i."docEntry"
      LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
      WHERE i."cancelled" = false AND c."commercial" = ${slp} AND i."docDate" >= ${since}
      GROUP BY i."docEntry", c."id"
      ORDER BY i."docDate" DESC, i."docEntry" DESC`),
    prisma.$queryRaw<{
      de: number; dn: number | null; dd: Date; card: string; name: string | null;
      total: number; marge: number;
    }[]>(Prisma.sql`
      SELECT n."docEntry" AS de, n."docNum" AS dn, n."docDate" AS dd, n."cardCode" AS card,
             n."cardName" AS name, n."docTotal"::float AS total,
             COALESCE(n."grossProfit", 0)::float AS marge
      FROM "SapCreditNote" n
      JOIN "Client" c ON c."code" = n."cardCode"
      WHERE n."cancelled" = false AND c."commercial" = ${slp} AND n."docDate" >= ${since}
      ORDER BY n."docDate" DESC, n."docEntry" DESC`),
  ]);

  // Résolution transport — identique à /api/commerciaux/sap : transporteur
  // HABITUEL du client (tournée cltour:) → direct = prix position ; externe =
  // grille par position (département × tranche) ; repli €/kg legacy ; inconnu = 0.
  const model = await getTransportModel();
  const prixPosition = computeTransportMetrics(model).prixPositionPerKg;
  const tariffs = await listCarrierTariffs();
  const pricingById = new Map<string, ClientCarrierPricing>();
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: "transportcli:" } } });
    for (const row of rows) {
      try { pricingById.set(row.key.slice("transportcli:".length), sanitizeClientPricing(JSON.parse(row.value))); } catch { /* ignore */ }
    }
  } catch { /* pas de tarifs legacy */ }
  const tournees = await getClientTournees([...new Set(invRows.map((r) => r.card))]);

  const invoices: InvoiceRow[] = invRows.map((r) => {
    const kg = Number(r.kg);
    const marge = Number(r.marge);
    let transport = 0;
    const code = normCarrier(tournees.get(r.card.trim().toUpperCase())?.trspCode);
    if (code && kg > 0) {
      const direct = isDirectCarrier(model, code) || model.directCarriers.length === 0;
      const posCost = !direct ? computePositionCost(resolveCarrierTariff(tariffs, code), departementOfZip(r.zip), kg) : null;
      transport = posCost
        ? posCost.total
        : transportPerKgForCarrier(model, prixPosition, code, pricingById.get(r.cid) ?? null) * kg;
    }
    const margeNette = marge - transport;
    return {
      docEntry: r.de,
      docNum: r.dn,
      docDate: r.dd.toISOString(),
      cardCode: r.card,
      cardName: r.name,
      caHt: Number(r.total),
      margeBrute: marge,
      kg,
      transport: Math.round(transport * 100) / 100,
      margeNette: Math.round(margeNette * 100) / 100,
      prime: Math.round(margeNette * rate * 100) / 100,
    };
  });

  const creditNotes = cnRows.map((r) => ({
    docEntry: r.de,
    docNum: r.dn,
    docDate: r.dd.toISOString(),
    cardCode: r.card,
    cardName: r.name,
    caHt: Number(r.total),
    margeBrute: Number(r.marge),
    // Avoir : la marge est REPRISE (transport non re-crédité) → prime négative.
    prime: -Math.round(Number(r.marge) * rate * 100) / 100,
  }));

  // Totaux sur TOUT (même si les listes sont plafonnées à MAX_ROWS).
  const margeBrute = invoices.reduce((s, r) => s + r.margeBrute, 0)
    - creditNotes.reduce((s, r) => s + r.margeBrute, 0);
  const transport = invoices.reduce((s, r) => s + r.transport, 0);
  const margeNette = margeBrute - transport;

  return NextResponse.json({
    slpName: slp,
    rate,
    since: since.toISOString(),
    totals: {
      invoices: invoices.length,
      creditNotes: creditNotes.length,
      caHt: invoices.reduce((s, r) => s + r.caHt, 0) - creditNotes.reduce((s, r) => s + r.caHt, 0),
      margeBrute: Math.round(margeBrute * 100) / 100,
      transport: Math.round(transport * 100) / 100,
      margeNette: Math.round(margeNette * 100) / 100,
      // Prime affichée = celle de la liste des commerciaux : jamais négative.
      prime: Math.max(0, Math.round(margeNette * rate * 100) / 100),
    },
    truncated: invoices.length > MAX_ROWS || creditNotes.length > MAX_ROWS,
    invoices: invoices.slice(0, MAX_ROWS),
    creditNotes: creditNotes.slice(0, MAX_ROWS),
    scope: scopePayload(scope),
  });
}
