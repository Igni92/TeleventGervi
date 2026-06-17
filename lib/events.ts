/**
 * Système d'événements commerciaux — fenêtre « ce qui se passe maintenant ».
 *
 * S'appuie sur le calendrier `COMMERCIAL_EVENTS` (lib/iso-week) : chaque
 * événement sait calculer sa date pour une année donnée. Ici on dérive, pour
 * une date de référence, les événements situés dans une fenêtre [réf − N j,
 * réf + N j] (par défaut 1 semaine de part et d'autre — cf. demande métier).
 *
 * Pur (aucun import Prisma / réseau) → testable directement en vitest, et
 * calculable côté client à partir de la date locale (= heure de Paris du poste).
 */
import { COMMERCIAL_EVENTS } from "./iso-week";

export interface UpcomingEvent {
  key: string;
  label: string;
  emoji: string;
  /** Date de l'occurrence (heure locale, 00:00). */
  date: Date;
  /** Décalage en jours vs la date de référence : <0 passé, 0 aujourd'hui, >0 à venir. */
  daysFromRef: number;
}

/** Minuit local d'une date (ignore l'heure). */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Événements dans la fenêtre [réf − before, réf + after] jours (défaut : 7/7).
 * Gère le passage d'année : un événement de début janvier reste visible fin
 * décembre (et inversement) car on teste l'occurrence des années réf−1/réf/réf+1.
 * Trié par date croissante (le plus proche dans le passé d'abord, puis à venir).
 */
export function eventsInWindow(
  ref: Date = new Date(),
  { before = 7, after = 7 }: { before?: number; after?: number } = {},
): UpcomingEvent[] {
  const ref0 = startOfDay(ref);
  const lo = new Date(ref0); lo.setDate(lo.getDate() - before);
  const hi = new Date(ref0); hi.setDate(hi.getDate() + after);
  const y = ref.getFullYear();

  const out: UpcomingEvent[] = [];
  for (const ev of COMMERCIAL_EVENTS) {
    for (const yy of [y - 1, y, y + 1]) {
      const day = startOfDay(ev.date(yy));
      if (day >= lo && day <= hi) {
        out.push({
          key: ev.key,
          label: ev.label,
          emoji: ev.emoji,
          date: day,
          daysFromRef: Math.round((day.getTime() - ref0.getTime()) / 86_400_000),
        });
      }
    }
  }
  out.sort((a, b) => a.date.getTime() - b.date.getTime());
  return out;
}

/** Libellé relatif court et lisible : « aujourd'hui », « dans 3 j », « il y a 2 j ». */
export function relativeDayLabel(daysFromRef: number): string {
  if (daysFromRef === 0) return "aujourd'hui";
  if (daysFromRef === 1) return "demain";
  if (daysFromRef === -1) return "hier";
  return daysFromRef > 0 ? `dans ${daysFromRef} j` : `il y a ${-daysFromRef} j`;
}
