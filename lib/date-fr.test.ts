import { describe, it, expect } from "vitest";
import { groupByJour } from "./date-fr";

describe("groupByJour — états groupés par jour (« VEN 17.05.26 » puis les pièces du jour)", () => {
  const docs = [
    { docNum: 4, docDate: "2026-05-18T00:00:00Z" },
    { docNum: 3, docDate: "2026-05-17" },
    { docNum: 2, docDate: "2026-05-18" },
    { docNum: 1, docDate: "2026-05-17" },
  ];

  it("regroupe par jour calendaire, jours récents d'abord", () => {
    const groups = groupByJour(docs, (d) => d.docDate);
    expect(groups.map((g) => g.day)).toEqual(["2026-05-18", "2026-05-17"]);
  });

  it("conserve l'ordre d'origine à l'intérieur d'un jour (DocEntry desc côté API)", () => {
    const groups = groupByJour(docs, (d) => d.docDate);
    expect(groups[0].items.map((d) => d.docNum)).toEqual([4, 2]);
    expect(groups[1].items.map((d) => d.docNum)).toEqual([3, 1]);
  });

  it("une date absente tombe dans un groupe « — » placé en dernier", () => {
    const groups = groupByJour(
      [{ docDate: null as string | null }, { docDate: "2026-05-17" }],
      (d) => d.docDate,
    );
    expect(groups.map((g) => g.day)).toEqual(["2026-05-17", ""]);
  });

  it("liste vide → aucun groupe", () => {
    expect(groupByJour([], () => "2026-05-17")).toEqual([]);
  });
});
