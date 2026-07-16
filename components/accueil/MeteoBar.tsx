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
 * - Conditions ACTUELLES à gauche (pastille teintée selon le temps, grande
 *   température, ville, vent) + SEMAINE à droite : 7 pastilles jour
 *   (jour · pictogramme coloré · température moyenne), « Auj. » mis en avant.
 * - Zone (ville) réglable dans les Paramètres (SETTING_KEYS.meteoZone) ; défaut
 *   METEO_ZONE_DEFAULT. Relevé via /api/meteo (Open-Meteo, sans clé, cache 15 min).
 * - MASQUABLE : croix → réglage `meteo` = "off" (le bandeau disparaît). On le
 *   réactive depuis Paramètres → Console & catalogue. Réagit à chaud (onSettingChange).
 * - Motion sobre (bandeau vu tous les jours) : simple cascade fade-in 40 ms sur
 *   les pastilles au montage — neutralisée par le réglage animations/reduced-motion
 *   (balai global de globals.css sur [class*="animate-"]).
 * - Défensif : chargement discret, erreur → rien affiché (jamais de saut ni de
 *   panneau cassé sur l'accueil).
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
/** « jeudi 16 juillet » — pour l'infobulle des pastilles. */
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
    <section
      aria-label="Météo"
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
    >
      {/* Lavis d'ambiance très léger, teinté ciel — juste de quoi respirer */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-sky-500/[0.07] via-transparent to-transparent" />

      <div className="relative flex items-center gap-3 px-3 py-2 sm:px-3.5">
        {/* ── Conditions actuelles ── */}
        <div className="flex shrink-0 items-center gap-2.5">
          <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-inset", cur.tile)}>
            <cur.Icon className={cn("h-5 w-5", cur.tone)} aria-hidden />
          </span>
          <div className="leading-tight">
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-[22px] font-semibold leading-none text-foreground tnum">{data.temp}°</span>
              <span className="text-[12.5px] font-semibold text-foreground">{cur.label}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">{data.city ?? zone}</span>
              {data.wind != null && data.wind > 0 && (
                <span className="inline-flex shrink-0 items-center gap-0.5">
                  <Wind className="h-3 w-3 opacity-70" aria-hidden />{data.wind} km/h
                </span>
              )}
            </div>
          </div>
        </div>

        {days.length > 0 && (
          <>
            <div aria-hidden className="hidden h-9 w-px shrink-0 bg-border/70 sm:block" />

            {/* ── Semaine : moyenne journalière + pictogramme (days[0] = aujourd'hui) ── */}
            <div className="ml-auto flex min-w-0 items-stretch gap-0.5 overflow-x-auto">
              {days.map((d, i) => {
                const w = describe(d.code);
                return (
                  <div
                    key={d.date}
                    title={`${dayLong(d.date)} — ${w.label}, ${d.temp}° en moyenne`}
                    className={cn(
                      "flex w-11 shrink-0 flex-col items-center gap-1 rounded-lg py-1.5 animate-fade-in",
                      i === 0
                        ? "bg-secondary/70 ring-1 ring-inset ring-border"
                        : "transition-colors hover:bg-secondary/40",
                    )}
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <span className={cn(
                      "text-[9.5px] font-bold uppercase tracking-[0.08em]",
                      i === 0 ? "text-foreground" : "text-muted-foreground",
                    )}>
                      {i === 0 ? "Auj." : dayShort(d.date)}
                    </span>
                    <w.Icon className={cn("h-4 w-4", w.tone)} aria-hidden />
                    <span className="tnum text-[12px] font-semibold text-foreground">{d.temp}°</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <button
          type="button"
          onClick={() => { setVisible(false); writeSetting(SETTING_KEYS.meteo, "off"); }}
          aria-label="Masquer la météo"
          title="Masquer (réactivable dans les Paramètres)"
          className={cn(
            "shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-secondary/60 hover:text-foreground",
            days.length === 0 && "ml-auto",
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}
