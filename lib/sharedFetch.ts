/**
 * Fetcher JSON partagé côté client — coalesce les requêtes concurrentes vers
 * une même URL (une seule requête en vol) + cache TTL court.
 *
 * Motivation (audit D11) : plusieurs composants montés simultanément tapaient
 * le même endpoint chacun de leur côté — ex. /accueil : `/api/promos?active=1`
 * et `/api/notifications` étaient fetchés 3× (PromoBanner + PromosAccueil +
 * PromoRibbon). Ils partagent désormais une seule réponse.
 *
 * Usage strictement client (effets/handlers) : le cache module-global vit dans
 * l'onglet du navigateur, jamais sollicité au rendu serveur.
 */

type Entry = { at: number; data: unknown };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * @param ttlMs durée de validité du cache (une lecture dans la fenêtre réutilise
 *   la réponse). Par défaut 30 s.
 * @param force ignore le cache et refetch (après une mutation : POST « seen »…).
 */
export async function sharedFetchJson<T>(
  url: string,
  ttlMs = 30_000,
  force = false,
): Promise<T> {
  if (force) {
    cache.delete(url);
  } else {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
    const flying = inflight.get(url);
    if (flying) return flying as Promise<T>;
  }

  const p = (async () => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as T;
      cache.set(url, { at: Date.now(), data });
      return data;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p as Promise<T>;
}

/** Invalide le cache (prochaine lecture = refetch). Sans argument : tout vider. */
export function invalidateSharedFetch(url?: string): void {
  if (url) {
    cache.delete(url);
    inflight.delete(url);
  } else {
    cache.clear();
    inflight.clear();
  }
}
