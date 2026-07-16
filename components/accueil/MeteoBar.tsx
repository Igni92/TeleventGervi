"use client";

import { useEffect, useState } from "react";
import {
  Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow,
  CloudSun, Sun, X, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SETTING_KEYS, METEO_ZONE_DEFAULT, parseMeteoZones,
  readSetting, writeSetting, onSettingChange,
} from "@/components/settings/app-settings";

/**
 * Météo de l'accueil — TOUT EN HAUT À DROITE de l'en-tête, au-dessus de
 * l'horloge (colonne alignée à droite, cf. AccueilHub). Format GRAND
 * (≈ ×1,5 de la première version compacte — d'abord doublé puis réduit
 * « d'un chouia » à la demande : lisible de loin sans envahir l'en-tête).
 *
 * - PLUSIEURS VILLES possibles (Paramètres : villes séparées par des
 *   virgules, cf. parseMeteoZones) : une pastille « conditions actuelles »
 *   par ville ; un clic sur une pastille affiche SA semaine à droite.
 *   Une seule ville → rendu identique à avant (pastille non cliquable).
 * - La SEMAINE (ville active) : 7 colonnes jour · pictogramme coloré ·
 *   température moyenne, « Auj » mis en avant. Détail en infobulle.
 * - Relevé via /api/meteo (Open-Meteo, sans clé, cache 15 min) — un appel par
 *   ville, rafraîchi ~15 min ; une ville en erreur est simplement absente
 *   (on garde la dernière bonne valeur connue, jamais de saut de page).
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

/**
 * Relevés météo pour PLUSIEURS villes — un fetch /api/meteo par ville, tous
 * rafraîchis à `intervalMs`. Même philosophie défensive que useJson : une
 * erreur de refresh ne dégrade jamais une donnée déjà affichée (on garde la
 * dernière bonne valeur), une ville en échec est simplement absente de la map.
 */
function useMeteoMulti(zones: string[], intervalMs: number): Record<string, MeteoResponse> {
  const [byZone, setByZone] = useState<Record<string, MeteoResponse>>({});
  // Clé stable : l'effet ne se relance que si la LISTE change réellement.
  // Séparateur \u0000 : impossible dans un nom de ville (« Le Havre » passe).
  const zonesKey = zones.join("\u0000");

  useEffect(() => {
    let cancelled = false;
    const list = zonesKey.split("\u0000").filter(Boolean);

    const load = async () => {
      const entries = await Promise.all(list.map(async (z) => {
        try {
          const r = await fetch(`/api/meteo?q=${encodeURIComponent(z)}`, { cache: "no-store" });
          if (!r.ok) throw new Error(String(r.status));
          return [z, (await r.json()) as MeteoResponse] as const;
        } catch {
          return [z, null] as const;
        }
      }));
      if (cancelled) return;
      setByZone((prev) => {
        const next: Record<string, MeteoResponse> = {};
        for (const [z, d] of entries) {
          if (d?.ok && d.temp != null) next[z] = d;
          else if (prev[z]) next[z] = prev[z]; // erreur → dernière bonne valeur
        }
        return next;
      });
    };

    load();
    const t = setInterval(load, intervalMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [zonesKey, intervalMs]);

  return byZone;
}

export function MeteoBar({ className }: { className?: string }) {
  // Visibilité + zones (réglages locaux, propagés à chaud entre onglets/widgets).
  const [visible, setVisible] = useState(true);
  const [zones, setZones] = useState<string[]>([METEO_ZONE_DEFAULT]);
  // Ville dont la SEMAINE est affichée (choisie au clic) — nom de zone, pas
  // un index : la liste peut changer à chaud sans dérégler la sélection.
  const [activeZone, setActiveZone] = useState<string | null>(null);

  useEffect(() => {
    setVisible(readSetting(SETTING_KEYS.meteo, "on") !== "off");
    setZones(parseMeteoZones(readSetting(SETTING_KEYS.meteoZone, "")));
    return onSettingChange((key, value) => {
      if (key === SETTING_KEYS.meteo) setVisible(value !== "off");
      if (key === SETTING_KEYS.meteoZone) setZones(parseMeteoZones(value));
    });
  }, []);

  // Relevés (rafraîchis ~15 min). Hook toujours appelé — on masque au rendu.
  const byZone = useMeteoMulti(zones, 900_000);

  // Masqué par réglage, ou aucune donnée exploitable → rien (pas de saut).
  if (!visible) return null;
  const loaded = zones.filter((z) => byZone[z]);
  if (loaded.length === 0) return null;

  const multi = loaded.length > 1;
  const active = activeZone && loaded.includes(activeZone) ? activeZone : loaded[0];
  const data = byZone[active];
  const days = (data.days ?? []).slice(0, 7);

  return (
    <section aria-label="Météo" className={cn("flex items-center gap-1", className)}>
      {/* ── Conditions actuelles — une pastille PAR VILLE (clic = semaine) ── */}
      <div className="mr-2.5 flex items-center gap-1 border-r border-border/60 pr-4">
        {loaded.map((z) => {
          const d = byZone[z];
          const c = describe(d.code ?? 0);
          const isActive = z === active;
          const title =
            `${c.label} — ${d.city ?? z}` +
            (d.wind != null && d.wind > 0 ? ` · vent ${d.wind} km/h` : "") +
            (multi && !isActive ? " — cliquer pour afficher sa semaine" : "");
          const inner = (
            <>
              <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl ring-1 ring-inset", c.tile)}>
                <c.Icon className={cn("h-6 w-6", c.tone)} aria-hidden />
              </span>
              <div className="leading-none text-left">
                <p className="font-display text-[23px] font-semibold leading-none text-foreground tnum">{d.temp}°</p>
                <p className="mt-0.5 max-w-[96px] truncate text-[13.5px] text-muted-foreground">{d.city ?? z}</p>
              </div>
            </>
          );
          // Une seule ville : rendu inerte (pas de bouton), comme historiquement.
          if (!multi) {
            return <div key={z} title={title} className="flex items-center gap-2">{inner}</div>;
          }
          return (
            <button
              key={z}
              type="button"
              onClick={() => setActiveZone(z)}
              aria-pressed={isActive}
              title={title}
              className={cn(
                "flex items-center gap-2 rounded-xl px-1.5 py-1 transition-colors",
                isActive ? "bg-secondary/70" : "hover:bg-secondary/40",
              )}
            >
              {inner}
            </button>
          );
        })}
      </div>

      {/* ── Semaine (ville active) : moyenne journalière + pictogramme
             (days[0] = aujourd'hui) — la cascade rejoue au changement de ville ── */}
      {days.map((d, i) => {
        const w = describe(d.code);
        return (
          <div
            key={`${active}:${d.date}`}
            title={`${dayLong(d.date)} — ${w.label}, ${d.temp}° en moyenne`}
            className={cn(
              "flex w-12 shrink-0 flex-col items-center gap-1 rounded-lg py-1.5 animate-fade-in",
              i === 0 ? "bg-secondary/70" : "transition-colors hover:bg-secondary/40",
            )}
            style={{ animationDelay: `${i * 35}ms` }}
          >
            <span className={cn(
              "text-[13px] font-bold uppercase leading-none tracking-[0.06em]",
              i === 0 ? "text-foreground" : "text-muted-foreground",
            )}>
              {i === 0 ? "Auj" : dayShort(d.date)}
            </span>
            <w.Icon className={cn("h-[22px] w-[22px]", w.tone)} aria-hidden />
            <span className="tnum text-[16px] font-semibold leading-none text-foreground">{d.temp}°</span>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => { setVisible(false); writeSetting(SETTING_KEYS.meteo, "off"); }}
        aria-label="Masquer la météo"
        title="Masquer (réactivable dans les Paramètres)"
        className="ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-secondary/60 hover:text-foreground"
      >
        <X className="h-[18px] w-[18px]" />
      </button>
    </section>
  );
}
