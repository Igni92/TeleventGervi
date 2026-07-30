/**
 * Cache mémoire TTL minimaliste pour les routes d'agrégats lourds (dashboard).
 *
 * Le miroir SAP n'évolue qu'au tick de sync : recalculer la matrice annuelle à
 * chaque montage d'écran est du gaspillage. On sert la même réponse pendant
 * `ttlMs`, par clé (ex. `annual:GMS`). Process-local : redémarre à vide, et
 * chaque worker a le sien — acceptable pour un dashboard interne, y compris
 * avec un TTL long (ex. 7 jours pour le rapport annuel comptable) : un restart
 * vide simplement le cache et le premier appel recalcule (agrégats SQL purs).
 *
 * `invalidate(prefix)` permet de purger après une écriture (ex. tick mirror)
 * ou sur demande (`?refresh=1` sur /api/pilotage/annual). `startsWith` matche
 * aussi la clé EXACTE → `invalidate(cleExacte)` fait office d'invalidation
 * unitaire, pas besoin d'une fonction dédiée.
 */

const store = new Map<string, { value: unknown; expiresAt: number }>();

/**
 * Calculs EN VOL, partagés (anti-troupeau).
 *
 * `cached` ne mémorisait que le RÉSULTAT : trois personnes ouvrant l'accueil à
 * 8h00 sur un cache expiré déclenchaient TROIS fois le même gros `Promise.all`
 * (agrégats + N-1 + CRM + tops), et se ralentissaient mutuellement — exactement
 * le pic qu'on cherchait à supprimer avec le préchauffage. On mémorise
 * désormais la PROMESSE : le premier arrivé calcule, les suivants attendent le
 * même travail au lieu d'en lancer un autre.
 */
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  // Un calcul identique est déjà lancé → on s'y raccroche.
  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const p = (async () => {
    try {
      const value = await compute();
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      // Retiré dans tous les cas : un échec ne doit pas coller un rejet en cache.
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p as Promise<T>;
}

export function invalidate(prefix: string): void {
  for (const k of Array.from(store.keys())) if (k.startsWith(prefix)) store.delete(k);
  // Les calculs en vol sur ce préfixe sont désormais périmés : on les détache
  // pour que la prochaine demande reparte sur des données fraîches. La promesse
  // en cours vit sa vie (ses attendeurs sont servis), elle n'est simplement plus
  // réutilisée par les suivants.
  for (const k of Array.from(inflight.keys())) if (k.startsWith(prefix)) inflight.delete(k);
}
