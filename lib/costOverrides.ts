/**
 * COÛTS CORRIGÉS PAR ARTICLE (override du prix de revient).
 *
 * Certains articles ont dans SAP un `lineCost` MANQUANT (0/null) ou ABERRANT
 * (largement sous-évalué → marge 90-100 % impossible). On ne peut pas corriger la
 * valorisation SAP sans écriture comptable sensible ; on maintient donc côté app
 * un coût unitaire CORRIGÉ par article, appliqué par le moteur de commission à la
 * place du coût SAP (missing OU aberrant). Source recommandée : le PRIX D'ACHAT
 * réel (SapPdnLine). Réversible, versionné, ne touche AUCUN document SAP.
 *
 * Stockage : une clé AppSetting `costoverride:v1` = JSON { itemCode: coûtUnitaire }.
 */
import { prisma } from "@/lib/prisma";

const KEY = "costoverride:v1";

export type CostOverrides = Record<string, number>;

export async function loadCostOverrides(): Promise<CostOverrides> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
    if (!row) return {};
    const raw = JSON.parse(row.value) as Record<string, unknown>;
    const out: CostOverrides = {};
    for (const [item, v] of Object.entries(raw)) {
      const c = Number(v);
      if (item && Number.isFinite(c) && c >= 0) out[item] = c;
    }
    return out;
  } catch { return {}; }
}

export async function saveCostOverrides(overrides: CostOverrides): Promise<CostOverrides> {
  const clean: CostOverrides = {};
  for (const [item, v] of Object.entries(overrides)) {
    const c = Number(v);
    if (item && Number.isFinite(c) && c >= 0) clean[item] = Math.round(c * 10000) / 10000;
  }
  const value = JSON.stringify(clean);
  await prisma.appSetting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
  return clean;
}

/** Coûts corrigés → paires (itemCode, coût) pour injection SQL (unnest). */
export function overridesToArrays(o: CostOverrides): { items: string[]; costs: number[] } {
  const items: string[] = [];
  const costs: number[] = [];
  for (const [item, c] of Object.entries(o)) { items.push(item); costs.push(c); }
  return { items, costs };
}
