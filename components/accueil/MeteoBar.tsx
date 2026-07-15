"use client";

import { useEffect, useState } from "react";
import {
  Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow,
  CloudSun, Sun, Wind, X, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SETTING_KEYS, METEO_ZONE_DEFAULT, readSetting, writeSetting, onSettingChange,
} from "@/components/settings/app-settings";
import { useJson } from "./use-json";

/**
 * Bandeau météo de l'accueil — zone à définir (placé en haut de l'écran).
 *
 * - Zone (ville) réglable dans les Paramètres (SETTING_KEYS.meteoZone) ; défaut
 *   METEO_ZONE_DEFAULT. Relevé via /api/meteo (Open-Meteo, sans clé, cache 15 min).
 * - MASQUABLE : croix → réglage `meteo` = "off" (le bandeau disparaît). On le
 *   réactive depuis Paramètres → Console & catalogue. Réagit à chaud (onSettingChange).
 * - Défensif : chargement discret, erreur → rien affiché (jamais de saut ni de
 *   panneau cassé sur l'accueil).
 */

interface MeteoResponse {
  ok?: boolean;
  city?: string;
  temp?: number;
  code?: number;
  wind?: number;
}

/** Code temps WMO (Open-Meteo) → libellé FR + icône lucide. */
function describe(code: number): { label: string; Icon: LucideIcon } {
  if (code === 0) return { label: "Ensoleillé", Icon: Sun };
  if (code === 1 || code === 2) return { label: "Peu nuageux", Icon: CloudSun };
  if (code === 3) return { label: "Couvert", Icon: Cloud };
  if (code === 45 || code === 48) return { label: "Brouillard", Icon: CloudFog };
  if (code >= 51 && code <= 57) return { label: "Bruine", Icon: CloudDrizzle };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: "Pluie", Icon: CloudRain };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: "Neige", Icon: CloudSnow };
  if (code >= 95) return { label: "Orage", Icon: CloudLightning };
  return { label: "—", Icon: Cloud };
}

export function MeteoBar({ className }: { className?: string }) {
  // Visibilité + zone (réglages locaux, propagés à chaud entre onglets/widgets).
  const [visible, setVisible] = useState(true);
  const [zone, setZone] = useState(METEO_ZONE_DEFAULT);

  useEffect(() => {
    setVisible(readSetting(SETTING_KEYS.meteo, "on") !== "off");
    setZone(readSetting(SETTING_KEYS.meteoZone, "").trim() || METEO_ZONE_DEFAULT);
    return onSettingChange((key, value) => {
      if (key === SETTING_KEYS.meteo) setVisible(value !== "off");
      if (key === SETTING_KEYS.meteoZone) setZone((value ?? "").trim() || METEO_ZONE_DEFAULT);
    });
  }, []);

  // Relevé (rafraîchi ~15 min). Hook toujours appelé — on masque au rendu.
  const { data, state } = useJson<MeteoResponse>(
    `/api/meteo?q=${encodeURIComponent(zone)}`,
    900_000,
  );

  // Masqué par réglage, ou pas encore de donnée exploitable → rien (pas de saut).
  if (!visible) return null;
  if (state !== "ok" || !data?.ok || data.temp == null) return null;

  const { label, Icon } = describe(data.code ?? 0);

  return (
    <section
      aria-label="Météo"
      className={cn(
        "flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-1.5 min-h-[40px]",
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-sky-500 dark:text-sky-400" aria-hidden />
      <span className="text-[14px] font-semibold text-foreground tnum shrink-0">{data.temp}°C</span>
      <span className="text-[12.5px] text-muted-foreground shrink-0">{label}</span>
      <span className="text-[12.5px] text-muted-foreground/70 truncate">· {data.city ?? zone}</span>
      {data.wind != null && data.wind > 0 && (
        <span className="hidden sm:inline-flex items-center gap-1 text-[11.5px] text-muted-foreground/70 shrink-0">
          <Wind className="h-3 w-3 opacity-70" />{data.wind} km/h
        </span>
      )}
      <button
        type="button"
        onClick={() => { setVisible(false); writeSetting(SETTING_KEYS.meteo, "off"); }}
        aria-label="Masquer la météo"
        title="Masquer (réactivable dans les Paramètres)"
        className="ml-auto shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-secondary/60 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </section>
  );
}
