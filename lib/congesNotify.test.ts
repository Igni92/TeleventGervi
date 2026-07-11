import { describe, it, expect } from "vitest";
import {
  congeSummary, congeMailHtml, congeWhatsappText, outlookCongeEvent, congeRangeLabel,
} from "./congesNotify";
import type { CongeRequest } from "./conges";

const CONGE: CongeRequest = {
  id: "abc123", email: "jean@gervifrais.com", name: "Jean Dupont",
  type: "recup", start: "2026-08-03", end: "2026-08-04",
  note: "Vacances", status: "pending", origin: "salarie", createdAt: "2026-07-11T08:00:00Z",
};

describe("congesNotify — contenus (purs)", () => {
  it("résumé : nom, type, plage, nb de jours", () => {
    const s = congeSummary(CONGE);
    expect(s).toContain("Jean Dupont");
    expect(s).toContain("Récupération");
    expect(s).toContain("(2 j)");
  });

  it("plage d'un seul jour sans « du … au »", () => {
    expect(congeRangeLabel({ start: "2026-08-03", end: "2026-08-03" })).not.toContain("du ");
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
