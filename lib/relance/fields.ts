/**
 * Calcul des champs de fusion d'un courrier de relance — NT-2026-RC-01 (§4).
 *
 * Fonctions PURES (aucune IO) → entièrement testables. Les montants viennent des
 * factures SAP **ouvertes** lues en direct (DocTotal TTC, solde = DocTotal −
 * PaidToDate). Règles métier de la note :
 *   - IFR = 40 € PAR FACTURE en retard (et non une fois par client) — §7.
 *   - Pénalités = principal × taux annuel × jours_retard / 365 (taux = clause CGV,
 *     0 si non paramétré → 0,00 € : on n'invente pas de montant — §3/§7).
 *   - Total dû = principal + pénalités + IFR.
 */
import { parisStartOfDay } from "../paris-time";
import type { RelanceParams } from "./params";

/** Facture concernée par une relance (sous-ensemble des champs SAP utiles). */
export interface RelanceInvoice {
  docEntry: number;
  docNum: number | null;
  docDate: Date | null;
  dueDate: Date | null;
  /** Montant TTC de la facture (SAP DocTotal). */
  docTotal: number;
  /** Solde restant dû TTC (DocTotal − PaidToDate, après lettrage). */
  balance: number;
  /** Jours par rapport à l'échéance (négatif = avant échéance). */
  overdueDays: number;
}

/** Coordonnées du tiers pour l'en-tête / les formules. */
export interface RelanceClientInfo {
  cardCode: string;
  raisonSociale: string;
  adresse?: string | null;
  /** Civilité du contact (ex. « Monsieur »). Défaut : « Madame, Monsieur ». */
  civilite?: string | null;
  contactNom?: string | null;
}

export interface RelanceTotals {
  nbFactures: number;
  principal: number;
  penalites: number;
  ifr: number;
  total: number;
}

export interface RelanceContext {
  /** Champs scalaires {{Champ}} → valeur formatée FR, prêts à fusionner. */
  fields: Record<string, string>;
  /** Factures incluses (alimentent {{TableauFactures}}). */
  invoices: RelanceInvoice[];
  /** Facture de référence (la plus en retard) — utilisée par R0/R1 (mono-facture). */
  primary: RelanceInvoice;
  totals: RelanceTotals;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Montant en euros, typographie FR : « 4 820,00 € » (séparateur de milliers). */
export function formatEUR(n: number): string {
  const neg = n < 0;
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${neg ? "-" : ""}${grouped},${dec} €`;
}

/** Date au format FR « jj/mm/aaaa » en fuseau Europe/Paris. « — » si absente. */
export function formatDateFR(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/**
 * Jours de retard par rapport à l'échéance, calculés sur les bornes de JOUR
 * Europe/Paris (déterministe, indépendant de l'heure d'envoi). Négatif avant
 * l'échéance (ex. -3 = J-3).
 */
export function overdueDaysFor(dueDate: Date | null, ref: Date = new Date()): number {
  if (!dueDate) return 0;
  const a = parisStartOfDay(ref).getTime();
  const b = parisStartOfDay(dueDate).getTime();
  return Math.floor((a - b) / 86_400_000);
}

/** Pénalités de retard d'une facture (0 si taux non paramétré). */
export function computePenalty(balance: number, overdueDays: number, annualRate: number): number {
  if (annualRate <= 0 || overdueDays <= 0 || balance <= 0) return 0;
  return round2(balance * annualRate * (overdueDays / 365));
}

/** N° de facture affichable (DocNum si présent, sinon DocEntry). */
function invoiceLabel(inv: RelanceInvoice): string {
  return inv.docNum != null ? String(inv.docNum) : String(inv.docEntry);
}

/** Facture de référence = la plus en retard (départage : solde le plus élevé). */
function pickPrimary(invoices: RelanceInvoice[]): RelanceInvoice {
  return invoices.reduce((best, inv) =>
    inv.overdueDays > best.overdueDays ||
    (inv.overdueDays === best.overdueDays && inv.balance > best.balance)
      ? inv
      : best,
  );
}

/**
 * Construit le contexte de fusion (champs + totaux) pour un ensemble de factures.
 * Le caller choisit l'ensemble selon le niveau (mono-facture pour R0/R1, toutes
 * les factures dues pour R2+). Lève si `invoices` est vide.
 */
export function buildRelanceContext(args: {
  client: RelanceClientInfo;
  invoices: RelanceInvoice[];
  params: RelanceParams;
  dateMiseEnDemeure?: Date | null;
}): RelanceContext {
  const { client, invoices, params, dateMiseEnDemeure } = args;
  if (invoices.length === 0) throw new Error("Aucune facture à relancer.");

  const primary = pickPrimary(invoices);
  const nbFactures = invoices.length;
  const principal = round2(invoices.reduce((s, i) => s + i.balance, 0));
  const penalites = round2(
    invoices.reduce((s, i) => s + computePenalty(i.balance, i.overdueDays, params.penaliteTauxAnnuel), 0),
  );
  const ifr = round2(params.ifrParFacture * nbFactures);
  const total = round2(principal + penalites + ifr);

  const fields: Record<string, string> = {
    Civilite: client.civilite?.trim() || "Madame, Monsieur",
    ContactNom: client.contactNom?.trim() || "",
    RaisonSociale: client.raisonSociale,
    Adresse: client.adresse?.trim() || "",
    NumFacture: invoiceLabel(primary),
    DateFacture: formatDateFR(primary.docDate),
    DateEcheance: formatDateFR(primary.dueDate),
    MontantTTC: formatEUR(primary.docTotal),
    MontantRestantDu: formatEUR(principal),
    JoursRetard: String(Math.max(0, primary.overdueDays)),
    TauxPenalites: params.tauxPenalitesLabel,
    MontantPenalites: formatEUR(penalites),
    IndemniteForfaitaire: formatEUR(ifr),
    TotalDu: formatEUR(total),
    DateMiseEnDemeure: formatDateFR(dateMiseEnDemeure ?? null),
    // Clause d'ouverture R5 : évite « mise en demeure du — » si aucune R4 n'est
    // datée (R4 = LRAR souvent envoyée hors outil → date non connue ici).
    RappelMiseEnDemeure: dateMiseEnDemeure
      ? `Notre mise en demeure du ${formatDateFR(dateMiseEnDemeure)} étant demeurée sans effet,`
      : "Nos relances et notre mise en demeure étant restées sans effet,",
    DelaiReponse: params.delaiReponse,
    Signataire: params.signataire,
    FonctionSignataire: params.fonctionSignataire,
    Societe: params.societe,
  };

  return { fields, invoices, primary, totals: { nbFactures, principal, penalites, ifr, total } };
}

/** Lignes du tableau multi-factures (pour le rendu HTML / texte). */
export function invoiceRows(invoices: RelanceInvoice[]): {
  num: string;
  date: string;
  echeance: string;
  montant: string;
}[] {
  return invoices.map((inv) => ({
    num: invoiceLabel(inv),
    date: formatDateFR(inv.docDate),
    echeance: formatDateFR(inv.dueDate),
    montant: formatEUR(inv.balance),
  }));
}
