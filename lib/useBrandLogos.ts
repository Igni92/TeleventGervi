"use client";

import { useEffect, useState } from "react";
import { SETTING_KEYS, readSetting, onSettingChange } from "@/components/settings/app-settings";

/**
 * Logos de marques partagés (réglés sur /parametres/marques). Chargés une seule
 * fois pour toute l'app puis mémorisés au niveau module : peu importe le nombre
 * de composants qui appellent le hook, un seul appel réseau est émis.
 *
 * La Map est indexée par marque normalisée (trim + minuscules) → data-URL.
 *
 * Respecte le réglage local « Afficher les logos » (SETTING_KEYS.brandLogos) :
 * quand il est sur "off", le hook renvoie une Map VIDE → BrandLogo ne rend rien
 * partout (console, détail livraison, inventaire), sans toucher aux logos stockés.
 */
type LogoMap = Map<string, string>;

const EMPTY: LogoMap = new Map();

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

/** Lit le réglage d'affichage des logos (défaut : activé). */
function logosEnabled(): boolean {
  return readSetting(SETTING_KEYS.brandLogos, "on") !== "off";
}

/** Renvoie la Map des logos — vide tant que le chargement n'est pas terminé,
 *  ou si l'affichage des logos est désactivé dans les paramètres. */
export function useBrandLogos(): LogoMap {
  const [logos, setLogos] = useState<LogoMap>(() => cache ?? new Map());
  const [enabled, setEnabled] = useState<boolean>(() => logosEnabled());
  useEffect(() => {
    let cancelled = false;
    loadLogos().then((m) => { if (!cancelled) setLogos(m); });
    const off = onSettingChange((key, value) => {
      if (key === SETTING_KEYS.brandLogos) setEnabled(value !== "off");
    });
    return () => { cancelled = true; off(); };
  }, []);
  return enabled ? logos : EMPTY;
}
