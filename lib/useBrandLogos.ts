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
 * Respecte le réglage local « Afficher les logos » PROPRE À CHAQUE ZONE
 * (console / livraison / inventaire). Quand la zone est sur "off", le hook
 * renvoie une Map VIDE → BrandLogo ne rend rien dans cette zone, sans toucher
 * aux logos stockés ni aux autres zones.
 */
type LogoMap = Map<string, string>;

export type LogoZone = "console" | "livraison" | "inventaire";

const ZONE_KEY: Record<LogoZone, string> = {
  console: SETTING_KEYS.brandLogosConsole,
  livraison: SETTING_KEYS.brandLogosLivraison,
  inventaire: SETTING_KEYS.brandLogosInventaire,
};

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

/** Renvoie la Map des logos pour une zone — vide tant que le chargement n'est
 *  pas terminé, ou si l'affichage des logos est désactivé pour cette zone. */
export function useBrandLogos(zone: LogoZone): LogoMap {
  const key = ZONE_KEY[zone];
  const [logos, setLogos] = useState<LogoMap>(() => cache ?? new Map());
  const [enabled, setEnabled] = useState<boolean>(() => readSetting(key, "on") !== "off");
  useEffect(() => {
    let cancelled = false;
    loadLogos().then((m) => { if (!cancelled) setLogos(m); });
    setEnabled(readSetting(key, "on") !== "off");
    const off = onSettingChange((k, value) => {
      if (k === key) setEnabled(value !== "off");
    });
    return () => { cancelled = true; off(); };
  }, [key]);
  return enabled ? logos : EMPTY;
}
