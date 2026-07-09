"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Plus, Trash2, Save, Truck, Calculator, Camera, Receipt, X,
  TrendingDown, ChevronDown, ChevronRight, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhotoStep } from "@/components/inventaire/PhotoStep";
import type { DraftPhoto } from "@/components/inventaire/inv-utils";
import { TransportBreakdown } from "@/components/transport/TransportBreakdown";
import {
  computeTransportMetrics,
  COST_KIND_LABELS,
  PERIOD_LABELS,
  TRANSPORT_COST_KINDS,
  type TransportCostKind,
  type TransportCostLine,
  type TransportCostModel,
  type CostPeriod,
  type TransportExpense,
} from "@/lib/transportCost";

/**
 * Panneau « Coût de transport » — structure de coûts (direction) + dépenses
 * (transporteur, photo à l'appui) + états (hebdo/mensuel/annuel) et prix
 * position €/kg. Le calcul vit dans lib/transportCost (partagé, testé) ;
 * ici on ne fait que l'UI et l'I/O API.
 */

const fmtEur = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const fmtEur2 = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
/** Prix au kilo — 3 décimales (ex. 0,142 €/kg). */
const fmtPerKg = (v: number) =>
  `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v)} €/kg`;
const fmtInt = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v);
const fmtKg = (v: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v)} kg`;
const fmtDate = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("fr-FR");
};

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

const EMPTY: TransportCostModel = { costs: [], deliveriesPerYear: 0, kgPerYear: 0, directCarriers: [] };

/** Un transporteur du catalogue (SAP SERGTRS ou table Carrier locale). */
interface CarrierOpt { code: string; name: string }

export function TransportCostPanel({ isManager }: { isManager: boolean }) {
  const [model, setModel] = useState<TransportCostModel>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [expenses, setExpenses] = useState<TransportExpense[]>([]);
  const [carriers, setCarriers] = useState<CarrierOpt[]>([]);

  const loadModel = useCallback(() => {
    return fetch("/api/transport/model", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j?.model) setModel({ ...EMPTY, ...j.model }); })
      .catch(() => {});
  }, []);

  // Catalogue transporteurs — SAP SERGTRS d'abord (mêmes codes U_TrspCode qu'à
  // la commande), repli sur la table Carrier locale. Best-effort (peut être vide).
  const loadCarriers = useCallback(async () => {
    try {
      const r = await fetch("/api/transporteurs", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (Array.isArray(j?.transporteurs) && j.transporteurs.length) {
        setCarriers(j.transporteurs.map((t: { code: string; name?: string }) => ({ code: t.code, name: t.name || t.code })));
        return;
      }
    } catch { /* repli local */ }
    try {
      const r = await fetch("/api/carriers", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (Array.isArray(j?.carriers)) {
        setCarriers(
          (j.carriers as { name: string; sapValue?: string | null }[])
            .filter((c) => c.sapValue && c.sapValue.trim())
            .map((c) => ({ code: c.sapValue!.trim(), name: c.name || c.sapValue!.trim() })),
        );
      }
    } catch { /* aucun catalogue */ }
  }, []);

  const loadExpenses = useCallback(() => {
    return fetch("/api/transport/expenses", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (Array.isArray(j?.expenses)) setExpenses(j.expenses); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([loadModel(), loadExpenses(), loadCarriers()]).finally(() => setLoading(false));
  }, [loadModel, loadExpenses, loadCarriers]);

  // Métriques recalculées EN LIVE à chaque édition (même avant enregistrement).
  const metrics = useMemo(() => computeTransportMetrics(model), [model]);

  /* ── Édition du modèle (direction) ─────────────────────────────────────── */
  const patchModel = (patch: Partial<TransportCostModel>) => { setModel((m) => ({ ...m, ...patch })); setDirty(true); };
  const patchLine = (id: string, patch: Partial<TransportCostLine>) => {
    setModel((m) => ({ ...m, costs: m.costs.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
    setDirty(true);
  };
  const addLine = () => {
    setModel((m) => ({
      ...m,
      costs: [...m.costs, { id: uid(), label: "", kind: "entretien", amount: 0, period: "monthly", amortYears: null }],
    }));
    setDirty(true);
  };
  const removeLine = (id: string) => { setModel((m) => ({ ...m, costs: m.costs.filter((l) => l.id !== id) })); setDirty(true); };

  // ── Transporteurs : marquer « direct » (flotte propre → prix position). Le
  //    tarif des transporteurs externes se saisit PAR CLIENT (fiche client). ──
  const norm = (c: string) => c.trim().toUpperCase();
  const setDirect = (code: string, direct: boolean) => {
    const k = norm(code);
    setModel((m) => {
      const set = new Set((m.directCarriers ?? []).map(norm));
      if (direct) set.add(k); else set.delete(k);
      return { ...m, directCarriers: [...set] };
    });
    setDirty(true);
  };

  // ── Récupération des volumes DIRECTS depuis les BL SAP (année en cours) ──
  const [fetchingBL, setFetchingBL] = useState(false);
  async function fetchFromBL() {
    setFetchingBL(true);
    try {
      const r = await fetch("/api/transport/direct-deliveries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Échec de la récupération");
      if (j.model) { setModel({ ...EMPTY, ...j.model }); setDirty(false); }
      toast.success(`${j.deliveries} livraison(s) directe(s) · ${Math.round(j.kg).toLocaleString("fr-FR")} kg (${j.window ?? "12 mois"})`, {
        description: j.truncated ? "Résultat plafonné — affine la période si besoin." : "Volumes renseignés depuis les BL (12 mois glissants).",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de récupération");
    } finally {
      setFetchingBL(false);
    }
  }

  async function saveModel() {
    setSaving(true);
    try {
      const r = await fetch("/api/transport/model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(model),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Échec de l'enregistrement");
      setModel({ ...EMPTY, ...j.model });
      setDirty(false);
      toast.success("Structure de coûts enregistrée", {
        description: `Prix position : ${fmtPerKg(computeTransportMetrics(j.model).prixPositionPerKg)}`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="h-40 flex items-center justify-center border border-border rounded-2xl bg-card">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── États / prix position (résultat) ─────────────────────────────── */}
      <MetricsBoard metrics={metrics} />

      {/* ── États détaillés (par poste / transporteur / client) ──────────── */}
      <TransportBreakdown metrics={metrics} isManager={isManager} />

      {/* ── Structure de coûts (direction) ───────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground inline-flex items-center gap-1.5">
              <Calculator className="h-3.5 w-3.5" /> Structure de coûts · direction
            </p>
            <p className="text-[12px] text-muted-foreground mt-1 max-w-xl">
              Tous les coûts rapportables à la livraison directe. L&apos;amortissement s&apos;étale
              sur X années ; les autres coûts sont saisis par période (hebdo / mensuel / annuel).
            </p>
          </div>
          {isManager && (
            <Button size="sm" variant="outline" onClick={addLine} className="shrink-0">
              <Plus className="h-3.5 w-3.5" /> Ligne
            </Button>
          )}
        </div>

        {model.costs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-8 text-center text-[13px] text-muted-foreground">
            Aucune ligne de coût. {isManager ? "Ajoute une première ligne (amortissement, salaire livreur…)." : "En attente de saisie par la direction."}
          </div>
        ) : (
          <div className="space-y-2">
            {model.costs.map((line) => (
              <CostLineRow
                key={line.id}
                line={line}
                editable={isManager}
                annual={computeTransportMetrics({ ...EMPTY, costs: [line] }).annualCost}
                onPatch={(p) => patchLine(line.id, p)}
                onRemove={() => removeLine(line.id)}
              />
            ))}
          </div>
        )}

        {/* Volumes de référence — récupérables depuis les BL SAP */}
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-4">
          <p className="text-[11px] text-muted-foreground">
            Volumes de référence <span className="text-muted-foreground/70">(livraisons en direct)</span>
          </p>
          {isManager && (
            <Button size="sm" variant="outline" onClick={fetchFromBL} disabled={fetchingBL} title="Compter les BL des 12 derniers mois et sommer le poids pour les transporteurs marqués « direct »">
              {fetchingBL ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Récupérer depuis les BL (12 mois)
            </Button>
          )}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <VolumeField
            label="Livraisons directes / an"
            hint="Nombre de livraisons EN DIRECT (flotte propre) sur l'année"
            value={model.deliveriesPerYear}
            editable={isManager}
            step={10}
            onChange={(v) => patchModel({ deliveriesPerYear: v })}
          />
          <VolumeField
            label="Kilos livrés en direct / an"
            hint="Volume livré EN DIRECT (flotte propre) sur l'année"
            value={model.kgPerYear}
            editable={isManager}
            step={1000}
            suffix="kg"
            onChange={(v) => patchModel({ kgPerYear: v })}
          />
          <div className="rounded-xl bg-secondary/40 px-3 py-2.5 flex flex-col justify-center">
            <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">Coût annuel total</p>
            <p className="text-[19px] font-bold tnum text-foreground leading-tight">{fmtEur(metrics.annualCost)}</p>
          </div>
        </div>

        {isManager && (
          <div className="mt-4 flex items-center justify-end gap-2">
            {model.updatedAt && !dirty && (
              <span className="text-[11px] text-muted-foreground mr-auto">
                Enregistré le {fmtDate(model.updatedAt)}
              </span>
            )}
            <Button onClick={saveModel} disabled={saving || !dirty} variant={dirty ? "default" : "secondary"}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Enregistrer
            </Button>
          </div>
        )}
      </section>

      {/* ── Transporteurs : marquer ceux « en direct » (flotte propre) ────── */}
      <CarriersSection
        carriers={carriers}
        model={model}
        prixPositionPerKg={metrics.prixPositionPerKg}
        isManager={isManager}
        onSetDirect={setDirect}
      />

      {/* ── Dépenses transporteur (photo à l'appui) ──────────────────────── */}
      <ExpensesSection
        expenses={expenses}
        isManager={isManager}
        onReload={loadExpenses}
        onAdded={(e) => setExpenses((cur) => [e, ...cur])}
        onDeleted={(id) => setExpenses((cur) => cur.filter((x) => x.id !== id))}
      />
    </div>
  );
}

/* ── Tableau des états + prix position ─────────────────────────────────────── */
function MetricsBoard({ metrics }: { metrics: ReturnType<typeof computeTransportMetrics> }) {
  const hasKg = metrics.kgPerYear > 0;
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-border/60 flex items-center gap-2">
        <Truck className="h-4 w-4 text-brand-500" />
        <p className="text-[13px] font-semibold text-foreground">Gestion de marge nette transport</p>
      </div>

      {/* Prix position — la valeur qui fait foi (annuelle) */}
      <div className="grid gap-px bg-border/60 sm:grid-cols-3">
        <div className="bg-card p-4 sm:col-span-1 flex flex-col justify-center">
          <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground inline-flex items-center gap-1">
            <TrendingDown className="h-3 w-3" /> Prix position (€/kg)
          </p>
          <p className="mt-1 text-[30px] font-bold tnum leading-none text-brand-600 dark:text-brand-400">
            {hasKg ? fmtPerKg(metrics.prixPositionPerKg) : "—"}
          </p>
          <p className="text-[10.5px] text-muted-foreground mt-1.5">
            Coût transport au kilo · valeur ANNUELLE (reportée en fiche client)
          </p>
        </div>
        <div className="bg-card p-4 flex flex-col justify-center">
          <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">Coût / livraison</p>
          <p className="mt-1 text-[22px] font-bold tnum leading-tight text-foreground">
            {metrics.deliveriesPerYear > 0 ? fmtEur2(metrics.costPerDelivery) : "—"}
          </p>
          <p className="text-[10.5px] text-muted-foreground mt-1.5">
            {fmtInt(metrics.deliveriesPerYear)} livraisons/an · {fmtKg(metrics.kgPerYear)}
          </p>
        </div>
        <div className="bg-card p-4 flex flex-col justify-center">
          <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">Règle transporteur</p>
          <p className="mt-1 text-[13px] font-medium text-foreground leading-snug">
            Direct → <span className="tnum font-bold">prix position</span>
          </p>
          <p className="text-[10.5px] text-muted-foreground mt-1">
            Seules les livraisons EN DIRECT sont valorisées au prix position ; les autres
            transporteurs portent une valeur €/kg saisie à la main (voir ci-dessous).
          </p>
        </div>
      </div>

      {/* États : annuel (12 mois glissants, référence) + mensuel (indicatif) */}
      <div className="px-4 sm:px-5 py-3 border-t border-border/60">
        <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2">États du coût</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-muted-foreground border-b border-border/60">
                <th className="text-left font-medium py-1.5 pr-3">Période</th>
                <th className="text-right font-medium py-1.5 px-3">Coût</th>
                <th className="text-right font-medium py-1.5 pl-3">Repère</th>
              </tr>
            </thead>
            <tbody className="tnum">
              <PeriodRow label="Annuel · 12 mois glissants" value={fmtEur(metrics.annualCost)} note="valeur de référence" strong />
              <PeriodRow label="Mensuel" indicatif value={fmtEur2(metrics.monthlyCost)} note="indicatif (annuel ÷ 12)" />
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function PeriodRow({ label, value, note, indicatif, strong }: { label: string; value: string; note: string; indicatif?: boolean; strong?: boolean }) {
  return (
    <tr className={`border-b border-border/40 last:border-0 ${strong ? "font-semibold text-foreground" : "text-foreground/90"}`}>
      <td className="py-1.5 pr-3">
        {label}
        {indicatif && <span className="ml-1.5 text-[10px] font-normal text-amber-600 dark:text-amber-400 uppercase tracking-wide">indicatif</span>}
      </td>
      <td className="py-1.5 px-3 text-right">{value}</td>
      <td className="py-1.5 pl-3 text-right text-[11px] text-muted-foreground font-normal">{note}</td>
    </tr>
  );
}

/* ── Ligne de coût éditable ────────────────────────────────────────────────── */
function CostLineRow({
  line, editable, annual, onPatch, onRemove,
}: {
  line: TransportCostLine;
  editable: boolean;
  annual: number;
  onPatch: (p: Partial<TransportCostLine>) => void;
  onRemove: () => void;
}) {
  const isAmort = line.kind === "amortissement";
  const selectCls = "h-9 rounded-md border border-input bg-background px-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
  const inputCls = "h-9 rounded-md border border-input bg-background px-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
  return (
    <div className="grid grid-cols-2 lg:grid-cols-12 gap-2 items-center rounded-xl bg-secondary/30 p-2">
      <input
        className={`${inputCls} col-span-2 lg:col-span-3`}
        placeholder={COST_KIND_LABELS[line.kind]}
        value={line.label}
        disabled={!editable}
        onChange={(e) => onPatch({ label: e.target.value })}
      />
      <select
        className={`${selectCls} col-span-1 lg:col-span-2`}
        value={line.kind}
        disabled={!editable}
        onChange={(e) => {
          const kind = e.target.value as TransportCostKind;
          onPatch({ kind, amortYears: kind === "amortissement" ? (line.amortYears ?? 5) : null });
        }}
      >
        {TRANSPORT_COST_KINDS.map((k) => (
          <option key={k} value={k}>{COST_KIND_LABELS[k]}</option>
        ))}
      </select>
      <div className="col-span-1 lg:col-span-2 flex items-center gap-1">
        <input
          type="number" min={0} step={10}
          className={`${inputCls} w-full text-right`}
          value={line.amount || ""}
          disabled={!editable}
          onChange={(e) => onPatch({ amount: parseFloat(e.target.value) || 0 })}
          aria-label={isAmort ? "Investissement total (€)" : "Montant (€)"}
        />
        <span className="text-[12px] text-muted-foreground">€</span>
      </div>
      {isAmort ? (
        <div className="col-span-1 lg:col-span-2 flex items-center gap-1">
          <input
            type="number" min={1} max={40} step={1}
            className={`${inputCls} w-full text-right`}
            value={line.amortYears ?? ""}
            disabled={!editable}
            onChange={(e) => onPatch({ amortYears: parseFloat(e.target.value) || 0 })}
            aria-label="Nombre d'années d'amortissement"
          />
          <span className="text-[12px] text-muted-foreground whitespace-nowrap">ans</span>
        </div>
      ) : (
        <select
          className={`${selectCls} col-span-1 lg:col-span-2`}
          value={line.period}
          disabled={!editable}
          onChange={(e) => onPatch({ period: e.target.value as CostPeriod })}
        >
          {(["weekly", "monthly", "annual"] as CostPeriod[]).map((p) => (
            <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
          ))}
        </select>
      )}
      <div className="col-span-1 lg:col-span-2 flex items-center justify-end gap-2">
        <span className="text-[12px] tnum text-muted-foreground whitespace-nowrap" title="Montant annualisé">
          {fmtEur(annual)}<span className="text-[10px]">/an</span>
        </span>
        {editable && (
          <button
            type="button"
            onClick={onRemove}
            className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
            aria-label="Supprimer la ligne"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Champ volume ──────────────────────────────────────────────────────────── */
function VolumeField({
  label, hint, value, editable, step, suffix, onChange,
}: {
  label: string; hint: string; value: number; editable: boolean; step: number; suffix?: string; onChange: (v: number) => void;
}) {
  return (
    <label className="rounded-xl bg-secondary/40 px-3 py-2.5 block">
      <span className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-center gap-1">
        <input
          type="number" min={0} step={step}
          className="h-8 w-full rounded-md bg-background/70 border border-input px-2 text-[16px] font-bold tnum text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70 disabled:border-transparent disabled:bg-transparent"
          value={value || ""}
          disabled={!editable}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        />
        {suffix && <span className="text-[12px] text-muted-foreground">{suffix}</span>}
      </div>
      <span className="text-[10px] text-muted-foreground">{hint}</span>
    </label>
  );
}

/* ── Section transporteurs : marquer ceux « en direct » (flotte propre) ─────── */
function CarriersSection({
  carriers, model, prixPositionPerKg, isManager, onSetDirect,
}: {
  carriers: CarrierOpt[];
  model: TransportCostModel;
  prixPositionPerKg: number;
  isManager: boolean;
  onSetDirect: (code: string, direct: boolean) => void;
}) {
  const norm = (c: string) => c.trim().toUpperCase();
  const directSet = new Set((model.directCarriers ?? []).map(norm));
  // Transporteurs marqués « direct » mais absents du catalogue (SAP indispo) :
  // on les liste quand même pour pouvoir les décocher.
  const known = new Set(carriers.map((c) => norm(c.code)));
  const extras = [...directSet].filter((k) => !known.has(k)).map((code) => ({ code, name: code }));
  const rows = [...carriers, ...extras];
  const fmtPerKg = (v: number) =>
    `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v)} €/kg`;

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-4">
        <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground inline-flex items-center gap-1.5">
          <Truck className="h-3.5 w-3.5" /> Transporteurs · livraison en direct
        </p>
        <p className="text-[12px] text-muted-foreground mt-1 max-w-xl">
          Marque « direct » les transporteurs de la flotte propre (ex. <span className="font-medium text-foreground">DIRECT IDF</span>, <span className="font-medium text-foreground">GERVIFRAIS IDF</span>) — valorisés au prix position
          {prixPositionPerKg > 0 ? <> · <span className="tnum font-medium text-foreground">{fmtPerKg(prixPositionPerKg)}</span></> : null}.
          Le tarif des transporteurs externes se saisit <span className="font-medium text-foreground">par client</span> (fiche client › Logistique).
          Tant qu&apos;aucun transporteur n&apos;est marqué direct, toutes les livraisons sont considérées directes.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-8 text-center text-[13px] text-muted-foreground">
          Catalogue transporteurs indisponible (SAP injoignable). La règle de repli « tout direct » s&apos;applique.
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((c) => {
            const k = norm(c.code);
            const direct = directSet.has(k);
            return (
              <li key={k} className="py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-foreground truncate">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">Code {c.code}</p>
                </div>
                <button
                  type="button"
                  onClick={() => isManager && onSetDirect(c.code, !direct)}
                  disabled={!isManager}
                  aria-pressed={direct}
                  className={`shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-60 ${
                    direct
                      ? "bg-brand-100 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/40"
                      : "bg-secondary/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Truck className="h-3.5 w-3.5" />
                  {direct ? "Direct" : "Externe"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ── Section dépenses transporteur ─────────────────────────────────────────── */
function ExpensesSection({
  expenses, isManager, onReload, onAdded, onDeleted,
}: {
  expenses: TransportExpense[];
  isManager: boolean;
  onReload: () => Promise<void> | void;
  onAdded: (e: TransportExpense) => void;
  onDeleted: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const total = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground inline-flex items-center gap-1.5">
            <Receipt className="h-3.5 w-3.5" /> Dépenses transporteur · justificatifs
          </p>
          <p className="text-[12px] text-muted-foreground mt-1 max-w-xl">
            Le transporteur notifie ici toutes ses dépenses, photo à l&apos;appui. Elles
            documentent la structure de coûts ci-dessus. Total déclaré : <span className="font-semibold text-foreground tnum">{fmtEur2(total)}</span>.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)} className="shrink-0">
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? "Fermer" : "Dépense"}
        </Button>
      </div>

      {showForm && (
        <ExpenseForm
          onCancel={() => setShowForm(false)}
          onSaved={(e) => { onAdded(e); setShowForm(false); }}
        />
      )}

      {expenses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-8 text-center text-[13px] text-muted-foreground">
          Aucune dépense déclarée pour l&apos;instant.
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {expenses.map((e) => (
            <ExpenseRow key={e.id} expense={e} isManager={isManager} onDeleted={onDeleted} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ExpenseRow({ expense, isManager, onDeleted }: { expense: TransportExpense; isManager: boolean; onDeleted: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<TransportExpense | null>(null);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const nbPhotos = full?.photos.length ?? expense.nbPhotos ?? 0;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !full && nbPhotos > 0) {
      setLoadingPhotos(true);
      try {
        const r = await fetch(`/api/transport/expenses?id=${encodeURIComponent(expense.id)}`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (j?.expense) setFull(j.expense);
      } catch { /* ignore */ }
      finally { setLoadingPhotos(false); }
    }
  }

  async function remove() {
    if (!confirm("Supprimer cette dépense ?")) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/transport/expenses?id=${encodeURIComponent(expense.id)}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      onDeleted(expense.id);
      toast.success("Dépense supprimée");
    } catch {
      toast.error("Suppression impossible");
      setDeleting(false);
    }
  }

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="flex-1 flex items-center gap-3 min-w-0 text-left"
          aria-expanded={open}
        >
          {nbPhotos > 0 ? (
            open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <span className="h-4 w-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-foreground truncate">
              {expense.label || COST_KIND_LABELS[expense.category]}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {COST_KIND_LABELS[expense.category]} · {fmtDate(expense.date)}
              {nbPhotos > 0 && <span className="inline-flex items-center gap-0.5 ml-1.5"><Camera className="h-3 w-3" />{nbPhotos}</span>}
            </p>
          </div>
        </button>
        <span className="text-[14px] font-bold tnum text-foreground shrink-0">{fmtEur2(expense.amount)}</span>
        {isManager && (
          <button
            type="button"
            onClick={remove}
            disabled={deleting}
            className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors disabled:opacity-50"
            aria-label="Supprimer la dépense"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 ml-7">
          {expense.note && <p className="text-[12px] text-muted-foreground mb-2 whitespace-pre-wrap">{expense.note}</p>}
          {loadingPhotos ? (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement des photos…</div>
          ) : full && full.photos.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {full.photos.map((p) => (
                <a key={p.id} href={p.dataUrl} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.dataUrl} alt="justificatif dépense" className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">Aucune photo jointe.</p>
          )}
        </div>
      )}
    </li>
  );
}

function ExpenseForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: (e: TransportExpense) => void }) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [category, setCategory] = useState<TransportCostKind>("entretien");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [saving, setSaving] = useState(false);

  const selectCls = "h-10 rounded-md border border-input bg-background px-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const inputCls = "h-10 w-full rounded-md border border-input bg-background px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  async function submit() {
    if (!label.trim() && amount <= 0 && photos.length === 0) {
      toast.error("Renseigne au moins un libellé, un montant ou une photo.");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/transport/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label, amount, category, date, note,
          photos: photos.map((p) => ({ id: p.id, dataUrl: p.dataUrl, bytes: p.bytes })),
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Échec");
      toast.success("Dépense enregistrée");
      onSaved(j.expense);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-3 sm:p-4 mb-4 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input className={`${inputCls} sm:col-span-2`} placeholder="Libellé (ex. Plein gasoil, pneu…)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className="flex items-center gap-1">
          <input type="number" min={0} step={1} className={`${inputCls} text-right`} placeholder="Montant" value={amount || ""} onChange={(e) => setAmount(parseFloat(e.target.value) || 0)} />
          <span className="text-[12px] text-muted-foreground">€</span>
        </div>
        <select className={selectCls} value={category} onChange={(e) => setCategory(e.target.value as TransportCostKind)}>
          {TRANSPORT_COST_KINDS.map((k) => <option key={k} value={k}>{COST_KIND_LABELS[k]}</option>)}
        </select>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Date</span>
          <input type="date" className={`${inputCls} mt-1`} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Note (optionnel)</span>
          <input className={`${inputCls} mt-1`} placeholder="Précision…" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      <div>
        <p className="text-[11px] font-semibold text-muted-foreground mb-2 inline-flex items-center gap-1.5">
          <Camera className="h-3.5 w-3.5" /> Photos justificatives
        </p>
        <PhotoStep photos={photos} onChange={setPhotos} />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>Annuler</Button>
        <Button size="sm" onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
        </Button>
      </div>
    </div>
  );
}
