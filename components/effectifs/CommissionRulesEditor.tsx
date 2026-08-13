"use client";

/**
 * Éditeur de RÈGLES DE COMMISSION (« SI … ALORS … ») + AVANCEMENT par client.
 * Piloté par les données de /api/effectif/commissions (champs `rules`, `progress`,
 * `seuilKg`). Sauvegarde via PUT /api/commerciaux/rules. Réservé direction/admin.
 *
 * Types redéfinis ici (le client ne peut pas importer lib/commissionRules, qui
 * tire Prisma) — tenus alignés avec le backend.
 */
import { useState } from "react";
import { Loader2, Plus, Trash2, Save, Target } from "lucide-react";
import { toast } from "sonner";

export type RuleMetric = "volume_kg" | "caht";
export type RuleAction = "rate_marge" | "rate_caht" | "fixed";
export interface Rule { id: string; metric: RuleMetric; threshold: number; action: RuleAction; value: number; }

export interface Progress {
  cardCode: string; cardName: string | null; kg: number; caht: number;
  qualified: boolean; winningLabel: string | null;
  nextMetric: RuleMetric | null; nextThreshold: number | null; nextLabel: string | null; ratio: number;
}

const eur0 = (v: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const kg0 = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} kg`;

export function describeRule(r: Rule): string {
  const cond = r.metric === "volume_kg" ? `volume ≥ ${Math.round(r.threshold)} kg` : `CA HT ≥ ${eur0(r.threshold)}`;
  const act = r.action === "rate_marge" ? `${round2(r.value * 100)} % de marge nette`
    : r.action === "rate_caht" ? `${round2(r.value * 100)} % du CA HT`
      : `prime fixe ${eur0(r.value)}`;
  return `SI ${cond} ALORS ${act}`;
}
const round2 = (v: number) => Math.round(v * 100) / 100;
const uid = () => `r${Math.floor(performance.now() * 1000)}${Math.floor(performance.timeOrigin % 1000)}`;

/* ───────────────────────────── Avancement clients ───────────────────────── */

export function ClientProgress({ progress }: { progress: Progress[] }) {
  if (!progress.length) return <p className="text-[12px] text-muted-foreground py-2">Aucun client à afficher.</p>;
  const done = progress.filter((p) => p.qualified).length;
  return (
    <div className="mt-1 space-y-1.5">
      <p className="text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">{done}</span> / {progress.length} clients commissionnés
      </p>
      <ul className="space-y-1">
        {progress.map((p) => (
          <li key={p.cardCode} className="flex items-center gap-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate" title={p.cardName ?? p.cardCode}>
              {p.cardName ?? p.cardCode}
            </span>
            <span className="tnum text-muted-foreground shrink-0 w-24 text-right">
              {kg0(p.kg)} · {eur0(p.caht)}
            </span>
            <div className="w-24 h-1.5 rounded-full bg-secondary overflow-hidden shrink-0">
              <div
                className={`h-full rounded-full ${p.qualified ? "bg-emerald-500" : "bg-amber-400"}`}
                style={{ width: `${Math.round(Math.min(1, p.ratio) * 100)}%` }}
              />
            </div>
            <span className={`tnum shrink-0 w-9 text-right font-semibold ${p.qualified ? "text-emerald-500" : "text-amber-500"}`}>
              {p.qualified ? "✓" : `${Math.round(p.ratio * 100)}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────────────── Éditeur de règles ──────────────────────── */

export function CommissionRulesEditor({
  slp, initial, hasCustom, onSaved,
}: {
  slp: string;
  initial: Rule[];
  hasCustom: boolean;
  onSaved: () => void;
}) {
  const [rules, setRules] = useState<Rule[]>(initial.map((r) => ({ ...r })));
  const [saving, setSaving] = useState(false);

  const patch = (i: number, up: Partial<Rule>) =>
    setRules((rs) => rs.map((r, k) => (k === i ? { ...r, ...up } : r)));
  const add = () =>
    setRules((rs) => [...rs, { id: uid(), metric: "volume_kg", threshold: 200, action: "rate_marge", value: 0.05 }]);
  const del = (i: number) => setRules((rs) => rs.filter((_, k) => k !== i));

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/commerciaux/rules", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slpName: slp, rules }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? "Échec");
      toast.success("Règles de commission enregistrées");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec"); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    if (!window.confirm("Revenir à la règle par défaut (seuil kg + taux) ? Les règles personnalisées seront supprimées.")) return;
    setSaving(true);
    try {
      const r = await fetch("/api/commerciaux/rules", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slpName: slp, rules: [] }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? "Échec");
      toast.success("Retour à la règle par défaut");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec"); }
    finally { setSaving(false); }
  };

  return (
    <div className="mt-1 space-y-2">
      <p className="text-[11px] text-muted-foreground">
        Pour chaque client, la <b className="text-foreground">première règle vraie</b> l&apos;emporte (sinon non commissionné).
        {!hasCustom && " Actuellement : règle par défaut (dérivée du seuil kg + taux)."}
      </p>

      <div className="space-y-1.5">
        {rules.map((r, i) => (
          <div key={r.id} className="flex flex-wrap items-center gap-1.5 text-[12px] rounded-lg border border-border bg-background/60 px-2 py-1.5">
            <span className="text-muted-foreground font-semibold">SI</span>
            <select
              value={r.metric} onChange={(e) => patch(i, { metric: e.target.value as RuleMetric })}
              className="h-7 rounded border border-border bg-background px-1.5"
            >
              <option value="volume_kg">volume (kg)</option>
              <option value="caht">CA HT (€)</option>
            </select>
            <span className="text-muted-foreground">≥</span>
            <input
              type="number" min={0} step={r.metric === "volume_kg" ? 50 : 500} value={r.threshold}
              onChange={(e) => patch(i, { threshold: Number(e.target.value) })}
              className="h-7 w-24 rounded border border-border bg-background px-1.5 tnum"
            />
            <span className="text-muted-foreground font-semibold">ALORS</span>
            <select
              value={r.action} onChange={(e) => patch(i, { action: e.target.value as RuleAction })}
              className="h-7 rounded border border-border bg-background px-1.5"
            >
              <option value="rate_marge">% marge nette</option>
              <option value="rate_caht">% CA HT</option>
              <option value="fixed">prime fixe €</option>
            </select>
            {r.action === "fixed" ? (
              <div className="relative">
                <input
                  type="number" min={0} step={50} value={r.value}
                  onChange={(e) => patch(i, { value: Number(e.target.value) })}
                  className="h-7 w-24 rounded border border-border bg-background pl-1.5 pr-5 tnum"
                />
                <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">€</span>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="number" min={0} max={100} step={0.5} value={round2(r.value * 100)}
                  onChange={(e) => patch(i, { value: Math.min(1, Number(e.target.value) / 100) })}
                  className="h-7 w-20 rounded border border-border bg-background pl-1.5 pr-5 tnum"
                />
                <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">%</span>
              </div>
            )}
            <button type="button" onClick={() => del(i)} title="Supprimer la règle"
              className="ml-auto shrink-0 text-muted-foreground hover:text-rose-500">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {rules.length === 0 && (
          <p className="text-[12px] text-amber-500 italic">Aucune règle → ce commercial ne sera pas commissionné. Ajoutez-en une ou revenez au défaut.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button type="button" onClick={add}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[12px] hover:bg-secondary">
          <Plus className="h-3.5 w-3.5" /> Règle
        </button>
        <button type="button" onClick={save} disabled={saving}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-brand-600 px-3 text-[12px] font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Enregistrer
        </button>
        {hasCustom && (
          <button type="button" onClick={reset} disabled={saving}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground hover:text-foreground">
            <Target className="h-3.5 w-3.5" /> Règle par défaut
          </button>
        )}
      </div>
    </div>
  );
}
