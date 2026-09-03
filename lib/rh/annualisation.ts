/**
 * Moteur ANNUALISATION (RH V2) — IDCC 1405 : 1600 h/an, modulation sur 12 mois.
 * Nouvelle capacité (absente de l'ancien moteur, qui ne raisonnait qu'à la semaine
 * puis au mois). Agrège les heures travaillées sur la période de modulation et les
 * compare au dû théorique (1600 h au prorata de la présence), pour piloter la
 * haute/basse saison, le déclenchement des heures supp à l'année, et le contingent.
 *
 * Règles (paramétrables via RhReglement) :
 *  - Dû théorique = dureeAnnuelleH, proraté par la fraction de la période couverte
 *    par un contrat actif (entrée/sortie en cours de période).
 *  - Solde de modulation = réalisé − dû-à-date (>0 = avance/haute saison ; <0 = basse).
 *  - Heures supp ANNÉE = max(0, réalisé − dû théorique) en fin de période (celles
 *    non déjà payées à la semaine restent dues) → imputées au contingent (200 h).
 */
import { REGLEMENT_1405, type RhReglementParams } from "./reglement";

export interface AnnualInput {
  /** Heures travaillées (effectives) réalisées à date, sur la période. */
  heuresRealisees: number;
  /** Fraction de la période couverte par un contrat actif (0..1). 1 = présent toute la période. */
  fractionPresence?: number;
  /** Fraction de la période ÉCOULÉE à date (0..1) — pour le dû « à date ». */
  fractionEcoulee?: number;
  /** Heures supp déjà payées à la semaine (déduites du décompte annuel). */
  heuresSuppDejaPayees?: number;
}

export interface AnnualResult {
  heuresTheoAnnee: number;   // dû théorique sur la période (proraté présence)
  heuresTheoADate: number;   // dû théorique à date (proraté présence × écoulé)
  heuresRealisees: number;
  soldeModulH: number;       // réalisé − dû-à-date (>0 avance, <0 retard)
  heuresSuppAnnee: number;   // heures supp à l'année (fin période) non encore payées
  contingent: number;        // contingent applicable (permanent/saisonnier)
  contingentRestant: number; // contingent − heures supp année
  depasseContingent: boolean;
}

/**
 * Calcule l'état d'annualisation. `saisonnier` sélectionne le contingent adéquat.
 */
export function computeAnnual(
  input: AnnualInput,
  saisonnier = false,
  reg: RhReglementParams = REGLEMENT_1405,
): AnnualResult {
  const presence = clamp01(input.fractionPresence ?? 1);
  const ecoule = clamp01(input.fractionEcoulee ?? 1);
  const dejaPayees = Math.max(0, input.heuresSuppDejaPayees ?? 0);

  const heuresTheoAnnee = round2(reg.dureeAnnuelleH * presence);
  const heuresTheoADate = round2(heuresTheoAnnee * ecoule);
  const realisees = Math.max(0, round2(input.heuresRealisees));

  const soldeModulH = round2(realisees - heuresTheoADate);
  // Heures supp année = dépassement du dû théorique total, net de ce qui a déjà été
  // payé à la semaine (on ne paie pas deux fois).
  const heuresSuppAnnee = Math.max(0, round2(realisees - heuresTheoAnnee - dejaPayees));

  const contingent = saisonnier ? reg.contingentSaisonnierH : reg.contingentPermanentH;
  const contingentRestant = round2(contingent - heuresSuppAnnee);

  return {
    heuresTheoAnnee,
    heuresTheoADate,
    heuresRealisees: realisees,
    soldeModulH,
    heuresSuppAnnee,
    contingent,
    contingentRestant,
    depasseContingent: heuresSuppAnnee > contingent,
  };
}

/** Fraction de présence sur une période = jours de contrat actif / jours de la période. */
export function fractionPresence(
  periodStart: Date, periodEnd: Date,
  contractStart: Date | null, contractEnd: Date | null,
): number {
  const p0 = periodStart.getTime(); const p1 = periodEnd.getTime();
  if (p1 <= p0) return 0;
  const c0 = Math.max(p0, (contractStart ?? periodStart).getTime());
  const c1 = Math.min(p1, (contractEnd ?? periodEnd).getTime());
  return clamp01((c1 - c0) / (p1 - p0));
}

/** Fraction écoulée d'une période à une date `now`. */
export function fractionEcoulee(periodStart: Date, periodEnd: Date, now: Date): number {
  const p0 = periodStart.getTime(); const p1 = periodEnd.getTime();
  if (p1 <= p0) return 0;
  return clamp01((now.getTime() - p0) / (p1 - p0));
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
function round2(x: number): number { return Math.round(x * 100) / 100; }
