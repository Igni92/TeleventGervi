/**
 * Segments commerciaux — buckets « métier » au-dessus des ~100 groupes clients SAP.
 *
 * Le rapport annuel (Écran 2) est bâti sur le miroir SAP (SapInvoice joint à
 * SapBusinessPartner). On ne stocke pas le segment : on le DÉDUIT du groupe
 * client SAP (`groupName`/`groupCode`) au moment d'agréger. Avantage : couverture
 * complète et toujours alignée sur la source du rapport, sans tag manuel.
 *
 * ⚙️  Pour re-classer un groupe : éditer les tables ci-dessous (`segmentOfGroup`).
 *     Tout groupe non classé tombe dans « autre » → compté uniquement dans TOUT.
 *
 * Buckets (cf. sap_scrape/sap_export/BusinessPartnerGroups.csv) :
 *   • GMS    — grande & moyenne surface : enseignes + centrales d'achat
 *              (GMS, Auchan, Carrefour, Casino, Cora, Dia, Intermarché, Système U,
 *               SCA / SOCA centrales, Galec…).
 *   • CHR    — café/hôtel/restaurant & RHF (Resto., Traiteur, Flunch, Metro,
 *              Pomona, Pâtisserie/Boulangerie artisanale…).
 *   • EXPORT — clients export (EXPORT, CLT - Export 1..4).
 *   • RUNGIS — marché de Rungis (RUNGIS, MIN RUNGIS, CLT - Rungis 1..4).
 */

export type Segment = "ALL" | "GMS" | "CHR" | "EXPORT" | "RUNGIS" | "MIN_RUNGIS";
/** Segments « réels » (hors agrégat TOUT). */
export type ClientSegment = Exclude<Segment, "ALL">;

export const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "ALL", label: "TOUT" },
  { id: "GMS", label: "GMS" },
  { id: "CHR", label: "CHR" },
  { id: "EXPORT", label: "EXPORT" },
  // RUNGIS = tous les clients du MIN ; MIN_RUNGIS = vente aux grossistes du MIN.
  { id: "RUNGIS", label: "RUNGIS" },
  { id: "MIN_RUNGIS", label: "MIN RUNGIS" },
];

const SEGMENT_IDS = new Set<Segment>(SEGMENTS.map((s) => s.id));

/** Parse un paramètre d'URL en Segment valide (défaut : ALL). */
export function parseSegment(v: string | null | undefined): Segment {
  return v && SEGMENT_IDS.has(v as Segment) ? (v as Segment) : "ALL";
}

// ── Correspondance par CODE de groupe SAP (source de vérité) ────────────
// ⚠️  Le miroir ne synchronise pas le `groupName` (null pour ~tous les BP),
//     mais `groupCode` est fiable (renseigné à 100 %). On classe donc d'abord
//     par code. Référence des codes : sap_export/BusinessPartnerGroups.csv.
//     Pour re-classer un groupe : déplacer son code d'une liste à l'autre.
const SEGMENT_CODES: Record<ClientSegment, number[]> = {
  // GMS — enseignes + centrales d'achat grande distribution
  GMS: [
    118, // GMS
    119, // A. HALLES
    138, // AUCHAN
    139, // CENTRALE
    145, // U SCHIEVER
    161, // H.DISCOUNT
    163, 164, 165, 166, 167, 168, 169, 170, // SCACHAP, SOCAMAINE, LECASUD, SCAOUEST…
    171, 172, 173, // A. SMPLY MKT, A. SAFIPAR, A. SODIX
    174, 175, 176, 177, 178, // SCADIF, SCAPNOR, SOMARVRAC, SOCARA, PROVENCIA
    179, // CARREFOUR
    180, 181, // C. INDEPT, C. MARKET
    182, 183, 184, 185, 186, 187, // SCANORMANDE, SCAMARK, SCASO, SCAPARTOIS, SCALANDES, SOCAMIL
    188, // HYPARLO
    191, 192, 193, 194, // Système U (Nord Ouest, Ouest, Sud, Est)
    202, // INTERMARCHE
    207, // CASINO
    208, // MIGROS
    210, // A. LUXEMBOURG (Auchan)
    217, 218, 219, // COOP ALSACE, AUCHAN TOMBLAINE, AUCHAN SOMARVRAC
    221, // COOP
    225, 226, // DIA, CORA
    228, // HEXAGROS
    248, 249, 250, 251, 252, 253, 254, 255, 256, // A1..A9 (dépôts Auchan / Schiever)
    271, // GALEC
    275, 276, 277, 278, // GMS - Patisserie 1..4
    279, 280, 281, 282, // GMS - RFL 1..4
  ],
  // CHR — café / hôtel / restaurant & RHF (restauration hors foyer)
  CHR: [
    113, // PATISSERIE
    122, 146, // FLUNCH, FLUNCH IDPT
    147, // RESTO.
    197, // TRAITEUR
    212, // POMONA
    213, // CAFETARIA CRESCENDO
    224, // METRO
    283, 284, 285, 286, // CLT - Boulangerie 1..4
  ],
  // EXPORT — clients export
  EXPORT: [
    205, // EXPORT
    291, 292, 293, 294, // CLT - Export 1..4
  ],
  // RUNGIS — tous les clients du marché de Rungis (hors grossistes du MIN)
  RUNGIS: [
    115, // RUNGIS
    295, 296, 297, 298, // CLT - Rungis 1..4
  ],
  // MIN RUNGIS — vente aux grossistes du carreau (MIN)
  MIN_RUNGIS: [
    150, // MIN RUNGIS
  ],
};

const SEGMENT_BY_CODE = new Map<number, ClientSegment>();
for (const [seg, codes] of Object.entries(SEGMENT_CODES) as [ClientSegment, number[]][]) {
  for (const c of codes) SEGMENT_BY_CODE.set(c, seg);
}

// ── Fallback par NOM (si le groupName venait à être synchronisé un jour) ──
const GMS_EXACT = new Set([
  "CENTRALE", "CARREFOUR", "CASINO", "CORA", "DIA", "INTERMARCHE", "MIGROS",
  "H.DISCOUNT", "HYPARLO", "PROVENCIA", "LECASUD", "GALEC", "COOP", "COOP ALSACE",
  "HEXAGROS",
]);
const CHR_EXACT = new Set([
  "RESTO.", "TRAITEUR", "FLUNCH", "FLUNCH IDPT", "CAFETARIA CRESCENDO",
  "PATISSERIE", "METRO", "POMONA",
]);

function segmentOfName(groupName: string): ClientSegment | null {
  const g = groupName.trim().toUpperCase();
  if (g === "EXPORT" || g.startsWith("CLT - EXPORT") || g.startsWith("CLT-EXPORT")) return "EXPORT";
  if (g === "MIN RUNGIS") return "MIN_RUNGIS";   // grossistes du MIN (avant le RUNGIS générique)
  if (g === "RUNGIS"
      || g.startsWith("CLT - RUNGIS") || g.startsWith("CLT-RUNGIS")) return "RUNGIS";
  if (g.startsWith("GMS")
      || g.startsWith("SCA") || g.startsWith("SOCA") || g.startsWith("SOMAR")
      || g.startsWith("AUCHAN")
      || g.startsWith("U ") || g.startsWith("A.") || g.startsWith("C.")
      || /^A\d+$/.test(g) || GMS_EXACT.has(g)) return "GMS";
  if (CHR_EXACT.has(g)
      || g.startsWith("CLT - BOULANGERIE") || g.startsWith("CLT-BOULANGERIE")) return "CHR";
  return null;
}

/**
 * Segment d'un client à partir de son groupe SAP. Priorité au CODE (fiable),
 * repli sur le NOM. Renvoie `null` si aucun des 4 segments (compté dans TOUT).
 */
export function segmentOfGroup(
  groupName: string | null | undefined,
  groupCode?: number | null,
): ClientSegment | null {
  if (groupCode != null && SEGMENT_BY_CODE.has(groupCode)) return SEGMENT_BY_CODE.get(groupCode)!;
  if (groupName) return segmentOfName(groupName);
  return null;
}

/**
 * Codes de groupe SAP d'un segment — `null` pour ALL (= aucun filtre).
 * Statique (zéro requête, importable côté client) : les agrégats filtrent par
 * jointure sur SapBusinessPartner.groupCode, pas par liste de CardCode.
 */
export function groupCodesForSegment(segment: Segment): number[] | null {
  if (segment === "ALL") return null;
  return SEGMENT_CODES[segment];
}

/** Les 3 segments LIVRÉS (préparation + tournée) — les seuls du Détail livraison. */
const DELIVERED_SEGMENTS = new Set<ClientSegment>(["GMS", "CHR", "EXPORT"]);

/**
 * Vente « comptoir » = client HORS des 3 segments livrés (GMS / CHR / EXPORT).
 *
 * Ces commandes (retrait comptoir, MIN, Rungis, divers) ne passent pas par la
 * file de préparation/livraison : leur marchandise part à la vente. On les
 * considère donc préparées + livrées dès la création du bon — sinon elles
 * traînent indéfiniment en « pas préparé » et faussent l'inventaire.
 *
 * Segment déduit du groupe SAP (fiable), avec repli sur le `type` client : si
 * l'un des deux signale un segment livré, ce N'EST PAS une vente comptoir.
 */
export function isComptoirClient(opts: {
  type?: string | null;
  groupName?: string | null;
  groupCode?: number | null;
}): boolean {
  const seg = segmentOfGroup(opts.groupName ?? null, opts.groupCode ?? null);
  if (seg && DELIVERED_SEGMENTS.has(seg)) return false;
  const t = (opts.type ?? "").trim().toUpperCase();
  if (t === "GMS" || t === "CHR" || t === "EXPORT") return false;
  return true;
}
