/**
 * Temps « jour ouvré » en fuseau Europe/Paris — le serveur tourne en UTC mais
 * l'activité (file d'appel, présence, couverture, stats du jour) raisonne en
 * heure FRANÇAISE. Sans ça, le « jour » bascule à 02h heure de Paris (l'été) →
 * la file affiche les mauvais clients en soirée et les bornes de jour/mois sont
 * décalées.
 *
 * Implémentation 100 % `Intl` (aucune dépendance) → déterministe quelle que
 * soit la TZ du process. DST gérée : l'offset est calculé à l'instant visé
 * (minuit n'est jamais dans le trou de passage à l'heure d'été en France).
 */
const TZ = "Europe/Paris";

/** Offset (ms) entre l'heure murale de `tz` et UTC à l'instant `date`. */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

/** Instant UTC du début de journée (00:00 heure de Paris) contenant `ref`. */
export function parisStartOfDay(ref: Date = new Date()): Date {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(ref).split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  return new Date(guess - tzOffsetMs(new Date(guess), TZ));
}

/** Début de la journée SUIVANTE (borne haute exclusive du jour de Paris). */
export function parisEndOfDay(ref: Date = new Date()): Date {
  const start = parisStartOfDay(ref);
  // +25h puis re-normalisé : absorbe les jours de 23h/25h (changement d'heure).
  return parisStartOfDay(new Date(start.getTime() + 25 * 3600_000));
}

/** Jour de la semaine à Paris : 0 = dimanche … 6 = samedi (comme Date.getDay()). */
export function parisDayOfWeek(ref: Date = new Date()): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(ref);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

// Formatteur réutilisé (coûteux à instancier) pour extraire heure+minute murales
// de Paris. Indispensable pour l'analyse comportementale : le serveur tourne en
// UTC → `Date.getHours()` renverrait l'heure UTC (décalage 1–2 h), ce qui
// fausserait « l'heure où le client décroche » ET le tri de la file.
const HM_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** Heure + minute murales à Paris (0–23 / 0–59) pour un instant donné. */
export function parisHourMinute(ref: Date): { hour: number; minute: number } {
  const p = Object.fromEntries(HM_FMT.formatToParts(ref).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour), minute: Number(p.minute) };
}

/** Heure murale à Paris (0–23) — pratique quand la minute n'importe pas. */
export function parisHour(ref: Date): number {
  return parisHourMinute(ref).hour;
}
