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

// ── Durée de vie par GROUPE de fruits (#1/#6) ──────────────────────────────
// Stockée dans AppSetting (clé→JSON) pour éviter une table dédiée : 7 clés fixes.
const GROUP_SETTING_KEY = "dlc_group_days";

/** Map { groupKey → jours } des durées de vie par groupe (valeurs > 0 seulement). */
export async function getGroupShelfLife(): Promise<Record<string, number>> {
  const row = await prisma.appSetting.findUnique({ where: { key: GROUP_SETTING_KEY } });
  if (!row?.value) return {};
  try {
    const obj = JSON.parse(row.value) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = Math.round(n);
    }
    return out;
  } catch {
    return {};
  }
}

/** Définit (days > 0) ou retire (days ≤ 0) la durée de vie d'un groupe. */
export async function setGroupDays(groupKey: string, days: number): Promise<void> {
  const key = groupKey.trim();
  if (!key) throw new Error("groupKey requis");
  const cur = await getGroupShelfLife();
  if (days <= 0) delete cur[key];
  else cur[key] = Math.round(days);
  await prisma.appSetting.upsert({
    where: { key: GROUP_SETTING_KEY },
    create: { key: GROUP_SETTING_KEY, value: JSON.stringify(cur) },
    update: { value: JSON.stringify(cur) },
  });
}
