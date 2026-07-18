import { describe, it, expect } from "vitest";
import {
  parseHM, dayMinutes, computeWeek, fmtHM,
  isoWeekId, isWeekId, weekDates, shiftWeek,
  isMonthId, shiftMonth, monthWeeks, aggregateMonth,
  isHeuresOption, HEURES_OPTION_LABEL, isDateInWeek, daysAfterWeek,
  splitSupp, effectivePaySuppMin, DAY_TAGS,
  structuralSuppMin, splitStructuralSupp,
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

describe("heuresCalc — tag « Férié » (journée type due et payée)", () => {
  const day = (h: number): DayHours => ({ m1: "06:00", m2: `${String(6 + h).padStart(2, "0")}:00` });
  const TYP = 7 * 60 + 15;   // journée type 7h15 (ex. 04:45 → 12:00)

  it("le tag est proposé dans la liste", () => {
    expect(DAY_TAGS).toContain("ferie");
  });

  it("jour férié SANS heures → journée type créditée, tracée dans ferieMin", () => {
    // Lun + mer→sam travaillés, mardi férié (14 juillet) → semaine complète.
    const days: DayHours[] = [day(7), { tag: "ferie" }, day(7), day(7), day(7), {}, {}];
    const c = computeWeek(days, 35, TYP);
    expect(c.dayMin[1]).toBe(TYP);
    expect(c.totalMin).toBe(28 * 60 + TYP);
    expect(c.ferieMin).toBe(TYP);
    expect(c.congesMin).toBe(0);
    // 35h15 > contrat, mais le dépassement vient du férié → RIEN d'arbitrable.
    expect(c.sup25Min).toBe(0);
    expect(c.sup50Min).toBe(0);
  });

  it("FORCÉMENT PAYÉ : le dépassement dû au férié n'est jamais arbitrable, seules les heures TRAVAILLÉES au-delà du contrat restent en supp", () => {
    // Cas réel : lun 7h45, mardi 14/07 férié, mer 8h15, jeu/ven/sam 7h15 → 37h45
    // travaillées + 7h15 créditées = 45h00. Supp arbitrables = 2h45 seulement.
    const days: DayHours[] = [
      { m1: "04:45", m2: "12:30" },
      { tag: "ferie" },
      { m1: "04:45", m2: "13:00" },
      { m1: "04:45", m2: "12:00" },
      { m1: "04:45", m2: "12:00" },
      { m1: "04:45", m2: "12:00" },
      {},
    ];
    const c = computeWeek(days, 35, TYP);
    expect(c.totalMin).toBe(45 * 60);
    expect(c.ferieMin).toBe(TYP);
    expect(c.sup25Min).toBe(2 * 60 + 45);
    expect(c.sup50Min).toBe(0);
    expect(c.majEquivMin).toBe(Math.round((2 * 60 + 45) * 1.25));   // 3h26
  });

  it("férié TRAVAILLÉ (heures saisies) → les heures réelles priment, pas de crédit", () => {
    const days: DayHours[] = [{ ...day(7), tag: "ferie" }, {}, {}, {}, {}, {}, {}];
    const c = computeWeek(days, 35, TYP);
    expect(c.dayMin[0]).toBe(7 * 60);
    expect(c.ferieMin).toBe(0);
  });

  it("sans journée type définie (0), aucun crédit fantôme", () => {
    const c = computeWeek([{ tag: "ferie" }, {}, {}, {}, {}, {}, {}], 35, 0);
    expect(c.totalMin).toBe(0);
    expect(c.ferieMin).toBe(0);
  });

  it("aggregateMonth totalise ferieMin", () => {
    const w = computeWeek([{ tag: "ferie" }, day(7), day(7), day(7), day(7), {}, {}], 35, TYP);
    const m = aggregateMonth([w, w, null]);
    expect(m.ferieMin).toBe(2 * TYP);
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
  it("isHeuresOption n'accepte que recup / paiement / mixte", () => {
    expect(isHeuresOption("recup")).toBe(true);
    expect(isHeuresOption("paiement")).toBe(true);
    expect(isHeuresOption("mixte")).toBe(true);
    expect(isHeuresOption("")).toBe(false);
    expect(isHeuresOption(null)).toBe(false);
    expect(isHeuresOption("payé")).toBe(false);
  });

  it("libellés canoniques présents pour les trois options", () => {
    expect(HEURES_OPTION_LABEL.recup).toMatch(/récup/i);
    expect(HEURES_OPTION_LABEL.paiement).toMatch(/paiement/i);
    expect(HEURES_OPTION_LABEL.mixte).toMatch(/paiement/i);
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

describe("heuresCalc — splitSupp (partage paiement / récup, option « mixte »)", () => {
  // 10 h supp = 8 h à +25 % + 2 h à +50 % → équivalent majoré total 13 h.
  const SUP25 = 8 * 60, SUP50 = 2 * 60;

  it("la part payée consomme d'abord la tranche +25 %", () => {
    const s = splitSupp(SUP25, SUP50, 4 * 60);
    expect(s.payMin).toBe(4 * 60);
    expect(s.payEquivMin).toBe(5 * 60);                 // 4 h × 1,25
    expect(s.recupMin).toBe(6 * 60);
    expect(s.recupEquivMin).toBe(8 * 60);               // 13 h − 5 h
  });

  it("au-delà de la tranche +25 %, la part payée bascule sur +50 %", () => {
    const s = splitSupp(SUP25, SUP50, 9 * 60);          // 8 h à +25 % + 1 h à +50 %
    expect(s.payEquivMin).toBe(Math.round(8 * 60 * 1.25 + 60 * 1.5));   // 11h30
    expect(s.recupEquivMin).toBe(90);                   // 1 h restante à +50 %
  });

  it("les équivalents se complètent EXACTEMENT (payé + récup = majoré total)", () => {
    for (const pay of [0, 37, 200, 480, 600]) {
      const s = splitSupp(SUP25, SUP50, pay);
      expect(s.payEquivMin + s.recupEquivMin).toBe(Math.round(SUP25 * 1.25 + SUP50 * 1.5));
    }
  });

  it("bornes : payer plus que les supp = tout payer ; négatif = rien", () => {
    expect(splitSupp(SUP25, SUP50, 20 * 60).payMin).toBe(10 * 60);
    expect(splitSupp(SUP25, SUP50, 20 * 60).recupEquivMin).toBe(0);
    expect(splitSupp(SUP25, SUP50, -60).payMin).toBe(0);
  });

  it("effectivePaySuppMin suit l'option : paiement = tout, recup/aucune = rien, mixte = borné", () => {
    expect(effectivePaySuppMin("paiement", null, 10 * 60)).toBe(10 * 60);
    expect(effectivePaySuppMin("recup", 4 * 60, 10 * 60)).toBe(0);
    expect(effectivePaySuppMin(null, 4 * 60, 10 * 60)).toBe(0);
    expect(effectivePaySuppMin("mixte", 4 * 60, 10 * 60)).toBe(4 * 60);
    expect(effectivePaySuppMin("mixte", 20 * 60, 10 * 60)).toBe(10 * 60);  // borné aux supp réelles
    expect(effectivePaySuppMin("mixte", null, 10 * 60)).toBe(0);
  });
});

describe("heuresCalc — heures supp STRUCTURELLES (contrat « 42 h » payé)", () => {
  it("structuralSuppMin = heures payées − contrat, ≥ 0, 0 si absent/≤ contrat", () => {
    expect(structuralSuppMin({ weeklyHours: 35, paidWeeklyHours: 42 })).toBe(7 * 60);
    expect(structuralSuppMin({ weeklyHours: 35, paidWeeklyHours: 35 })).toBe(0);
    expect(structuralSuppMin({ weeklyHours: 35, paidWeeklyHours: 30 })).toBe(0);
    expect(structuralSuppMin({ weeklyHours: 35, paidWeeklyHours: null })).toBe(0);
    expect(structuralSuppMin({ weeklyHours: 35 })).toBe(0);
  });

  it("Hugo 42h à 45h : 7h structurelles (payées d'office) + 3h arbitrables (1h à +25, 2h à +50)", () => {
    // 45 h → supp 10 h : +25 % sur 8 h (35→43), +50 % sur 2 h (43→45).
    const sup25 = 8 * 60, sup50 = 2 * 60;
    const st = splitStructuralSupp(sup25, sup50, 7 * 60);   // 7 h structurelles
    // Structurel consomme d'abord la tranche +25 % : 7 h à +25 %.
    expect(st.struct25Min).toBe(7 * 60);
    expect(st.struct50Min).toBe(0);
    expect(st.structEquivMin).toBe(Math.round(7 * 60 * 1.25)); // 8h45 équiv.
    // Arbitrable : 1 h à +25 % (43e h) + 2 h à +50 %.
    expect(st.arb25Min).toBe(1 * 60);
    expect(st.arb50Min).toBe(2 * 60);
    expect(st.arbitrableMin).toBe(3 * 60);
  });

  it("Hugo à 40h : tout structurel (5h ≤ 7h), rien d'arbitrable", () => {
    const st = splitStructuralSupp(5 * 60, 0, 7 * 60);
    expect(st.arbitrableMin).toBe(0);
    expect(st.structEquivMin).toBe(Math.round(5 * 60 * 1.25));
  });

  it("floor 0 (salarié standard) : tout est arbitrable, rien de structurel", () => {
    const st = splitStructuralSupp(8 * 60, 2 * 60, 0);
    expect(st.structEquivMin).toBe(0);
    expect(st.arb25Min).toBe(8 * 60);
    expect(st.arb50Min).toBe(2 * 60);
    expect(st.arbitrableMin).toBe(10 * 60);
  });
});
