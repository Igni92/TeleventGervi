import { prisma } from "@/lib/prisma";

/**
 * Durée de vie par défaut (en JOURS) par article — réglée dans les Paramètres.
 * Sert à pré-remplir la DLC à la réception (date de réception + days). Côté
 * TeleVent uniquement (ne touche pas SAP).
 */
export async function getShelfLifeMap(): Promise<Record<string, number>> {
  const rows = await prisma.itemShelfLife.findMany({ select: { itemCode: true, days: true } });
  const map: Record<string, number> = {};
  for (const r of rows) map[r.itemCode] = r.days;
  return map;
}

export async function setShelfLife(
  itemCode: string,
  days: number,
  createdBy?: string | null,
): Promise<void> {
  const code = itemCode.trim();
  if (!code) throw new Error("itemCode requis");
  await prisma.itemShelfLife.upsert({
    where: { itemCode: code },
    create: { itemCode: code, days, createdBy: createdBy ?? null },
    update: { days, createdBy: createdBy ?? null },
  });
}

export async function removeShelfLife(itemCode: string): Promise<void> {
  const code = itemCode.trim();
  if (!code) return;
  await prisma.itemShelfLife.deleteMany({ where: { itemCode: code } });
}
