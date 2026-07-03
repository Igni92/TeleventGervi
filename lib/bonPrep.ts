/**
 * BONS DE PRÉPARATION (hors SAP) — circuit EXPORT.
 *
 * Métier : pour l'export, la marchandise est souvent achetée à la dernière
 * minute (plus fraîche, sélectionnée) — les lots ne sont connus qu'à la
 * réception. La saisie télévente d'un client EXPORT ne crée donc PAS le BL SAP
 * directement : elle enregistre un BON DE PRÉPARATION ; on y AFFECTE ensuite
 * tous les lots (arrivages dédiés, cf. lib/emAffect), puis on crée le BL SAP
 * « proprement » avec ces lots (repost de /api/sap/orders avec bonPrepId +
 * lot par ligne).
 *
 * Persistance : AppSetting, clé `bonprep:<id>` → valeur JSON (BonPrep). Les
 * bons transformés sont purgés au bout de 7 jours (lors des listages).
 */
import { prisma } from "./prisma";

/** Ligne telle qu'envoyée à /api/sap/orders (miroir de son OrderLine). */
export interface BonPrepOrderLine {
  itemCode: string;
  itemName?: string;
  quantity: number;              // pièces SAP
  displayQuantity?: number;      // colis affichés à la saisie
  displayUnit?: string;
  warehouseCode?: string;
  price?: number;
  discountPercent?: number;
  /** Lot affecté — rempli au moment de la transformation. */
  lot?: string;
}

/** Corps d'ordre à rejouer tel quel sur /api/sap/orders à la transformation. */
export interface BonPrepOrderBody {
  clientId: string;
  deliveryModeId?: string;
  trspCode?: string;
  trspHeure?: string;
  tournee?: { nom?: string | null; des?: string | null; lineId?: number | null };
  deliveryDate: string;
  numAtCard?: string;
  comments?: string;
  lines: BonPrepOrderLine[];
}

export interface BonPrep {
  id: string;
  createdAt: string;             // ISO
  createdBy: string | null;      // nom/email du vendeur
  clientName: string;
  cardCode: string;
  segment: string | null;        // EXPORT (périmètre actuel)
  status: "A_AFFECTER" | "TRANSFORME";
  /** Lot choisi par ligne (index aligné sur orderBody.lines) — null = à affecter. */
  lots: (string | null)[];
  orderBody: BonPrepOrderBody;
  /** Renseigné à la transformation en BL SAP. */
  result?: { docNum: number; docEntry: number; at: string } | null;
}

const PREFIX = "bonprep:";
const TRANSFORMED_TTL_MS = 7 * 86_400_000;

function newId(): string {
  return `bp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Crée un bon de préparation (statut « à affecter », aucun lot posé). */
export async function createBonPrep(input: {
  createdBy: string | null;
  clientName: string;
  cardCode: string;
  segment: string | null;
  orderBody: BonPrepOrderBody;
}): Promise<BonPrep> {
  const bon: BonPrep = {
    id: newId(),
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    clientName: input.clientName,
    cardCode: input.cardCode,
    segment: input.segment,
    status: "A_AFFECTER",
    lots: input.orderBody.lines.map(() => null),
    orderBody: input.orderBody,
    result: null,
  };
  await prisma.appSetting.create({ data: { key: PREFIX + bon.id, value: JSON.stringify(bon) } });
  return bon;
}

export async function getBonPrep(id: string): Promise<BonPrep | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: PREFIX + id } });
    return row ? (JSON.parse(row.value) as BonPrep) : null;
  } catch {
    return null;
  }
}

/** Réécrit un bon (id inchangé). */
export async function saveBonPrep(bon: BonPrep): Promise<void> {
  const key = PREFIX + bon.id;
  const value = JSON.stringify(bon);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function deleteBonPrep(id: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: PREFIX + id } });
}

/** Tous les bons, plus récents d'abord. Purge (best-effort) les bons
 *  TRANSFORMÉS de plus de 7 jours au passage. */
export async function listBonPreps(): Promise<BonPrep[]> {
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: PREFIX } } });
  const bons: BonPrep[] = [];
  const stale: string[] = [];
  const now = Date.now();
  for (const r of rows) {
    let bon: BonPrep;
    try { bon = JSON.parse(r.value) as BonPrep; } catch { continue; }
    if (bon.status === "TRANSFORME" && bon.result?.at && now - Date.parse(bon.result.at) > TRANSFORMED_TTL_MS) {
      stale.push(r.key);
      continue;
    }
    bons.push(bon);
  }
  if (stale.length) {
    prisma.appSetting.deleteMany({ where: { key: { in: stale } } }).catch(() => { /* purge best-effort */ });
  }
  return bons.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Pose les lots choisis (index alignés sur orderBody.lines). */
export async function setBonPrepLots(id: string, lots: (string | null)[]): Promise<BonPrep | null> {
  const bon = await getBonPrep(id);
  if (!bon || bon.status === "TRANSFORME") return null;
  if (!Array.isArray(lots) || lots.length !== bon.orderBody.lines.length) return null;
  bon.lots = lots.map((l) => (typeof l === "string" && l.trim() ? l.trim() : null));
  await saveBonPrep(bon);
  return bon;
}

/** Marque le bon transformé en BL SAP (appelé par /api/sap/orders au succès). */
export async function markBonPrepTransformed(
  id: string,
  result: { docNum: number; docEntry: number },
): Promise<void> {
  const bon = await getBonPrep(id);
  if (!bon) return;
  bon.status = "TRANSFORME";
  bon.result = { ...result, at: new Date().toISOString() };
  await saveBonPrep(bon);
}
