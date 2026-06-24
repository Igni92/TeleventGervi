/**
 * Logique « prochaine livraison » — date de la prochaine tournée à préparer.
 *
 * RÈGLE MÉTIER (TeleVent) : on livre à J+1, SAUF le samedi où la prochaine
 * livraison saute le dimanche et tombe le lundi (J+2). Aucune livraison le
 * dimanche.
 *
 * Les JOURS FÉRIÉS ne sont PAS retirés automatiquement : la décision reste à
 * l'utilisateur (« je dois pouvoir renseigner le jour de livraison en cas de
 * jour férié »). On se contente de DÉTECTER le férié pour l'avertir, et on
 * propose le prochain jour ouvré via `nextWorkingDeliveryDay`.
 *
 * Tout est en date MURALE Europe/Paris (le serveur tourne en UTC) et purement
 * calendaire — testable hors-ligne, zéro I/O.
 */

import { parisDayOfWeek } from "./paris-time";

const TZ = "Europe/Paris";

/** Parts [année, mois(1-12), jour] de la date MURALE Paris à l'instant `ref`. */
function parisParts(ref: Date): [number, number, number] {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(ref)
    .split("-")
    .map(Number);
  return [y, m, d];
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Ajoute `days` jours calendaires à une date ISO « YYYY-MM-DD » → ISO. */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Jour de la semaine (0 = dimanche … 6 = samedi) d'une date ISO « YYYY-MM-DD ». */
export function isoDayOfWeek(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Date de la PROCHAINE livraison à partir de `ref` (heure de Paris), au format
 * ISO « YYYY-MM-DD » :
 *   • samedi  → J+2 (on saute le dimanche → livraison le lundi) ;
 *   • sinon   → J+1.
 */
export function nextDeliveryDate(ref: Date = new Date()): string {
  const [y, m, d] = parisParts(ref);
  const today = isoOf(y, m, d);
  const dow = parisDayOfWeek(ref); // 0 = dim … 6 = sam
  const offset = dow === 6 ? 2 : 1; // samedi → +2 (lundi), sinon +1
  return addDaysISO(today, offset);
}

/* ───────────────────────── Jours fériés français ─────────────────────────
   Fériés légaux métropolitains (calendrier civil). Pâques par l'algorithme de
   Meeus/Jones/Butcher (grégorien), le reste à date fixe. Mémoïsé par année. */

/** Dimanche de Pâques de `year` → parts [année, mois, jour]. */
function easterSunday(year: number): [number, number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mo = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mo + 114) / 31); // 3 = mars, 4 = avril
  const day = ((h + l - 7 * mo + 114) % 31) + 1;
  return [year, month, day];
}

const holidayCache = new Map<number, Map<string, string>>();

/** Map ISO « YYYY-MM-DD » → libellé du jour férié, pour l'année donnée. */
export function frenchHolidays(year: number): Map<string, string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const map = new Map<string, string>();
  const easter = isoOf(...easterSunday(year));

  map.set(isoOf(year, 1, 1), "Jour de l'An");
  map.set(addDaysISO(easter, 1), "Lundi de Pâques");
  map.set(isoOf(year, 5, 1), "Fête du Travail");
  map.set(isoOf(year, 5, 8), "Victoire 1945");
  map.set(addDaysISO(easter, 39), "Ascension");
  map.set(addDaysISO(easter, 50), "Lundi de Pentecôte");
  map.set(isoOf(year, 7, 14), "Fête nationale");
  map.set(isoOf(year, 8, 15), "Assomption");
  map.set(isoOf(year, 11, 1), "Toussaint");
  map.set(isoOf(year, 11, 11), "Armistice 1918");
  map.set(isoOf(year, 12, 25), "Noël");

  holidayCache.set(year, map);
  return map;
}

/** Libellé du jour férié pour une date ISO, ou `null` si jour ouvré. */
export function frenchHolidayLabel(iso: string): string | null {
  const year = Number(iso.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return frenchHolidays(year).get(iso) ?? null;
}

/** Vrai si la date ISO tombe un dimanche OU un jour férié (pas de livraison). */
export function isNonDeliveryDay(iso: string): boolean {
  return isoDayOfWeek(iso) === 0 || frenchHolidayLabel(iso) !== null;
}

/**
 * Prochain JOUR OUVRÉ livrable à partir de `iso` (inclus) : saute les dimanches
 * et les jours fériés. Sert au bouton « reporter au prochain jour ouvré ».
 */
export function nextWorkingDeliveryDay(iso: string): string {
  let cur = iso;
  // Garde-fou : au plus 14 itérations (jamais 2 semaines fériées d'affilée).
  for (let i = 0; i < 14 && isNonDeliveryDay(cur); i++) {
    cur = addDaysISO(cur, 1);
  }
  return cur;
}

/** Libellé long lisible, ex. « jeudi 25 juin 2026 » (capitalisable côté UI). */
export function formatDeliveryDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
