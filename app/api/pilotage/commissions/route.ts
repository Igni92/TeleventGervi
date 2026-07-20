import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessScope, scopePayload } from "@/lib/permissions";
import {
  loadDocTransportContext, docTransportCost, GIFT_LINE_SQL,
  type DocTransportMode,
} from "@/lib/transportDoc";

/**
 * GET /api/pilotage/commissions?slp=MM
 *
 * DÉTAIL DES FACTURES derrière la PRIME d'un commercial — la preuve du calcul.
 *
 * RÈGLES DE PRIME (validées direction, 07/2026) :
 *   • CADEAUX neutralisés — ligne produit offerte (0 € ou remise 100 %) : sa
 *     marge SAP (−coût) est retirée de la marge de la facture ;
 *   • PLANCHER PAR FACTURE — une facture à marge nette NÉGATIVE compte 0 (elle
 *     ne rapporte rien mais ne ronge pas la prime des autres) ;
 *   • AVOIRS déduits (marge reprise), mais la base totale ne descend JAMAIS
 *     sous 0 (pas de « déficit » reporté) ;
 *   • TRANSPORT par POSITION : transporteur RÉEL du document (U_TrspCode
 *     mirroré), repli tournée habituelle — direct = coût/position, externe =
 *     grille département × tranche (lib/transportDoc, partagé avec la page
 *     Effectif pour des chiffres IDENTIQUES).
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
  /** Marge brute CORRIGÉE des cadeaux (base du calcul). */
  margeBrute: number;
  /** Coût des lignes cadeaux neutralisé (≥ 0, informatif). */
  cadeaux: number;
  kg: number;
  transport: number;
  /** Transporteur retenu + provenance (doc réel ou tournée habituelle). */
  carrier: string | null;
  mode: DocTransportMode;
  fromDoc: boolean;
  margeNette: number;
  /** true si la facture est au plancher (marge nette < 0 → prime 0). */
  plancher: boolean;
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

  // Factures du portefeuille depuis la date de début — par facture : poids
  // livré, transporteur réel mirroré, et marge des lignes CADEAUX à neutraliser.
  const [invRows, cnRows] = await Promise.all([
    prisma.$queryRaw<{
      de: number; dn: number | null; dd: Date; card: string; name: string | null;
      total: number; marge: number; mcad: number; cid: string; zip: string | null;
      trsp: string | null; kg: number;
    }[]>(Prisma.sql`
      SELECT i."docEntry" AS de, i."docNum" AS dn, i."docDate" AS dd, i."cardCode" AS card,
             i."cardName" AS name, i."docTotal"::float AS total,
             COALESCE(i."grossProfit", 0)::float AS marge,
             COALESCE(SUM(l."grossProfit") FILTER (WHERE ${Prisma.raw(GIFT_LINE_SQL)}), 0)::float AS mcad,
             c."id" AS cid, c."zipCode" AS zip, i."trspCode" AS trsp,
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

  // Contexte transport partagé (modèle direct, grilles, tournées, €/kg legacy).
  const ctx = await loadDocTransportContext(invRows.map((r) => r.card));

  const r2 = (v: number) => Math.round(v * 100) / 100;

  const invoices: InvoiceRow[] = invRows.map((r) => {
    const kg = Number(r.kg);
    // Marge corrigée : la marge des lignes cadeaux (négative = −coût) est retirée.
    const cadeaux = Math.max(0, -Number(r.mcad));
    const margeBrute = Number(r.marge) - Number(r.mcad);
    const t = docTransportCost(ctx, { cardCode: r.card, clientId: r.cid, zip: r.zip, kg, trspCode: r.trsp });
    const margeNette = margeBrute - t.cost;
    const plancher = margeNette < 0;
    return {
      docEntry: r.de,
      docNum: r.dn,
      docDate: r.dd.toISOString(),
      cardCode: r.card,
      cardName: r.name,
      caHt: Number(r.total),
      margeBrute: r2(margeBrute),
      cadeaux: r2(cadeaux),
      kg,
      transport: r2(t.cost),
      carrier: t.carrier,
      mode: t.mode,
      fromDoc: t.fromDoc,
      margeNette: r2(margeNette),
      plancher,
      // PLANCHER PAR FACTURE : marge nette négative → 0 de prime (pas de malus).
      prime: r2(Math.max(0, margeNette) * rate),
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
    // Avoir : la marge est REPRISE (transport non re-crédité) → prime négative
    // sur la ligne — mais la BASE TOTALE est plafonnée à 0 (pas de déficit).
    prime: -r2(Number(r.marge) * rate),
  }));

  // Totaux — base de prime = Σ max(0, nette facture) − Σ marge avoirs, ≥ 0.
  const margeBrute = invoices.reduce((s, r) => s + r.margeBrute, 0)
    - creditNotes.reduce((s, r) => s + r.margeBrute, 0);
  const transport = invoices.reduce((s, r) => s + r.transport, 0);
  const cadeauxExclus = invoices.reduce((s, r) => s + r.cadeaux, 0);
  const basePositive = invoices.reduce((s, r) => s + Math.max(0, r.margeNette), 0);
  const avoirs = creditNotes.reduce((s, r) => s + r.margeBrute, 0);
  const base = Math.max(0, basePositive - avoirs);

  return NextResponse.json({
    slpName: slp,
    rate,
    since: since.toISOString(),
    totals: {
      invoices: invoices.length,
      creditNotes: creditNotes.length,
      caHt: invoices.reduce((s, r) => s + r.caHt, 0) - creditNotes.reduce((s, r) => s + r.caHt, 0),
      margeBrute: r2(margeBrute),
      transport: r2(transport),
      cadeauxExclus: r2(cadeauxExclus),
      planchers: invoices.filter((r) => r.plancher).length,
      avoirs: r2(avoirs),
      /** Base de prime (marge nette RETENUE) = Σ max(0, nette) − avoirs, ≥ 0. */
      margeNette: r2(base),
      prime: r2(base * rate),
    },
    truncated: invoices.length > MAX_ROWS || creditNotes.length > MAX_ROWS,
    invoices: invoices.slice(0, MAX_ROWS),
    creditNotes: creditNotes.slice(0, MAX_ROWS),
    scope: scopePayload(scope),
  });
}
