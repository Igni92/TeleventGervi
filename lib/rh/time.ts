/**
 * Moteur TEMPS de travail (RH V2) — réécrit de 0, paramétré par RhReglement.
 *
 * Deux entrées possibles :
 *  - BADGEUSE : des pointages (in/out) → minutes travaillées par jour (`punchesToMinutes`).
 *  - SAISIE   : des plages matin/après-midi (m1/m2/a1/a2) → minutes (`rangeMinutes`).
 *
 * Le calcul de semaine (`computeWeek`) reproduit EXACTEMENT la sémantique éprouvée
 * de l'ancien moteur (lib/heuresCalc), validée par l'oracle de régression
 * (lib/rh/time.oracle.test.ts) : majorations +25 % (8 premières h supp) / +50 %
 * au-delà, jour de congé/férié crédité d'une journée type (jamais d'heure supp
 * générée), jour de récup posé crédité borné au déficit au contrat.
 *
 * Les taux et le seuil viennent du règlement (défauts IDCC 1405 : +25/+50, 8 h).
 */
import { REGLEMENT_1405, type RhReglementParams } from "./reglement";

export type DayTag = "present" | "absent" | "conges" | "recup" | "maladie" | "ferie";

/** Un pointage badgeuse. */
export interface Punch { kind: "in" | "out"; at: string | Date }

/** Plages saisies (repli/correction) — "HH:MM". */
export interface DayRanges {
  m1?: string | null; m2?: string | null; // matin début/fin
  a1?: string | null; a2?: string | null; // après-midi début/fin
  tag?: DayTag | null;
  note?: string | null;
}

export interface WeekCalc {
  dayMin: number[];       // minutes par jour (Lun→Dim), crédits congés/férié/récup inclus
  totalMin: number;       // total travaillé (crédits inclus)
  contractMin: number;    // contrat hebdo
  deltaMin: number;       // total − contrat (négatif = récup)
  sup25Min: number;       // heures supp à +25 % (dépassement TRAVAILLÉ seulement)
  sup50Min: number;       // heures supp au taux majoré supérieur
  recupMin: number;       // minutes de récup (si total < contrat)
  majEquivMin: number;    // équivalent PAYÉ des heures supp (×1,25 / ×1,5)
  congesMin: number;      // minutes créditées par les congés (journée type)
  ferieMin: number;       // minutes créditées par les fériés chômés (toujours payées)
  recupCreditMin: number; // récup posée créditée (= débit compteur, bornée au déficit)
}

const clampHM = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(mi) || h > 23 || mi > 59) return null;
  return h * 60 + mi;
};

/** Minutes d'une plage début→fin (0 si incomplète ou fin ≤ début). */
function span(a: string | null | undefined, b: string | null | undefined): number {
  const x = clampHM(a); const y = clampHM(b);
  if (x == null || y == null || y <= x) return 0;
  return y - x;
}

/** Plages matin + après-midi → minutes travaillées d'un jour. */
export function rangeMinutes(d: DayRanges | undefined | null): number {
  if (!d) return 0;
  return span(d.m1, d.m2) + span(d.a1, d.a2);
}

/**
 * Pointages badgeuse → minutes travaillées (paires in→out successives), moins la
 * pause. Arrondi optionnel (au quart d'heure) configurable ultérieurement.
 * Robuste aux pointages manquants (in sans out ignoré).
 */
export function punchesToMinutes(punches: Punch[], pauseMin = 0): number {
  const sorted = [...punches]
    .map((p) => ({ kind: p.kind, t: new Date(p.at).getTime() }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  let total = 0;
  let openIn: number | null = null;
  for (const p of sorted) {
    if (p.kind === "in") {
      openIn = p.t; // un nouvel « in » écrase un « in » resté ouvert
    } else if (p.kind === "out" && openIn != null) {
      total += Math.max(0, Math.round((p.t - openIn) / 60000));
      openIn = null;
    }
  }
  return Math.max(0, total - Math.max(0, pauseMin));
}

/** Minutes de la journée type (repli = contrat / 5). Créditée pour un congé/férié. */
export function typicalDayMinutes(weeklyHours: number, typicalDayMin?: number): number {
  if (typicalDayMin && typicalDayMin > 0) return typicalDayMin;
  return Math.max(0, Math.round(((weeklyHours || 0) * 60) / 5));
}

/**
 * Calcule une semaine à partir des minutes travaillées + tags par jour.
 * `workedMin[i]` = minutes travaillées du jour i (Lun→Dim) ; `tags[i]` = tag jour.
 * Sémantique identique à l'ancien moteur (prouvée par l'oracle).
 */
export function computeWeek(
  workedMin: number[],
  tags: (DayTag | null | undefined)[],
  weeklyHours: number,
  typicalDayMin = 0,
  reg: RhReglementParams = REGLEMENT_1405,
): WeekCalc {
  let congesMin = 0;
  let ferieMin = 0;
  const recupIdx: number[] = [];
  const dayMin = Array.from({ length: 7 }, (_, i) => {
    const worked = Math.max(0, Math.round(workedMin[i] ?? 0));
    const tag = tags[i];
    if (worked === 0 && tag === "conges" && typicalDayMin > 0) { congesMin += typicalDayMin; return typicalDayMin; }
    if (worked === 0 && tag === "ferie" && typicalDayMin > 0) { ferieMin += typicalDayMin; return typicalDayMin; }
    if (worked === 0 && tag === "recup" && typicalDayMin > 0) { recupIdx.push(i); return 0; }
    return worked;
  });
  const contractMin = Math.max(0, Math.round((weeklyHours || 0) * 60));
  const baseTotalMin = dayMin.reduce((s, m) => s + m, 0);
  // Récup posée : comble le déficit au contrat, une journée type par jour, cap contrat.
  let recupCreditMin = 0;
  let gap = Math.max(0, contractMin - baseTotalMin);
  for (const i of recupIdx) {
    const credit = Math.min(typicalDayMin, gap);
    dayMin[i] = credit; recupCreditMin += credit; gap -= credit;
  }
  const totalMin = baseTotalMin + recupCreditMin;
  const deltaMin = totalMin - contractMin;
  // Dépassement TRAVAILLÉ = dépassement − crédits férié/congés (payés tels quels).
  const supMin = Math.max(0, Math.max(0, deltaMin) - ferieMin - congesMin);
  const band25 = Math.max(0, Math.round(reg.seuilMaj50HebdoH * 60));
  const sup25Min = Math.min(supMin, band25);
  const sup50Min = Math.max(0, supMin - band25);
  const recupMin = Math.max(0, -deltaMin);
  const majEquivMin = Math.round(sup25Min * (1 + reg.majoration25) + sup50Min * (1 + reg.majoration50));
  return { dayMin, totalMin, contractMin, deltaMin, sup25Min, sup50Min, recupMin, majEquivMin, congesMin, ferieMin, recupCreditMin };
}

/** Minutes → « 38h30 » (signe conservé). */
export function fmtHM(min: number): string {
  const sign = min < 0 ? "-" : "";
  const a = Math.abs(Math.round(min));
  return `${sign}${Math.floor(a / 60)}h${String(a % 60).padStart(2, "0")}`;
}
