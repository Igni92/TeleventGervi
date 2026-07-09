/**
 * Coût de transport & MARGE NETTE TRANSPORT — modèle de calcul PARTAGÉ.
 *
 * Principe métier (juillet 2026) :
 *   • La direction saisit la STRUCTURE DE COÛTS liés à la livraison en propre
 *     (amortissement du véhicule sur X ans, entretien, casse, salaire livreur,
 *     tout coût rapportable à la livraison directe). Le transporteur, lui,
 *     notifie ses dépenses réelles PHOTO À L'APPUI (cf. TransportExpense) —
 *     pièces justificatives qui informent la direction.
 *   • On annualise chaque ligne de coût, on divise par le NOMBRE DE LIVRAISONS
 *     (→ coût par livraison) et par les KILOS livrés (→ « prix position »,
 *     c.-à-d. le coût de transport au kilo). Hebdomadaire / mensuel ne sont
 *     donnés qu'à TITRE INDICATIF (annuel ÷ 52 / ÷ 12) — la valeur ANNUELLE
 *     fait foi (elle est reportée dans la fiche client).
 *   • La MARGE NETTE TRANSPORT d'une vente = marge brute − prix position × kg.
 *     Elle ne concerne QUE les livraisons Île-de-France livrées en propre :
 *     l'EXPORT est à 0 (le transport est payé par le client) ; le CHR est
 *     calculé de la même façon que les autres livraisons IDF.
 *
 * Module volontairement PUR (aucun import serveur / prisma) : importable côté
 * serveur (API, fiche client) ET client (console, pilotage, page transport),
 * pour que tous les écrans partagent EXACTEMENT le même calcul. L'I/O
 * (AppSetting) vit dans lib/transportCostStore.ts.
 */

/* ─────────────────────────── Modèle de coûts (direction) ────────────────── */

/** Familles de coût rapportables à la livraison directe. */
export type TransportCostKind = "amortissement" | "entretien" | "casse" | "salaire" | "autre";

export const TRANSPORT_COST_KINDS: TransportCostKind[] = ["amortissement", "entretien", "casse", "salaire", "autre"];

export const COST_KIND_LABELS: Record<TransportCostKind, string> = {
  amortissement: "Amortissement",
  entretien: "Entretien",
  casse: "Casse",
  salaire: "Salaire livreur",
  autre: "Autre",
};

/** Périodicité du montant saisi (annualisé pour le calcul). */
export type CostPeriod = "weekly" | "monthly" | "annual";

export const PERIOD_LABELS: Record<CostPeriod, string> = {
  weekly: "hebdo",
  monthly: "mensuel",
  annual: "annuel",
};

/** Une ligne de coût saisie par la direction. Pour un amortissement, `amount`
 *  est l'INVESTISSEMENT TOTAL et `amortYears` le nombre d'années : la ligne est
 *  alors annualisée en `amount / amortYears` (la périodicité est ignorée). */
export interface TransportCostLine {
  id: string;
  label: string;
  kind: TransportCostKind;
  /** € — montant de la période (ou investissement total si amortissement). */
  amount: number;
  /** Périodicité du montant (ignorée si `amortYears` > 0). */
  period: CostPeriod;
  /** Amortissement : nombre d'années d'étalement (> 0). */
  amortYears?: number | null;
}

export interface TransportCostModel {
  costs: TransportCostLine[];
  /** Nombre de livraisons IDF / an (référence de gestion). */
  deliveriesPerYear: number;
  /** Kilos livrés IDF / an (référence de gestion). */
  kgPerYear: number;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export const EMPTY_TRANSPORT_MODEL: TransportCostModel = {
  costs: [],
  deliveriesPerYear: 0,
  kgPerYear: 0,
  updatedAt: null,
  updatedBy: null,
};

/* ─────────────────────────── Calcul (pur) ───────────────────────────────── */

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};

/** Montant ANNUALISÉ d'une ligne de coût (0 si montant nul/négatif). */
export function annualizeLine(line: Pick<TransportCostLine, "kind" | "amount" | "period" | "amortYears">): number {
  const amt = n(line.amount);
  if (amt <= 0) return 0;
  if (line.kind === "amortissement" && n(line.amortYears) > 0) {
    return amt / n(line.amortYears);
  }
  switch (line.period) {
    case "weekly": return amt * 52;
    case "monthly": return amt * 12;
    default: return amt;
  }
}

export interface TransportCostMetrics {
  /** Coût total ANNUEL (fait foi). */
  annualCost: number;
  /** Indicatif (annuel ÷ 12). */
  monthlyCost: number;
  /** Indicatif (annuel ÷ 52). */
  weeklyCost: number;
  deliveriesPerYear: number;
  kgPerYear: number;
  /** Coût par livraison = annuel ÷ nb livraisons. */
  costPerDelivery: number;
  /** « PRIX POSITION » : coût de transport au kilo = annuel ÷ kg livrés. */
  prixPositionPerKg: number;
  /** Coût annualisé cumulé par famille (pour la répartition). */
  byKind: Record<TransportCostKind, number>;
}

/** Agrège le modèle de coûts en métriques de gestion (dont le prix position). */
export function computeTransportMetrics(model: TransportCostModel | null | undefined): TransportCostMetrics {
  const byKind: Record<TransportCostKind, number> = {
    amortissement: 0, entretien: 0, casse: 0, salaire: 0, autre: 0,
  };
  let annualCost = 0;
  for (const l of model?.costs ?? []) {
    const a = annualizeLine(l);
    annualCost += a;
    byKind[l.kind] = (byKind[l.kind] ?? 0) + a;
  }
  const deliveriesPerYear = Math.max(0, n(model?.deliveriesPerYear));
  const kgPerYear = Math.max(0, n(model?.kgPerYear));
  return {
    annualCost,
    monthlyCost: annualCost / 12,
    weeklyCost: annualCost / 52,
    deliveriesPerYear,
    kgPerYear,
    costPerDelivery: deliveriesPerYear > 0 ? annualCost / deliveriesPerYear : 0,
    prixPositionPerKg: kgPerYear > 0 ? annualCost / kgPerYear : 0,
    byKind,
  };
}

/* ───────────────────── Application aux ventes (marge nette) ───────────────
 * La règle IDF : l'EXPORT ne supporte pas le transport (payé par le client →
 * 0). Toutes les autres livraisons en propre (CHR, GMS et divers IDF) sont
 * frappées du même prix position au kilo. On raisonne sur le segment client
 * (Client.type) : "EXPORT" | "CHR" | "GMS" | null. */

/** Vrai si ce segment supporte le coût de transport (⇔ livré en propre en IDF).
 *  Seul l'EXPORT en est exonéré (transport à la charge du client). */
export function typeSupportsTransport(type: string | null | undefined): boolean {
  return (type ?? "").trim().toUpperCase() !== "EXPORT";
}

/** Prix position applicable à un segment client : 0 pour l'EXPORT, sinon le
 *  coût au kilo (CHR = même calcul que les autres IDF). */
export function transportPerKgForType(prixPositionPerKg: number, type: string | null | undefined): number {
  return typeSupportsTransport(type) ? Math.max(0, n(prixPositionPerKg)) : 0;
}

/** Coût de transport d'une vente = prix position (selon segment) × kg. */
export function transportCostForSale(prixPositionPerKg: number, kg: number, type: string | null | undefined): number {
  return transportPerKgForType(prixPositionPerKg, type) * Math.max(0, n(kg));
}

/** Marge NETTE TRANSPORT d'une vente = marge brute − coût de transport. */
export function netTransportMargin(
  grossMargin: number,
  kg: number,
  type: string | null | undefined,
  prixPositionPerKg: number,
): number {
  return n(grossMargin) - transportCostForSale(prixPositionPerKg, kg, type);
}

/* ─────────────────── Dépenses transporteur (justificatifs) ────────────────
 * Le transporteur notifie ses dépenses réelles avec photo à l'appui. Elles
 * documentent/alimentent la structure de coûts de la direction. Photos en
 * data-URL (même convention que l'inventaire : petit JSON dans AppSetting). */

export interface TransportExpensePhoto {
  id: string;
  /** data:image/jpeg;base64,… */
  dataUrl: string;
  bytes: number;
}

export interface TransportExpense {
  id: string;
  label: string;
  /** € dépensés. */
  amount: number;
  category: TransportCostKind;
  /** Date de la dépense (ISO, jour). */
  date: string;
  note?: string | null;
  photos: TransportExpensePhoto[];
  createdBy?: string | null;
  createdAt: string;
  /** Présent uniquement dans les réponses de LISTE (photos retirées du payload). */
  nbPhotos?: number;
}

/* Plafonds photos (UI + revalidation serveur), calqués sur l'inventaire. */
export const MAX_EXPENSE_PHOTOS = 4;
const MAX_PHOTO_BYTES = 240 * 1024;
const MAX_TOTAL_PHOTO_BYTES = 720 * 1024;

/** Poids décodé (octets) d'une data-URL base64. */
function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : "";
  return Math.floor((b64.length * 3) / 4);
}

/** Ne garde que les images data-URL valides, plafonne nombre et taille. */
export function sanitizeExpensePhotos(raw: unknown, idPrefix = "p"): TransportExpensePhoto[] {
  if (!Array.isArray(raw)) return [];
  const out: TransportExpensePhoto[] = [];
  let total = 0;
  for (const item of raw) {
    if (out.length >= MAX_EXPENSE_PHOTOS) break;
    const p = item as Partial<TransportExpensePhoto> | null;
    const dataUrl = typeof p?.dataUrl === "string" ? p.dataUrl : "";
    if (!/^data:image\/(jpeg|webp|png);base64,/.test(dataUrl)) continue;
    const bytes = dataUrlBytes(dataUrl);
    if (bytes <= 0 || bytes > MAX_PHOTO_BYTES) continue;
    if (total + bytes > MAX_TOTAL_PHOTO_BYTES) break;
    total += bytes;
    out.push({
      id: typeof p?.id === "string" && p.id ? p.id.slice(0, 40) : `${idPrefix}-${out.length}`,
      dataUrl,
      bytes,
    });
  }
  return out;
}

/* ─────────────────────────── Sanitizers (I/O) ───────────────────────────── */

function coerceKind(v: unknown): TransportCostKind {
  const s = String(v ?? "").toLowerCase();
  return (TRANSPORT_COST_KINDS as string[]).includes(s) ? (s as TransportCostKind) : "autre";
}

function coercePeriod(v: unknown): CostPeriod {
  const s = String(v ?? "").toLowerCase();
  return s === "weekly" || s === "monthly" || s === "annual" ? (s as CostPeriod) : "annual";
}

/** Normalise un modèle de coûts entrant (PUT). Ne jette jamais. */
export function sanitizeTransportModel(raw: unknown): TransportCostModel {
  const o = (raw ?? {}) as Record<string, unknown>;
  const rawCosts = Array.isArray(o.costs) ? o.costs : [];
  const costs: TransportCostLine[] = rawCosts.slice(0, 50).map((c, i) => {
    const l = (c ?? {}) as Record<string, unknown>;
    const kind = coerceKind(l.kind);
    const amortYears = kind === "amortissement" && n(l.amortYears) > 0
      ? Math.min(40, Math.round(n(l.amortYears) * 100) / 100)
      : null;
    return {
      id: typeof l.id === "string" && l.id ? l.id.slice(0, 40) : `c-${i}`,
      label: typeof l.label === "string" ? l.label.trim().slice(0, 80) : "",
      kind,
      amount: Math.max(0, Math.round(n(l.amount) * 100) / 100),
      period: coercePeriod(l.period),
      amortYears,
    };
  });
  return {
    costs,
    deliveriesPerYear: Math.max(0, Math.round(n(o.deliveriesPerYear))),
    kgPerYear: Math.max(0, Math.round(n(o.kgPerYear) * 100) / 100),
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : null,
    updatedBy: typeof o.updatedBy === "string" ? o.updatedBy.slice(0, 120) : null,
  };
}

/** Normalise une dépense transporteur entrante (POST). Ne jette jamais. */
export function sanitizeTransportExpense(
  raw: unknown,
  id: string,
  nowIso: string,
  createdBy?: string | null,
): TransportExpense {
  const o = (raw ?? {}) as Record<string, unknown>;
  const dateStr = typeof o.date === "string" && o.date.trim() ? o.date.trim().slice(0, 10) : nowIso.slice(0, 10);
  return {
    id,
    label: typeof o.label === "string" ? o.label.trim().slice(0, 120) : "",
    amount: Math.max(0, Math.round(n(o.amount) * 100) / 100),
    category: coerceKind(o.category),
    date: dateStr,
    note: typeof o.note === "string" && o.note.trim() ? o.note.trim().slice(0, 500) : null,
    photos: sanitizeExpensePhotos(o.photos, id),
    createdBy: createdBy ?? (typeof o.createdBy === "string" ? o.createdBy.slice(0, 120) : null),
    createdAt: nowIso,
  };
}
