/**
 * Attribution des AVOIRS (CreditNotes SAP) aux factures ouvertes — affichage
 * « Soldes par facture » de l'encours.
 *
 * CONTEXTE FINANCIER (à lire avant de toucher à cette logique)
 * ------------------------------------------------------------
 * L'encours d'un client est calculé à partir de DEUX sources SAP :
 *   1. les factures OUVERTES (bost_Open) → solde brut = DocTotal − PaidToDate ;
 *   2. le solde du compte tiers (CurrentAccountBalance) → met l'encours au NET
 *      (cf. lib/encours-net.ts) ; la différence brut − net est l'« encaissé »
 *      (règlements + avoirs NON encore affectés), présentée en UNE ligne globale.
 *
 * Un avoir (CreditNote) impacte DÉJÀ l'une de ces deux sources :
 *   - avoir RÉCONCILIÉ contre sa facture → augmente le PaidToDate de la facture
 *     (le solde brut affiché est déjà net de cet avoir ; si l'avoir solde la
 *     facture, elle passe bost_Closed et n'apparaît plus) ;
 *   - avoir NON réconcilié (ouvert) → crédite le compte tiers → baisse le
 *     CurrentAccountBalance → il est DÉJÀ compté dans l'« encaissé » global.
 *
 * ⇒ Soustraire bêtement le montant des avoirs une seconde fois DOUBLE-COMPTERAIT.
 *
 * Cette fonction ne CHANGE donc PAS le net total. Elle se contente de SORTIR du
 * sac global « encaissé » la part qui s'explique par des avoirs rattachables à
 * une facture encore ouverte, et de la RÉ-IMPUTER visuellement sous cette
 * facture. Conséquences :
 *   - `encaisse` (paiements + avoirs non affectés) DIMINUE du montant ré-imputé ;
 *   - chaque facture porte ses avoirs et un « net facture » = solde − avoirs
 *     attribués (borné à 0) ;
 *   - le total client (brut − encaissé − avoirs attribués) est INCHANGÉ.
 *
 * RÈGLE D'ATTRIBUTION (lien avoir → facture)
 * ------------------------------------------
 * On n'utilise QUE le lien FIABLE fourni par SAP : sur chaque ligne d'avoir,
 * `BaseType === 13` (Invoice) + `BaseEntry` = DocEntry de la facture d'origine.
 * Un avoir est rattaché à une facture SEULEMENT si cette facture est encore
 * OUVERTE dans le périmètre. Les avoirs sans lien exploitable, ou pointant vers
 * une facture déjà soldée/hors périmètre, restent dans « avoirs non affectés ».
 *
 * GARDE-FOU anti double-comptage : le montant d'avoirs ré-imputable à un client
 * est PLAFONNÉ par son « encaissé » global (brut − net). On ne ré-impute jamais
 * plus que ce que la mise au net a effectivement retiré — sinon on ferait
 * descendre le net en dessous du vrai solde du compte tiers. Le plafond est
 * réparti facture par facture (ordre stable), et borné par le solde de chaque
 * facture (on n'affiche jamais un avoir > solde de sa facture).
 *
 * Fonction PURE (testable). Montants en euros (HT côté affichage encours = TTC,
 * cf. route : balance = DocTotal − PaidToDate, donc TTC ; les avoirs reçus sont
 * eux aussi des montants TTC SAP — cohérent).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Un avoir SAP, ramené au strict nécessaire pour l'attribution. */
export interface CreditNoteRef {
  docEntry: number;
  docNum: number | null;
  docDate: string | null;
  /** Montant TTC de l'avoir (positif). */
  amount: number;
  /** DocEntry de la facture d'origine (BaseType=13), si traçable. */
  baseInvoiceEntry: number | null;
}

/** Un avoir attribué à une facture (pour l'UI). */
export interface AttributedCreditNote {
  docEntry: number;
  docNum: number | null;
  docDate: string | null;
  /** Montant attribué à CETTE facture (positif, ≤ avoir, ≤ solde facture). */
  amount: number;
}

/** Facture ouverte minimale (entrée). */
export interface OpenInvoiceRef {
  docEntry: number;
  /** Solde brut dû (DocTotal − PaidToDate). */
  balance: number;
}

/** Résultat de l'attribution pour un client. */
export interface AvoirAttribution {
  /** Avoirs attribués, indexés par DocEntry de facture. */
  byInvoice: Map<number, AttributedCreditNote[]>;
  /** Total des avoirs effectivement attribués (sorti du sac « encaissé »). */
  attributedTotal: number;
  /**
   * Avoirs NON rattachables (lien absent, facture soldée/hors périmètre, ou
   * au-delà du plafond anti double-comptage). Restent dans l'encaissé global
   * mais sont remontés à part pour pouvoir afficher une ligne « avoirs non
   * affectés » distincte des paiements.
   */
  unattributedTotal: number;
}

/**
 * Attribue les avoirs d'UN client à ses factures ouvertes.
 *
 * @param invoices       factures ouvertes du client (solde brut par facture)
 * @param creditNotes    avoirs du client (montant positif + lien éventuel)
 * @param encaisse       déduction globale brut − net (plafond anti double-comptage)
 */
export function attributeAvoirs(
  invoices: OpenInvoiceRef[],
  creditNotes: CreditNoteRef[],
  encaisse: number,
): AvoirAttribution {
  const byInvoice = new Map<number, AttributedCreditNote[]>();
  const balanceLeft = new Map<number, number>();
  for (const inv of invoices) balanceLeft.set(inv.docEntry, inv.balance);

  // Plafond global : on ne ré-impute jamais plus que ce que la mise au net a
  // effectivement retiré (sinon le net descendrait sous le solde compte tiers).
  let budget = Math.max(0, round2(encaisse));
  let attributedTotal = 0;
  let unattributedTotal = 0;

  // Ordre stable & déterministe : avoir le plus ANCIEN d'abord (DocEntry croît
  // avec le temps dans SAP). Garantit un affichage reproductible.
  const sorted = [...creditNotes].sort((a, b) => a.docEntry - b.docEntry);

  for (const cn of sorted) {
    const amount = round2(Math.abs(cn.amount));
    if (amount <= 0.01) continue;

    const targetEntry = cn.baseInvoiceEntry;
    const invBalance = targetEntry != null ? balanceLeft.get(targetEntry) : undefined;

    // Rattachable seulement si : lien présent + facture encore ouverte + il
    // reste du solde sur la facture + il reste du budget anti double-comptage.
    if (targetEntry == null || invBalance == null || invBalance <= 0.01 || budget <= 0.01) {
      unattributedTotal = round2(unattributedTotal + amount);
      continue;
    }

    const applied = round2(Math.min(amount, invBalance, budget));
    if (applied <= 0.01) {
      unattributedTotal = round2(unattributedTotal + amount);
      continue;
    }

    const list = byInvoice.get(targetEntry) ?? [];
    list.push({ docEntry: cn.docEntry, docNum: cn.docNum, docDate: cn.docDate, amount: applied });
    byInvoice.set(targetEntry, list);

    balanceLeft.set(targetEntry, round2(invBalance - applied));
    budget = round2(budget - applied);
    attributedTotal = round2(attributedTotal + applied);

    // Reliquat d'avoir non absorbé (avoir > solde facture, ou > budget) → reste
    // dans le sac global (il aura impacté une autre facture ou un règlement).
    const leftover = round2(amount - applied);
    if (leftover > 0.01) unattributedTotal = round2(unattributedTotal + leftover);
  }

  return { byInvoice, attributedTotal, unattributedTotal };
}
