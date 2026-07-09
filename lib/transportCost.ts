/**
 * Coût de transport & MARGE NETTE TRANSPORT — modèle de calcul PARTAGÉ.
 *
 * Principe métier (juillet 2026) :
 *   • La direction saisit la STRUCTURE DE COÛTS de la livraison EN PROPRE
 *     (amortissement du véhicule sur X ans, entretien, casse, salaire livreur,
 *     tout coût rapportable à la livraison directe). Le transporteur, lui,
 *     notifie ses dépenses réelles PHOTO À L'APPUI (cf. TransportExpense) —
 *     pièces justificatives qui informent la direction.
 *   • On annualise chaque ligne de coût, on divise par le NOMBRE DE LIVRAISONS
 *     DIRECTES (→ coût par livraison) et par les KILOS livrés en direct
 *     (→ « prix position », c.-à-d. le coût de transport au kilo). Hebdomadaire
 *     / mensuel ne sont donnés qu'à TITRE INDICATIF (annuel ÷ 52 / ÷ 12) — la
 *     valeur ANNUELLE fait foi (elle est reportée dans la fiche client).
 *   • On se base sur le TRANSPORTEUR (U_TrspCode), pas sur le type de client :
 *     seules les livraisons EN DIRECT (transporteurs marqués « direct », flotte
 *     propre) sont valorisées au prix position. Les autres transporteurs
 *     (SCACHAP, prestataires…) portent une valeur au kilo SAISIE À LA MAIN
 *     (l'export, lui, est livré par un prestataire / enlevé par le client, donc
 *     sa valeur manuelle reste à 0 s'il n'est pas facturé).
 *   • La MARGE NETTE TRANSPORT d'une vente = marge brute − coût transport × kg.
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
  /** Nombre de livraisons EN DIRECT / an (référence de gestion). */
  deliveriesPerYear: number;
  /** Kilos livrés EN DIRECT / an (référence de gestion). */
  kgPerYear: number;
  /** Codes transporteurs (U_TrspCode) considérés « en direct » (flotte propre)
   *  → valorisés au prix position. Normalisés en MAJUSCULES. */
  directCarriers: string[];
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export const EMPTY_TRANSPORT_MODEL: TransportCostModel = {
  costs: [],
  deliveriesPerYear: 0,
  kgPerYear: 0,
  directCarriers: [],
  updatedAt: null,
  updatedBy: null,
};

/** Tarif transport SAISI À LA MAIN (€/kg) par transporteur NON direct, PROPRE À
 *  UN CLIENT (clé = code U_TrspCode en MAJUSCULES). Un client peut avoir
 *  plusieurs transporteurs possibles, chacun avec son propre prix. Stocké par
 *  client (AppSetting `transportcli:<clientId>`, cf. lib/transportCostStore). */
export type ClientCarrierPricing = Record<string, number>;

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
 * On se base sur le TRANSPORTEUR de la livraison (U_TrspCode) :
 *   • transporteur « direct » (flotte propre)  → prix position calculé ;
 *   • transporteur non direct                  → tarif €/kg saisi à la main
 *     POUR CE CLIENT et ce transporteur (un client peut en avoir plusieurs) ;
 *   • transporteur inconnu / non renseigné      → prix position SI aucun
 *     transporteur direct n'a encore été paramétré (repli « tout direct »),
 *     sinon 0 (on ne devine pas).
 * Toutes les clés transporteur sont comparées en MAJUSCULES. */

/** Normalise un code transporteur (U_TrspCode) pour comparaison. */
export function normCarrier(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

/** Le transporteur est-il « en direct » (flotte propre) ? */
export function isDirectCarrier(model: TransportCostModel | null | undefined, carrierCode: string | null | undefined): boolean {
  const c = normCarrier(carrierCode);
  if (!c) return false;
  return (model?.directCarriers ?? []).some((d) => normCarrier(d) === c);
}

/**
 * Prix de transport €/kg applicable à une livraison, selon son transporteur.
 * `clientPricing` = tarifs €/kg du CLIENT par transporteur (transportcli:<id>) ;
 * il ne sert QUE pour les transporteurs non directs.
 */
export function transportPerKgForCarrier(
  model: TransportCostModel | null | undefined,
  prixPositionPerKg: number,
  carrierCode: string | null | undefined,
  clientPricing?: ClientCarrierPricing | null,
): number {
  const pp = Math.max(0, n(prixPositionPerKg));
  const directs = model?.directCarriers ?? [];
  if (isDirectCarrier(model, carrierCode)) return pp;
  // Aucun transporteur direct paramétré → on considère la livraison directe
  // (repli pratique tant que la direction n'a pas classé ses transporteurs).
  if (directs.length === 0) return pp;
  const tarif = clientPricing?.[normCarrier(carrierCode)];
  return Math.max(0, n(tarif));
}

/** Coût de transport d'une vente = prix €/kg (selon transporteur & client) × kg. */
export function transportCostForSale(
  model: TransportCostModel | null | undefined,
  prixPositionPerKg: number,
  kg: number,
  carrierCode: string | null | undefined,
  clientPricing?: ClientCarrierPricing | null,
): number {
  return transportPerKgForCarrier(model, prixPositionPerKg, carrierCode, clientPricing) * Math.max(0, n(kg));
}

/** Marge NETTE TRANSPORT d'une vente = marge brute − coût de transport. */
export function netTransportMargin(
  model: TransportCostModel | null | undefined,
  grossMargin: number,
  kg: number,
  carrierCode: string | null | undefined,
  prixPositionPerKg: number,
  clientPricing?: ClientCarrierPricing | null,
): number {
  return n(grossMargin) - transportCostForSale(model, prixPositionPerKg, kg, carrierCode, clientPricing);
}

/** Normalise un tarif client par transporteur (clé MAJUSCULES, valeur ≥ 0). */
export function sanitizeClientPricing(raw: unknown): ClientCarrierPricing {
  const out: ClientCarrierPricing = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) {
    const code = normCarrier(k).slice(0, 60);
    const val = Math.max(0, Math.round(n(v) * 1000) / 1000);
    if (code && val > 0) out[code] = val;
  }
  return out;
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
  // Transporteurs « direct » — codes uniques, en MAJUSCULES, bornés.
  const directCarriers: string[] = [];
  const seenDirect = new Set<string>();
  if (Array.isArray(o.directCarriers)) {
    for (const c of o.directCarriers.slice(0, 100)) {
      const code = normCarrier(typeof c === "string" ? c : "").slice(0, 60);
      if (code && !seenDirect.has(code)) { seenDirect.add(code); directCarriers.push(code); }
    }
  }
  return {
    costs,
    deliveriesPerYear: Math.max(0, Math.round(n(o.deliveriesPerYear))),
    kgPerYear: Math.max(0, Math.round(n(o.kgPerYear) * 100) / 100),
    directCarriers,
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
