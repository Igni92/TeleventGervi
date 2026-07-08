import { describe, it, expect } from "vitest";
import {
  isCongeType, isIsoDate, congeDayCount, validateConge, rangesOverlap, canDecide,
  CONGE_TYPE_LABEL, type CongeRequest,
} from "./conges";

describe("conges — helpers purs", () => {
  it("isCongeType", () => {
    expect(isCongeType("cp")).toBe(true);
    expect(isCongeType("rtt")).toBe(true);
    expect(isCongeType("vacances")).toBe(false);
    expect(isCongeType(null)).toBe(false);
  });

  it("isIsoDate rejette l'invalide", () => {
    expect(isIsoDate("2026-07-20")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);   // 30 février
    expect(isIsoDate("2026-7-1")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });

  it("congeDayCount : jours calendaires inclus", () => {
    expect(congeDayCount("2026-07-20", "2026-07-20")).toBe(1);     // 1 jour
    expect(congeDayCount("2026-07-20", "2026-07-24")).toBe(5);     // lun→ven
    expect(congeDayCount("2026-07-24", "2026-07-20")).toBeNull();  // fin < début
    expect(congeDayCount("2026-12-31", "2027-01-02")).toBe(3);     // passage d'année
  });

  it("validateConge", () => {
    expect(validateConge({ type: "cp", start: "2026-07-20", end: "2026-07-24" })).toBeNull();
    expect(validateConge({ type: "x", start: "2026-07-20", end: "2026-07-24" })).toMatch(/type/i);
    expect(validateConge({ type: "cp", start: "2026-07-24", end: "2026-07-20" })).toMatch(/fin/i);
    expect(validateConge({ type: "cp", start: "2026-01-01", end: "2027-06-01" })).toMatch(/long/i);
  });

  it("rangesOverlap", () => {
    expect(rangesOverlap("2026-07-01", "2026-07-10", "2026-07-05", "2026-07-15")).toBe(true);
    expect(rangesOverlap("2026-07-01", "2026-07-10", "2026-07-10", "2026-07-12")).toBe(true);  // bord commun
    expect(rangesOverlap("2026-07-01", "2026-07-10", "2026-07-11", "2026-07-12")).toBe(false);
  });

  it("canDecide : seul « pending » se tranche", () => {
    const base: CongeRequest = {
      id: "a", email: "s@x.fr", name: "S", type: "cp", start: "2026-07-20", end: "2026-07-24",
      note: "", status: "pending", createdAt: "2026-07-01T00:00:00Z",
    };
    expect(canDecide(base)).toBe(true);
    expect(canDecide({ ...base, status: "approved" })).toBe(false);
    expect(canDecide(null)).toBe(false);
  });

  it("libellés de type présents", () => {
    expect(CONGE_TYPE_LABEL.cp).toMatch(/congés/i);
    expect(CONGE_TYPE_LABEL.rtt).toBe("RTT");
  });
});
