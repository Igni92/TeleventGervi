import { prisma } from "@/lib/prisma";

/**
 * Bascule TEMPORAIRE d'un client vers un autre VENDEUR (télévente), avec retour
 * automatique à une date choisie (ex. fin de congés).
 *
 * On mute réellement la colonne `Client.vendeur` (lue partout, notamment par la
 * console d'appels : `WHERE "vendeur" = <moi> AND "activeTelevente"`), pour que
 * le client apparaisse tout de suite dans la file du remplaçant et disparaisse
 * de celle du titulaire. On garde ici, dans un marqueur `AppSetting`, de quoi
 * revenir en arrière :
 *   - `from`    : vendeur PERMANENT (titulaire) — restauré à l'échéance ou lors
 *                 d'un retour manuel dans la popup ;
 *   - `to`      : vendeur temporaire actuel (= valeur courante de la colonne) ;
 *   - `endDate` : yyyy-mm-dd (Europe/Paris). À partir de CE jour, le cron
 *                 quotidien `/api/vendeur-reassign/revert` remet `from`.
 *
 * Même convention que les marqueurs `livcommande:` (clé/valeur JSON stringifiée
 * dans `AppSetting`) — aucune migration Prisma, et `vendeur` reste hors client
 * typé (écrit en SQL brut, comme partout ailleurs).
 */

export const REASSIGN_PREFIX = "vendeur-reassign:";
export function reassignKey(clientId: string): string { return REASSIGN_PREFIX + clientId; }

export interface ReassignMarker {
  from: string;
  to: string;
  endDate: string;
  by: string;
  at: string;
}

/** Date du jour au format yyyy-mm-dd dans le fuseau Europe/Paris. */
export function parisDateStr(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function parseMarker(raw: string): ReassignMarker | null {
  try {
    const v = JSON.parse(raw) as Partial<ReassignMarker>;
    if (!v || typeof v.from !== "string" || typeof v.to !== "string" || typeof v.endDate !== "string") return null;
    return { from: v.from, to: v.to, endDate: v.endDate, by: v.by ?? "", at: v.at ?? "" };
  } catch { return null; }
}

/**
 * Marqueurs de bascule en cours, indexés par clientId. Sans argument : tous.
 * Avec une liste vide : Map vide (pas de requête inutile).
 */
export async function getReassignMarkers(clientIds?: string[]): Promise<Map<string, ReassignMarker>> {
  const rows = clientIds
    ? (clientIds.length ? await prisma.appSetting.findMany({ where: { key: { in: clientIds.map(reassignKey) } } }) : [])
    : await prisma.appSetting.findMany({ where: { key: { startsWith: REASSIGN_PREFIX } } });
  const map = new Map<string, ReassignMarker>();
  for (const r of rows) {
    const m = parseMarker(r.value);
    if (m) map.set(r.key.slice(REASSIGN_PREFIX.length), m);
  }
  return map;
}

/** Écrit (upsert) ou lève (null) le marqueur d'un client. */
export async function setReassignMarker(clientId: string, marker: ReassignMarker | null): Promise<void> {
  const key = reassignKey(clientId);
  if (!marker) {
    try { await prisma.appSetting.delete({ where: { key } }); } catch { /* déjà absent */ }
    return;
  }
  const value = JSON.stringify(marker);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
