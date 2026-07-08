/**
 * VALIDATION MENSUELLE DES HEURES — état de l'accord employeur ⇄ salarié.
 *
 * Au 1er du mois, l'employeur (direction) doit ENVOYER les heures du mois
 * précédent à chaque salarié pour validation. Le salarié VALIDE (entente) ou
 * PROPOSE une autre date (récup) ; l'employeur accepte ou renvoie. La boucle
 * continue jusqu'à l'ENTENTE.
 *
 * Persistance : AppSetting (même convention que lib/heuresRh — `rhsem:`,
 * `rhprofil:`), une ligne par salarié et par mois :
 *   `rhvalid:<email>:<YYYY-MM>` → HoursValidation (JSON)
 *
 * La logique d'état (transitions, « qui doit agir », mois à valider) est PURE
 * (testée hors Prisma) ; ce fichier ne fait que lecture/écriture autour.
 */
import { prisma } from "./prisma";
import { monthIdOf, shiftMonth, isMonthId } from "./heuresCalc";

const VALID_PREFIX = "rhvalid:";
const emailKey = (email: string) => email.trim().toLowerCase();

/** État de la validation d'un mois pour un salarié.
 *  • sent     : envoyé par l'employeur → le salarié doit valider/proposer ;
 *  • counter  : le salarié a proposé une autre date → l'employeur doit trancher ;
 *  • agreed   : entente — terminal. */
export type ValidStatus = "sent" | "counter" | "agreed";

/** Actions possibles (mappées vers un statut cible). */
export type ValidAction = "send" | "resend" | "validate" | "accept" | "counter";

export interface ValidEvent {
  by: string;                       // email de l'auteur
  role: "manager" | "employee";
  action: ValidAction;
  at: string;                       // ISO
  recupDates?: string[];            // dates proposées (action « counter »)
  note?: string;
}

export interface HoursValidation {
  month: string;                    // YYYY-MM (mois validé)
  email: string;                    // salarié concerné
  status: ValidStatus;
  proposal: string[];               // dernières dates de récup proposées (« autre date »)
  note: string;                     // dernière note
  updatedAt: string;
  updatedBy: string;
  history: ValidEvent[];
}

/* ─────────────────────────── Logique PURE ─────────────────────────────────── */

/** Le mois à faire valider au 1er = le mois PRÉCÉDENT. */
export function monthToValidate(today: Date): string {
  return shiftMonth(monthIdOf(today), -1);
}

/** Statut cible d'une action. */
export function statusOfAction(action: ValidAction): ValidStatus {
  switch (action) {
    case "send":
    case "resend":   return "sent";
    case "validate":
    case "accept":   return "agreed";
    case "counter":  return "counter";
  }
}

/** L'action est-elle permise depuis l'état courant + rôle de l'auteur ?
 *  Verrou métier : l'employeur envoie/renvoie/accepte ; le salarié valide/propose
 *  UNIQUEMENT quand la balle est dans son camp (statut « sent »). */
export function canAct(cur: HoursValidation | null, action: ValidAction, role: "manager" | "employee"): boolean {
  const status = cur?.status ?? null;
  if (status === "agreed") return false;                       // entente = terminal
  switch (action) {
    case "send":      return role === "manager" && status === null;
    case "resend":    return role === "manager" && status === "counter";
    case "accept":    return role === "manager" && status === "counter";
    case "validate":  return role === "employee" && status === "sent";
    case "counter":   return role === "employee" && status === "sent";
  }
}

/** Applique une action et renvoie le nouvel état (PUR : pas d'I/O). */
export function applyAction(
  cur: HoursValidation | null,
  p: { action: ValidAction; by: string; role: "manager" | "employee"; month: string; email: string; recupDates?: string[]; note?: string; at: string },
): HoursValidation {
  const base: HoursValidation = cur ?? {
    month: p.month, email: emailKey(p.email), status: "sent",
    proposal: [], note: "", updatedAt: p.at, updatedBy: p.by, history: [],
  };
  const status = statusOfAction(p.action);
  // Proposition (« autre date ») dédupliquée + triée → sortie canonique (= stockée).
  const recupDates = p.action === "counter"
    ? Array.from(new Set((p.recupDates ?? []).filter((d): d is string => typeof d === "string"))).sort()
    : base.proposal;
  const note = p.note ?? (p.action === "counter" ? "" : base.note);
  const event: ValidEvent = {
    by: p.by, role: p.role, action: p.action, at: p.at,
    ...(p.action === "counter" ? { recupDates } : {}),
    ...(p.note ? { note: p.note } : {}),
  };
  return {
    month: base.month, email: base.email, status,
    proposal: recupDates, note,
    updatedAt: p.at, updatedBy: p.by,
    history: [...base.history, event].slice(-40),   // borne l'historique
  };
}

/** Qui doit agir ? « manager » (à envoyer ou proposition à traiter),
 *  « employee » (à valider), ou null (entente / rien à faire). */
export function whoMustAct(v: HoursValidation | null): "manager" | "employee" | null {
  if (!v) return "manager";
  if (v.status === "sent") return "employee";
  if (v.status === "counter") return "manager";
  return null;                                       // agreed
}

/** Libellé court de l'état (UI). */
export function statusLabel(v: HoursValidation | null): string {
  if (!v) return "À envoyer";
  if (v.status === "sent") return "En attente du salarié";
  if (v.status === "counter") return "Autre date proposée";
  return "Validé";
}

/* ─────────────────────────── Persistance ──────────────────────────────────── */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const cleanDates = (v: unknown): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.filter((x): x is string => typeof x === "string" && ISO_DATE.test(x)))).sort() : [];

function parse(v: Partial<HoursValidation>, month: string, email: string): HoursValidation {
  const status: ValidStatus = v.status === "counter" || v.status === "agreed" ? v.status : "sent";
  const history = Array.isArray(v.history)
    ? v.history.filter((e): e is ValidEvent => !!e && typeof e === "object").slice(-40)
    : [];
  return {
    month, email: emailKey(email), status,
    proposal: cleanDates(v.proposal),
    note: typeof v.note === "string" ? v.note.slice(0, 500) : "",
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : "",
    updatedBy: typeof v.updatedBy === "string" ? v.updatedBy : "",
    history,
  };
}

const keyOf = (email: string, month: string) => `${VALID_PREFIX}${emailKey(email)}:${month}`;

export async function getValidation(email: string, month: string): Promise<HoursValidation | null> {
  if (!isMonthId(month)) return null;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: keyOf(email, month) } });
    return row ? parse(JSON.parse(row.value) as Partial<HoursValidation>, month, email) : null;
  } catch {
    return null;
  }
}

export async function saveValidation(v: HoursValidation): Promise<HoursValidation> {
  const clean = parse(v, v.month, v.email);
  const key = keyOf(clean.email, clean.month);
  const value = JSON.stringify(clean);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  return clean;
}

/** Toutes les validations d'un MOIS, par email (état d'équipe pour l'employeur). */
export async function listValidations(month: string): Promise<Map<string, HoursValidation>> {
  const out = new Map<string, HoursValidation>();
  if (!isMonthId(month)) return out;
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: VALID_PREFIX, endsWith: `:${month}` } } });
    for (const r of rows) {
      const rest = r.key.slice(VALID_PREFIX.length);
      const i = rest.lastIndexOf(":");
      if (i <= 0) continue;
      const email = rest.slice(0, i);
      if (rest.slice(i + 1) !== month) continue;
      try { out.set(email, parse(JSON.parse(r.value) as Partial<HoursValidation>, month, email)); } catch { /* corrompu → ignoré */ }
    }
  } catch { /* indisponible */ }
  return out;
}
