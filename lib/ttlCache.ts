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

export async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await compute();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function invalidate(prefix: string): void {
  for (const k of Array.from(store.keys())) if (k.startsWith(prefix)) store.delete(k);
}
