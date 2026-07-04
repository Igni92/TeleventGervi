"use client";

/**
 * PARAMÈTRES › NAVIGATION — personnalisation des entrées de la sidebar :
 * renommer un libellé et changer l'EMPLACEMENT (groupe + position).
 *
 * Réglage GLOBAL (poste partagé — pas de personnalisation par utilisateur,
 * cf. charte), réservé à l'administration : PUT /api/nav-overrides. La sidebar
 * se met à jour immédiatement (événement `nav-overrides-changed`) et à chaque
 * chargement. « Accueil » et le groupe Système restent renommables mais
 * l'Accueil n'est pas déplaçable (porte d'entrée fixe).
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, PanelLeft, RotateCcw, Save } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { NAV_GROUPS } from "@/components/Sidebar";
import { applyNavOverrides, type NavOverrides } from "@/lib/navOverrides";

interface Row { href: string; defaultLabel: string; defaultGroup: string; label: string }
interface GroupState { label: string; rows: Row[] }

/** Groupes personnalisables = ceux qui portent un libellé (Accueil exclu). */
const GROUP_LABELS = NAV_GROUPS.map((g) => g.label).filter((l): l is string => !!l);

/** Groupe d'ORIGINE de chaque entrée (pour ne stocker que les vrais écarts). */
const DEFAULT_GROUP_BY_HREF = new Map<string, string>();
const DEFAULT_LABEL_BY_HREF = new Map<string, string>();
for (const g of NAV_GROUPS) {
  if (!g.label) continue;
  for (const it of g.items) {
    DEFAULT_GROUP_BY_HREF.set(it.href, g.label);
    DEFAULT_LABEL_BY_HREF.set(it.href, it.label);
  }
}

/** Construit l'état d'édition depuis des surcharges existantes. */
function toState(overrides: NavOverrides): GroupState[] {
  return applyNavOverrides(NAV_GROUPS, overrides)
    .filter((g): g is typeof g & { label: string } => !!g.label)
    .map((g) => ({
      label: g.label!,
      rows: g.items.map((it) => ({
        href: it.href,
        defaultLabel: DEFAULT_LABEL_BY_HREF.get(it.href) ?? it.label,
        defaultGroup: DEFAULT_GROUP_BY_HREF.get(it.href) ?? g.label!,
        label: overrides[it.href]?.label ?? "",
      })),
    }));
}

/** Reconstruit les surcharges depuis l'état d'édition : ordre EXPLICITE pour
 *  toutes les entrées (déterministe), libellé/groupe seulement s'ils diffèrent. */
function toOverrides(state: GroupState[]): NavOverrides {
  const out: NavOverrides = {};
  for (const g of state) {
    g.rows.forEach((row, i) => {
      const ov: NavOverrides[string] = { order: i };
      if (row.label.trim() && row.label.trim() !== row.defaultLabel) ov.label = row.label.trim();
      if (g.label !== row.defaultGroup) ov.group = g.label;
      out[row.href] = ov;
    });
  }
  return out;
}

export function NavCustomizer() {
  const [state, setState] = useState<GroupState[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/nav-overrides", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setState(toState(j?.ok ? j.overrides ?? {} : {})); })
      .catch(() => { if (!cancelled) setState(toState({})); });
    return () => { cancelled = true; };
  }, []);

  const dirty = useMemo(() => state != null, [state]);   // sauvegarde explicite — pas de diff fin

  const rename = (href: string, label: string) =>
    setState((cur) => cur?.map((g) => ({ ...g, rows: g.rows.map((r) => (r.href === href ? { ...r, label } : r)) })) ?? cur);

  const move = (href: string, dir: -1 | 1) =>
    setState((cur) => {
      if (!cur) return cur;
      return cur.map((g) => {
        const i = g.rows.findIndex((r) => r.href === href);
        if (i < 0) return g;
        const j = i + dir;
        if (j < 0 || j >= g.rows.length) return g;
        const rows = g.rows.slice();
        [rows[i], rows[j]] = [rows[j], rows[i]];
        return { ...g, rows };
      });
    });

  const changeGroup = (href: string, target: string) =>
    setState((cur) => {
      if (!cur) return cur;
      let moved: Row | null = null;
      const without = cur.map((g) => {
        const row = g.rows.find((r) => r.href === href);
        if (row && g.label !== target) moved = row;
        return { ...g, rows: g.rows.filter((r) => r.href !== href || g.label === target) };
      });
      if (!moved) return cur;
      return without.map((g) => (g.label === target ? { ...g, rows: [...g.rows, moved!] } : g));
    });

  async function save(overrides: NavOverrides, successMsg: string) {
    setSaving(true);
    try {
      const r = await fetch("/api/nav-overrides", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Échec de l'enregistrement");
      setState(toState(j.overrides ?? {}));
      // La sidebar de CE poste se met à jour à chaud ; les autres au prochain chargement.
      window.dispatchEvent(new CustomEvent("nav-overrides-changed", { detail: j.overrides ?? {} }));
      toast.success(successMsg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SurfaceCard accent="brand" className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold flex items-center gap-2">
            <PanelLeft className="h-4 w-4 text-muted-foreground" />
            Navigation — libellés &amp; emplacement
          </h2>
          <p className="text-[12px] text-muted-foreground mt-1 max-w-2xl">
            Renomme les entrées de la barre latérale et change leur groupe ou leur ordre.
            Réglage <b>global</b> (tous les postes), appliqué immédiatement ici et au prochain
            chargement ailleurs. Vide = libellé d&apos;origine.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="sm" disabled={saving || !dirty}
            onClick={() => save({}, "Navigation réinitialisée (libellés et emplacements d'origine)")}>
            <RotateCcw className="h-3.5 w-3.5" /> Réinitialiser
          </Button>
          <Button size="sm" disabled={saving || !state}
            onClick={() => state && save(toOverrides(state), "Navigation enregistrée")}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Enregistrer
          </Button>
        </div>
      </div>

      {state === null ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement de la navigation…
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {state.map((g) => (
            <section key={g.label} className="rounded-xl border border-border overflow-hidden">
              <p className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground bg-secondary/40 border-b border-border">
                {g.label}
              </p>
              <ul className="divide-y divide-border/60">
                {g.rows.map((row, i) => (
                  <li key={row.href} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <input
                        value={row.label}
                        onChange={(e) => rename(row.href, e.target.value)}
                        placeholder={row.defaultLabel}
                        aria-label={`Libellé de ${row.defaultLabel}`}
                        className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/40 placeholder:text-muted-foreground/60"
                      />
                      <p className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">{row.href}</p>
                    </div>
                    <select
                      value={g.label}
                      onChange={(e) => changeGroup(row.href, e.target.value)}
                      aria-label={`Groupe de ${row.defaultLabel}`}
                      className="h-9 shrink-0 rounded-lg border border-border bg-card px-1.5 text-[11.5px] focus:outline-none focus:ring-2 focus:ring-ring/40"
                    >
                      {GROUP_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <span className="inline-flex shrink-0 rounded-lg border border-border overflow-hidden">
                      <button type="button" onClick={() => move(row.href, -1)} disabled={i === 0}
                        aria-label={`Monter ${row.defaultLabel}`}
                        className="h-9 w-8 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30">
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => move(row.href, 1)} disabled={i === g.rows.length - 1}
                        aria-label={`Descendre ${row.defaultLabel}`}
                        className="h-9 w-8 inline-flex items-center justify-center border-l border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30">
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
                {g.rows.length === 0 && (
                  <li className="px-3 py-2.5 text-[12px] italic text-muted-foreground">Groupe vide — il disparaît de la barre.</li>
                )}
              </ul>
            </section>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}
