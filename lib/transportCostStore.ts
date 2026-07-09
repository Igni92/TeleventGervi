/**
 * Persistance du COÛT DE TRANSPORT — AppSetting (aucune migration).
 *
 *   • Modèle de coûts (direction)  → clé unique `transport:model` (JSON).
 *   • Dépenses transporteur        → clé `transportexp:<id>` (une par dépense,
 *     photos incluses) — même convention que l'inventaire (`inv:<id>`).
 *
 * Toutes les lectures sont défensives (JSON corrompu / clé absente → repli
 * silencieux). L'I/O est isolée ici ; le calcul pur vit dans lib/transportCost.
 */
import { prisma } from "@/lib/prisma";
import {
  EMPTY_TRANSPORT_MODEL,
  sanitizeTransportModel,
  type TransportCostModel,
  type TransportExpense,
} from "@/lib/transportCost";

const MODEL_KEY = "transport:model";
const EXP_PREFIX = "transportexp:";

/* ── Modèle de coûts (singleton direction) ─────────────────────────────────── */

/** Lit le modèle de coûts (repli EMPTY si absent/corrompu). Jamais d'exception. */
export async function getTransportModel(): Promise<TransportCostModel> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: MODEL_KEY } });
    if (!row) return EMPTY_TRANSPORT_MODEL;
    return sanitizeTransportModel(JSON.parse(row.value));
  } catch {
    return EMPTY_TRANSPORT_MODEL;
  }
}

/** Enregistre (upsert) le modèle de coûts. */
export async function setTransportModel(model: TransportCostModel): Promise<void> {
  const value = JSON.stringify(model);
  await prisma.appSetting.upsert({
    where: { key: MODEL_KEY },
    update: { value },
    create: { key: MODEL_KEY, value },
  });
}

/* ── Dépenses transporteur (une clé par dépense) ───────────────────────────── */

/** Liste toutes les dépenses, plus récentes d'abord. Lignes corrompues ignorées. */
export async function listTransportExpenses(): Promise<TransportExpense[]> {
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: EXP_PREFIX } } });
  const out: TransportExpense[] = [];
  for (const r of rows) {
    try { out.push(JSON.parse(r.value) as TransportExpense); } catch { /* ignore */ }
  }
  return out.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
}

/** Une dépense complète (photos incluses). */
export async function getTransportExpense(id: string): Promise<TransportExpense | null> {
  const r = await prisma.appSetting.findUnique({ where: { key: EXP_PREFIX + id } });
  if (!r) return null;
  try { return JSON.parse(r.value) as TransportExpense; } catch { return null; }
}

/** Crée / remplace une dépense. */
export async function saveTransportExpense(e: TransportExpense): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: EXP_PREFIX + e.id },
    update: { value: JSON.stringify(e) },
    create: { key: EXP_PREFIX + e.id, value: JSON.stringify(e) },
  });
}

/** Supprime une dépense (no-op si absente). */
export async function deleteTransportExpense(id: string): Promise<void> {
  try { await prisma.appSetting.delete({ where: { key: EXP_PREFIX + id } }); } catch { /* déjà absente */ }
}
