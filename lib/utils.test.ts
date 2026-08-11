import { describe, it, expect } from "vitest";
import { formatRappelDate } from "./utils";

describe("formatRappelDate", () => {
  it("formate un rappel en « JOU JJ.MM.AA HH:MM »", () => {
    expect(formatRappelDate(new Date(2026, 7, 12, 10, 0))).toBe("MER 12.08.26 10:00");
  });

  it("accepte la valeur d'un input datetime-local", () => {
    expect(formatRappelDate("2026-08-12T10:00")).toBe("MER 12.08.26 10:00");
  });

  it("fait varier le jour de la semaine avec la date", () => {
    // 10 → 16 août 2026 : lundi … dimanche.
    const jours = [10, 11, 12, 13, 14, 15, 16].map((d) =>
      formatRappelDate(new Date(2026, 7, d, 9, 5)).split(" ")[0]
    );
    expect(jours).toEqual(["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"]);
  });

  it("complète les nombres à deux chiffres", () => {
    expect(formatRappelDate(new Date(2027, 0, 3, 8, 7))).toBe("DIM 03.01.27 08:07");
  });

  it("renvoie un tiret pour une date invalide", () => {
    expect(formatRappelDate("pas une date")).toBe("—");
  });
});
