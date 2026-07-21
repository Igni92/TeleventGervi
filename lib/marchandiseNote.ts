/**
 * NOTE QUALITÉ DE LA MARCHANDISE (1 à 5 étoiles) — côté TeleVent uniquement.
 *
 * À la réception, on note la qualité de chaque article reçu (1★ à 5★). La note
 * n'existe pas dans SAP : on la stocke dans AppSetting (clé/valeur JSON, comme le
 * reste de l'état TeleVent — aucune migration).
 *
 *   • `artnote:<itemCode>`        → note COURANTE de l'article (dernier arrivage
 *     noté) : { rating, lot, by, at }. Lue par la console pour afficher les étoiles.
 *   • `lotnote:<itemCode>:<lot>`  → note du LOT précis : { rating, by, at }.
 *     Lue par le détail des lots (clic droit).
 */
import { prisma } from "@/lib/prisma";

const ART_PREFIX = "artnote:";
const LOT_PREFIX = "lotnote:";

/** Ramène une valeur quelconque à une note entière 1..5, ou null si invalide. */
export function sanitizeRating(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 1 && r <= 5 ? r : null;
}

interface ArtNote { rating: number; lot: string | null; by: string | null; at: string }

/**
 * Enregistre la note d'un article pour un lot donné (réception). Écrit la note du
 * LOT et met à jour la note COURANTE de l'article (dernier arrivage noté).
 * Best-effort : ne jamais casser la réception.
 */
export async function setMarchandiseNote(
  itemCode: string,
  lot: string | null,
  rating: number,
  by: string | null,
): Promise<void> {
  const code = (itemCode ?? "").trim();
  const r = sanitizeRating(rating);
  if (!code || r == null) return;
  const at = new Date().toISOString();
  const cleanBy = by?.trim() || null;
  const cleanLot = lot?.trim() || null;

  const writes: Promise<unknown>[] = [];
  // Note courante de l'article (pour la console).
  const artVal = JSON.stringify({ rating: r, lot: cleanLot, by: cleanBy, at } satisfies ArtNote);
  writes.push(prisma.appSetting.upsert({
    where: { key: ART_PREFIX + code },
    update: { value: artVal },
    create: { key: ART_PREFIX + code, value: artVal },
  }));
  // Note du lot précis (pour le détail des lots).
  if (cleanLot) {
    const lotVal = JSON.stringify({ rating: r, by: cleanBy, at });
    writes.push(prisma.appSetting.upsert({
      where: { key: `${LOT_PREFIX}${code}:${cleanLot}` },
      update: { value: lotVal },
      create: { key: `${LOT_PREFIX}${code}:${cleanLot}`, value: lotVal },
    }));
  }
  await Promise.all(writes);
}

/**
 * Notes COURANTES par article (console). Renvoie une Map itemCode → note (1..5).
 * Sans `itemCodes`, renvoie TOUTES les notes connues (peu nombreuses : seuls les
 * articles notés ont une clé).
 */
export async function getArticleNotes(itemCodes?: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const rows = itemCodes && itemCodes.length
      ? await prisma.appSetting.findMany({ where: { key: { in: itemCodes.map((c) => ART_PREFIX + c.trim()).filter(Boolean) } } })
      : await prisma.appSetting.findMany({ where: { key: { startsWith: ART_PREFIX } } });
    for (const row of rows) {
      const code = row.key.slice(ART_PREFIX.length);
      try {
        const v = JSON.parse(row.value) as ArtNote;
        const r = sanitizeRating(v?.rating);
        if (code && r != null) out.set(code, r);
      } catch { /* ligne corrompue ignorée */ }
    }
  } catch { /* table absente → aucune note */ }
  return out;
}

/** Efface la note d'un LOT précis (met le rating à vide). Best-effort — ne
 *  touche pas la note COURANTE de l'article (dernier arrivage noté). */
export async function clearLotNote(itemCode: string, lot: string): Promise<void> {
  const code = (itemCode ?? "").trim();
  const cleanLot = (lot ?? "").trim();
  if (!code || !cleanLot) return;
  try {
    await prisma.appSetting.deleteMany({ where: { key: `${LOT_PREFIX}${code}:${cleanLot}` } });
  } catch { /* table absente → rien à effacer */ }
}

/**
 * Notes des LOTS pour une liste de paires (article, lot) — lecture groupée en
 * UNE requête. Renvoie une Map « `<itemCode>::<lot>` → note (1..5) ». Utile pour
 * l'historique des EM où chaque ligne a SON lot (« une EM par ligne »).
 */
export async function getLotNotesForPairs(
  pairs: { itemCode: string; lot: string }[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const keys = new Map<string, { itemCode: string; lot: string }>();
  for (const p of pairs) {
    const code = (p.itemCode ?? "").trim();
    const lot = (p.lot ?? "").trim();
    if (!code || !lot) continue;
    keys.set(`${LOT_PREFIX}${code}:${lot}`, { itemCode: code, lot });
  }
  if (keys.size === 0) return out;
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { in: [...keys.keys()] } } });
    for (const row of rows) {
      const meta = keys.get(row.key);
      if (!meta) continue;
      try {
        const v = JSON.parse(row.value) as { rating?: number };
        const r = sanitizeRating(v?.rating);
        if (r != null) out.set(`${meta.itemCode}::${meta.lot}`, r);
      } catch { /* ligne corrompue ignorée */ }
    }
  } catch { /* table absente → aucune note */ }
  return out;
}

/** Notes des LOTS d'un article (détail des lots). Map lot → note (1..5). */
export async function getLotNotes(itemCode: string, lots: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const code = (itemCode ?? "").trim();
  const wanted = [...new Set(lots.map((l) => l.trim()).filter(Boolean))];
  if (!code || wanted.length === 0) return out;
  try {
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: wanted.map((l) => `${LOT_PREFIX}${code}:${l}`) } },
    });
    for (const row of rows) {
      const lot = row.key.slice(`${LOT_PREFIX}${code}:`.length);
      try {
        const v = JSON.parse(row.value) as { rating?: number };
        const r = sanitizeRating(v?.rating);
        if (lot && r != null) out.set(lot, r);
      } catch { /* ignore */ }
    }
  } catch { /* table absente */ }
  return out;
}
