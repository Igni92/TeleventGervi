import { describe, it, expect } from "vitest";
import {
  classifyAccount,
  classifyByDays,
  isProspect,
  nextStage,
  getStage,
  isValidStage,
  PIPELINE_STAGES,
  STAGE_KEYS,
  notifyLabel,
  PROSPECT_INACTIVITY_DAYS,
} from "./prospection";

const NOW = new Date("2026-07-21T09:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("classifyAccount — séparation CLIENT / PROSPECT", () => {
  it("commande récente (< 1 an) → CLIENT", () => {
    expect(classifyAccount(daysAgo(30), null, NOW)).toBe("CLIENT");
    expect(classifyAccount(daysAgo(PROSPECT_INACTIVITY_DAYS - 1), null, NOW)).toBe("CLIENT");
  });

  it("aucune commande depuis > 1 an → PROSPECT", () => {
    expect(classifyAccount(daysAgo(PROSPECT_INACTIVITY_DAYS + 1), null, NOW)).toBe("PROSPECT");
    expect(classifyAccount(daysAgo(800), null, NOW)).toBe("PROSPECT");
  });

  it("jamais commandé → PROSPECT", () => {
    expect(classifyAccount(null, null, NOW)).toBe("PROSPECT");
    expect(classifyAccount(undefined, null, NOW)).toBe("PROSPECT");
  });

  it("en pipeline (≠ GAGNE) sans commande récente → PROSPECT", () => {
    expect(classifyAccount(null, "QUALIFICATION", NOW)).toBe("PROSPECT");
    expect(classifyAccount(daysAgo(400), "PRESENTATION", NOW)).toBe("PROSPECT");
  });

  it("« BL → client » : commande récente prime sur l'état pipeline", () => {
    expect(classifyAccount(daysAgo(5), "QUALIFICATION", NOW)).toBe("CLIENT");
    expect(classifyAccount(daysAgo(5), "PRESENTATION", NOW)).toBe("CLIENT");
  });

  it("GAGNE + commande récente → CLIENT", () => {
    expect(classifyAccount(daysAgo(5), "GAGNE", NOW)).toBe("CLIENT");
  });

  it("GAGNE mais plus de commande depuis > 1 an → redevient PROSPECT", () => {
    expect(classifyAccount(daysAgo(400), "GAGNE", NOW)).toBe("PROSPECT");
  });

  it("isProspect est cohérent avec classifyAccount", () => {
    expect(isProspect(daysAgo(30), null, NOW)).toBe(false);
    expect(isProspect(daysAgo(400), null, NOW)).toBe(true);
  });

  it("classifyByDays applique la même règle sur un nombre de jours", () => {
    expect(classifyByDays(30, null)).toBe("CLIENT");
    expect(classifyByDays(400, null)).toBe("PROSPECT");
    expect(classifyByDays(null, null)).toBe("PROSPECT");
    expect(classifyByDays(400, "QUALIFICATION")).toBe("PROSPECT"); // pipeline sans BL récent
    expect(classifyByDays(5, "QUALIFICATION")).toBe("CLIENT");     // BL récent → client
    expect(classifyByDays(5, "GAGNE")).toBe("CLIENT");
  });

  it("classifyByDays — seuls GMS/EXPORT/CHR deviennent prospect en dormance", () => {
    // Dormant, segment prospectable → PROSPECT.
    expect(classifyByDays(400, null, "GMS")).toBe("PROSPECT");
    expect(classifyByDays(400, null, "EXPORT")).toBe("PROSPECT");
    expect(classifyByDays(null, null, "CHR")).toBe("PROSPECT");
    // Dormant mais hors segment (indépendant, marché, grossiste, sans type) → reste CLIENT.
    expect(classifyByDays(400, null, null)).toBe("CLIENT");
    expect(classifyByDays(400, null, "MARCHE")).toBe("CLIENT");
    expect(classifyByDays(null, null, "GROSSISTE")).toBe("CLIENT");
    // En pipeline actif SANS commande récente → PROSPECT (segment prospectable).
    expect(classifyByDays(400, "QUALIFICATION", "GMS")).toBe("PROSPECT");
    // « BL → client » : commande récente prime sur tout (même type/pipeline).
    expect(classifyByDays(5, "QUALIFICATION", "MARCHE")).toBe("CLIENT");
    expect(classifyByDays(30, null, "GMS")).toBe("CLIENT");
  });
});

describe("pipeline — étapes", () => {
  it("le Kanban expose 5 colonnes dans l'ordre (PERDU exclu)", () => {
    expect(PIPELINE_STAGES.map((s) => s.key)).toEqual([
      "A_CONTACTER",
      "QUALIFICATION",
      "PRESENTATION",
      "POST_COMMANDE",
      "GAGNE",
    ]);
  });

  it("nextStage suit le flux et s'arrête à GAGNE", () => {
    expect(nextStage("A_CONTACTER")).toBe("QUALIFICATION");
    expect(nextStage("QUALIFICATION")).toBe("PRESENTATION");
    expect(nextStage("PRESENTATION")).toBe("POST_COMMANDE");
    expect(nextStage("POST_COMMANDE")).toBe("GAGNE");
    expect(nextStage("GAGNE")).toBeNull();
    expect(nextStage("PERDU")).toBeNull();
  });

  it("chaque étape a un script non vide", () => {
    for (const key of STAGE_KEYS) {
      expect(getStage(key)?.script.length).toBeGreaterThan(20);
    }
  });

  it("isValidStage filtre les clés inconnues", () => {
    expect(isValidStage("QUALIFICATION")).toBe(true);
    expect(isValidStage("N_IMPORTE_QUOI")).toBe(false);
    expect(isValidStage(null)).toBe(false);
  });
});

describe("notifyLabel", () => {
  it("formate le délai de notification", () => {
    expect(notifyLabel(15)).toBe("15 min avant");
    expect(notifyLabel(60)).toBe("1 h avant");
    expect(notifyLabel(120)).toBe("2 h avant");
    expect(notifyLabel(1440)).toBe("1 j avant");
  });
});
