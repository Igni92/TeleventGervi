/**
 * Échelle de relance des encours clients — NT-2026-RC-01 (§2).
 *
 * Six niveaux d'escalade, du rappel préventif (R0) au dernier avis avant
 * contentieux (R5). Les délais sont exprimés EN JOURS PAR RAPPORT À L'ÉCHÉANCE
 * (négatif = avant l'échéance). Ce sont des **valeurs par défaut paramétrables**
 * (cf. la note) — on les centralise ici pour qu'un seul endroit fasse foi.
 *
 * L'escalade est suspendue dès l'encaissement (facture lettrée → solde nul, donc
 * exclue côté SAP) et gelée en cas de litige déclaré (cf. /api/relance).
 */

export type RelanceCode = "R0" | "R1" | "R2" | "R3" | "R4" | "R5";

export interface RelanceLevel {
  code: RelanceCode;
  /** Libellé métier (ex. « 1re relance »). */
  libelle: string;
  /** Déclenchement en jours par rapport à l'échéance (négatif = avant). */
  triggerDays: number;
  /** Libellé du déclenchement, pour l'affichage (ex. « J+8 »). */
  declenchement: string;
  /** Canal recommandé (Email, Email + appel, LRAR…). */
  canal: string;
  /** Tonalité du courrier. */
  tonalite: string;
  /**
   * Courrier mono-facture (R0/R1) ou multi-factures (R2+). En multi, le corps
   * insère le bloc {{TableauFactures}} et agrège les totaux.
   */
  multiInvoice: boolean;
  /** Le courrier comporte le décompte pénalités / IFR / total dû (R3+). */
  showBreakdown: boolean;
}

/** Les 6 niveaux, ordonnés du moins au plus ferme. */
export const RELANCE_LEVELS: readonly RelanceLevel[] = [
  { code: "R0", libelle: "Relance préventive", triggerDays: -3, declenchement: "J-3 (avant échéance)", canal: "Email", tonalite: "Courtois", multiInvoice: false, showBreakdown: false },
  { code: "R1", libelle: "1re relance", triggerDays: 8, declenchement: "J+8", canal: "Email", tonalite: "Courtois, ferme", multiInvoice: false, showBreakdown: false },
  { code: "R2", libelle: "2e relance", triggerDays: 21, declenchement: "J+21", canal: "Email + appel", tonalite: "Ferme", multiInvoice: true, showBreakdown: false },
  { code: "R3", libelle: "Relance avant mise en demeure", triggerDays: 35, declenchement: "J+35", canal: "Email + courrier", tonalite: "Très ferme", multiInvoice: true, showBreakdown: true },
  { code: "R4", libelle: "Mise en demeure", triggerDays: 45, declenchement: "J+45", canal: "LRAR", tonalite: "Formel (juridique)", multiInvoice: true, showBreakdown: true },
  { code: "R5", libelle: "Dernier avis avant contentieux", triggerDays: 60, declenchement: "J+60", canal: "LRAR + protocole", tonalite: "Comminatoire", multiInvoice: true, showBreakdown: true },
] as const;

const BY_CODE = new Map(RELANCE_LEVELS.map((l) => [l.code, l]));

/** Récupère un niveau par code (lève si inconnu — usage interne maîtrisé). */
export function getLevel(code: RelanceCode): RelanceLevel {
  const l = BY_CODE.get(code);
  if (!l) throw new Error(`Niveau de relance inconnu : ${code}`);
  return l;
}

/** True si la chaîne est un code de relance valide. */
export function isRelanceCode(v: unknown): v is RelanceCode {
  return typeof v === "string" && BY_CODE.has(v as RelanceCode);
}

/**
 * Niveau de relance SUGGÉRÉ pour un retard donné (jours par rapport à
 * l'échéance). Renvoie le niveau le plus élevé dont le seuil est atteint, ou
 * `null` si l'échéance est encore lointaine (avant J-3 : rien à envoyer).
 *
 *   retard ≥ 60 → R5 · ≥ 45 → R4 · ≥ 35 → R3 · ≥ 21 → R2 · ≥ 8 → R1 · ≥ -3 → R0
 */
export function suggestLevel(overdueDays: number): RelanceCode | null {
  let suggested: RelanceCode | null = null;
  for (const l of RELANCE_LEVELS) {
    if (overdueDays >= l.triggerDays) suggested = l.code;
  }
  return suggested;
}
