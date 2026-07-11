/**
 * Persistance SERVEUR de la config des garde-fous de vente (lib/safeguards.ts).
 *
 * Une seule clé AppSetting (`safeguards_config`, JSON) — même mécanique que les
 * paramètres de relance (lib/relance/params.ts) : surchargeable sans redéploiement,
 * PARTAGÉE par tous les postes (contrairement aux réglages d'affichage localStorage).
 *
 * Cache module-level court (30 s) : la config est relue à chaque création de
 * commande — on évite un aller-retour DB par POST sans retarder sensiblement
 * la prise d'effet d'un changement de seuil.
 */
import { prisma } from "@/lib/prisma";
import {
  normalizeSafeguardsConfig,
  type SafeguardsConfig,
} from "@/lib/safeguards";

export const SAFEGUARDS_SETTING_KEY = "safeguards_config";

const TTL = 30 * 1000;
let cache: { at: number; config: SafeguardsConfig } | null = null;

/** Config courante (AppSetting + défauts). Best-effort : DB indisponible → défauts. */
export async function getSafeguardsConfig(): Promise<SafeguardsConfig> {
  if (cache && Date.now() - cache.at < TTL) return cache.config;
  let raw: unknown = null;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: SAFEGUARDS_SETTING_KEY } });
    if (row?.value) raw = JSON.parse(row.value);
  } catch { /* DB indispo ou JSON corrompu → défauts */ }
  const config = normalizeSafeguardsConfig(raw);
  cache = { at: Date.now(), config };
  return config;
}

/** Écrit la config (normalisée) et invalide le cache. Retourne la version stockée. */
export async function saveSafeguardsConfig(raw: unknown): Promise<SafeguardsConfig> {
  const config = normalizeSafeguardsConfig(raw);
  const value = JSON.stringify(config);
  await prisma.appSetting.upsert({
    where: { key: SAFEGUARDS_SETTING_KEY },
    update: { value },
    create: { key: SAFEGUARDS_SETTING_KEY, value },
  });
  cache = { at: Date.now(), config };
  return config;
}
