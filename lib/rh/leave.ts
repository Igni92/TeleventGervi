/**
 * Utilitaires CONGÉS (RH V2). Décompte en jours OUVRABLES (lundi→samedi, hors
 * dimanches et jours fériés) — règle CP de l'IDCC 1405 / droit du travail.
 */
export const LEAVE_TYPES = ["cp", "rtt", "recup", "sans_solde", "maladie", "autre"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_LABEL: Record<LeaveType, string> = {
  cp: "Congés payés", rtt: "RTT", recup: "Récupération",
  sans_solde: "Sans solde", maladie: "Maladie", autre: "Autre",
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Jours ouvrables (lun→sam) entre deux dates incluses, hors jours fériés fournis. */
export function joursOuvrables(start: Date, end: Date, feries: Set<string> = new Set()): number {
  if (end < start) return 0;
  let n = 0;
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (d <= last) {
    const wd = d.getUTCDay(); // 0 = dimanche
    if (wd !== 0 && !feries.has(iso(d))) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}

export function isLeaveType(v: unknown): v is LeaveType {
  return typeof v === "string" && (LEAVE_TYPES as readonly string[]).includes(v);
}
