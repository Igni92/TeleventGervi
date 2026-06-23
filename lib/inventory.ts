import { prisma } from "@/lib/prisma";

/**
 * Inventaire (comptage du préparateur) — stocké dans la table clé/valeur
 * AppSetting (clé `inv:<id>`, valeur = JSON), pour éviter toute migration.
 *
 * Cycle : un préparateur saisit le stock RÉEL en face du stock SAP → une
 * session « submitted » est créée avec les écarts ; les administrateurs la
 * voient (badge + écarts) et la marquent « reviewed ».
 */

const PREFIX = "inv:";

export interface InventoryLine {
  itemCode: string;
  itemName: string;
  sapQty: number;        // stock SAP au moment de la saisie
  realQty: number;       // stock compté par le préparateur
  unit: string;          // unité affichée (colis / kg…)
  ecart: number;         // realQty − sapQty
}
export interface InventorySession {
  id: string;
  status: "submitted" | "reviewed";
  createdBy: string;     // email du préparateur
  note: string;
  lines: InventoryLine[];
  nbEcarts: number;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

/** Liste blanche des emails préparateurs (env, séparés par des virgules). */
export function isPreparateurEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.PREPARATEUR_EMAILS || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

export async function listSessions(): Promise<InventorySession[]> {
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: PREFIX } } });
  const out: InventorySession[] = [];
  for (const r of rows) {
    try { out.push(JSON.parse(r.value) as InventorySession); } catch { /* ignore ligne corrompue */ }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getSession(id: string): Promise<InventorySession | null> {
  const r = await prisma.appSetting.findUnique({ where: { key: PREFIX + id } });
  if (!r) return null;
  try { return JSON.parse(r.value) as InventorySession; } catch { return null; }
}

export async function saveSession(s: InventorySession): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: PREFIX + s.id },
    update: { value: JSON.stringify(s) },
    create: { key: PREFIX + s.id, value: JSON.stringify(s) },
  });
}
