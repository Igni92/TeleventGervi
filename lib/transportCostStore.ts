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
  sanitizeClientPricing,
  normCarrier,
  type TransportCostModel,
  type TransportExpense,
  type ClientCarrierPricing,
} from "@/lib/transportCost";
import { sanitizeCarrierTariff, type CarrierTariff, type CarrierTariffMap } from "@/lib/carrierTariff";

const MODEL_KEY = "transport:model";
const EXP_PREFIX = "transportexp:";
const CLIENT_PRICING_PREFIX = "transportcli:";
const CARRIER_TARIFF_PREFIX = "transporttarif:";

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

/* ── Tarif transport par CLIENT × transporteur (transporteurs non directs) ──── */

/** Tarifs €/kg d'un client par transporteur (repli {} si absent/corrompu). */
export async function getClientTransportPricing(clientId: string): Promise<ClientCarrierPricing> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: CLIENT_PRICING_PREFIX + clientId } });
    if (!row) return {};
    return sanitizeClientPricing(JSON.parse(row.value));
  } catch {
    return {};
  }
}

/** Enregistre (ou vide) les tarifs transport d'un client. */
export async function setClientTransportPricing(clientId: string, pricing: ClientCarrierPricing): Promise<void> {
  const key = CLIENT_PRICING_PREFIX + clientId;
  const clean = sanitizeClientPricing(pricing);
  if (Object.keys(clean).length === 0) {
    try { await prisma.appSetting.delete({ where: { key } }); } catch { /* déjà absente */ }
    return;
  }
  const value = JSON.stringify(clean);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/* ── Grilles tarifaires par TRANSPORTEUR externe (coût par position) ───────── */

/** Grille d'un transporteur (null si absente/corrompue). */
export async function getCarrierTariff(carrierCode: string): Promise<CarrierTariff | null> {
  const code = normCarrier(carrierCode);
  if (!code) return null;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: CARRIER_TARIFF_PREFIX + code } });
    if (!row) return null;
    return sanitizeCarrierTariff(JSON.parse(row.value));
  } catch {
    return null;
  }
}

/** Toutes les grilles, indexées par code transporteur (MAJUSCULES). */
export async function listCarrierTariffs(): Promise<CarrierTariffMap> {
  const out: CarrierTariffMap = {};
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: CARRIER_TARIFF_PREFIX } } });
    for (const r of rows) {
      const code = normCarrier(r.key.slice(CARRIER_TARIFF_PREFIX.length));
      if (!code) continue;
      try { out[code] = sanitizeCarrierTariff(JSON.parse(r.value)); } catch { /* ignore */ }
    }
  } catch { /* pas de grilles */ }
  return out;
}

/** Enregistre (ou supprime si vide : ni zone ni ligne annexe) une grille. */
export async function setCarrierTariff(tariff: CarrierTariff): Promise<void> {
  const clean = sanitizeCarrierTariff(tariff);
  if (!clean.carrierCode) return;
  const key = CARRIER_TARIFF_PREFIX + clean.carrierCode;
  if (clean.zones.length === 0 && clean.extras.length === 0) {
    try { await prisma.appSetting.delete({ where: { key } }); } catch { /* déjà absente */ }
    return;
  }
  const value = JSON.stringify(clean);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
