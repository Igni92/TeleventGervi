import { describe, it, expect } from "vitest";
import {
  monthToValidate, statusOfAction, canAct, applyAction, whoMustAct,
  type HoursValidation,
} from "./heuresValidation";

const AT = "2026-08-01T09:00:00.000Z";

describe("heuresValidation — mois à valider", () => {
  it("au 1er du mois = mois précédent", () => {
    expect(monthToValidate(new Date(2026, 7, 1))).toBe("2026-07");   // 1er août → juillet
    expect(monthToValidate(new Date(2026, 0, 3))).toBe("2025-12");   // janv → déc N-1
  });
});

describe("heuresValidation — transitions (send → validate / counter → accept)", () => {
  it("statusOfAction mappe chaque action", () => {
    expect(statusOfAction("send")).toBe("sent");
    expect(statusOfAction("resend")).toBe("sent");
    expect(statusOfAction("validate")).toBe("agreed");
    expect(statusOfAction("accept")).toBe("agreed");
    expect(statusOfAction("counter")).toBe("counter");
  });

  it("canAct : verrou métier employeur ⇄ salarié", () => {
    expect(canAct(null, "send", "manager")).toBe(true);
    expect(canAct(null, "send", "employee")).toBe(false);        // le salarié n'envoie pas
    const sent = applyAction(null, { action: "send", by: "boss@x.fr", role: "manager", month: "2026-07", email: "sal@x.fr", at: AT });
    expect(canAct(sent, "validate", "employee")).toBe(true);
    expect(canAct(sent, "validate", "manager")).toBe(false);
    expect(canAct(sent, "counter", "employee")).toBe(true);
    expect(canAct(sent, "send", "manager")).toBe(false);         // déjà envoyé
    const counter = applyAction(sent, { action: "counter", by: "sal@x.fr", role: "employee", month: "2026-07", email: "sal@x.fr", recupDates: ["2026-08-05"], note: "je préfère le 5", at: AT });
    expect(canAct(counter, "accept", "manager")).toBe(true);
    expect(canAct(counter, "resend", "manager")).toBe(true);
    expect(canAct(counter, "validate", "employee")).toBe(false); // balle côté employeur
    const agreed = applyAction(counter, { action: "accept", by: "boss@x.fr", role: "manager", month: "2026-07", email: "sal@x.fr", at: AT });
    expect(canAct(agreed, "counter", "employee")).toBe(false);   // entente = terminal
  });

  it("applyAction : porte la proposition et empile l'historique", () => {
    const sent = applyAction(null, { action: "send", by: "boss@x.fr", role: "manager", month: "2026-07", email: "SAL@x.fr", at: AT });
    expect(sent.status).toBe("sent");
    expect(sent.email).toBe("sal@x.fr");                          // normalisé
    expect(whoMustAct(sent)).toBe("employee");

    const counter = applyAction(sent, { action: "counter", by: "sal@x.fr", role: "employee", month: "2026-07", email: "sal@x.fr", recupDates: ["2026-08-07", "2026-08-05"], note: "plutôt ces jours", at: AT });
    expect(counter.status).toBe("counter");
    expect(counter.proposal).toEqual(["2026-08-05", "2026-08-07"]);
    expect(whoMustAct(counter)).toBe("manager");
    expect(counter.history).toHaveLength(2);

    const agreed = applyAction(counter, { action: "accept", by: "boss@x.fr", role: "manager", month: "2026-07", email: "sal@x.fr", at: AT });
    expect(agreed.status).toBe("agreed");
    expect(agreed.proposal).toEqual(["2026-08-05", "2026-08-07"]); // dates retenues conservées
    expect(whoMustAct(agreed)).toBeNull();
    expect(agreed.history).toHaveLength(3);
  });

  it("whoMustAct : rien d'envoyé ⇒ le manager doit agir", () => {
    expect(whoMustAct(null)).toBe("manager");
  });
});
