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
import { attributeAvoirs, type CreditNoteRef } from "../encours-avoirs";
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
  /** true = facture de SERVICE (aucune ligne produit : prestation/location/
   *  déchet) → relance à retraiter et personnaliser manuellement. false/absent =
   *  facture d'ARTICLE (négoce classique) → relance automatique. */
  isService?: boolean;
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
  /** Somme des soldes des factures ouvertes (avant déduction des encaissements). */
  openTotal: number;
  /** Encaissements / avoirs reçus mais non encore affectés (à déduire). */
  encaissementsNonAffectes: number;
  /** Principal NET restant dû (= openTotal − encaissements, ou solde compte tiers). */
  principal: number;
  penalites: number;
  ifr: number;
  /** Nombre de factures ENCORE DUES après imputation = nombre de positions
   *  touchées par l'indemnité forfaitaire de 40 € (ifr = nbFacturesDues × ifrParFacture). */
  nbFacturesDues: number;
  /** Montant forfaitaire unitaire appliqué (€, = params.ifrParFacture ; 40 par défaut). */
  ifrParFacture: number;
  /** Nombre de factures de SERVICE dans la relance (à personnaliser à la main). */
  nbServiceInvoices: number;
  /** true = TOUTES les factures de la relance sont des factures de service →
   *  l'envoi automatique doit être bloqué (courrier à rédiger manuellement). */
  serviceOnly: boolean;
  total: number;
}

/** Un avoir en faveur du client, non imputé, prêt à afficher dans le courrier. */
export interface RelanceAvoirEnFaveur {
  /** N° d'avoir affichable (DocNum, sinon DocEntry). */
  num: string;
  /** Date FR (« jj/mm/aaaa »), « — » si absente. */
  date: string;
  /** Montant de l'avoir en faveur (positif). */
  montant: number;
}

export interface RelanceContext {
  /** Champs scalaires {{Champ}} → valeur formatée FR, prêts à fusionner. */
  fields: Record<string, string>;
  /** Factures incluses (alimentent {{TableauFactures}}). */
  invoices: RelanceInvoice[];
  /** Facture de référence (la plus en retard) — utilisée par R0/R1 (mono-facture). */
  primary: RelanceInvoice;
  totals: RelanceTotals;
  /** Avoir IMPUTÉ (positif) par docEntry de facture — colonne « Avoir » du tableau. */
  avoirsByInvoice: Map<number, number>;
  /** Avoirs EN FAVEUR du client, non imputés (à déduire d'une facture ultérieure). */
  avoirsNonImputes: RelanceAvoirEnFaveur[];
  /** Total des avoirs en faveur non imputés. */
  avoirsNonImputesTotal: number;
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

/**
 * Pénalités de retard d'UNE facture (0 si taux non paramétré).
 *
 * Convention habituelle (créances commerciales) : intérêts = principal × taux
 * ANNUEL × (jours de retard / 365) — le taux annuel est donc appliqué AU PRORATA
 * du délai réel de paiement de CETTE facture, jamais en année pleine ni sur un
 * total agrégé. `annualRate` = taux légal EN VIGUEUR × multiplicateur CGV
 * (« 5 × le taux légal »). Chaque facture a son propre `overdueDays` : le total
 * des pénalités est la SOMME de ces montants par facture (cf. buildRelanceContext),
 * jamais un calcul unique sur le principal cumulé.
 */
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
  /**
   * Solde net du compte tiers (SAP CurrentAccountBalance) — net de TOUS les
   * encaissements/avoirs, rapprochés ou non (= SOLDE du grand livre). Fourni pour
   * les relances multi-factures (compte) afin de soustraire l'encaissé non
   * affecté. Absent (mono-facture R0/R1) → on s'en tient au solde de la facture.
   */
  currentAccountBalance?: number | null;
  /**
   * Avoirs (CreditNotes SAP) du client, avec lien facture d'origine si traçable.
   * Fournis pour les relances multi-factures : permet d'afficher, par facture,
   * l'avoir IMPUTÉ, et de lister à part les avoirs EN FAVEUR non imputés. Absent
   * → aucun avoir n'est mentionné (compatibilité : rendu strictement inchangé).
   */
  creditNotes?: CreditNoteRef[] | null;
}): RelanceContext {
  const { client, invoices, params, dateMiseEnDemeure } = args;
  if (invoices.length === 0) throw new Error("Aucune facture à relancer.");

  const primary = pickPrimary(invoices);
  const nbFactures = invoices.length;

  // Total des factures ouvertes, puis NET du compte : on soustrait les
  // encaissements/avoirs non encore affectés (ne jamais relancer du déjà payé).
  const openTotal = round2(invoices.reduce((s, i) => s + i.balance, 0));
  const cab = args.currentAccountBalance;
  const principal = cab == null ? openTotal : round2(Math.max(0, Math.min(openTotal, cab)));
  const encaissementsNonAffectes = round2(openTotal - principal);

  // Ventilation des avoirs (même logique que l'encours : lien BaseType=13,
  // plafond anti double-comptage = encaissements non affectés). Les avoirs
  // imputés s'affichent par facture ; les avoirs « en faveur » (non imputés) sont
  // listés à part et mentionnés dans le courrier.
  const avoirAttr =
    args.creditNotes && args.creditNotes.length
      ? attributeAvoirs(
          invoices.map((i) => ({ docEntry: i.docEntry, balance: i.balance })),
          args.creditNotes,
          encaissementsNonAffectes,
        )
      : null;
  const avoirsByInvoice = new Map<number, number>();
  if (avoirAttr) {
    for (const [entry, list] of avoirAttr.byInvoice) {
      avoirsByInvoice.set(entry, round2(list.reduce((s, a) => s + a.amount, 0)));
    }
  }
  const avoirsNonImputes: RelanceAvoirEnFaveur[] = avoirAttr
    ? avoirAttr.unattributed.map((a) => ({
        num: a.docNum != null ? String(a.docNum) : String(a.docEntry),
        date: formatDateFR(a.docDate ? new Date(a.docDate) : null),
        montant: round2(a.amount),
      }))
    : [];
  const avoirsNonImputesTotal = round2(avoirsNonImputes.reduce((s, a) => s + a.montant, 0));

  // Audit 2026-08-13 (#7) : pénalités et IFR ne doivent porter que sur le NET
  // réellement dû. Avant, les pénalités étaient sommées sur le solde BRUT de
  // CHAQUE facture et l'IFR = ifrParFacture × nombre TOTAL de factures ouvertes
  // (y compris celles soldées par un règlement/avoir non encore lettré) → dû
  // surévalué dès qu'un paiement traînait non affecté. Correctif : on IMPUTE les
  // encaissements non affectés (= openTotal − principal, part NON déjà attribuée
  // à une facture via un avoir) sur les factures, d'abord les plus anciennes ;
  // pénalités et IFR ne comptent alors que les factures encore dues après
  // imputation. Somme des nets ≡ principal → cohérent avec le total affiché.
  // ⚠️ judgmentCall (règle d'imputation) : l'ordre « la plus ancienne d'abord »
  // (overdueDays décroissant) est un choix conservateur — solder d'abord les
  // créances les plus vieilles maximise les pénalités restantes. Une imputation
  // « la plus récente d'abord » minorerait pénalités et IFR. À trancher par la
  // direction / le conseil (clause CGV).
  const avoirsAttribuesTotal = round2([...avoirsByInvoice.values()].reduce((s, v) => s + v, 0));
  let resteAImputer = round2(Math.max(0, encaissementsNonAffectes - avoirsAttribuesTotal));
  const netDuParFacture = new Map<number, number>();
  // Factures des plus anciennes (les plus en retard) aux plus récentes.
  const parAnciennete = [...invoices].sort((a, b) => b.overdueDays - a.overdueDays);
  for (const inv of parAnciennete) {
    // Net de départ = solde brut − avoir déjà imputé à CETTE facture.
    let net = round2(Math.max(0, inv.balance - (avoirsByInvoice.get(inv.docEntry) ?? 0)));
    if (resteAImputer > 0 && net > 0) {
      const impute = Math.min(resteAImputer, net);
      net = round2(net - impute);
      resteAImputer = round2(resteAImputer - impute);
    }
    netDuParFacture.set(inv.docEntry, net);
  }
  const penalites = round2(
    invoices.reduce(
      (s, i) => s + computePenalty(netDuParFacture.get(i.docEntry) ?? 0, i.overdueDays, params.penaliteTauxAnnuel),
      0,
    ),
  );
  // IFR = ifrParFacture × nombre de factures ENCORE DUES après imputation (et non
  // le nombre total de factures ouvertes).
  const nbFacturesDues = invoices.reduce(
    (n, i) => n + ((netDuParFacture.get(i.docEntry) ?? 0) > 0.005 ? 1 : 0),
    0,
  );
  const ifr = round2(params.ifrParFacture * nbFacturesDues);
  const total = round2(principal + penalites + ifr);

  // Séparation SERVICE / ARTICLE : les relances de factures de service doivent
  // être retraitées à la main. On compte celles présentes dans la relance et on
  // signale le cas « 100 % service » (l'appelant bloque alors l'envoi auto).
  const nbServiceInvoices = invoices.reduce((n, i) => n + (i.isService ? 1 : 0), 0);
  const serviceOnly = nbServiceInvoices > 0 && nbServiceInvoices === invoices.length;

  const hasDeduction = encaissementsNonAffectes > 0.005;

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
    TotalFactures: formatEUR(openTotal),
    EncaissementsNonAffectes: formatEUR(encaissementsNonAffectes),
    // Lignes optionnelles (vides si rien à déduire → masquées au rendu).
    LigneTotalFactures: hasDeduction ? `Total des factures échues : ${formatEUR(openTotal)}` : "",
    LigneDeduction: hasDeduction ? `Règlements et avoirs reçus non affectés : -${formatEUR(encaissementsNonAffectes)}` : "",
    JoursRetard: String(Math.max(0, primary.overdueDays)),
    TauxPenalites: params.tauxPenalitesLabel,
    MontantPenalites: formatEUR(penalites),
    IndemniteForfaitaire: formatEUR(ifr),
    // Détail de l'indemnité forfaitaire : nombre de factures concernées × 40 €.
    NbFacturesIFR: String(nbFacturesDues),
    IfrParFacture: formatEUR(params.ifrParFacture),
    // Libellé « (N facture(s) × 40,00 €) » — TOUJOURS le nombre de positions
    // touchées par le forfait (demande direction : le marquer dans le courrier).
    DetailIFR: `(${nbFacturesDues} facture${nbFacturesDues > 1 ? "s" : ""} × ${formatEUR(params.ifrParFacture)})`,
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
    // Mention (facultative) des avoirs en faveur du client non imputés. Vide si
    // aucun → le bloc de paragraphe est supprimé au rendu (lignes vides filtrées).
    ParagrapheAvoirsFaveur:
      avoirsNonImputesTotal > 0.005
        ? `Nous vous signalons par ailleurs que votre compte enregistre à ce jour des avoirs en votre faveur, non encore imputés, pour un montant total de ${formatEUR(avoirsNonImputesTotal)}` +
          (avoirsNonImputes.length ? ` (avoir${avoirsNonImputes.length > 1 ? "s" : ""} n° ${avoirsNonImputes.map((a) => a.num).join(", ")})` : "") +
          `. Ceux-ci viendront en déduction d'une prochaine facture.`
        : "",
  };

  return {
    fields,
    invoices,
    primary,
    totals: { nbFactures, openTotal, encaissementsNonAffectes, principal, penalites, ifr, nbFacturesDues, ifrParFacture: params.ifrParFacture, nbServiceInvoices, serviceOnly, total },
    avoirsByInvoice,
    avoirsNonImputes,
    avoirsNonImputesTotal,
  };
}

/**
 * Lignes du tableau multi-factures (pour le rendu HTML / texte).
 *
 * `montant` = solde BRUT de la facture (jamais le net). Si `avoirsByInvoice` est
 * fourni ET qu'au moins une facture porte un avoir imputé, chaque ligne expose
 * aussi `avoir` (montant imputé, ou « — ») et `net` (brut − avoir) : le tableau
 * peut alors afficher les colonnes « Avoir imputé » / « Net dû ». Sans avoir, ces
 * champs restent absents et le tableau garde ses 4 colonnes d'origine.
 */
export function invoiceRows(
  invoices: RelanceInvoice[],
  avoirsByInvoice?: Map<number, number>,
): {
  num: string;
  date: string;
  echeance: string;
  montant: string;
  avoir?: string;
  net?: string;
}[] {
  const hasAvoirs = !!avoirsByInvoice && [...avoirsByInvoice.values()].some((v) => v > 0.005);
  return invoices.map((inv) => {
    const base = {
      num: invoiceLabel(inv),
      date: formatDateFR(inv.docDate),
      echeance: formatDateFR(inv.dueDate),
      montant: formatEUR(inv.balance),
    };
    if (!hasAvoirs) return base;
    const av = avoirsByInvoice!.get(inv.docEntry) ?? 0;
    const net = round2(Math.max(0, inv.balance - av));
    return { ...base, avoir: av > 0.005 ? `-${formatEUR(av)}` : "—", net: formatEUR(net) };
  });
}
