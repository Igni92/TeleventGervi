/**
 * CONGÉS — types + logique PURE (validation de plage, décompte, chevauchement).
 *
 * Le salarié pose une demande (type + plage de dates + note) ; la DIRECTION
 * valide ou refuse. Ce module est PUR (aucun import Prisma) → utilisable côté
 * CLIENT (libellés) ET testé en vitest. La persistance AppSetting vit dans
 * `lib/congesRh` (`rhconge:<email>:<id>`).
 */
const emailKey = (e: string) => e.trim().toLowerCase();

export type CongeType = "cp" | "rtt" | "sans_solde" | "maladie" | "recup" | "autre";
export type CongeStatus = "pending" | "approved" | "refused" | "cancelled";

export const CONGE_TYPE_LABEL: Record<CongeType, string> = {
  cp: "Congés payés",
  rtt: "RTT",
  sans_solde: "Sans solde",
  maladie: "Maladie",
  recup: "Récupération",
  autre: "Autre",
};

export const CONGE_STATUS_LABEL: Record<CongeStatus, string> = {
  pending: "En attente",
  approved: "Validé",
  refused: "Refusé",
  cancelled: "Annulé",
};

/** Qui a INITIÉ la demande — le circuit fait BOOMERANG :
 *   • « salarie »  : le salarié demande → la DIRECTION valide/refuse ;
 *   • « direction »: l'employeur PROPOSE (congés/récup, au vu des compteurs)
 *     → le SALARIÉ accepte/refuse → une fois accepté, le jour s'inscrit dans
 *     son calendrier ET dans le calendrier d'équipe. */
export type CongeOrigin = "salarie" | "direction";

export interface CongeRequest {
  id: string;
  email: string;                 // salarié concerné
  name: string;
  type: CongeType;
  start: string;                 // YYYY-MM-DD
  end: string;                   // YYYY-MM-DD (inclus)
  note: string;
  status: CongeStatus;
  /** Initiateur (absent sur l'historique → « salarie »). */
  origin?: CongeOrigin;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
}

/* ─────────────────────────── Logique PURE ─────────────────────────────────── */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isCongeType(v: unknown): v is CongeType {
  return v === "cp" || v === "rtt" || v === "sans_solde" || v === "maladie" || v === "recup" || v === "autre";
}

/** Date « YYYY-MM-DD » réelle (rejette 2026-02-30…). */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Nombre de jours CALENDAIRES inclus (start..end) ; null si plage invalide. */
export function congeDayCount(start: string, end: string): number | null {
  if (!isIsoDate(start) || !isIsoDate(end)) return null;
  const a = Date.parse(`${start}T12:00:00Z`);
  const b = Date.parse(`${end}T12:00:00Z`);
  if (b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Valide une demande (type + plage). Retourne un message d'erreur, ou null si OK. */
export function validateConge(input: { type?: unknown; start?: unknown; end?: unknown }): string | null {
  if (!isCongeType(input.type)) return "Type de congé invalide.";
  if (!isIsoDate(input.start) || !isIsoDate(input.end)) return "Dates invalides.";
  const n = congeDayCount(input.start, input.end);
  if (n == null) return "La date de fin doit suivre la date de début.";
  if (n > 366) return "Plage trop longue (max 1 an).";
  return null;
}

/** Deux plages de dates ISO se chevauchent-elles ? (comparaison lexicographique) */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Une décision est-elle possible dans l'état courant ? (seul « pending » se tranche) */
export function canDecide(c: CongeRequest | null): boolean {
  return !!c && c.status === "pending";
}

/** Origine effective (l'historique sans champ = demande salarié). */
export function congeOrigin(c: Pick<CongeRequest, "origin">): CongeOrigin {
  return c.origin === "direction" ? "direction" : "salarie";
}

/** Le SALARIÉ peut-il répondre (boomerang) ? — uniquement une proposition de la
 *  DIRECTION, encore en attente, qui le concerne. */
export function canRespond(c: CongeRequest | null, email: string): boolean {
  return !!c && c.status === "pending" && congeOrigin(c) === "direction"
    && c.email === email.trim().toLowerCase();
}

/* ───────── Nettoyage/normalisation (utilisé par la persistance, cf. congesRh) ── */

export function parseConge(v: Partial<CongeRequest>, email: string, id: string): CongeRequest {
  const status: CongeStatus =
    v.status === "approved" || v.status === "refused" || v.status === "cancelled" ? v.status : "pending";
  return {
    id,
    email: emailKey(email),
    name: typeof v.name === "string" ? v.name.slice(0, 120) : email,
    type: isCongeType(v.type) ? v.type : "cp",
    start: isIsoDate(v.start) ? v.start : "",
    end: isIsoDate(v.end) ? v.end : "",
    note: typeof v.note === "string" ? v.note.slice(0, 500) : "",
    status,
    origin: v.origin === "direction" ? "direction" : "salarie",
    createdAt: typeof v.createdAt === "string" ? v.createdAt : "",
    decidedAt: typeof v.decidedAt === "string" ? v.decidedAt : undefined,
    decidedBy: typeof v.decidedBy === "string" ? v.decidedBy : undefined,
    decisionNote: typeof v.decisionNote === "string" ? v.decisionNote.slice(0, 500) : undefined,
  };
}
