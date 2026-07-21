/**
 * GROUPE d'ENTRÉES MARCHANDISES — « une EM par ligne ».
 *
 * Besoin métier : à la création d'une entrée marchandise (directe ou par
 * réception d'une commande fournisseur), CHAQUE ligne devient sa PROPRE
 * PurchaseDeliveryNote SAP (ex. 10 colis + 40 colis → 2 EM), pour avoir un
 * lot, une DLC et une annulation PAR article. Côté SAP, toutes les EM du
 * groupe partagent la même référence (« EM <n° de la 1re> - initiales à
 * heure ») et le même N° BL fournisseur.
 *
 * Côté Télévente, l'historique (/api/sap/goods-receipts GET) REGROUPE ces EM
 * en UNE SEULE entrée affichée — le n° d'EM propre à chaque ligne reste
 * visible sur la ligne. Ce module persiste l'appartenance au groupe.
 *
 * Persistance : AppSetting, une ligne PAR MEMBRE du groupe (y compris la
 * primaire) — clé `emgroup:<DocNum>` → valeur = DocNum de l'EM primaire
 * (la 1re créée, dont le n° est affiché). Une EM « historique » (multi-lignes,
 * d'avant le découpage) n'a aucune ligne → elle reste affichée seule.
 */
import { prisma } from "./prisma";

const PREFIX = "emgroup:";

/** Enregistre un groupe d'EM : chaque membre pointe vers l'EM primaire. */
export async function setEmGroup(primaryDocNum: number, memberDocNums: number[]): Promise<void> {
  const members = memberDocNums.filter((n) => Number.isFinite(n));
  if (members.length <= 1) return;   // groupe d'une seule EM = pas de groupe
  await prisma.$transaction(members.map((docNum) =>
    prisma.appSetting.upsert({
      where: { key: PREFIX + docNum },
      update: { value: String(primaryDocNum) },
      create: { key: PREFIX + docNum, value: String(primaryDocNum) },
    }),
  ));
}

/** Tous les groupes connus : DocNum d'EM → DocNum de l'EM primaire du groupe.
 *  Les EM sans ligne sont « seules ». Best-effort : map vide en cas d'échec. */
export async function getEmGroups(): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: PREFIX } } });
    for (const r of rows) {
      const docNum = Number(r.key.slice(PREFIX.length));
      const primary = Number(r.value);
      if (Number.isFinite(docNum) && Number.isFinite(primary)) m.set(docNum, primary);
    }
  } catch { /* groupes indisponibles → chaque EM s'affiche seule */ }
  return m;
}
