"use client";

import { useEffect, useRef, useState } from "react";
import { sharedFetchJson } from "@/lib/sharedFetch";

export type FetchState = "loading" | "ok" | "error";

/**
 * Fetch JSON défensif pour les panneaux de l'accueil.
 *
 * - `state` : loading → ok | error (les panneaux affichent un état vide élégant).
 * - `intervalMs` optionnel : rafraîchissement léger (les erreurs de refresh ne
 *   dégradent PAS une donnée déjà affichée — on garde la dernière bonne valeur).
 * - Jamais de throw : tout est avalé, l'accueil ne doit jamais casser.
 */
export function useJson<T>(url: string, intervalMs?: number): { data: T | null; state: FetchState } {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<FetchState>("loading");
  // garde la dernière bonne valeur pour ne pas régresser sur une erreur de refresh
  const hasData = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // Cache partagé : montages concurrents du même URL = une seule requête.
    // Les rafraîchissements d'intervalle forcent un refetch (cadence préservée).
    const load = async (force: boolean) => {
      try {
        const j = await sharedFetchJson<T>(url, intervalMs ?? 30_000, force);
        if (cancelled) return;
        hasData.current = true;
        setData(j);
        setState("ok");
      } catch {
        if (cancelled) return;
        if (!hasData.current) setState("error");
      }
    };

    load(false);
    if (intervalMs && intervalMs > 0) {
      const t = setInterval(() => load(true), intervalMs);
      return () => { cancelled = true; clearInterval(t); };
    }
    return () => { cancelled = true; };
  }, [url, intervalMs]);

  return { data, state };
}
