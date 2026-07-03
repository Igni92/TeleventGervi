/**
 * Affectation d'une ENTRÉE MARCHANDISE (EM / PurchaseDeliveryNote) à un
 * segment client — « Tous » (défaut), « Export », « GMS » ou « CHR ».
 *
 * Besoin métier (export) : les achats de dernière minute sont faits POUR un
 * client/segment précis (marchandise plus fraîche, sélectionnée) — ces lots ne
 * doivent PAS être mélangés avec ceux du stock GMS. L'affectation posée à la
 * réception pilote :
 *   • le CHOIX du lot à la création d'un BL télévente (lotResolver :
 *     resolveLotForSegment — le lot vient d'une EM du segment du client) ;
 *   • la PROPAGATION rétro à la réception (/api/sap/goods-receipts : les
 *     commandes à découvert du segment affecté sont servies en premier).
 *
 * Persistance : AppSetting, clé `emaffect:<DocNum>` → valeur = segment.
 * « TOUS » = absence de ligne (aucune restriction), pour rester léger.
 */
import { prisma } from "./prisma";

export type EmAffect = "TOUS" | "EXPORT" | "GMS" | "CHR";

const PREFIX = "emaffect:";
const SEGMENTS: EmAffect[] = ["TOUS", "EXPORT", "GMS", "CHR"];

/** Normalise une valeur libre (body API, UI) en affectation valide — défaut « TOUS ». */
export function normalizeEmAffect(v: unknown): EmAffect {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return (SEGMENTS as string[]).includes(s) ? (s as EmAffect) : "TOUS";
}

/** Pose (ou lève) l'affectation d'une EM. « TOUS » supprime la ligne (défaut). */
export async function setEmAffect(docNum: number, affect: EmAffect): Promise<void> {
  const key = PREFIX + docNum;
  if (affect === "TOUS") {
    await prisma.appSetting.deleteMany({ where: { key } });
    return;
  }
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: affect },
    create: { key, value: affect },
  });
}

/** Toutes les affectations connues, par DocNum d'EM (une requête). Les EM sans
 *  ligne sont « TOUS » (aucune restriction). Best-effort : map vide en cas d'échec. */
export async function getEmAffects(): Promise<Map<number, EmAffect>> {
  const m = new Map<number, EmAffect>();
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: PREFIX } } });
    for (const r of rows) {
      const docNum = Number(r.key.slice(PREFIX.length));
      const affect = normalizeEmAffect(r.value);
      if (Number.isFinite(docNum) && affect !== "TOUS") m.set(docNum, affect);
    }
  } catch { /* affectations indisponibles → tout est « TOUS » */ }
  return m;
}
