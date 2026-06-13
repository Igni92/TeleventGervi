"use client";

import { useEffect, useRef, useState } from "react";

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

    const load = async () => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as T;
        if (cancelled) return;
        hasData.current = true;
        setData(j);
        setState("ok");
      } catch {
        if (cancelled) return;
        if (!hasData.current) setState("error");
      }
    };

    load();
    if (intervalMs && intervalMs > 0) {
      const t = setInterval(load, intervalMs);
      return () => { cancelled = true; clearInterval(t); };
    }
    return () => { cancelled = true; };
  }, [url, intervalMs]);

  return { data, state };
}
