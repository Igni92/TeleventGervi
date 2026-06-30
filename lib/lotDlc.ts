/**
 * Fraîcheur / DLC des lots — fondation **côté TeleVent uniquement**.
 *
 * La DLC (date limite de consommation) n'existe PAS dans SAP : elle est saisie
 * et stockée ici, rattachée au numéro de lot « EM<DocNum> » d'un bon de
 * réception. On ne touche JAMAIS à la sélection de lot expédié (lib/lotResolver) :
 * cette couche ne sert qu'à RENDRE VISIBLE et SAISISSABLE la fraîcheur.
 *
 * Modèle Prisma associé : `LotDlc` (batchNumber unique, expirationDate nullable).
 */
import { prisma } from "@/lib/prisma";
import { parisStartOfDay } from "@/lib/paris-time";

/**
 * DLC connues pour un lot de numéros de lot. Renvoie une Map indexée par
 * batchNumber → date d'expiration (ou `null` si la DLC n'a pas été saisie).
 * Les batchNumbers inconnus sont absents de la Map (pas de clé).
 */
export async function getDlcMap(batchNumbers: string[]): Promise<Map<string, Date | null>> {
  const wanted = Array.from(new Set(batchNumbers.map((b) => b.trim()).filter(Boolean)));
  if (wanted.length === 0) return new Map();
  const rows = await prisma.lotDlc.findMany({
    where: { batchNumber: { in: wanted } },
    select: { batchNumber: true, expirationDate: true },
  });
  return new Map(rows.map((r) => [r.batchNumber, r.expirationDate ?? null]));
}

/** Saisie / mise à jour de la DLC d'un lot (upsert sur `batchNumber`). */
export async function setDlc(input: {
  batchNumber: string;
  itemCode?: string | null;
  expirationDate: Date | null;
  createdBy?: string | null;
}): Promise<void> {
  const batchNumber = input.batchNumber.trim();
  if (!batchNumber) throw new Error("batchNumber requis");
  const itemCode = input.itemCode?.trim() || null;
  const createdBy = input.createdBy?.trim() || null;
  await prisma.lotDlc.upsert({
    where: { batchNumber },
    create: { batchNumber, itemCode, expirationDate: input.expirationDate, createdBy },
    update: { itemCode, expirationDate: input.expirationDate, createdBy },
  });
}

export type FreshnessTone = "green" | "amber" | "red" | "muted";

/** Nombre de jours « pleins » (heure de Paris) entre aujourd'hui et la DLC. */
function daysUntil(expirationDate: Date): number {
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

  const days = daysUntil(d);
  // J-… = jours restants ; J+… = jours de dépassement (périmé).
  const rel = days > 0 ? `J-${days}` : `J+${Math.abs(days)}`;
  const tone: FreshnessTone = days > 3 ? "green" : days >= 1 ? "amber" : "red";
  return { label: `DLC ${rel}`, tone };
}
