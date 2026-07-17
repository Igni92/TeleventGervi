import { describe, it, expect } from "vitest";
import {
  congeSummary, congeMailHtml, congeWhatsappText, outlookCongeEvent, congeRangeLabel,
  congeInboxLine,
} from "./congesNotify";
import { stripOrgSuffix } from "./userNames";
import type { CongeRequest } from "./conges";

const CONGE: CongeRequest = {
  id: "abc123", email: "jean@gervifrais.com", name: "Jean Dupont",
  type: "recup", start: "2026-08-03", end: "2026-08-04",
  note: "Vacances", status: "pending", origin: "salarie", createdAt: "2026-07-11T08:00:00Z",
};

describe("congesNotify — contenus (purs)", () => {
  it("résumé : nom, type, plage, nb de jours OUVRABLES (hors dim./fériés)", () => {
    const s = congeSummary(CONGE);
    expect(s).toContain("Jean Dupont");
    expect(s).toContain("Récupération");
    expect(s).toContain("(2 j ouvrables)");   // 3–4 août = lundi+mardi
  });

  it("plage d'un seul jour sans « du … au »", () => {
    expect(congeRangeLabel({ start: "2026-08-03", end: "2026-08-03" })).not.toContain("du ");
  });

  it("le suffixe « - Gervifrais » des comptes Microsoft est retiré partout", () => {
    expect(stripOrgSuffix("Maxyme MANDINE - Gervifrais")).toBe("Maxyme MANDINE");
    expect(stripOrgSuffix("Jean Dupont")).toBe("Jean Dupont");
    expect(congeSummary({ ...CONGE, name: "Jean Dupont - Gervifrais" })).not.toContain("Gervifrais");
  });

  it("ligne de réception COMPACTE : « Récup. SAM 22.08.26 au MAR 25.08.26 inclu (3 jours) »", () => {
    const line = congeInboxLine({ ...CONGE, type: "recup", start: "2026-08-22", end: "2026-08-25" });
    expect(line).toBe("Récup. SAM 22.08.26 au MAR 25.08.26 inclu (3 jours)");
  });

  it("ligne de réception CP : « Demande CP. MER 26.08.26 au LUN 31.08.26 inclu (5 jours) »", () => {
    const line = congeInboxLine({ ...CONGE, type: "cp", start: "2026-08-26", end: "2026-08-31" });
    expect(line).toBe("Demande CP. MER 26.08.26 au LUN 31.08.26 inclu (5 jours)");
  });

  it("ligne de réception d'un seul jour : pas de « au … inclu »", () => {
    const line = congeInboxLine({ ...CONGE, type: "recup", start: "2026-08-24", end: "2026-08-24" });
    expect(line).toBe("Récup. LUN 24.08.26 (1 jour)");
  });

  it("l'aperçu compact est la 1re ligne du corps du mail", () => {
    const html = congeMailHtml({ ...CONGE, start: "2026-08-22", end: "2026-08-25" }, "https://app/planning");
    expect(html.indexOf("Récup. SAM 22.08.26")).toBeGreaterThan(-1);
    expect(html.indexOf("Récup. SAM 22.08.26")).toBeLessThan(html.indexOf("Gervifrais · Planning"));
  });

  it("email : contient le lien vers le planning et échappe le HTML", () => {
    const html = congeMailHtml({ ...CONGE, note: "<script>" }, "https://app/planning");
    expect(html).toContain("https://app/planning");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("WhatsApp : résumé + lien", () => {
    const t = congeWhatsappText(CONGE, "https://app/planning");
    expect(t).toContain("Jean Dupont");
    expect(t).toContain("https://app/planning");
  });

  it("évènement Outlook : journée entière, FIN EXCLUSIVE (lendemain du dernier jour)", () => {
    const e = outlookCongeEvent(CONGE, "https://app/planning") as {
      isAllDay: boolean; showAs: string; subject: string;
      start: { dateTime: string; timeZone: string }; end: { dateTime: string };
    };
    expect(e.isAllDay).toBe(true);
    expect(e.start.dateTime).toBe("2026-08-03T00:00:00");
    expect(e.end.dateTime).toBe("2026-08-05T00:00:00");   // 4 août inclus → fin le 5
    expect(e.start.timeZone).toBe("Europe/Paris");
    expect(e.subject).toContain("Jean Dupont");
    expect(e.showAs).toBe("free");
  });
});
