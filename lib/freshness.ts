/**
 * Fraîcheur / DLC — logique PURE (aucun I/O, aucun import Prisma).
 *
 * Extraite de `lib/lotDlc.ts` : ce dernier importe `@/lib/prisma` au niveau
 * module, donc l'importer depuis un composant CLIENT embarquerait Prisma dans le
 * bundle navigateur. Faute de ce module, la logique avait déjà été recopiée à
 * l'identique dans l'écran de réception — et il fallait la recopier une 3ᵉ fois
 * pour la console. Une seule définition ici, partagée serveur ET client, évite
 * que les seuils divergent d'un écran à l'autre.
 *
 * `lib/lotDlc.ts` (serveur) ré-exporte ces symboles : les appelants existants
 * n'ont rien à changer.
 */
import { parisStartOfDay } from "@/lib/paris-time";

export type FreshnessTone = "green" | "amber" | "red" | "muted";

/** Nombre de jours « pleins » (heure de Paris) entre aujourd'hui et la DLC. */
export function daysUntilDlc(expirationDate: Date): number {
  const today = parisStartOfDay().getTime();
  const due = parisStartOfDay(expirationDate).getTime();
  return Math.round((due - today) / 86_400_000);
}

/**
 * Étiquette + ton d'une DLC pour l'affichage :
 *   - `null`/absent → « DLC non saisie » (muted)
 *   - > 3 j         → vert
 *   - 1 à 3 j       → ambre
 *   - ≤ 0 j         → rouge (périmée ou expire aujourd'hui)
 * Le libellé indique l'échéance relative : « DLC J-3 » (dans 3 j), « DLC J+0 »
 * (aujourd'hui), « DLC J+2 » (périmée depuis 2 j).
 */
export function freshnessLabel(
  expirationDate: Date | null | undefined,
): { label: string; tone: FreshnessTone } {
  if (!expirationDate) return { label: "DLC non saisie", tone: "muted" };
  const d = expirationDate instanceof Date ? expirationDate : new Date(expirationDate);
  if (Number.isNaN(d.getTime())) return { label: "DLC non saisie", tone: "muted" };

  const days = daysUntilDlc(d);
  // J-… = jours restants ; J+… = jours de dépassement (périmé).
  const rel = days > 0 ? `J-${days}` : `J+${Math.abs(days)}`;
  const tone: FreshnessTone = days > 3 ? "green" : days >= 1 ? "amber" : "red";
  return { label: `DLC ${rel}`, tone };
}

/** Seuil « DLC proche » : à partir de combien de jours restants on alerte.
 *  Aligné sur le passage au ton ambre de `freshnessLabel` (≤ 3 j). */
export const DLC_SOON_DAYS = 3;

/** Vrai si la DLC mérite une alerte à la vente (proche OU dépassée). */
export function isDlcSoon(expirationDate: Date | string | null | undefined): boolean {
  if (!expirationDate) return false;
  const d = expirationDate instanceof Date ? expirationDate : new Date(expirationDate);
  if (Number.isNaN(d.getTime())) return false;
  return daysUntilDlc(d) <= DLC_SOON_DAYS;
}
