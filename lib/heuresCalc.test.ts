import { describe, it, expect } from "vitest";
import {
  parseHM, dayMinutes, computeWeek, fmtHM,
  isoWeekId, isWeekId, weekDates, shiftWeek,
  isMonthId, shiftMonth, monthWeeks, aggregateMonth,
  isHeuresOption, HEURES_OPTION_LABEL, isDateInWeek, daysAfterWeek,
  type DayHours,
} from "./heuresCalc";

describe("heuresCalc — parseHM / dayMinutes", () => {
  it("parse HH:MM et rejette l'invalide", () => {
    expect(parseHM("06:30")).toBe(390);
    expect(parseHM("6:30")).toBe(390);
    expect(parseHM("")).toBeNull();
    expect(parseHM("25:00")).toBeNull();
    expect(parseHM("06:75")).toBeNull();
    expect(parseHM("6h30")).toBeNull();
  });

  it("journée = matin + après-midi, plages incomplètes ignorées", () => {
    expect(dayMinutes({ m1: "06:00", m2: "12:00", a1: "13:00", a2: "16:30" })).toBe(360 + 210);
    expect(dayMinutes({ m1: "06:00", m2: "13:00" })).toBe(420);
    expect(dayMinutes({ m1: "06:00" })).toBe(0);                      // fin manquante
    expect(dayMinutes({ m1: "12:00", m2: "06:00" })).toBe(0);         // fin < début
    expect(dayMinutes(undefined)).toBe(0);
  });
});

describe("heuresCalc — computeWeek (contrat 35 h)", () => {
  const day = (h: number): DayHours => ({ m1: "06:00", m2: `${String(6 + h).padStart(2, "0")}:00` });

  it("semaine pile au contrat : ni supp ni récup", () => {
    const c = computeWeek([day(7), day(7), day(7), day(7), day(7)], 35);
    expect(c.totalMin).toBe(35 * 60);
    expect(c.deltaMin).toBe(0);
    expect(c.sup25Min).toBe(0);
    expect(c.sup50Min).toBe(0);
    expect(c.recupMin).toBe(0);
    expect(c.majEquivMin).toBe(0);
  });

  it("39 h → 4 h supp, toutes à +25 %", () => {
    const c = computeWeek([day(8), day(8), day(8), day(8), day(7)], 35);
    expect(c.totalMin).toBe(39 * 60);
    expect(c.sup25Min).toBe(4 * 60);
    expect(c.sup50Min).toBe(0);
    expect(c.majEquivMin).toBe(Math.round(4 * 60 * 1.25));   // 5h00 payées
  });

  it("45 h → 8 h à +25 % puis 2 h à +50 %", () => {
    const c = computeWeek([day(9), day(9), day(9), day(9), day(9)], 35);
    expect(c.totalMin).toBe(45 * 60);
    expect(c.sup25Min).toBe(8 * 60);
    expect(c.sup50Min).toBe(2 * 60);
    expect(c.majEquivMin).toBe(Math.round(8 * 60 * 1.25 + 2 * 60 * 1.5)); // 10h + 3h
  });

  it("32 h → 3 h de récup, aucune supp", () => {
    const c = computeWeek([day(7), day(7), day(7), day(7), day(4)], 35);
    expect(c.deltaMin).toBe(-3 * 60);
    expect(c.recupMin).toBe(3 * 60);
    expect(c.sup25Min).toBe(0);
    expect(c.majEquivMin).toBe(0);
  });

  it("contrat 39 h : le seuil des majorations suit le contrat", () => {
    const c = computeWeek([day(9), day(9), day(9), day(9), day(9)], 39);   // 45 h
    expect(c.sup25Min).toBe(6 * 60);
    expect(c.sup50Min).toBe(0);
  });
});

describe("heuresCalc — fmtHM", () => {
  it("formate heures/minutes avec signe", () => {
    expect(fmtHM(38.5 * 60)).toBe("38h30");
    expect(fmtHM(0)).toBe("0h00");
    expect(fmtHM(-150)).toBe("−2h30");
  });
});

describe("heuresCalc — semaines ISO", () => {
  it("isoWeekId : cas connus (bords d'année)", () => {
    expect(isoWeekId(new Date(2026, 6, 6))).toBe("2026-W28");    // lundi 6 juillet 2026
    expect(isoWeekId(new Date(2026, 0, 1))).toBe("2026-W01");    // jeudi 1er janv 2026
    expect(isoWeekId(new Date(2027, 0, 1))).toBe("2026-W53");    // vendredi 1er janv 2027 → W53 de 2026
  });

  it("weekDates : Lun→Dim cohérents", () => {
    const d = weekDates("2026-W28");
    expect(d[0]).toBe("2026-07-06");
    expect(d[6]).toBe("2026-07-12");
    expect(d).toHaveLength(7);
  });

  it("shiftWeek traverse les années", () => {
    expect(shiftWeek("2026-W28", 1)).toBe("2026-W29");
    expect(shiftWeek("2026-W01", -1)).toBe("2025-W52");
  });

  it("isWeekId", () => {
    expect(isWeekId("2026-W07")).toBe(true);
    expect(isWeekId("2026-W54")).toBe(false);
    expect(isWeekId("nawak")).toBe(false);
  });
});

describe("heuresCalc — état MENSUEL (semaine rattachée au mois de son dimanche)", () => {
  it("juillet 2026 : dimanches 5, 12, 19, 26 → W27..W30 (la semaine à cheval juin/juillet part en juillet)", () => {
    expect(monthWeeks("2026-07")).toEqual(["2026-W27", "2026-W28", "2026-W29", "2026-W30"]);
  });

  it("juin 2026 : 4 dimanches → W23..W26 ; W27 (29 juin–5 juil) N'EST PAS en juin", () => {
    const w = monthWeeks("2026-06");
    expect(w).toEqual(["2026-W23", "2026-W24", "2026-W25", "2026-W26"]);
    expect(w).not.toContain("2026-W27");
  });

  it("janvier 2027 : la semaine à cheval 2026-W53 (28 déc–3 janv) est rattachée à janvier", () => {
    expect(monthWeeks("2027-01")[0]).toBe("2026-W53");
  });

  it("aggregateMonth : somme des calculs hebdo (majorations DÉJÀ ventilées par semaine)", () => {
    const day = (h: number): DayHours => ({ m1: "06:00", m2: `${String(6 + h).padStart(2, "0")}:00` });
    const w39 = computeWeek([day(8), day(8), day(8), day(8), day(7)], 35);   // +4 h → 25 %
    const w32 = computeWeek([day(7), day(7), day(7), day(7), day(4)], 35);   // −3 h récup
    const m = aggregateMonth([w39, w32, null]);
    expect(m.weeksWithData).toBe(2);
    expect(m.totalMin).toBe((39 + 32) * 60);
    expect(m.sup25Min).toBe(4 * 60);
    expect(m.recupMin).toBe(3 * 60);
    expect(m.majEquivMin).toBe(Math.round(4 * 60 * 1.25));
  });

  it("isMonthId / shiftMonth", () => {
    expect(isMonthId("2026-07")).toBe(true);
    expect(isMonthId("2026-13")).toBe(false);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("heuresCalc — option compta des heures supp", () => {
  it("isHeuresOption n'accepte que recup / paiement", () => {
    expect(isHeuresOption("recup")).toBe(true);
    expect(isHeuresOption("paiement")).toBe(true);
    expect(isHeuresOption("")).toBe(false);
    expect(isHeuresOption(null)).toBe(false);
    expect(isHeuresOption("payé")).toBe(false);
  });

  it("libellés canoniques présents pour les deux options", () => {
    expect(HEURES_OPTION_LABEL.recup).toMatch(/récup/i);
    expect(HEURES_OPTION_LABEL.paiement).toMatch(/paiement/i);
  });

  it("isDateInWeek : la récup ne peut pas tomber dans la semaine des supp (S28 = 6→12 juil.)", () => {
    expect(isDateInWeek("2026-07-06", "2026-W28")).toBe(true);   // lundi
    expect(isDateInWeek("2026-07-11", "2026-W28")).toBe(true);   // samedi → interdit
    expect(isDateInWeek("2026-07-12", "2026-W28")).toBe(true);   // dimanche
    expect(isDateInWeek("2026-07-13", "2026-W28")).toBe(false);  // lundi S29 → autorisé
    expect(isDateInWeek("2026-07-05", "2026-W28")).toBe(false);  // dimanche S27
  });

  it("daysAfterWeek : propose les jours HORS de la semaine (à partir du lendemain du dimanche)", () => {
    const next = daysAfterWeek("2026-W28", 3);
    expect(next).toEqual(["2026-07-13", "2026-07-14", "2026-07-15"]);
    next.forEach((d) => expect(isDateInWeek(d, "2026-W28")).toBe(false));
  });
});
