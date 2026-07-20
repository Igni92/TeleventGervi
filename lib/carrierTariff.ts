/**
 * GRILLES TARIFAIRES des transporteurs EXTERNES — coût PAR POSITION.
 *
 * Principe métier (juillet 2026, demande direction) :
 *   • Le prix position « direct » (flotte propre) ne concerne QUE les magasins
 *     livrables par un transporteur direct — il n'apparaît plus comme tarif
 *     global de la fiche.
 *   • Chaque transporteur externe porte une GRILLE : le coût d'une livraison
 *     (une POSITION, pas un €/kg) dépend du POIDS livré (tranches modifiables,
 *     ex. 0–50 kg / 51–100 kg…) et du DÉPARTEMENT de livraison (zones).
 *   • Une tranche est cotée soit en € PAR POSITION (forfait), soit en € AUX
 *     100 KG (grilles type Antoine au-delà de 100 kg) — au choix, par tranche.
 *   • Des LIGNES ANNEXES complètent le coût : fixes (€ par envoi — frais
 *     administratifs, frais documentaire…) et en % (majoration gazole du mois,
 *     pied de facture GO/GNR…). Le % s'applique au prix transport de la
 *     tranche ; les fixes s'ajoutent ensuite :
 *         total = base × (1 + Σ % ÷ 100) + Σ fixes
 *   • Grille GLOBALE par transporteur (partagée entre clients) — le département
 *     du client (code postal SAP) sélectionne la zone applicable.
 *
 * Sources des modèles pré-remplis : « DelanchyTarif » (GERVIFRAIS 2025, tarif
 * par département 0–100 / 101–500 kg + frais administratifs 4,62 € + majoration
 * gasoil mensuelle) et « AntoineTarif » (GERVIFRAIS 01/01/2026, distribution
 * par groupes de départements, forfaits 0–50 / 51–100 kg puis prix aux 100 kg,
 * frais documentaire 3,05 €, gestion palettes 1 €, pieds de facture GO & GNR
 * indexés CNR — cf. www.cnr.fr).
 *
 * Module volontairement PUR (aucun import serveur / prisma) — importable côté
 * serveur ET client, comme lib/transportCost. L'I/O vit dans
 * lib/transportCostStore.ts (AppSetting `transporttarif:<CODE>`).
 */

import { normCarrier } from "./transportCost";

/* ─────────────────────────────── Modèle ─────────────────────────────────── */

/** Unité de cotation d'une tranche : forfait position, prix aux 100 kg
 *  (grilles Antoine) ou prix À LA TONNE (Delanchy au-delà de 100 kg — le coût
 *  de la position se CALCULE alors : prix × kg ÷ 1000). */
export type BracketUnit = "position" | "per100kg" | "perTonne";

export const BRACKET_UNIT_LABELS: Record<BracketUnit, string> = {
  position: "€ / position",
  per100kg: "€ / 100 kg",
  perTonne: "€ / tonne",
};

/** Tranche de poids MODIFIABLE (bornes en kg, maxKg null = au-delà). */
export interface TariffBracket {
  id: string;
  /** Borne basse (incluse) — informative pour l'affichage/saisie. */
  minKg: number;
  /** Borne haute (incluse). null = « et au-delà ». */
  maxKg: number | null;
  unit: BracketUnit;
}

/** Zone de livraison = un groupe de DÉPARTEMENTS partageant les mêmes prix. */
export interface TariffZone {
  id: string;
  label: string;
  /** Codes départements ("75", "02", "2A", "971"…). */
  departements: string[];
  /** Prix par tranche (clé = TariffBracket.id) — 0/absent = non coté. */
  prices: Record<string, number>;
}

/** Ligne annexe : fixe (€ par envoi) ou en % du prix transport. */
export type TariffLineKind = "fixed" | "percent";

export interface TariffExtraLine {
  id: string;
  label: string;
  kind: TariffLineKind;
  /** € si `fixed`, pourcentage (ex. 5 = 5 %) si `percent`. */
  value: number;
}

/** Grille tarifaire d'UN transporteur externe (clé = U_TrspCode MAJUSCULES). */
export interface CarrierTariff {
  carrierCode: string;
  brackets: TariffBracket[];
  zones: TariffZone[];
  extras: TariffExtraLine[];
  updatedAt?: string | null;
  updatedBy?: string | null;
}

/** Grilles par code transporteur (MAJUSCULES). */
export type CarrierTariffMap = Record<string, CarrierTariff>;

/* ─────────────────────────────── Helpers ────────────────────────────────── */

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Normalise un code département ("2" → "02", "2a" → "2A", "971" → "971"). */
export function normDept(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return "";
  if (/^2[AB]$/.test(s)) return s;
  if (/^\d{3}$/.test(s)) return s;            // DOM/COM (971…)
  if (/^\d{1,2}$/.test(s)) return s.padStart(2, "0");
  return s.slice(0, 3);
}

/** Tranche applicable à un poids : la première (triée) dont maxKg couvre kg.
 *  Les bornes basses ne créent pas de trous : 0–50 puis 51–100 → 50,5 kg tombe
 *  dans la 2ᵉ tranche. Poids au-delà de la dernière borne → null (hors grille). */
export function bracketForWeight(brackets: TariffBracket[], kg: number): TariffBracket | null {
  const w = n(kg);
  if (w <= 0 || !brackets.length) return null;
  const sorted = [...brackets].sort((a, b) => (a.maxKg ?? Infinity) - (b.maxKg ?? Infinity));
  for (const b of sorted) {
    if (b.maxKg == null || w <= b.maxKg) return b;
  }
  return null;
}

/** Zone couvrant un département (première zone qui le liste). */
export function zoneForDepartement(zones: TariffZone[], dept: string | null | undefined): TariffZone | null {
  const d = normDept(dept);
  if (!d) return null;
  return zones.find((z) => z.departements.some((x) => normDept(x) === d)) ?? null;
}

/* ─────────────────────────────── Calcul ─────────────────────────────────── */

export interface PositionCostDetail {
  /** Prix transport de la tranche (forfait, ou €/100 kg × poids). */
  base: number;
  /** Σ des lignes en % (points de %). */
  percentTotal: number;
  /** Montant € des lignes en % (base × Σ% ÷ 100). */
  percentAmount: number;
  /** Σ des lignes fixes (€). */
  fixedAmount: number;
  /** Coût TOTAL de la position. */
  total: number;
  bracket: TariffBracket;
  zone: TariffZone;
}

/**
 * Coût d'UNE POSITION (une livraison) : `null` si la grille ne couvre pas ce
 * département / ce poids (le poids doit être > 0 et une tranche cotée > 0).
 */
export function computePositionCost(
  tariff: CarrierTariff | null | undefined,
  departement: string | null | undefined,
  kg: number,
): PositionCostDetail | null {
  if (!tariff) return null;
  const zone = zoneForDepartement(tariff.zones, departement);
  if (!zone) return null;
  const bracket = bracketForWeight(tariff.brackets, kg);
  if (!bracket) return null;
  const price = n(zone.prices[bracket.id]);
  if (price <= 0) return null;
  const base = bracket.unit === "per100kg" ? (price * n(kg)) / 100
    : bracket.unit === "perTonne" ? (price * n(kg)) / 1000
    : price;
  let percentTotal = 0;
  let fixedAmount = 0;
  for (const l of tariff.extras) {
    if (l.kind === "percent") percentTotal += n(l.value);
    else fixedAmount += n(l.value);
  }
  const percentAmount = (base * percentTotal) / 100;
  return {
    base: r2(base),
    percentTotal: r2(percentTotal),
    percentAmount: r2(percentAmount),
    fixedAmount: r2(fixedAmount),
    total: r2(base + percentAmount + fixedAmount),
    bracket,
    zone,
  };
}

/** Grille utilisable ? (au moins une tranche ET une zone avec un prix > 0). */
export function tariffIsUsable(tariff: CarrierTariff | null | undefined): boolean {
  if (!tariff || !tariff.brackets.length) return false;
  return tariff.zones.some((z) => tariff.brackets.some((b) => n(z.prices[b.id]) > 0));
}

/* ─────────────────────────── Sanitizer (I/O) ────────────────────────────── */

const MAX_BRACKETS = 20;
const MAX_ZONES = 80;
const MAX_EXTRAS = 20;
const MAX_DEPTS = 120;

function coerceUnit(v: unknown): BracketUnit {
  return v === "per100kg" || v === "perTonne" ? v : "position";
}

/** Normalise une grille entrante (PUT). Ne jette jamais. */
export function sanitizeCarrierTariff(raw: unknown): CarrierTariff {
  const o = (raw ?? {}) as Record<string, unknown>;

  const brackets: TariffBracket[] = (Array.isArray(o.brackets) ? o.brackets : [])
    .slice(0, MAX_BRACKETS)
    .map((b, i) => {
      const l = (b ?? {}) as Record<string, unknown>;
      const maxKg = l.maxKg == null || l.maxKg === "" ? null : Math.max(0, r2(n(l.maxKg)));
      return {
        id: typeof l.id === "string" && l.id ? l.id.slice(0, 40) : `b-${i}`,
        minKg: Math.max(0, r2(n(l.minKg))),
        maxKg,
        unit: coerceUnit(l.unit),
      };
    });
  const bracketIds = new Set(brackets.map((b) => b.id));

  const zones: TariffZone[] = (Array.isArray(o.zones) ? o.zones : [])
    .slice(0, MAX_ZONES)
    .map((z, i) => {
      const l = (z ?? {}) as Record<string, unknown>;
      const depts: string[] = [];
      const seen = new Set<string>();
      for (const d of (Array.isArray(l.departements) ? l.departements : []).slice(0, MAX_DEPTS)) {
        const code = normDept(typeof d === "string" ? d : String(d ?? ""));
        if (code && !seen.has(code)) { seen.add(code); depts.push(code); }
      }
      const prices: Record<string, number> = {};
      if (l.prices && typeof l.prices === "object") {
        for (const [k, v] of Object.entries(l.prices as Record<string, unknown>)) {
          if (!bracketIds.has(k)) continue;
          const val = Math.max(0, r2(n(v)));
          if (val > 0) prices[k] = val;
        }
      }
      return {
        id: typeof l.id === "string" && l.id ? l.id.slice(0, 40) : `z-${i}`,
        label: typeof l.label === "string" ? l.label.trim().slice(0, 120) : "",
        departements: depts,
        prices,
      };
    });

  const extras: TariffExtraLine[] = (Array.isArray(o.extras) ? o.extras : [])
    .slice(0, MAX_EXTRAS)
    .map((e, i) => {
      const l = (e ?? {}) as Record<string, unknown>;
      return {
        id: typeof l.id === "string" && l.id ? l.id.slice(0, 40) : `x-${i}`,
        label: typeof l.label === "string" ? l.label.trim().slice(0, 120) : "",
        kind: l.kind === "percent" ? "percent" as const : "fixed" as const,
        value: Math.max(0, r2(n(l.value))),
      };
    });

  return {
    carrierCode: normCarrier(typeof o.carrierCode === "string" ? o.carrierCode : "").slice(0, 60),
    brackets,
    zones,
    extras,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : null,
    updatedBy: typeof o.updatedBy === "string" ? o.updatedBy.slice(0, 120) : null,
  };
}

/* ─────────────────── Modèles pré-remplis (fichiers tarifs) ──────────────── */

const zone = (id: string, label: string, departements: string[], prices: Record<string, number>): TariffZone =>
  ({ id, label, departements, prices });

/** Grille DELANCHY — « GERVIFRAIS TARIF 2025 » (tarif par département).
 *  0–100 kg : forfait par position ; 101–500 kg : prix À LA TONNE (le coût de
 *  la position se calcule : prix × kg ÷ 1000). Majoration gasoil PRÉ-REMPLIE à
 *  5 % (valeur du fichier) — à actualiser chaque mois (barème Delanchy
 *  « majoration gasoil du mois en vigueur »). */
function delanchyTemplate(carrierCode: string): CarrierTariff {
  const B1 = "0-100", B2 = "101-500";
  const brackets: TariffBracket[] = [
    { id: B1, minKg: 0, maxKg: 100, unit: "position" },
    { id: B2, minKg: 101, maxKg: 500, unit: "perTonne" },
  ];
  const rows: [string[], number, number][] = [
    [["44", "85"], 47.95, 395.63],
    [["16", "36", "37", "87"], 52.77, 429.06],
    [["17"], 54.83, 438.82],
    [["18", "19"], 56.59, 462.22],
    [["23"], 59.08, 472.60],
    [["24", "33"], 57.62, 462.96],
    [["26"], 61.47, 491.78],
    [["28", "45"], 86.21, 689.65],
    [["42"], 65.32, 522.49],
    [["43"], 67.72, 541.64],
    [["47"], 60.95, 487.67],
    [["49"], 53.68, 448.78],
    [["54", "57"], 87.45, 699.58],
    [["64"], 77.88, 623.14],
    [["67"], 103.03, 824.30],
    [["68", "90"], 95.22, 761.91],
    [["69"], 55.26, 441.89],
    [["71"], 69.52, 556.46],
    [["72"], 59.62, 477.00],
    [["73", "74"], 73.98, 591.54],
    [["79"], 52.00, 433.98],
    [["80"], 97.19, 777.38],
    [["86"], 42.14, 340.92],
    [["89"], 73.69, 589.58],
  ];
  return {
    carrierCode,
    brackets,
    zones: rows.map(([depts, p1, p2], i) => zone(`z-${i}`, `Dépt ${depts.join(" · ")}`, depts, { [B1]: p1, [B2]: p2 })),
    extras: [
      { id: "admin", label: "Frais administratifs / envoi", kind: "fixed", value: 4.62 },
      { id: "gazole", label: "Majoration gasoil (mois en vigueur)", kind: "percent", value: 5 },
    ],
    updatedAt: null,
    updatedBy: null,
  };
}

/** Grille ANTOINE — « GERVIFRAIS 01/01/2026 », section 2. Distribution
 *  (forfaits 0–50 / 51–100 kg, puis PRIX AUX 100 KG 101–300 / 301–800).
 *  Pieds de facture indexés CNR (www.cnr.fr) :
 *    • GO : (cuve moy. mensuelle − 0,880 €/L) ÷ 0,880 × 23 % — pré-rempli 9,8 %
 *      (estimation indice CNR gazole professionnel juin 2026 : 229,03,
 *      base 100 = 12/2000) ;
 *    • GNR groupe froid : indice M-1 ÷ 283,84 × 2,6 % (jamais négatif) —
 *      juin 2026 : 371,58 → 3,40 % (indicateur CNR n° 36). */
function antoineTemplate(carrierCode: string): CarrierTariff {
  const B1 = "0-50", B2 = "51-100", B3 = "101-300", B4 = "301-800";
  return {
    carrierCode,
    brackets: [
      { id: B1, minKg: 0, maxKg: 50, unit: "position" },
      { id: B2, minKg: 51, maxKg: 100, unit: "position" },
      { id: B3, minKg: 101, maxKg: 300, unit: "per100kg" },
      { id: B4, minKg: 301, maxKg: 800, unit: "per100kg" },
    ],
    zones: [
      zone("z-rp", "Région parisienne (75 · 91 · 92 · 93 · 94)", ["75", "91", "92", "93", "94"],
        { [B1]: 37.86, [B2]: 40.20, [B3]: 34.02, [B4]: 27.84 }),
      zone("z-9578", "95 · 78", ["95", "78"],
        { [B1]: 40.02, [B2]: 42.21, [B3]: 35.72, [B4]: 29.23 }),
      zone("z-nord", "Nord (59 · 62 · 02 Hirson / Viry-Noureuil / St-Omer)", ["59", "62", "02"],
        { [B1]: 43.26, [B2]: 46.51, [B3]: 38.94, [B4]: 31.91 }),
      zone("z-norm", "27 Bernay · 60 · 76 · 80", ["27", "60", "76", "80"],
        { [B1]: 42.18, [B2]: 44.03, [B3]: 36.48, [B4]: 30.19 }),
    ],
    extras: [
      { id: "doc", label: "Frais documentaire", kind: "fixed", value: 3.05 },
      { id: "palette", label: "Gestion palettes (1 € / palette)", kind: "fixed", value: 1.00 },
      { id: "go", label: "Pied de facture GO (gazole, base 0,880 €/L × 23 %)", kind: "percent", value: 9.8 },
      { id: "gnr", label: "Pied de facture GNR (groupe froid, CNR ÷ 283,84 × 2,6 %)", kind: "percent", value: 3.4 },
    ],
    updatedAt: null,
    updatedBy: null,
  };
}

/** Code Delanchy ? = contient DELANCHY, ou l'un des dépôts « FT » suivis d'un
 *  numéro de département (FT86, FT94…) — Delanchy regroupe tous les FT. */
export function isDelanchyCarrierCode(code: string | null | undefined): boolean {
  const c = normCarrier(code);
  if (!c) return false;
  return c.includes("DELANCHY") || /(^|[^A-Z0-9])FT\s*\d+/.test(c);
}

/**
 * Modèle pré-rempli pour un transporteur, d'après son code (repère souple :
 * DELANCHY / FT<n° dépt> → grille Delanchy ; ANTOINE → grille Antoine). null
 * sinon — l'éditeur part d'une grille vierge (tranches 0–50 / 51–100 / 101–300).
 */
export function tariffTemplateFor(carrierCode: string): CarrierTariff | null {
  const code = normCarrier(carrierCode);
  if (!code) return null;
  if (isDelanchyCarrierCode(code)) return delanchyTemplate(code);
  if (code.includes("ANTOINE")) return antoineTemplate(code);
  return null;
}

/** Grille vierge de départ (tranches usuelles, aucune zone). */
export function emptyTariff(carrierCode: string): CarrierTariff {
  return {
    carrierCode: normCarrier(carrierCode),
    brackets: [
      { id: "b-0", minKg: 0, maxKg: 50, unit: "position" },
      { id: "b-1", minKg: 51, maxKg: 100, unit: "position" },
      { id: "b-2", minKg: 101, maxKg: 300, unit: "position" },
    ],
    zones: [],
    extras: [],
    updatedAt: null,
    updatedBy: null,
  };
}
