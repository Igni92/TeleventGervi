/**
 * Fraîcheur / DDM des lots — fondation **côté TeleVent uniquement**.
 *
 * La DDM (date limite de consommation) n'existe PAS dans SAP : elle est saisie
 * et stockée ici, rattachée au numéro de lot « EM<DocNum> » d'un bon de
 * réception. On ne touche JAMAIS à la sélection de lot expédié (lib/lotResolver) :
 * cette couche ne sert qu'à RENDRE VISIBLE et SAISISSABLE la fraîcheur.
 *
 * Modèle Prisma associé : `LotDlc` (batchNumber unique, expirationDate nullable).
 */
import { prisma } from "@/lib/prisma";

// Logique PURE (seuils, libellé) déportée dans `lib/freshness.ts` : ce module-ci
// importe Prisma, donc il est inutilisable depuis un composant client. On
// ré-exporte pour ne rien casser chez les appelants serveur existants.
export { freshnessLabel, daysUntilDdm, isDdmSoon, DDM_SOON_DAYS, type FreshnessTone } from "@/lib/freshness";

/**
 * DDM connues pour un lot de numéros de lot. Renvoie une Map indexée par
 * batchNumber → date d'expiration (ou `null` si la DDM n'a pas été saisie).
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

/** Saisie / mise à jour de la DDM d'un lot (upsert sur `batchNumber`). */
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

