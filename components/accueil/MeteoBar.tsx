"use client";

import { useEffect, useState } from "react";
import {
  Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow,
  CloudSun, Sun, X, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SETTING_KEYS, METEO_ZONE_DEFAULT, readSetting, writeSetting, onSettingChange,
} from "@/components/settings/app-settings";
import { useJson } from "./use-json";

/**
 * Météo de l'accueil — logée EN HAUT À DROITE, dans l'en-tête (à gauche de
 * l'horloge, cf. AccueilHub). Format GRAND (toutes les tailles doublées par
 * rapport à la première version compacte — demande utilisateur : lisibilité
 * de loin sur le poste télévente).
 *
 * - Conditions actuelles (pastille teintée selon le temps + température +
 *   ville) puis la SEMAINE : 7 colonnes jour · pictogramme coloré ·
 *   température moyenne, « Auj » mis en avant. Détail en infobulle.
 * - Zone (ville) réglable dans les Paramètres (SETTING_KEYS.meteoZone) ; défaut
 *   METEO_ZONE_DEFAULT. Relevé via /api/meteo (Open-Meteo, sans clé, cache 15 min).
 * - MASQUABLE : croix → réglage `meteo` = "off". Réactivable depuis
 *   Paramètres → Console & catalogue. Réagit à chaud (onSettingChange).
 * - Motion sobre (vu tous les jours) : cascade fade-in 35 ms sur les colonnes
 *   au montage — neutralisée par le réglage animations / reduced-motion
 *   (balai global de globals.css sur [class*="animate-"]).
 * - Défensif : chargement discret, erreur → rien affiché (jamais de saut).
 */

interface MeteoDay { date: string; temp: number; code: number }
interface MeteoResponse {
  ok?: boolean;
  city?: string;
  temp?: number;
  code?: number;
  wind?: number;
  /** Prévision 7 jours (moyenne journalière) — days[0] = aujourd'hui. */
  days?: MeteoDay[];
}

/** Code temps WMO (Open-Meteo) → libellé FR + icône lucide + teintes. */
interface Condition {
  label: string;
  Icon: LucideIcon;
  /** couleur de l'icône */
  tone: string;
  /** fond + anneau de la pastille des conditions actuelles */
  tile: string;
}
function describe(code: number): Condition {
  if (code === 0) return { label: "Ensoleillé", Icon: Sun, tone: "text-amber-500 dark:text-amber-400", tile: "bg-amber-400/15 ring-amber-400/30" };
  if (code === 1 || code === 2) return { label: "Peu nuageux", Icon: CloudSun, tone: "text-amber-400", tile: "bg-amber-400/10 ring-amber-400/25" };
  if (code === 3) return { label: "Couvert", Icon: Cloud, tone: "text-slate-400", tile: "bg-slate-400/15 ring-slate-400/25" };
  if (code === 45 || code === 48) return { label: "Brouillard", Icon: CloudFog, tone: "text-slate-400", tile: "bg-slate-400/15 ring-slate-400/25" };
  if (code >= 51 && code <= 57) return { label: "Bruine", Icon: CloudDrizzle, tone: "text-sky-400", tile: "bg-sky-400/10 ring-sky-400/25" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: "Pluie", Icon: CloudRain, tone: "text-sky-500 dark:text-sky-400", tile: "bg-sky-400/15 ring-sky-400/30" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: "Neige", Icon: CloudSnow, tone: "text-cyan-500 dark:text-cyan-300", tile: "bg-cyan-400/15 ring-cyan-400/25" };
  if (code >= 95) return { label: "Orage", Icon: CloudLightning, tone: "text-violet-500 dark:text-violet-400", tile: "bg-violet-400/15 ring-violet-400/30" };
  return { label: "—", Icon: Cloud, tone: "text-slate-400", tile: "bg-slate-400/15 ring-slate-400/25" };
}

/** « jeu » — jour de semaine court FR (midi local : aucun glissement de fuseau). */
function dayShort(date: string): string {
  return new Date(date + "T12:00:00")
    .toLocaleDateString("fr-FR", { weekday: "short" })
    .replace(".", "");
}
/** « jeudi 16 juillet » — pour l'infobulle des colonnes. */
function dayLong(date: string): string {
  return new Date(date + "T12:00:00")
    .toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
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

  const cur = describe(data.code ?? 0);
  const days = (data.days ?? []).slice(0, 7);

  return (
    <section aria-label="Météo" className={cn("flex items-center gap-1", className)}>
      {/* ── Conditions actuelles ── */}
      <div
        className="mr-3 flex items-center gap-3 border-r border-border/60 pr-5"
        title={`${cur.label} — ${data.city ?? zone}${data.wind != null && data.wind > 0 ? ` · vent ${data.wind} km/h` : ""}`}
      >
        <span className={cn("flex h-14 w-14 items-center justify-center rounded-2xl ring-1 ring-inset", cur.tile)}>
          <cur.Icon className={cn("h-8 w-8", cur.tone)} aria-hidden />
        </span>
        <div className="leading-none">
          <p className="font-display text-[30px] font-semibold leading-none text-foreground tnum">{data.temp}°</p>
          <p className="mt-1 max-w-[128px] truncate text-[18px] text-muted-foreground">{data.city ?? zone}</p>
        </div>
      </div>

      {/* ── Semaine : moyenne journalière + pictogramme (days[0] = aujourd'hui) ── */}
      {days.map((d, i) => {
        const w = describe(d.code);
        return (
          <div
            key={d.date}
            title={`${dayLong(d.date)} — ${w.label}, ${d.temp}° en moyenne`}
            className={cn(
              "flex w-16 shrink-0 flex-col items-center gap-1.5 rounded-xl py-2 animate-fade-in",
              i === 0 ? "bg-secondary/70" : "transition-colors hover:bg-secondary/40",
            )}
            style={{ animationDelay: `${i * 35}ms` }}
          >
            <span className={cn(
              "text-[17px] font-bold uppercase leading-none tracking-[0.06em]",
              i === 0 ? "text-foreground" : "text-muted-foreground",
            )}>
              {i === 0 ? "Auj" : dayShort(d.date)}
            </span>
            <w.Icon className={cn("h-7 w-7", w.tone)} aria-hidden />
            <span className="tnum text-[21px] font-semibold leading-none text-foreground">{d.temp}°</span>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => { setVisible(false); writeSetting(SETTING_KEYS.meteo, "off"); }}
        aria-label="Masquer la météo"
        title="Masquer (réactivable dans les Paramètres)"
        className="ml-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground/50 transition-colors hover:bg-secondary/60 hover:text-foreground"
      >
        <X className="h-6 w-6" />
      </button>
    </section>
  );
}
