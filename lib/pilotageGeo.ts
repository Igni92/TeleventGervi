/**
 * Agrégat GÉOGRAPHIQUE — « où je livre le plus » (Écran 3 du dashboard).
 *
 * Source : SapInvoice joint au miroir Client (adresse SAP : Client.zipCode /
 * Client.country, alimentés par /api/sap/clients/import). Pour chaque client on
 * déduit une ZONE :
 *   • France (métropole + DOM) → DÉPARTEMENT via le code postal (lib/geo/zip) ;
 *   • Export                   → PAYS via Client.country (lib/geo/countries).
 *
 * Périmètre métier (demande utilisateur) : on ne garde QUE les segments
 * EXPORT + GMS + CHR (cf. lib/segments). Tout est regroupé : par zone on cumule
 * CA, marge réelle (coût EM, lib/cogs), volume (kg) et nombre de BL/factures.
 *
 * NB : à la différence du rapport annuel (Écran 2), on ne déduit PAS les avoirs
 *      clients — c'est une vue de DISTRIBUTION du facturé, pas le CA net comptable.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { COGS_MARGIN, cogsFromSql } from "@/lib/cogs";
import { groupCodesForSegment, segmentOfGroup, type ClientSegment } from "@/lib/segments";
import { isFranceCountry, departementOfZip } from "@/lib/geo/zip";
import { departementName, DOM_DEPTS } from "@/lib/geo/departements";
import { resolveCountry } from "@/lib/geo/countries";

/** Centroïde des DOM (rendus en bulles sur la carte « Outre-mer & Export »). */
const DOM_CENTROID = new Map(DOM_DEPTS.map((d) => [d.code, { lat: d.lat, lng: d.lng }]));

/** Les 3 segments retenus + leurs codes de groupe SAP (union). */
export const GEO_SEGMENTS: ClientSegment[] = ["GMS", "CHR", "EXPORT"];
const GEO_GROUP_CODES: number[] = GEO_SEGMENTS.flatMap((s) => groupCodesForSegment(s) ?? []);

export interface GeoZone {
  id: string;                       // "fr-75" | "c-MV"
  kind: "fr-dept" | "country";
  code: string;                     // "75" | "MV"
  name: string;                     // "Paris" | "Maldives"
  /** centroïde — fourni pour les bulles (DOM + pays). null pour la métropole (choroplèthe). */
  lat: number | null;
  lng: number | null;
  ca: number;
  margin: number;
  weightKg: number;
  docs: number;                     // nb de BL/factures
  clients: number;                  // nb de clients distincts livrés
}

export interface GeoSegmentTotal {
  segment: ClientSegment;
  ca: number;
  margin: number;
  weightKg: number;
  docs: number;
  clients: number;
}

/** Client individuel localisé — pour le drill-down d'une zone (bulles). */
export interface GeoClient {
  cardCode: string;
  name: string;
  zoneId: string | null;          // "fr-75" | "c-MV" | null (non localisé)
  kind: "fr-dept" | "country" | null;
  code: string | null;            // "75" | "MV" | null
  zip: string | null;
  city: string | null;
  ca: number;
  margin: number;
  weightKg: number;
  docs: number;
}

export interface GeoPayload {
  zones: GeoZone[];
  segments: GeoSegmentTotal[];
  totals: { ca: number; margin: number; weightKg: number; docs: number; clients: number };
  /** Clients livrés mais non localisables (CP/pays absent ou inconnu). */
  unlocated: { ca: number; margin: number; weightKg: number; docs: number; clients: number };
  /** Clients individuels (pour le drill-down d'une zone en bulles). */
  clients: GeoClient[];
}

type Accum = { ca: number; margin: number; weightKg: number; docs: number; clients: number };
const zero = (): Accum => ({ ca: 0, margin: 0, weightKg: 0, docs: 0, clients: 0 });

/**
 * Agrège le facturé par zone géographique sur [start, end[.
 * `slpName` (non-admin / « voir comme ») restreint aux factures du commercial.
 */
export async function geoAggregate(start: Date, end: Date, slpName?: string | null): Promise<GeoPayload> {
  if (GEO_GROUP_CODES.length === 0) {
    return { zones: [], segments: [], totals: zero(), unlocated: zero(), clients: [] };
  }
  const slp = slpName ? Prisma.sql`AND i."slpName" = ${slpName}` : Prisma.empty;
  const inCodes = Prisma.sql`c."sapGroupCode" IN (${Prisma.join(GEO_GROUP_CODES)})`;
  const range = Prisma.sql`i."cancelled" = false AND i."docDate" >= ${start} AND i."docDate" < ${end}`;

  // En-tête : CA + nb BL par client (avec son adresse + groupe SAP).
  const headerRows = await prisma.$queryRaw<{
    card: string; nom: string | null; zip: string | null; city: string | null; country: string | null;
    gcode: number | null; gname: string | null; docs: number; ca: number;
  }[]>(Prisma.sql`
    SELECT c."code" AS card, c."nom" AS nom, c."zipCode" AS zip, c."city" AS city, c."country" AS country,
           c."sapGroupCode" AS gcode, c."sapGroupName" AS gname,
           COUNT(i."docEntry")::int AS docs,
           COALESCE(SUM(i."docTotal"), 0)::float AS ca
    FROM "SapInvoice" i
    JOIN "Client" c ON c."code" = i."cardCode"
    WHERE ${range} AND ${inCodes} ${slp}
    GROUP BY c."code", c."nom", c."zipCode", c."city", c."country", c."sapGroupCode", c."sapGroupName"`);

  // Marge réelle (coût EM) par client — agrégat ligne (lib/cogs).
  const marginRows = await prisma.$queryRaw<{ card: string; m: number }[]>(Prisma.sql`
    SELECT i."cardCode" AS card, COALESCE(SUM(${COGS_MARGIN}), 0)::float AS m
    FROM ${cogsFromSql("invoice")}
    JOIN "Client" c ON c."code" = i."cardCode"
    WHERE ${range} AND ${inCodes} ${slp}
    GROUP BY 1`);

  // Poids (kg) par client — quantité × poids unitaire produit.
  const weightRows = await prisma.$queryRaw<{ card: string; w: number }[]>(Prisma.sql`
    SELECT i."cardCode" AS card,
           COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS w
    FROM "SapInvoiceLine" l
    JOIN "SapInvoice" i ON i."docEntry" = l."docEntry"
    JOIN "Client" c ON c."code" = i."cardCode"
    LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
    WHERE ${range} AND ${inCodes} ${slp}
    GROUP BY 1`);

  const marginByCard = new Map(marginRows.map((r) => [r.card, Number(r.m)]));
  const weightByCard = new Map(weightRows.map((r) => [r.card, Number(r.w)]));

  const zones = new Map<string, GeoZone>();
  const segs = new Map<ClientSegment, Accum>();
  const totals = zero();
  const unlocated = zero();
  const clients: GeoClient[] = [];

  const bumpSeg = (s: ClientSegment, ca: number, m: number, w: number, docs: number) => {
    const acc = segs.get(s) ?? zero();
    acc.ca += ca; acc.margin += m; acc.weightKg += w; acc.docs += docs; acc.clients += 1;
    segs.set(s, acc);
  };

  for (const r of headerRows) {
    const seg = segmentOfGroup(r.gname, r.gcode);
    if (!seg || !GEO_SEGMENTS.includes(seg)) continue; // hors périmètre
    const ca = Number(r.ca);
    const margin = marginByCard.get(r.card) ?? 0;
    const weightKg = weightByCard.get(r.card) ?? 0;
    const docs = Number(r.docs);

    totals.ca += ca; totals.margin += margin; totals.weightKg += weightKg;
    totals.docs += docs; totals.clients += 1;
    bumpSeg(seg, ca, margin, weightKg, docs);

    // Détermination de la zone
    let zone: Pick<GeoZone, "id" | "kind" | "code" | "name" | "lat" | "lng"> | null = null;
    if (isFranceCountry(r.country)) {
      const dept = departementOfZip(r.zip);
      if (dept) {
        // Métropole + Corse → choroplèthe (lat/lng null). DOM → bulles (centroïde).
        const dom = DOM_CENTROID.get(dept);
        zone = {
          id: `fr-${dept}`, kind: "fr-dept", code: dept, name: departementName(dept),
          lat: dom?.lat ?? null, lng: dom?.lng ?? null,
        };
      }
    } else {
      const c = resolveCountry(r.country);
      if (c) zone = { id: `c-${c.iso2}`, kind: "country", code: c.iso2, name: c.nameFr, lat: c.lat, lng: c.lng };
    }

    clients.push({
      cardCode: r.card, name: r.nom ?? r.card,
      zoneId: zone?.id ?? null, kind: zone?.kind ?? null, code: zone?.code ?? null,
      zip: r.zip, city: r.city, ca, margin, weightKg, docs,
    });

    if (!zone) {
      unlocated.ca += ca; unlocated.margin += margin; unlocated.weightKg += weightKg;
      unlocated.docs += docs; unlocated.clients += 1;
      continue;
    }

    const z = zones.get(zone.id) ?? { ...zone, ca: 0, margin: 0, weightKg: 0, docs: 0, clients: 0 };
    z.ca += ca; z.margin += margin; z.weightKg += weightKg; z.docs += docs; z.clients += 1;
    zones.set(zone.id, z);
  }

  return {
    zones: Array.from(zones.values()).sort((a, b) => b.ca - a.ca),
    segments: GEO_SEGMENTS.map((s) => ({ segment: s, ...(segs.get(s) ?? zero()) })),
    totals,
    unlocated,
    clients: clients.sort((a, b) => b.ca - a.ca),
  };
}
