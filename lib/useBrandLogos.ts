"use client";

import { useEffect, useState } from "react";

/**
 * Logos de marques partagés (réglés sur /parametres/marques). Chargés une seule
 * fois pour toute l'app puis mémorisés au niveau module : peu importe le nombre
 * de composants qui appellent le hook, un seul appel réseau est émis.
 *
 * La Map est indexée par marque normalisée (trim + minuscules) → data-URL.
 */
type LogoMap = Map<string, string>;

let cache: LogoMap | null = null;
let inflight: Promise<LogoMap> | null = null;

function loadLogos(): Promise<LogoMap> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch("/api/marques/logos", { cache: "no-store" })
    .then((r) => r.json())
    .then((j: { logos?: { marque: string; logoUrl: string }[] }) => {
      const m: LogoMap = new Map();
      for (const l of j.logos ?? []) m.set(l.marque.trim().toLowerCase(), l.logoUrl);
      cache = m;
      return m;
    })
    .catch(() => new Map<string, string>()) // pas de logos → Map vide, jamais d'erreur bloquante
    .finally(() => { inflight = null; });
  return inflight;
}

/** Renvoie la Map des logos (vide tant que le chargement n'est pas terminé). */
export function useBrandLogos(): LogoMap {
  const [logos, setLogos] = useState<LogoMap>(() => cache ?? new Map());
  useEffect(() => {
    let cancelled = false;
    loadLogos().then((m) => { if (!cancelled) setLogos(m); });
    return () => { cancelled = true; };
  }, []);
  return logos;
}
