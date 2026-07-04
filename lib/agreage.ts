import { prisma } from "./prisma";

/**
 * AGRÉAGE des réceptions (contrôle qualité à l'arrivée de la marchandise).
 *
 * L'AGRÉEUR (User.isAgreeur — cf. lib/permissions.requireCanReceivePurchaseOrder)
 * agrée chaque ENTRÉE MARCHANDISE (PurchaseDeliveryNote SAP) :
 *   • CONFORME — marchandise acceptée telle quelle ;
 *   • RESERVE  — acceptée AVEC RÉSERVE (type + note obligatoires côté UI) ;
 *     une réserve ouvre automatiquement un incident de réception (litige
 *     fournisseur, cf. ReceptionIncident) pour le suivi.
 *
 * Persisté par DocEntry de l'EM en AppSetting (clé `agreage:<docEntry>`) — même
 * mécanique que les statuts « Détail livraison » (lib/inventory). NE PAS
 * confondre avec la « réserve de segment » d'une EM (lib/emAffect : lot réservé
 * à un segment client), qui est un concept commercial sans lien avec la qualité.
 */

export type AgreageStatus = "CONFORME" | "RESERVE";

export interface Agreage {
  status: AgreageStatus;
  /** Type de réserve (mêmes types que les incidents : Qualité, Manquant, Casse,
   *  Température, Prix, Autre) — null si conforme. */
  type: string | null;
  note: string | null;
  by: string;
  at: string;
}

const AGREAGE_PREFIX = "agreage:";

/** Agréage d'UNE entrée marchandise — null si jamais agréée. */
export async function getAgreage(docEntry: number): Promise<Agreage | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: AGREAGE_PREFIX + docEntry } });
    if (!row) return null;
    return JSON.parse(row.value) as Agreage;
  } catch {
    return null;
  }
}

/** Agréages d'un LOT d'entrées marchandises en une requête (liste /entrees). */
export async function getAgreages(docEntries: number[]): Promise<Map<number, Agreage>> {
  const out = new Map<number, Agreage>();
  if (!docEntries.length) return out;
  try {
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: docEntries.map((d) => AGREAGE_PREFIX + d) } },
    });
    for (const r of rows) {
      const docEntry = Number(r.key.slice(AGREAGE_PREFIX.length));
      if (!Number.isFinite(docEntry)) continue;
      try { out.set(docEntry, JSON.parse(r.value) as Agreage); } catch { /* valeur illisible → non agréée */ }
    }
  } catch { /* table absente → aucune marque */ }
  return out;
}

/** Pose (ou remplace) l'agréage d'une EM. Renvoie l'horodatage. */
export async function setAgreage(
  docEntry: number,
  data: { status: AgreageStatus; type?: string | null; note?: string | null; by: string },
): Promise<string> {
  const at = new Date().toISOString();
  const value = JSON.stringify({
    status: data.status,
    type: data.status === "RESERVE" ? (data.type?.trim() || "Qualité") : null,
    note: data.note?.trim() || null,
    by: data.by,
    at,
  } satisfies Agreage);
  const key = AGREAGE_PREFIX + docEntry;
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  return at;
}

/**
 * Pose l'agréage d'une EM ET applique l'invariant métier « réserve ⇒ incident
 * de réception » en un seul point d'entrée (utilisé par la réception CF → EM et
 * par l'agréage a posteriori). Renvoie l'Agreage normalisé enregistré.
 */
export async function applyAgreage(params: {
  docEntry: number; docNum: number | null; lot?: string | null;
  cardCode?: string | null; cardName?: string | null;
  status: AgreageStatus; type?: string | null; note?: string | null; by: string;
}): Promise<Agreage> {
  const type = params.status === "RESERVE" ? (params.type?.trim() || "Qualité") : null;
  const note = params.note?.trim() || null;
  const at = await setAgreage(params.docEntry, { status: params.status, type, note, by: params.by });
  if (params.status === "RESERVE") {
    await openReserveIncident({
      docEntry: params.docEntry, docNum: params.docNum, lot: params.lot,
      cardCode: params.cardCode, cardName: params.cardName,
      type: type ?? "Qualité", note, by: params.by,
    });
  }
  return { status: params.status, type, note, by: params.by, at };
}

/** Une RÉSERVE d'agréage ouvre un incident de réception (suivi litige fournisseur).
 *  Best-effort : l'échec de l'incident ne doit jamais faire échouer l'agréage. */
async function openReserveIncident(params: {
  docEntry: number; docNum: number | null; lot?: string | null;
  cardCode?: string | null; cardName?: string | null;
  type: string; note?: string | null; by: string;
}): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO "ReceptionIncident"
        ("id","docEntry","docNum","lot","cardCode","cardName","itemCode","type","note","createdBy")
      VALUES (
        gen_random_uuid()::text,
        ${params.docEntry}, ${params.docNum ?? null}, ${params.lot?.trim() || null},
        ${params.cardCode?.trim() || null}, ${params.cardName?.trim() || null},
        ${null}, ${params.type.trim() || "Qualité"},
        ${["Réserve d'agréage", params.note?.trim() || null].filter(Boolean).join(" — ")},
        ${params.by}
      )`;
  } catch (e) {
    console.warn("[agreage] incident de réserve non créé (non-bloquant):", (e as Error).message);
  }
}
