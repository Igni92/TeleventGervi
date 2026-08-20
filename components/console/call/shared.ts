import type { ClientInsights } from "@/lib/insights";
import type { LifecycleResult, LifecycleState } from "@/lib/lifecycle";
import type { ValueTier } from "@/lib/clientValue";

/* ─────────────────────────────────────────────────────────────
   Types (mirror /api/console response)
───────────────────────────────────────────────────────────── */
export interface AppelLog {
  id: string;
  type: "COMMANDE" | "DEMAIN";
  /** Issue fine loguée avec l'appel (NRP, REFUS, REPONDEUR, RAPPELE, LITIGE…). */
  outcome?: string | null;
  note: string | null;
  heureAppel: string;
  scheduledFor?: string | null;
}
export interface Rappel { id: string; dateRappel: string; note: string | null; statut: string; }
export interface Client {
  id: string; code: string; nom: string;
  type: string | null; commercial: string | null;
  tel1: string | null; tel2: string | null; tel3: string | null;
  email: string | null;
  sapGroupCode: number | null;
  sapGroupName: string | null;
  notes: string | null; joursAppel: string | null;
  rappels: Rappel[]; appels: AppelLog[];
  insights?: ClientInsights;
  /** Cycle de vie dérivé serveur (lib/lifecycle) — pilote le badge de la file. */
  lifecycle?: LifecycleResult;
  /** Palier de valeur A/B/C/D (lib/clientValue) issu du CA 12 mois. */
  tier?: ValueTier;
  /** CA 12 mois glissants (€ HT). */
  ca12m?: number;
  /** Score de priorité « valeur × urgence » + phrase d'action (lib/priority). */
  priority?: { score: number; reason: string };
  /** null = not claimed; string = original commercial name (I covered this client today) */
  claimedFrom?: string | null;
  /** true = client REPRIS aujourd'hui dont le commercial d'origine est absent → vraie couverture */
  ownerAbsent?: boolean;
  /** nb d'incidents ouverts (BL) — affiché dans la file */
  openIncidents?: number;
  /** Repli cold-start : heure de décroché typique des clients du même type
   *  (quand ce client n'a pas assez d'historique perso). */
  fallbackHour?: number | null;
  /** Tenté aujourd'hui sans décroché (NRP/répondeur) → à re-tenter plus tard. */
  retryAfterNrp?: boolean;
  /** Rappel DÛ (heure passée) — le client remonte en tête de file, coloré.
   *  ISO du rappel dépassé le plus ancien, ou null/absent. */
  dueReminderAt?: string | null;
}
export interface DueRappel {
  id: string;
  clientId: string;
  clientNom: string;
  dateRappel: string;
  note: string | null;
}
export interface ConsoleData {
  queue: Client[]; done: Client[];
  dueRappels?: DueRappel[];
  stats: { remaining: number; called: number; commandes: number; demains: number; conversion: number };
  presence?: { present: string[]; absent: string[]; toCover: number };
  me?: { stockSharePct: number };
}

/** Résultat brut de /api/clients (recherche de comptes hors file). Ne contient
 *  ni insights ni historique complet — juste l'identité + contacts + groupe. */
export interface GlobalHit {
  id: string; code: string; nom: string; type: string | null;
  commercial: string | null;
  tel1: string | null; tel2: string | null; tel3: string | null;
  email: string | null;
  sapGroupCode: number | null; sapGroupName: string | null;
  notes: string | null; joursAppel: string | null;
}

/** Adapte un compte trouvé (hors file) au type `Client` de la console. Les
 *  listes rappels/appels sont vides (pas d'historique télévente chargé) et les
 *  champs dérivés (insights, cycle de vie, valeur…) restent absents. */
export function clientFromSearch(r: GlobalHit): Client {
  return {
    id: r.id, code: r.code, nom: r.nom, type: r.type, commercial: r.commercial,
    tel1: r.tel1, tel2: r.tel2, tel3: r.tel3, email: r.email,
    sapGroupCode: r.sapGroupCode, sapGroupName: r.sapGroupName,
    notes: r.notes, joursAppel: r.joursAppel,
    rappels: [], appels: [],
  };
}

export type SortMode = "priorite" | "name" | "hour" | "type" | "lastOrder";

export const JOURS_FR: Record<number, string> = { 0:"Dim",1:"Lun",2:"Mar",3:"Mer",4:"Jeu",5:"Ven",6:"Sam" };

/**
 * Couleurs du badge CYCLE DE VIE dans la file — alignées sur LifecycleBadge.
 * Seuls les états « à traiter » portent une pastille ; ACTIF/NOUVEAU restent
 * nus pour garder la file lisible (l'enjeu, c'est ce qui décroche).
 */
export const LIFECYCLE_PILL: Partial<Record<LifecycleState, string>> = {
  EN_RETARD: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  A_RISQUE: "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300",
  ENDORMI: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  PERDU: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
};

/**
 * Heure de prise de commande d'un client « fait » aujourd'hui.
 * Prend l'appel COMMANDE le plus récent (sinon le dernier appel logué),
 * et renvoie l'heure « HH:mm ». null si aucun appel exploitable.
 */
export function handledTimeLabel(client: Client): string | null {
  const appels = client.appels ?? [];
  if (appels.length === 0) return null;
  const commandes = appels.filter((a) => a.type === "COMMANDE");
  const pool = commandes.length > 0 ? commandes : appels;
  const latest = pool.reduce((a, b) =>
    new Date(b.heureAppel).getTime() > new Date(a.heureAppel).getTime() ? b : a,
  );
  const d = new Date(latest.heureAppel);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Libellé + couleur d'une issue d'appel (pastille du journal). */
export function appelBadge(a: AppelLog): { text: string; cls: string } {
  if (a.type === "COMMANDE")
    return { text: "Commande", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" };
  switch (a.outcome) {
    case "NRP":       return { text: "Pas de réponse", cls: "bg-secondary text-muted-foreground" };
    case "REPONDEUR": return { text: "Répondeur",      cls: "bg-secondary text-muted-foreground" };
    case "REFUS":     return { text: "Refus",          cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300" };
    case "LITIGE":    return { text: "Litige",         cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" };
    case "RAPPELE":   return { text: "Rappellera",     cls: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300" };
    default:          return { text: "À demain",       cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" };
  }
}
