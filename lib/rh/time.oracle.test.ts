/**
 * ORACLE DE RÉGRESSION — le moteur temps RH V2 (lib/rh/time) DOIT reproduire à la
 * minute près l'ancien moteur éprouvé (lib/heuresCalc.computeWeek) sur un large
 * échantillon de cas générés. C'est la garantie qui rend « réécrire le moteur de
 * 0 » sûr : tout écart = bug bloquant.
 *
 * Générateur DÉTERMINISTE (PRNG à graine — pas de Math.random) → reproductible.
 */
import { describe, it, expect } from "vitest";
import { computeWeek as oldComputeWeek, dayMinutes, type DayHours, type DayTag } from "../heuresCalc";
import { computeWeek as newComputeWeek, typicalDayMinutes } from "./time";

// PRNG mulberry32 (déterministe).
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const TAGS: (DayTag | undefined)[] = [undefined, "present", "absent", "conges", "recup", "maladie", "ferie"];

function randDay(r: () => number): DayHours {
  const tag = TAGS[Math.floor(r() * TAGS.length)];
  // 60 % des jours ont des heures saisies, 40 % vides (pour exercer les crédits).
  if (r() < 0.4) return tag ? { tag } : {};
  const m1 = 5 * 60 + Math.floor(r() * 180);              // 05:00–08:00
  const m2 = m1 + 120 + Math.floor(r() * 180);            // +2h à +5h
  const hasPм = r() < 0.6;
  const a1 = m2 + 30 + Math.floor(r() * 120);
  const a2 = a1 + 60 + Math.floor(r() * 240);
  const d: DayHours = { m1: hm(m1), m2: hm(Math.min(m2, 23 * 60 + 59)), tag };
  if (hasPм && a2 < 24 * 60) { d.a1 = hm(a1); d.a2 = hm(a2); }
  return d;
}

describe("RH V2 time engine — oracle vs lib/heuresCalc (parité)", () => {
  it("reproduit computeWeek sur 3000 semaines générées + profils variés", () => {
    const r = rng(1234567);
    const profiles = [
      { weeklyHours: 35, typical: { m1: "06:00", m2: "13:00" } },
      { weeklyHours: 39, typical: { m1: "08:00", m2: "12:00", a1: "13:00", a2: "16:48" } },
      { weeklyHours: 42, typical: { m1: "06:00", m2: "14:00" } },
      { weeklyHours: 35, typical: {} }, // journée type absente → repli contrat/5
    ];
    let mismatches = 0;
    for (let n = 0; n < 3000; n++) {
      const prof = profiles[Math.floor(r() * profiles.length)];
      const days: DayHours[] = Array.from({ length: 7 }, () => randDay(r));
      const typMin = typicalDayMinutes(prof.weeklyHours, dayMinutes(prof.typical as DayHours));

      const old = oldComputeWeek(days, prof.weeklyHours, typMin);
      const neu = newComputeWeek(
        days.map((d) => dayMinutes(d)),
        days.map((d) => d.tag),
        prof.weeklyHours,
        typMin,
      );

      // Comparaison champ à champ (tous les nombres du WeekCalc).
      const same =
        JSON.stringify(old.dayMin) === JSON.stringify(neu.dayMin) &&
        old.totalMin === neu.totalMin &&
        old.contractMin === neu.contractMin &&
        old.deltaMin === neu.deltaMin &&
        old.sup25Min === neu.sup25Min &&
        old.sup50Min === neu.sup50Min &&
        old.recupMin === neu.recupMin &&
        old.majEquivMin === neu.majEquivMin &&
        old.congesMin === neu.congesMin &&
        old.ferieMin === neu.ferieMin &&
        old.recupCreditMin === neu.recupCreditMin;
      if (!same) {
        mismatches++;
        if (mismatches <= 3) {
          // eslint-disable-next-line no-console
          console.error("MISMATCH", { days, prof, old, neu });
        }
      }
    }
    expect(mismatches).toBe(0);
  });

  it("cas limites : semaine vide, tout férié, tout congé, tout récup", () => {
    const typMin = typicalDayMinutes(35, 7 * 60);
    const cases: { days: DayHours[]; label: string }[] = [
      { days: Array.from({ length: 7 }, () => ({})), label: "vide" },
      { days: Array.from({ length: 7 }, () => ({ tag: "ferie" as const })), label: "férié" },
      { days: Array.from({ length: 7 }, () => ({ tag: "conges" as const })), label: "congés" },
      { days: Array.from({ length: 7 }, () => ({ tag: "recup" as const })), label: "récup" },
    ];
    for (const c of cases) {
      const old = oldComputeWeek(c.days, 35, typMin);
      const neu = newComputeWeek(c.days.map((d) => dayMinutes(d)), c.days.map((d) => d.tag), 35, typMin);
      expect(neu, c.label).toEqual(old);
    }
  });
});
