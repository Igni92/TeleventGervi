import { prisma } from "@/lib/prisma";

/**
 * Réglages RH globaux (AppSetting KV). Pour l'instant : activation de la badgeuse.
 * Badgeuse OFF → on ne lit plus les pointages : les salariés sont réputés présents
 * aux horaires de leur contrat (journée-type lun→ven), les absences approuvées
 * (congés/récup/maladie/fériés) restant déduites.
 */
const BADGEUSE_KEY = "rh:badgeuse:enabled";

export async function isBadgeuseEnabled(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: BADGEUSE_KEY } });
  if (!row) return true; // défaut : activée
  return row.value !== "0" && row.value.toLowerCase() !== "false";
}

export async function setBadgeuseEnabled(v: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: BADGEUSE_KEY },
    create: { key: BADGEUSE_KEY, value: v ? "1" : "0" },
    update: { value: v ? "1" : "0" },
  });
}
