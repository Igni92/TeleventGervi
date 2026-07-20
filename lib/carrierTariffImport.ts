/**
 * IMPORT des tarifs transporteurs depuis leurs fichiers Excel — un simple
 * dépôt du fichier (« DelanchyTarif », « AntoineTarif ») reconstruit la GRILLE
 * PAR POSITION (lib/carrierTariff) et l'applique aux transporteurs concernés :
 * le coût de transport de TOUS les clients en découle (département du client ×
 * tranche de poids), sans ressaisie.
 *
 * Deux formats reconnus (détection automatique) :
 *   • DELANCHY — « GERVIFRAIS TARIF » : en-têtes « 0 à 100kg » / « 101 à
 *     500kg », puis une ligne PAR DÉPARTEMENT (n° en colonne A, prix en face).
 *     Les départements aux prix identiques sont regroupés en zones.
 *     + « Frais administratif/envois » (€ fixe) et « Majoration gasoil » (%).
 *   • ANTOINE — section « 2. Distribution » : en-têtes « Forfait » puis « Prix
 *     aux 100 kgs », tranches « 0-50 » « 51-100 » (forfait / position) et
 *     « 101-300 » « 301-800 » (aux 100 kg) ; une ligne par GROUPE de
 *     départements (« 75 - 91 - 92 - 93 - 94 »…). La section « 1. Tarif
 *     plateforme » (au-dessus) est ignorée. + « Frais Documentaire »,
 *     « Gestion des palettes », pieds de facture GO / GNR (%).
 *
 * Les lignes en % (majoration gazole, GO/GNR) ne portent pas de valeur
 * exploitable dans les fichiers : à l'application, on CONSERVE la valeur déjà
 * saisie sur la grille existante (sinon celle du modèle pré-rempli) — cf.
 * mergeExtraValues. Module PUR (aucun import serveur) : le décodage xlsx vit
 * dans la route d'import (exceljs), qui fournit une matrice de cellules.
 */

import {
  normDept,
  tariffTemplateFor,
  type CarrierTariff,
  type TariffBracket,
  type TariffExtraLine,
  type TariffZone,
} from "./carrierTariff";

/** Matrice de cellules (lignes × colonnes), valeurs déjà aplaties en texte/nombre. */
export type CellMatrix = (string | number | null)[][];

export type TariffImportFormat = "delanchy" | "antoine";

export interface TariffImportResult {
  format: TariffImportFormat;
  /** Grille SANS code transporteur (appliquée ensuite par code — cf. route). */
  tariff: Omit<CarrierTariff, "carrierCode"> & { carrierCode: "" };
  warnings: string[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Une seule ligne annexe par id (première occurrence gardée). */
const dedupeById = (lines: TariffExtraLine[]): TariffExtraLine[] => {
  const seen = new Set<string>();
  return lines.filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
};

const asStr = (v: string | number | null): string => (v == null ? "" : String(v)).trim();
const asNum = (v: string | number | null): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = asStr(v).replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

/** Code département valide (métropole 01-95 + Corse 2A/2B + DOM 971-976). */
function isDeptCode(s: string): boolean {
  if (/^2[AB]$/i.test(s)) return true;
  if (/^97[1-6]$/.test(s)) return true;
  if (/^\d{1,2}$/.test(s)) {
    const n = parseInt(s, 10);
    return n >= 1 && n <= 95;
  }
  return false;
}

/** Tous les codes départements présents dans un libellé de zone Antoine
 *  (« 59-62- Hirson 02- Viry Noureuil 02 » → ["59","62","02"]). */
function deptsFromLabel(label: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of label.matchAll(/\b(2[AB]|97[1-6]|\d{1,2})\b/gi)) {
    const raw = m[1].toUpperCase();
    if (!isDeptCode(raw)) continue;
    const code = normDept(raw);
    if (!seen.has(code)) { seen.add(code); out.push(code); }
  }
  return out;
}

/* ─────────────────────────── Format DELANCHY ────────────────────────────── */

/** En-tête de tranche Delanchy : « 0 à 100kg », « 101 à 500 kg »… */
const DELANCHY_BRACKET_RE = /(\d+)\s*à\s*(\d+)\s*kg/i;

function parseDelanchy(matrix: CellMatrix): TariffImportResult | null {
  // 1) Ligne d'en-tête : ≥ 2 cellules « X à Y kg ».
  let headerRow = -1;
  let cols: { col: number; minKg: number; maxKg: number }[] = [];
  for (let r = 0; r < matrix.length; r++) {
    const found: typeof cols = [];
    (matrix[r] ?? []).forEach((cell, c) => {
      const m = asStr(cell).match(DELANCHY_BRACKET_RE);
      if (m) found.push({ col: c, minKg: parseInt(m[1], 10), maxKg: parseInt(m[2], 10) });
    });
    if (found.length >= 2) { headerRow = r; cols = found; break; }
  }
  if (headerRow < 0) return null;

  const brackets: TariffBracket[] = cols.map((c) => ({
    id: `${c.minKg}-${c.maxKg}`,
    minKg: c.minKg,
    maxKg: c.maxKg,
    // Barème Delanchy : forfait par position jusqu'à 100 kg ; AU-DELÀ le prix
    // est À LA TONNE (coût de la position = prix × kg ÷ 1000).
    unit: c.maxKg <= 100 ? "position" : "perTonne",
  }));

  // 2) Lignes départements : n° en colonne A, prix en face des tranches.
  //    Regroupement des départements aux prix identiques en une zone.
  const groups = new Map<string, { depts: string[]; prices: Record<string, number> }>();
  let deptRows = 0;
  const warnings: string[] = [];
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const dRaw = asStr(matrix[r]?.[0]);
    if (!dRaw || !isDeptCode(dRaw)) continue;
    const dept = normDept(dRaw);
    const prices: Record<string, number> = {};
    for (let i = 0; i < cols.length; i++) {
      const v = asNum(matrix[r]?.[cols[i].col] ?? null);
      if (v != null && v > 0) prices[brackets[i].id] = r2(v);
    }
    if (Object.keys(prices).length === 0) { warnings.push(`Département ${dept} : aucun prix lu — ignoré.`); continue; }
    deptRows++;
    const key = brackets.map((b) => prices[b.id] ?? 0).join("|");
    const g = groups.get(key) ?? { depts: [], prices };
    if (!g.depts.includes(dept)) g.depts.push(dept);
    groups.set(key, g);
  }
  if (deptRows === 0) return null;

  const zones: TariffZone[] = [...groups.values()].map((g, i) => ({
    id: `z-${i}`,
    label: `Dépt ${g.depts.join(" · ")}`,
    departements: g.depts,
    prices: g.prices,
  }));

  // 3) Lignes annexes (texte cherché dans toute la feuille).
  const extras: TariffExtraLine[] = [];
  for (const row of matrix) {
    const label = asStr(row?.[0]);
    if (/frais\s+administratif/i.test(label)) {
      const v = row.map(asNum).find((n): n is number => n != null && n > 0);
      extras.push({ id: "admin", label: "Frais administratifs / envoi", kind: "fixed", value: v != null ? r2(v) : 0 });
    } else if (/majoration\s+ga[sz]/i.test(label)) {
      // Pas de % fiable dans le fichier (« du mois en vigueur ») — valeur posée
      // au merge (grille existante, sinon modèle pré-rempli).
      extras.push({ id: "gazole", label: "Majoration gasoil (mois en vigueur)", kind: "percent", value: 0 });
    }
  }

  return {
    format: "delanchy",
    tariff: { carrierCode: "", brackets, zones, extras: dedupeById(extras), updatedAt: null, updatedBy: null },
    warnings,
  };
}

/* ─────────────────────────── Format ANTOINE ─────────────────────────────── */

/** En-tête de tranche Antoine : « 0-50 », « 301-800 »… */
const ANTOINE_BRACKET_RE = /^(\d+)\s*[-–]\s*(\d+)$/;

function parseAntoine(matrix: CellMatrix): TariffImportResult | null {
  // 1) Marqueur de section « Distribution » (la section plateforme, au-dessus,
  //    est hors périmètre magasins — ignorée). On exige un TITRE court
  //    (« 2. Distribution ») — pas un texte le contenant par hasard (l'e-mail
  //    « antoinedistribution.fr » en tête de feuille, par exemple).
  const distRow = matrix.findIndex((row) =>
    (row ?? []).some((c) => /^\s*(\d+\s*[.)]\s*)?distribution\s*$/i.test(asStr(c))),
  );
  if (distRow < 0) return null;

  // 2) Ligne d'en-tête des tranches (« 0-50 » « 51-100 »…), après le marqueur.
  let headerRow = -1;
  let cols: { col: number; minKg: number; maxKg: number }[] = [];
  for (let r = distRow + 1; r < matrix.length; r++) {
    const found: typeof cols = [];
    (matrix[r] ?? []).forEach((cell, c) => {
      const m = asStr(cell).match(ANTOINE_BRACKET_RE);
      if (m) found.push({ col: c, minKg: parseInt(m[1], 10), maxKg: parseInt(m[2], 10) });
    });
    if (found.length >= 2) { headerRow = r; cols = found; break; }
  }
  if (headerRow < 0) return null;

  // 3) Unités : les colonnes À PARTIR de l'en-tête « … aux 100 kg » sont
  //    cotées aux 100 kg ; celles d'avant (« Forfait ») par position. Cherché
  //    juste AU-DESSUS de la ligne de tranches (la section plateforme a son
  //    propre « Prix aux 100 kgs », plus haut — hors fenêtre).
  let per100Col = Infinity;
  for (let r = Math.max(distRow, headerRow - 2); r <= headerRow; r++) {
    (matrix[r] ?? []).forEach((cell, c) => {
      if (/aux?\s*100\s*kg/i.test(asStr(cell))) per100Col = Math.min(per100Col, c);
    });
  }
  const brackets: TariffBracket[] = cols.map((c) => ({
    id: `${c.minKg}-${c.maxKg}`,
    minKg: c.minKg,
    maxKg: c.maxKg,
    unit: c.col >= per100Col ? "per100kg" : "position",
  }));

  // 4) Zones : libellé (groupe de départements) en colonne A + ≥ 1 prix.
  const zones: TariffZone[] = [];
  const warnings: string[] = [];
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const label = asStr(matrix[r]?.[0]);
    if (!label) continue;
    if (/frais|pied de facture|palette|limite|conditions|retour/i.test(label)) break; // fin des zones
    const depts = deptsFromLabel(label);
    if (depts.length === 0) continue;
    const prices: Record<string, number> = {};
    for (let i = 0; i < cols.length; i++) {
      const v = asNum(matrix[r]?.[cols[i].col] ?? null);
      if (v != null && v > 0) prices[brackets[i].id] = r2(v);
    }
    if (Object.keys(prices).length === 0) { warnings.push(`Zone « ${label.slice(0, 40)} » : aucun prix lu — ignorée.`); continue; }
    zones.push({ id: `z-${zones.length}`, label: label.replace(/\s+/g, " ").slice(0, 120), departements: depts, prices });
  }
  if (zones.length === 0) return null;

  // 5) Lignes annexes.
  const extras: TariffExtraLine[] = [];
  for (const row of matrix) {
    const label = asStr(row?.[0]);
    const rowText = (row ?? []).map(asStr).join(" ");
    if (/frais\s+documentaire/i.test(label)) {
      const v = row.map(asNum).find((n): n is number => n != null && n > 0);
      extras.push({ id: "doc", label: "Frais documentaire", kind: "fixed", value: v != null ? r2(v) : 0 });
    } else if (/gestion\s+des?\s+palettes/i.test(rowText)) {
      const m = rowText.match(/([\d.,]+)\s*€/);
      extras.push({ id: "palette", label: "Gestion palettes (par palette)", kind: "fixed", value: m ? r2(asNum(m[1]) ?? 0) : 0 });
    } else if (/pied de facture\s*GO/i.test(rowText)) {
      extras.push({ id: "go", label: "Pied de facture GO (gazole, indexation cuve)", kind: "percent", value: 0 });
    } else if (/pied de facture\s*GNR/i.test(rowText)) {
      extras.push({ id: "gnr", label: "Pied de facture GNR (groupe froid, CNR)", kind: "percent", value: 0 });
    }
  }

  return {
    format: "antoine",
    tariff: { carrierCode: "", brackets, zones, extras: dedupeById(extras), updatedAt: null, updatedBy: null },
    warnings,
  };
}

/* ─────────────────────────── Entrée principale ──────────────────────────── */

/** Détecte le format et parse la matrice. Lance une Error (message FR) sinon. */
export function parseTariffMatrix(matrix: CellMatrix): TariffImportResult {
  // Antoine d'abord : sa feuille contient aussi des « X à Y kg » (plateforme)
  // qui matcheraient le détecteur Delanchy.
  const antoine = parseAntoine(matrix);
  if (antoine) return antoine;
  const delanchy = parseDelanchy(matrix);
  if (delanchy) return delanchy;
  throw new Error(
    "Format de fichier non reconnu — attendu : tarif Delanchy (tranches « 0 à 100kg » + une ligne par département) ou tarif Antoine (section « Distribution »).",
  );
}

/**
 * Valeurs des lignes annexes à l'application : une ligne en % importée à 0
 * reprend la valeur de la grille EXISTANTE (même id : gazole, go, gnr…), sinon
 * celle du modèle pré-rempli du transporteur ; idem pour une ligne fixe sans
 * montant lu. Les montants LUS dans le fichier gardent la priorité.
 */
export function mergeExtraValues(
  imported: TariffExtraLine[],
  existing: CarrierTariff | null,
  carrierCode: string,
): TariffExtraLine[] {
  const template = tariffTemplateFor(carrierCode);
  const byId = (lines: TariffExtraLine[] | undefined, id: string) => lines?.find((l) => l.id === id);
  return imported.map((line) => {
    if (line.value > 0) return line;
    const prev = byId(existing?.extras, line.id) ?? byId(template?.extras, line.id);
    return prev && prev.kind === line.kind && prev.value > 0 ? { ...line, value: prev.value } : line;
  });
}

/**
 * Code FAMILLE d'un format importé : la grille est enregistrée UNE SEULE fois
 * sous ce code, et tous les transporteurs de la famille y retombent au calcul
 * (resolveCarrierTariff — FT54/FT86/FT94… → DELANCHY, *ANTOINE* → ANTOINE).
 */
export function familyCodeForFormat(format: TariffImportFormat): string {
  return format === "delanchy" ? "DELANCHY" : "ANTOINE";
}
