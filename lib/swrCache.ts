/**
 * Cache serveur *stale-while-revalidate* en mémoire (par instance Next).
 *
 * Pensé pour les routes de CONSULTATION qui agrègent des appels SAP live lents
 * et variables (historique EM / commandes fournisseur) : après le 1er chargement,
 * les suivants sont INSTANTANÉS, et une donnée périmée est renvoyée tout de suite
 * puis rafraîchie en arrière-plan. Aucune écriture, aucune donnée sensible en dur.
 *
 * - frais (< ttl)      → renvoie le cache immédiatement.
 * - périmé (≥ ttl)     → renvoie le cache immédiatement ET revalide en tâche de fond.
 * - absent (cold)      → attend `fresh()` une fois (seul cas « lent », ex. après
 *                        redéploiement qui vide la mémoire).
 *
 * La clé doit inclure tout ce qui change la réponse (env SAP, paramètres, et les
 * droits — ex. `priceBlind` de l'agréeur — pour ne jamais servir des prix à qui
 * ne doit pas les voir). Sur mutation, appeler `bustCache(prefix)`.
 */
type Entry = { at: number; data: unknown; revalidating: boolean };
const store = new Map<string, Entry>();

export async function swr<T>(key: string, ttlMs: number, fresh: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const e = store.get(key);

  if (e && now - e.at < ttlMs) return e.data as T; // frais

  if (e) {
    // périmé : revalidation de fond (une seule à la fois), on rend le périmé.
    if (!e.revalidating) {
      e.revalidating = true;
      fresh()
        .then((d) => store.set(key, { at: Date.now(), data: d, revalidating: false }))
        .catch(() => { const x = store.get(key); if (x) x.revalidating = false; });
    }
    return e.data as T;
  }

  // froid : on doit attendre une fois.
  const d = await fresh();
  store.set(key, { at: Date.now(), data: d, revalidating: false });
  return d;
}

/** Invalide toutes les entrées dont la clé commence par `prefix` (après mutation). */
export function bustCache(prefix: string): void {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
