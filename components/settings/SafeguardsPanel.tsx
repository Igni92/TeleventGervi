"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { NumberInput } from "@/components/ui/number-input";
import { cn } from "@/lib/utils";
import {
  SAFEGUARD_CATEGORIES, SAFEGUARD_DEFS, DEFAULT_SAFEGUARDS_CONFIG,
  type SafeguardMode, type SafeguardRuleId, type SafeguardsConfig,
} from "@/lib/safeguards";

/**
 * Panneau Paramètres → « Garde-fous de vente » (admin/direction).
 *
 * Chaque règle : mode Off / Avertir / Bloquer + seuils numériques. La config
 * est GLOBALE (AppSetting serveur, PUT /api/safeguards) — contrairement aux
 * réglages d'affichage localStorage du reste de la page : un seuil changé ici
 * s'applique à TOUS les postes, en console comme au filet serveur (création
 * de commande) et dans les Ventes du jour.
 *
 * Enregistrement : auto, débouncé (600 ms) après chaque changement — l'état
 * « Enregistré ✓ / Enregistrement… » est affiché dans l'en-tête.
 */

const MODES: { id: SafeguardMode; label: string; hint: string }[] = [
  { id: "off", label: "Off", hint: "Règle désactivée" },
  { id: "warn", label: "Avertir", hint: "Signale l'anomalie — vente possible après confirmation" },
  { id: "block", label: "Bloquer", hint: "Vente refusée tant que l'anomalie persiste" },
];

function ModeToggle({ value, onChange, ariaLabel }: {
  value: SafeguardMode; onChange: (m: SafeguardMode) => void; ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 bg-secondary/60 p-0.5 rounded-lg shrink-0">
      {MODES.map((m) => {
        const active = value === m.id;
        return (
          <button key={m.id} type="button" role="radio" aria-checked={active} title={m.hint}
            onClick={() => onChange(m.id)}
            className={cn(
              "px-2.5 h-7 text-[11.5px] font-semibold tracking-tight rounded-md transition-colors",
              active
                ? m.id === "block"
                  ? "bg-rose-600 text-white shadow-[0_0_10px_rgba(225,29,72,0.35)]"
                  : m.id === "warn"
                    ? "bg-amber-500 text-white shadow-[0_0_10px_rgba(245,158,11,0.35)]"
                    : "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}>
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

export function SafeguardsPanel() {
  const [config, setConfig] = useState<SafeguardsConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Débounce d'enregistrement — on n'envoie que la DERNIÈRE version.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<SafeguardsConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/safeguards", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setConfig(j?.config ?? DEFAULT_SAFEGUARDS_CONFIG); })
      .catch(() => { if (!cancelled) { setConfig(DEFAULT_SAFEGUARDS_CONFIG); setError("Config non chargée — valeurs par défaut affichées."); } });
    return () => { cancelled = true; };
  }, []);

  const scheduleSave = (next: SafeguardsConfig) => {
    latest.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const payload = latest.current;
      if (!payload) return;
      setSaving(true); setError(null);
      try {
        const r = await fetch("/api/safeguards", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: payload }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || j?.ok === false) throw new Error(j?.error || "Échec de l'enregistrement");
        // Se resynchronise sur la version NORMALISÉE serveur (clamps éventuels)
        // — seulement si aucun changement plus récent n'attend son tour.
        if (latest.current === payload && j?.config) setConfig(j.config);
        setSavedAt(Date.now());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        toast.error("Garde-fous NON enregistrés", { description: e instanceof Error ? e.message : undefined });
      } finally {
        setSaving(false);
      }
    }, 600);
  };

  const update = (id: SafeguardRuleId, patch: { mode?: SafeguardMode; param?: { key: string; value: number } }) => {
    setConfig((cur) => {
      if (!cur) return cur;
      const next: SafeguardsConfig = {
        ...cur,
        [id]: {
          mode: patch.mode ?? cur[id].mode,
          params: patch.param ? { ...cur[id].params, [patch.param.key]: patch.param.value } : cur[id].params,
        },
      };
      scheduleSave(next);
      return next;
    });
  };

  if (!config) {
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement des garde-fous…
      </div>
    );
  }

  const activeCount = SAFEGUARD_DEFS.filter((d) => config[d.id].mode !== "off").length;

  return (
    <div className="space-y-4">
      {/* Statut : nb de règles actives + état d'enregistrement */}
      <div className="flex items-center justify-between gap-3 -mt-1">
        <p className="text-[12px] text-muted-foreground max-w-xl">
          Règles appliquées à <b>tous les postes</b> — alertes en direct dans la console,
          filet à la création de commande (serveur) et badges dans les Ventes du jour.
          <b> Avertir</b> = confirmable par le commercial · <b>Bloquer</b> = vente refusée.
        </p>
        <span className={cn(
          "inline-flex items-center gap-1.5 text-[11.5px] font-semibold shrink-0",
          error ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
        )}>
          {saving
            ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Enregistrement…</>)
            : error
              ? (<><ShieldAlert className="h-3.5 w-3.5" /> Non enregistré</>)
              : savedAt
                ? (<><Check className="h-3.5 w-3.5 text-emerald-500" /> Enregistré</>)
                : (<><ShieldCheck className="h-3.5 w-3.5" /> {activeCount} règle{activeCount > 1 ? "s" : ""} active{activeCount > 1 ? "s" : ""}</>)}
        </span>
      </div>

      {SAFEGUARD_CATEGORIES.map((cat) => {
        const defs = SAFEGUARD_DEFS.filter((d) => d.category === cat.id);
        if (defs.length === 0) return null;
        return (
          <section key={cat.id}>
            <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-1.5">
              {cat.label}
            </p>
            <div className="rounded-lg border border-border/60 divide-y divide-border/50">
              {defs.map((d) => {
                const rule = config[d.id];
                const off = rule.mode === "off";
                return (
                  <div key={d.id} className="px-3 py-2.5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <p className={cn("text-[13px] font-semibold", off ? "text-muted-foreground" : "text-foreground")}>
                          {d.label}
                        </p>
                        <p className="text-[11.5px] text-muted-foreground mt-0.5 max-w-lg">{d.description}</p>
                      </div>
                      <ModeToggle
                        ariaLabel={`Mode du garde-fou « ${d.label} »`}
                        value={rule.mode}
                        onChange={(m) => update(d.id, { mode: m })}
                      />
                    </div>
                    {d.params.length > 0 && (
                      <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-2", off && "opacity-50")}>
                        {d.params.map((p) => (
                          <label key={p.key} className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                            {p.label}
                            <NumberInput
                              value={rule.params[p.key] ?? p.default}
                              onValueChange={(n) => { if (n != null) update(d.id, { param: { key: p.key, value: n } }); }}
                              min={p.min}
                              max={p.max}
                              step={p.step ?? 1}
                              disabled={off}
                              aria-label={`${d.label} — ${p.label}`}
                              className="h-7 w-[74px] rounded-md border border-border bg-background px-2 text-[12px] tnum text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:cursor-not-allowed"
                            />
                            <span className="font-medium">{p.unit}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
