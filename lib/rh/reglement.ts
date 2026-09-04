/**
 * Paramètres CONVENTIONNELS du module RH — défauts IDCC 1405 (expédition/
 * exportation de fruits & légumes). Ces valeurs pilotent tout le moteur RH
 * (`lib/rh/*`). Elles sont VERSIONNÉES et ÉDITABLES en base (table RhReglement) —
 * ce fichier n'est que le socle de défaut « code », copié dans RhReglement au
 * premier démarrage et servant de repli si aucune version active n'est en base.
 *
 * Sources (2026-09) :
 *  - Accord ARTT du 7 juin 2001, IDCC 1405 (Légifrance KALITEXT000005674679) :
 *    1600 h/an ; modulation 12 mois ; max 48 h/sem & 46 h moy./12 sem ; 10 h/jour
 *    (12 h en pointe saisonnière) ; délai de prévenance 7 jours ouvrés ; contingent
 *    200 h/an ; repos compensateur par demi-journées, soldé avant fin d'année.
 *  - Majorations heures supp : régime légal (+25 % / +50 %) — défaut, à confirmer.
 *  - Congés d'ancienneté (art. 36), période d'essai, préavis : à CONFIRMER par
 *    l'expert-comptable (valeurs de départ prudentes ci-dessous, éditables).
 *
 * ⚠️ Tout ce qui touche la paie/le juridique DOIT être confirmé contre le texte
 * intégral 1405 + validé par le cabinet avant bascule paie. Voir le plan
 * /home/ubuntu/.claude/plans/rh-refonte.md et la mémoire televent-rh-refonte.
 */

export interface RhReglementParams {
  /** Identité de la version (défaut code). */
  version: string;
  label: string;

  // ── Temps de travail / annualisation (IDCC 1405, art. 8 & 26) ──
  /** Durée annuelle effective d'un temps plein (h). */
  dureeAnnuelleH: number;
  /** Base hebdo légale servant au calcul des majorations (h). */
  baseHebdoH: number;
  /** Bornes de modulation autour de la base (h) — semaine basse/haute. */
  modulationBasseH: number;
  modulationHauteH: number;
  /** Plafonds légaux/conventionnels. */
  maxHebdoH: number;         // 48
  maxMoyenne12SemH: number;  // 46
  maxJournalierH: number;    // 10
  maxJournalierPointeH: number; // 12 (pointe saisonnière)
  /** Période de modulation (mois). */
  modulationPeriodeMois: number; // 12
  /** Délai de prévenance changement d'horaire (jours ouvrés). */
  prevenanceJoursOuvres: number; // 7

  // ── Heures supplémentaires (art. 27-29) ──
  /** Contingent annuel d'heures supp (permanents / saisonniers). */
  contingentPermanentH: number; // 200
  contingentSaisonnierH: number; // à confirmer (idem 200 par défaut)
  /** Taux de majoration (fraction) — 8 premières / au-delà. */
  majoration25: number; // 0.25
  majoration50: number; // 0.50
  /** Nombre d'heures/semaine à +25 % avant de passer à +50 %. */
  seuilMaj50HebdoH: number; // 8 (au-delà de la base)

  // ── Congés payés (art. 33 & 36) ──
  /** Acquisition mensuelle (jours ouvrables). */
  cpAccrualParMois: number; // 2.5
  /** Congés d'ancienneté : jours supplémentaires par seuil d'années. À CONFIRMER. */
  cpAncienneteTranches: { ansMin: number; joursSupp: number }[];

  // ── Pauses (Code du travail L3121-16 ; convention peut prévoir plus) ──
  /** Seuil de temps de travail quotidien (minutes) déclenchant la pause obligatoire. */
  pauseSeuilMinutes: number; // 360 = 6 h
  /** Durée minimale de pause obligatoire (minutes) au-delà du seuil. */
  pauseMinObligatoire: number; // 20

  // ── Récupération / repos compensateur ──
  /** Plafond par défaut du compteur de récup (heures) — repli si non fixé par salarié. */
  recupCapDefautH: number;
  /** Le repos compensateur se pose par demi-journées. */
  recupDemiJournee: boolean;

  // ── Contrats (art. 20-22) — À CONFIRMER ──
  /** Période d'essai par catégorie (jours). */
  essaiJours: { ouvrier: number; employe: number; agentMaitrise: number; cadre: number };
  /** Préavis (jours) par catégorie, hors période d'essai. */
  preavisJours: { ouvrier: number; employe: number; agentMaitrise: number; cadre: number };
}

/**
 * DÉFAUTS IDCC 1405. Les 6 premières familles (temps/modulation/contingent) sont
 * confirmées Légifrance. Les valeurs marquées « à confirmer » sont prudentes et
 * éditables (RhReglement) — à valider par le cabinet.
 */
export const REGLEMENT_1405: RhReglementParams = {
  version: "IDCC1405-2025",
  label: "Convention 1405 — Expédition/exportation fruits & légumes",

  dureeAnnuelleH: 1600,
  baseHebdoH: 35,
  modulationBasseH: 30, // base − 5 (borne indicative, éditable)
  modulationHauteH: 40, // base + 5 (borne indicative, éditable)
  maxHebdoH: 48,
  maxMoyenne12SemH: 46,
  maxJournalierH: 10,
  maxJournalierPointeH: 12,
  modulationPeriodeMois: 12,
  prevenanceJoursOuvres: 7,

  contingentPermanentH: 200,
  contingentSaisonnierH: 200, // à confirmer
  majoration25: 0.25,
  majoration50: 0.5,
  seuilMaj50HebdoH: 8,

  cpAccrualParMois: 2.5,
  cpAncienneteTranches: [
    // Valeurs de DÉPART prudentes — À CONFIRMER (art. 36).
    { ansMin: 10, joursSupp: 1 },
    { ansMin: 15, joursSupp: 2 },
    { ansMin: 20, joursSupp: 3 },
  ],

  pauseSeuilMinutes: 360, // 6 h (Code du travail L3121-16)
  pauseMinObligatoire: 20,

  recupCapDefautH: 35,
  recupDemiJournee: true,

  essaiJours: { ouvrier: 60, employe: 60, agentMaitrise: 90, cadre: 120 }, // à confirmer
  preavisJours: { ouvrier: 30, employe: 30, agentMaitrise: 60, cadre: 90 }, // à confirmer
};

/** Champs conventionnels dont la valeur doit être VALIDÉE par le cabinet avant
 *  toute bascule paie (affichés en garde-fou dans l'écran Réglementation). */
export const REGLEMENT_A_CONFIRMER: (keyof RhReglementParams)[] = [
  "modulationBasseH", "modulationHauteH", "contingentSaisonnierH",
  "majoration25", "majoration50", "cpAncienneteTranches", "essaiJours", "preavisJours",
];
