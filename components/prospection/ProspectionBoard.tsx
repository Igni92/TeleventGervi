"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Target, CalendarPlus, Check, X, Phone, MapPin, ChevronLeft, ChevronRight, ArrowLeft, Plus, Search, BarChart3 } from "lucide-react";
import {
  PIPELINE_STAGES, getStage, nextStage, stageLabel,
  LOST_REASONS, RDV_TYPES, NOTIFY_MINUTES_CHOICES, notifyLabel, DEFAULT_NOTIFY_MINUTES_BEFORE,
} from "@/lib/prospection";

type Row = {
  id: string; code: string; nom: string; city: string | null; zipCode: string | null;
  tel1: string | null; email: string | null; probaLabo: string | null;
  prospectStage: string | null; prospectOwner: string | null; qualifieLabo: boolean | null;
  prospectLostReason: string | null; nextRdvAt: string | null;
};

/** Libellés courts des codes enseigne (cf. scripts/normalize-prospects.mjs). */
const ENSEIGNE_LABELS: Record<string, string> = {
  A: "Auchan", ITM: "Intermarché", U: "Système U", L: "Leclerc", CARR: "Carrefour",
  MONO: "Monoprix", FP: "Franprix", CASINO: "Casino/Géant", CORA: "Cora", LIDL: "Lidl",
  ALDI: "Aldi", COSTCO: "Costco", GE: "Grande Épicerie", NATU: "Naturalia", BIO: "Bio",
  G20: "G20", COCCI: "Coccinelle", PROXI: "Proxi", MF: "Marché Frais", AUTRE: "Indépendant",
};
/** Codes proposés dans le filtre (ordre = fréquence approx.). */
const ENSEIGNE_CHOICES = ["CARR", "ITM", "A", "U", "L", "MONO", "CORA", "CASINO", "GE", "COSTCO", "PROXI", "COCCI", "AUTRE"];

/** Départements français (métropole + Corse + DOM) pour le filtre zone. */
const DEPARTEMENTS: [string, string][] = [
  ["01", "Ain"], ["02", "Aisne"], ["03", "Allier"], ["04", "Alpes-de-Hte-P."], ["05", "Htes-Alpes"],
  ["06", "Alpes-Maritimes"], ["07", "Ardèche"], ["08", "Ardennes"], ["09", "Ariège"], ["10", "Aube"],
  ["11", "Aude"], ["12", "Aveyron"], ["13", "Bouches-du-Rhône"], ["14", "Calvados"], ["15", "Cantal"],
  ["16", "Charente"], ["17", "Charente-Mar."], ["18", "Cher"], ["19", "Corrèze"], ["2A", "Corse-du-Sud"],
  ["2B", "Haute-Corse"], ["21", "Côte-d'Or"], ["22", "Côtes-d'Armor"], ["23", "Creuse"], ["24", "Dordogne"],
  ["25", "Doubs"], ["26", "Drôme"], ["27", "Eure"], ["28", "Eure-et-Loir"], ["29", "Finistère"],
  ["30", "Gard"], ["31", "Haute-Garonne"], ["32", "Gers"], ["33", "Gironde"], ["34", "Hérault"],
  ["35", "Ille-et-Vilaine"], ["36", "Indre"], ["37", "Indre-et-Loire"], ["38", "Isère"], ["39", "Jura"],
  ["40", "Landes"], ["41", "Loir-et-Cher"], ["42", "Loire"], ["43", "Haute-Loire"], ["44", "Loire-Atl."],
  ["45", "Loiret"], ["46", "Lot"], ["47", "Lot-et-Garonne"], ["48", "Lozère"], ["49", "Maine-et-Loire"],
  ["50", "Manche"], ["51", "Marne"], ["52", "Haute-Marne"], ["53", "Mayenne"], ["54", "Meurthe-et-M."],
  ["55", "Meuse"], ["56", "Morbihan"], ["57", "Moselle"], ["58", "Nièvre"], ["59", "Nord"],
  ["60", "Oise"], ["61", "Orne"], ["62", "Pas-de-Calais"], ["63", "Puy-de-Dôme"], ["64", "Pyrénées-Atl."],
  ["65", "Htes-Pyrénées"], ["66", "Pyrénées-Or."], ["67", "Bas-Rhin"], ["68", "Haut-Rhin"], ["69", "Rhône"],
  ["70", "Haute-Saône"], ["71", "Saône-et-Loire"], ["72", "Sarthe"], ["73", "Savoie"], ["74", "Haute-Savoie"],
  ["75", "Paris"], ["76", "Seine-Mar."], ["77", "Seine-et-Marne"], ["78", "Yvelines"], ["79", "Deux-Sèvres"],
  ["80", "Somme"], ["81", "Tarn"], ["82", "Tarn-et-Gar."], ["83", "Var"], ["84", "Vaucluse"],
  ["85", "Vendée"], ["86", "Vienne"], ["87", "Haute-Vienne"], ["88", "Vosges"], ["89", "Yonne"],
  ["90", "Territoire de Belfort"], ["91", "Essonne"], ["92", "Hauts-de-Seine"], ["93", "Seine-St-Denis"],
  ["94", "Val-de-Marne"], ["95", "Val-d'Oise"], ["971", "Guadeloupe"], ["972", "Martinique"],
  ["973", "Guyane"], ["974", "La Réunion"],
];

const PROBA_COLOR: Record<string, string> = {
  "Élevée": "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  "Moyenne-haute": "bg-lime-500/15 text-lime-300 ring-lime-500/30",
  "Moyenne": "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  "À qualifier": "bg-slate-500/15 text-slate-300 ring-slate-500/30",
};

export function ProspectionBoard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [mobileIdx, setMobileIdx] = useState(0);
  const stageKeys = PIPELINE_STAGES.map((s) => s.key);
  // Menu contextuel (clic droit) : sur une carte (id) ou une colonne (stageKey).
  const [menu, setMenu] = useState<
    { x: number; y: number; kind: "card" | "col"; id?: string; stageKey?: string; view: "root" | "move" | "lost" } | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch("/api/prospection", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Erreur");
      setRows(j.rows as Row[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Ferme le menu contextuel sur Échap / molette / redimensionnement.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    const onScroll = () => setMenu(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("resize", onScroll); };
  }, [menu]);

  const [importing, setImporting] = useState(false);
  async function doImport() {
    setImporting(true);
    try {
      const r = await fetch("/api/prospection/import", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec");
      toast.success(`Import : ${j.inserted} ajoutés · ${j.already} déjà présents`);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec"); }
    finally { setImporting(false); }
  }

  const [importingH, setImportingH] = useState(false);
  async function doImportHypers() {
    setImportingH(true);
    try {
      const r = await fetch("/api/prospection/import-hypers", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec");
      toast.success(`Hypers France : ${j.inserted} ajoutés · ${j.already} déjà présents`);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec"); }
    finally { setImportingH(false); }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => `${r.nom} ${r.city ?? ""} ${r.code}`.toLowerCase().includes(s));
  }, [rows, q]);

  const byStage = useCallback((key: string) => filtered.filter((r) => r.prospectStage === key), [filtered]);
  const sel = rows.find((r) => r.id === selId) ?? null;

  async function patch(id: string, body: Record<string, unknown>, okMsg?: string) {
    const prev = rows;
    // maj optimiste de l'étape
    if (typeof body.stage === "string") {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, prospectStage: body.stage as string } : r)));
    }
    try {
      const r = await fetch(`/api/prospection/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec");
      if (okMsg) toast.success(okMsg);
      if (!body.stage) load();
    } catch (e) {
      setRows(prev);
      toast.error(e instanceof Error ? e.message : "Échec");
    }
  }

  function onDrop(stageKey: string) {
    if (dragId) { patch(dragId, { stage: stageKey }, `Déplacé vers « ${stageLabel(stageKey)} »`); setDragId(null); }
  }

  /** Retire un prospect du pipeline (retour au vivier : prospectStage NULL). */
  async function removeFromPipeline(id: string, silent = false) {
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, prospectStage: null } : r)));
    try {
      const r = await fetch(`/api/prospection/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remove: true }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Échec");
      if (!silent) toast.success("Prospect retiré du pipeline (remis au vivier)");
    } catch (e) {
      setRows(prev);
      toast.error(e instanceof Error ? e.message : "Échec");
    }
  }

  /** Vide une colonne : retire tous ses prospects du pipeline. */
  async function clearStage(stageKey: string) {
    const items = byStage(stageKey);
    if (!items.length) { toast.info("Cette colonne est déjà vide."); return; }
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.prospectStage === stageKey ? { ...r, prospectStage: null } : r)));
    try {
      const res = await Promise.all(items.map((it) =>
        fetch(`/api/prospection/${it.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remove: true }),
        })));
      if (res.some((r) => !r.ok)) throw new Error("Échec partiel");
      toast.success(`${items.length} prospect${items.length > 1 ? "s" : ""} retiré${items.length > 1 ? "s" : ""} de « ${stageLabel(stageKey)} »`);
    } catch (e) {
      setRows(prev);
      toast.error(e instanceof Error ? e.message : "Échec");
    }
  }

  /** Déplace un prospect vers l'étape adjacente (−1 précédente, +1 suivante). */
  function move(id: string, dir: -1 | 1) {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    const i = stageKeys.indexOf((r.prospectStage ?? "") as (typeof stageKeys)[number]);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= stageKeys.length) return;
    patch(id, { stage: stageKeys[j] }, `→ ${stageLabel(stageKeys[j])}`);
  }

  /** Carte prospect partagée (desktop Kanban + mobile). */
  function card(r: Row, sIdx: number, draggable: boolean) {
    return (
      <div key={r.id}
        draggable={draggable}
        onDragStart={draggable ? () => setDragId(r.id) : undefined}
        onDragEnd={draggable ? () => { setDragId(null); setOverStage(null); } : undefined}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, kind: "card", id: r.id, view: "root" }); }}
        className={`rounded-xl bg-[#11161f] ring-1 transition-[box-shadow,opacity] duration-150 ${
          selId === r.id ? "ring-brand-500" : "ring-white/[0.07] hover:ring-white/20"
        } ${dragId === r.id ? "opacity-40" : ""}`}
      >
        <button onClick={() => setSelId(r.id)}
          className="w-full text-left px-3 pt-2.5 pb-2 transition-transform duration-100 active:scale-[0.98]">
          <div className="flex items-start gap-1.5">
            <span className="text-[13px] font-semibold text-white/90 leading-snug flex-1">{r.nom}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {r.city && <span className="text-[11px] text-white/45">{r.city}</span>}
            {/* Labo qualifié → certitude (on n'affiche plus l'estimation de proba).
                Non qualifié → pas de labo. Inconnu → estimation de proba. */}
            {r.qualifieLabo === true ? (
              <span className="text-[9.5px] px-1.5 py-0.5 rounded ring-1 bg-emerald-500/15 text-emerald-300 ring-emerald-500/30 inline-flex items-center gap-0.5">
                <Check className="h-3 w-3" /> labo confirmé
              </span>
            ) : r.qualifieLabo === false ? (
              <span className="text-[9.5px] px-1.5 py-0.5 rounded ring-1 bg-white/[0.05] text-white/45 ring-white/10">sans labo</span>
            ) : r.probaLabo ? (
              <span className={`text-[9.5px] px-1.5 py-0.5 rounded ring-1 ${PROBA_COLOR[r.probaLabo] ?? PROBA_COLOR["À qualifier"]}`}>
                labo {r.probaLabo.toLowerCase()}
              </span>
            ) : null}
            {r.nextRdvAt && (
              <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30">
                RDV {new Date(r.nextRdvAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
              </span>
            )}
          </div>
        </button>
        {/* Flèches — déplacer d'une étape à l'autre */}
        <div className="flex items-center gap-1 border-t border-white/[0.06] px-1.5 py-1">
          <button disabled={sIdx <= 0} onClick={() => move(r.id, -1)} title="Étape précédente"
            className="h-6 w-6 grid place-items-center rounded-md text-white/45 transition hover:bg-white/[0.06] hover:text-white active:scale-90 disabled:pointer-events-none disabled:opacity-25">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="flex-1 text-center text-[9.5px] tabular-nums text-white/25">{sIdx + 1}/{stageKeys.length}</span>
          <button disabled={sIdx >= stageKeys.length - 1} onClick={() => move(r.id, 1)} title="Étape suivante"
            className="h-6 w-6 grid place-items-center rounded-md text-white/45 transition hover:bg-white/[0.06] hover:text-white active:scale-90 disabled:pointer-events-none disabled:opacity-25">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 md:p-6">
      {/* Barre d'outils */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <Link href="/accueil" title="Retour à l'accueil"
          className="h-9 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[13px] text-white/70 hover:bg-white/[0.08]">
          <ArrowLeft className="h-4 w-4" /> Retour
        </Link>
        <div className="flex items-center gap-2 text-white/90">
          <Target className="h-5 w-5 text-brand-400" />
          <h1 className="text-[17px] font-bold">Prospection</h1>
          <span className="text-white/40 text-[13px]">{rows.length} en pipeline</span>
        </div>
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer la pipeline…"
          className="ml-auto h-9 w-52 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[13px] text-white placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <button onClick={() => setStatsOpen(true)}
          className="h-9 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[13px] text-white/70 hover:bg-white/[0.08]">
          <BarChart3 className="h-4 w-4" /> Stats
        </button>
        <button onClick={() => setPoolOpen(true)}
          className="h-9 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 px-3 text-[13px] text-white font-semibold">
          <Plus className="h-4 w-4" /> Ajouter des prospects
        </button>
        <button onClick={doImportHypers} disabled={importingH} title="Ajouter tous les hypermarchés de France (province) au vivier — admin"
          className="h-9 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[13px] text-white/70 hover:bg-white/[0.08] disabled:opacity-60">
          {importingH ? <Loader2 className="h-4 w-4 animate-spin" /> : "Importer hypers France"}
        </button>
        <button onClick={doImport} disabled={importing} title="Recharger le vivier depuis le fichier (admin)"
          className="h-9 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[13px] text-white/70 hover:bg-white/[0.08] disabled:opacity-60">
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Recharger le vivier"}
        </button>
      </div>

      {err && <div className="rounded-lg bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30 px-3 py-2 text-[13px]">{err} — la migration prospection est-elle appliquée ?</div>}

      {loading ? (
        <div className="flex-1 grid place-items-center text-white/50"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
      <>
        {/* ─────────── Desktop — Kanban ─────────── */}
        <div className="hidden md:flex flex-1 min-h-0 gap-4 overflow-x-auto pb-1">
          {PIPELINE_STAGES.map((st, sIdx) => {
            const items = byStage(st.key);
            return (
              <div key={st.key}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); if (overStage !== st.key) setOverStage(st.key); } }}
                onDragLeave={(e) => { if (dragId && !e.currentTarget.contains(e.relatedTarget as Node)) setOverStage((s) => (s === st.key ? null : s)); }}
                onDrop={() => { onDrop(st.key); setOverStage(null); }}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, kind: "col", stageKey: st.key, view: "root" }); }}
                className="relative flex-1 min-w-[256px] flex flex-col rounded-2xl bg-white/[0.02] ring-1 ring-white/[0.06]"
              >
                {/* Surbrillance de dépôt : la colonne survolée s'illumine en jaune. */}
                {dragId && overStage === st.key && (
                  <div className="pointer-events-none absolute inset-0 z-20 rounded-2xl bg-amber-400/10 ring-2 ring-amber-400 shadow-[0_0_28px_-4px_rgba(251,191,36,0.55)] transition-opacity duration-150" />
                )}
                <div className="flex items-center gap-2 rounded-t-2xl px-3.5 py-2.5" style={{ background: st.color + "1a" }}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />
                  <span className="text-[13px] font-semibold text-white/90">{st.label}</span>
                  <span className="ml-auto text-[11px] font-medium tabular-nums text-white/50 rounded-full bg-white/[0.06] px-2 py-0.5">{items.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                  {items.map((r) => card(r, sIdx, true))}
                  {items.length === 0 && (
                    <button onClick={() => setPoolOpen(true)}
                      className="w-full rounded-xl border border-dashed border-white/[0.12] py-8 text-center text-[12px] text-white/40 transition hover:border-brand-500/40 hover:bg-white/[0.02] hover:text-white/70 active:scale-[0.99]">
                      <Plus className="mx-auto mb-1 h-4 w-4" />
                      Ajouter un prospect
                    </button>
                  )}
                  {/* Footer d'ajout permanent sur la 1re étape (point d'entrée) */}
                  {sIdx === 0 && items.length > 0 && (
                    <button onClick={() => setPoolOpen(true)}
                      className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/[0.12] py-2 text-[12px] text-white/45 transition hover:border-brand-500/40 hover:text-white/75 active:scale-[0.99]">
                      <Plus className="h-3.5 w-3.5" /> Ajouter un prospect
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ─────────── Mobile — une étape à la fois ─────────── */}
        <div className="md:hidden flex-1 min-h-0 flex flex-col">
          {(() => {
            const st = PIPELINE_STAGES[Math.min(mobileIdx, PIPELINE_STAGES.length - 1)];
            const items = byStage(st.key);
            return (
              <>
                {/* Sélecteur d'étape avec flèches */}
                <div className="flex items-center gap-2 rounded-2xl px-2 py-2" style={{ background: st.color + "1a" }}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, kind: "col", stageKey: st.key, view: "root" }); }}>

                  <button disabled={mobileIdx <= 0} onClick={() => setMobileIdx((i) => Math.max(0, i - 1))}
                    className="h-10 w-10 grid place-items-center rounded-xl bg-white/[0.06] text-white/80 transition active:scale-90 disabled:opacity-25">
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div className="flex-1 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />
                      <span className="text-[14px] font-bold text-white/90">{st.label}</span>
                    </div>
                    <span className="text-[11px] text-white/50">{items.length} prospect{items.length > 1 ? "s" : ""}</span>
                  </div>
                  <button disabled={mobileIdx >= PIPELINE_STAGES.length - 1} onClick={() => setMobileIdx((i) => Math.min(PIPELINE_STAGES.length - 1, i + 1))}
                    className="h-10 w-10 grid place-items-center rounded-xl bg-white/[0.06] text-white/80 transition active:scale-90 disabled:opacity-25">
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
                {/* Points de progression */}
                <div className="flex items-center justify-center gap-1.5 py-2.5">
                  {PIPELINE_STAGES.map((s, i) => (
                    <button key={s.key} onClick={() => setMobileIdx(i)} aria-label={s.label}
                      className="h-1.5 rounded-full transition-all duration-200"
                      style={{ width: i === mobileIdx ? 22 : 7, background: i === mobileIdx ? s.color : "rgba(255,255,255,0.18)" }} />
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto space-y-2.5 pb-1">
                  {items.map((r) => card(r, mobileIdx, false))}
                  {items.length === 0 && (
                    <button onClick={() => setPoolOpen(true)}
                      className="w-full rounded-xl border border-dashed border-white/[0.12] py-10 text-center text-[13px] text-white/40 transition active:scale-[0.99]">
                      <Plus className="mx-auto mb-1.5 h-5 w-5" />
                      Ajouter un prospect
                    </button>
                  )}
                  {/* Bouton d'ajout permanent sur la 1re étape */}
                  {mobileIdx === 0 && items.length > 0 && (
                    <button onClick={() => setPoolOpen(true)}
                      className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/[0.12] py-2.5 text-[13px] text-white/45 transition active:scale-[0.99]">
                      <Plus className="h-4 w-4" /> Ajouter un prospect
                    </button>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      </>
      )}

      {/* Fiche prospect — tiroir en superposition (desktop + mobile) */}
      {sel && <FichePanel key={sel.id} row={sel} onClose={() => setSelId(null)} onPatch={patch} onReload={load} />}
      {poolOpen && <AddProspectsPanel onClose={() => setPoolOpen(false)} onAdded={load} />}
      {statsOpen && <StatsPanel onClose={() => setStatsOpen(false)} />}

      {/* Menu contextuel (clic droit) */}
      {menu && (() => {
        const mrow = menu.kind === "card" ? rows.find((r) => r.id === menu.id) ?? null : null;
        const close = () => setMenu(null);
        const item =
          "w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-white/85 hover:bg-white/[0.07] active:scale-[0.985] transition disabled:opacity-30 disabled:pointer-events-none";
        const left = Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 236);
        const top = Math.min(menu.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 320);
        return (
          <>
            <div className="fixed inset-0 z-[90]" onClick={close}
              onContextMenu={(e) => { e.preventDefault(); close(); }} />
            <div className="fixed z-[91] w-[224px] rounded-xl bg-[#0f141c] p-1 text-white/85 shadow-2xl ring-1 ring-white/10"
              style={{ left, top }}>
              {menu.kind === "card" && mrow && (
                <>
                  <div className="truncate px-2.5 pb-1.5 pt-1 text-[12px] font-semibold text-white/50">{mrow.nom}</div>
                  {menu.view === "root" && (
                    <>
                      <button className={item} onClick={() => { setSelId(mrow.id); close(); }}>
                        <Target className="h-4 w-4 text-brand-300" /> Ouvrir la fiche
                      </button>
                      <button className={item} onClick={() => setMenu({ ...menu, view: "move" })}>
                        <ChevronRight className="h-4 w-4 text-white/45" /> Déplacer vers…
                      </button>
                      <button className={item} onClick={() => setMenu({ ...menu, view: "lost" })}>
                        <X className="h-4 w-4 text-rose-400" /> Marquer perdu…
                      </button>
                      <div className="my-1 border-t border-white/[0.06]" />
                      <button className={item} onClick={() => { removeFromPipeline(mrow.id); close(); }}>
                        <ArrowLeft className="h-4 w-4 text-amber-300" /> Retirer du pipeline
                      </button>
                    </>
                  )}
                  {menu.view === "move" && (
                    <>
                      <button className={`${item} text-white/50`} onClick={() => setMenu({ ...menu, view: "root" })}>
                        <ChevronLeft className="h-4 w-4" /> Retour
                      </button>
                      {PIPELINE_STAGES.map((s) => (
                        <button key={s.key} disabled={s.key === mrow.prospectStage} className={item}
                          onClick={() => { patch(mrow.id, { stage: s.key }, `→ ${s.label}`); close(); }}>
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} /> {s.label}
                        </button>
                      ))}
                    </>
                  )}
                  {menu.view === "lost" && (
                    <>
                      <button className={`${item} text-white/50`} onClick={() => setMenu({ ...menu, view: "root" })}>
                        <ChevronLeft className="h-4 w-4" /> Retour
                      </button>
                      {LOST_REASONS.map((m) => (
                        <button key={m} className={item}
                          onClick={() => { patch(mrow.id, { stage: "PERDU", lostReason: m }, "Marqué perdu"); close(); }}>
                          <X className="h-3.5 w-3.5 text-rose-400" /> {m}
                        </button>
                      ))}
                    </>
                  )}
                </>
              )}
              {menu.kind === "col" && menu.stageKey && (
                <>
                  <div className="px-2.5 pb-1.5 pt-1 text-[12px] font-semibold text-white/50">
                    Catégorie « {stageLabel(menu.stageKey)} » · {byStage(menu.stageKey).length}
                  </div>
                  <button className={item} onClick={() => { clearStage(menu.stageKey!); close(); }}>
                    <ArrowLeft className="h-4 w-4 text-amber-300" /> Vider la catégorie (→ vivier)
                  </button>
                </>
              )}
            </div>
          </>
        );
      })()}
    </div>
  );
}

type PoolRow = { id: string; code: string; nom: string; city: string | null; zipCode: string | null; probaLabo: string | null; prospectEnseigne: string | null; prospectFormat: string | null; prospectSource: string | null };

function AddProspectsPanel({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("proba");
  const [enseigne, setEnseigne] = useState("");
  const [source, setSource] = useState("");
  const [format, setFormat] = useState("");
  const [zones, setZones] = useState<Set<string>>(new Set());
  const [zoneOpen, setZoneOpen] = useState(false);
  const zoneCsv = [...zones].join(",");
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ search, sort, limit: "100" });
      if (enseigne) p.set("enseigne", enseigne);
      if (source) p.set("source", source);
      if (format) p.set("format", format);
      if (zoneCsv) p.set("zone", zoneCsv);
      const r = await fetch(`/api/prospection/pool?${p}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Erreur");
      setRows(j.rows as PoolRow[]); setTotal(j.total ?? 0); setSel(new Set());
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
    finally { setLoading(false); }
  }, [search, sort, enseigne, source, format, zoneCsv]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function add(body: Record<string, unknown>, label: string) {
    setAdding(true);
    try {
      const r = await fetch("/api/prospection/pool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec");
      toast.success(`${j.added} prospect${j.added > 1 ? "s" : ""} ajouté${j.added > 1 ? "s" : ""} à la pipeline (${label})`);
      onAdded(); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec"); }
    finally { setAdding(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/50" onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} className="w-[440px] max-w-[92vw] h-full overflow-y-auto bg-[#0f141c] ring-1 ring-white/10 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-bold text-white/90 flex-1">Ajouter des prospects</h2>
          <span className="text-[12px] text-white/45">{total} dans le vivier</span>
          <button onClick={onClose} className="h-7 w-7 grid place-items-center rounded-lg text-white/40 hover:text-white hover:bg-white/[0.06]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/35" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher (nom, ville, CP)…"
              className="w-full h-9 rounded-lg border border-white/10 bg-white/[0.04] pl-8 pr-3 text-[13px] text-white placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={source} onChange={(e) => setSource(e.target.value)} className="h-8 flex-1 min-w-[110px] rounded-lg bg-[#11161f] ring-1 ring-white/10 text-[12px] text-white/80 px-2" title="Origine du prospect">
              <option value="">Tous types</option>
              <option value="gms">GMS (prospection)</option>
              <option value="ancien">Anciens clients</option>
            </select>
            <select value={format} onChange={(e) => setFormat(e.target.value)} className="h-8 flex-1 min-w-[110px] rounded-lg bg-[#11161f] ring-1 ring-white/10 text-[12px] text-white/80 px-2" title="Format du magasin (proxy taille / labo)">
              <option value="">Tous formats</option>
              <option value="Hyper">Hyper (labo probable)</option>
              <option value="Super">Super</option>
            </select>
            <button type="button" onClick={() => setZoneOpen((v) => !v)}
              className={`h-8 flex-1 min-w-[110px] inline-flex items-center gap-1 rounded-lg bg-[#11161f] ring-1 text-[12px] px-2 justify-between ${zones.size ? "ring-brand-500/50 text-white" : "ring-white/10 text-white/80"}`}>
              <span className="truncate">{zones.size ? `${zones.size} dépt${zones.size > 1 ? "s" : ""}` : "Toutes zones"}</span>
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${zoneOpen ? "rotate-90" : ""}`} />
            </button>
            <select value={enseigne} onChange={(e) => setEnseigne(e.target.value)} className="h-8 flex-1 min-w-[110px] rounded-lg bg-[#11161f] ring-1 ring-white/10 text-[12px] text-white/80 px-2" title="Enseigne">
              <option value="">Toutes enseignes</option>
              {ENSEIGNE_CHOICES.map((c) => <option key={c} value={c}>{ENSEIGNE_LABELS[c] ?? c}</option>)}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-8 flex-1 min-w-[110px] rounded-lg bg-[#11161f] ring-1 ring-white/10 text-[12px] text-white/80 px-2" title="Trier par">
              <option value="proba">Tri : proba labo</option>
              <option value="zone">Tri : zone (CP)</option>
              <option value="enseigne">Tri : enseigne</option>
              <option value="ville">Tri : ville</option>
              <option value="nom">Tri : nom</option>
            </select>
          </div>
          {/* Sélecteur de départements (multi) — inline, pleine largeur (jamais rogné). */}
          {zoneOpen && (
            <div className="rounded-xl bg-[#11161f] ring-1 ring-white/10 p-2">
              <div className="flex items-center justify-between px-0.5 pb-1.5">
                <span className="text-[10.5px] uppercase tracking-wide text-white/40">Départements ({zones.size})</span>
                <div className="flex items-center gap-2">
                  {zones.size > 0 && <button onClick={() => setZones(new Set())} className="text-[10.5px] text-brand-300 hover:underline">Effacer</button>}
                  <button onClick={() => setZoneOpen(false)} className="text-[10.5px] text-white/50 hover:text-white">Fermer</button>
                </div>
              </div>
              <div className="max-h-[220px] overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-0.5">
                {DEPARTEMENTS.map(([code, name]) => {
                  const on = zones.has(code);
                  return (
                    <button key={code} onClick={() => setZones((s) => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n; })}
                      className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] transition ${on ? "bg-brand-500/15 text-white" : "text-white/70 hover:bg-white/[0.06]"}`}>
                      <span className={`h-3 w-3 shrink-0 grid place-items-center rounded-[3px] ring-1 ${on ? "bg-brand-500 ring-brand-500" : "ring-white/25"}`}>{on && <Check className="h-2.5 w-2.5 text-white" />}</span>
                      <span className="truncate"><b className="text-white/80">{code}</b> {name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-[12px]">
          <button disabled={adding || !sel.size} onClick={() => add({ ids: [...sel] }, "sélection")}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-600 hover:bg-brand-700 px-3 h-8 text-white font-semibold disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" /> Ajouter la sélection ({sel.size})
          </button>
          <button disabled={adding || !total} onClick={() => add({ all: true, search, enseigne, source, format, zone: zoneCsv }, `${total} résultats`)}
            className="inline-flex items-center gap-1 rounded-lg ring-1 ring-white/10 px-3 h-8 text-white/80 hover:bg-white/[0.06] disabled:opacity-40">
            Tout ajouter ({total})
          </button>
        </div>

        {loading ? (
          <div className="grid place-items-center py-10 text-white/40"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.id}>
                <button onClick={() => toggle(r.id)}
                  className={`w-full text-left rounded-lg px-2.5 py-2 ring-1 flex items-center gap-2 transition-colors ${sel.has(r.id) ? "ring-brand-500 bg-brand-500/10" : "ring-white/[0.07] bg-[#11161f] hover:ring-white/20"}`}>
                  <span className={`h-4 w-4 shrink-0 rounded grid place-items-center ring-1 ${sel.has(r.id) ? "bg-brand-500 ring-brand-500" : "ring-white/20"}`}>
                    {sel.has(r.id) && <Check className="h-3 w-3 text-white" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] text-white/90 truncate">{r.nom}</span>
                    <span className="mt-0.5 flex items-center gap-1 flex-wrap">
                      <span className="text-[10.5px] text-white/40">{[r.city, r.zipCode].filter(Boolean).join(" · ")}</span>
                      {r.prospectEnseigne && r.prospectEnseigne !== "AUTRE" && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30">{ENSEIGNE_LABELS[r.prospectEnseigne] ?? r.prospectEnseigne}</span>
                      )}
                      {r.prospectFormat === "Hyper" && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30">Hyper</span>
                      )}
                      {r.prospectSource === "ancien-client" && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30">ancien client</span>
                      )}
                    </span>
                  </span>
                  {r.probaLabo && <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/60 shrink-0">{r.probaLabo}</span>}
                </button>
              </li>
            ))}
            {rows.length === 0 && <li className="text-[12px] text-white/35 italic py-6 text-center">Aucun prospect dans le vivier pour cette recherche.</li>}
            {total > rows.length && <li className="text-[11px] text-white/35 text-center pt-1">{rows.length} affichés sur {total} — affinez la recherche ou « Tout ajouter ».</li>}
          </ul>
        )}
      </aside>
    </div>
  );
}

type Stats = {
  kpis: { won: number; lost: number; inPipeline: number; vivier: number; conversion: number | null };
  funnel: { k: string; n: number }[];
  lostByReason: { k: string | null; n: number }[];
  byOwner: { k: string | null; won: number; lost: number; active: number }[];
  vivierComposition: {
    byEnseigne: { k: string | null; n: number }[];
    byFormat: { k: string | null; n: number }[];
    byProba: { k: string | null; n: number }[];
    bySource: { k: string | null; n: number }[];
  };
};

/** Barre horizontale simple (largeur = valeur / max). */
function Bar({ label, n, max, color, sub }: { label: string; n: number; max: number; color?: string; sub?: string }) {
  const pct = max > 0 ? Math.max(3, Math.round((n / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 truncate text-[11.5px] text-white/70" title={label}>{label}</span>
      <span className="relative h-4 flex-1 overflow-hidden rounded bg-white/[0.05]">
        <span className="absolute inset-y-0 left-0 rounded transition-[width] duration-500" style={{ width: `${pct}%`, background: color ?? "#6366f1" }} />
      </span>
      <span className="w-14 shrink-0 text-right text-[11.5px] tabular-nums text-white/80">{n}{sub}</span>
    </div>
  );
}

function StatsPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/prospection/stats", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "Erreur");
        setData(j as Stats);
      } catch (e) { setErr(e instanceof Error ? e.message : "Erreur"); }
    })();
  }, []);

  const KPI = ({ label, value, tone }: { label: string; value: string | number; tone?: string }) => (
    <div className="flex-1 min-w-[92px] rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06] px-3 py-2.5">
      <div className={`text-[19px] font-bold ${tone ?? "text-white/90"}`}>{value}</div>
      <div className="text-[10.5px] uppercase tracking-wide text-white/45">{label}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/50" onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} className="w-[520px] max-w-[94vw] h-full overflow-y-auto bg-[#0f141c] ring-1 ring-white/10 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-brand-400" />
          <h2 className="text-[15px] font-bold text-white/90 flex-1">Statistiques de prospection</h2>
          <button onClick={onClose} className="h-7 w-7 grid place-items-center rounded-lg text-white/40 hover:text-white hover:bg-white/[0.06]"><X className="h-4 w-4" /></button>
        </div>

        {err && <div className="rounded-lg bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30 px-3 py-2 text-[13px]">{err}</div>}
        {!data && !err && <div className="grid place-items-center py-16 text-white/40"><Loader2 className="h-6 w-6 animate-spin" /></div>}

        {data && (() => {
          const funnelMax = Math.max(1, ...data.funnel.map((f) => f.n));
          const lostMax = Math.max(1, ...data.lostByReason.map((f) => f.n));
          const ensMax = Math.max(1, ...data.vivierComposition.byEnseigne.map((f) => f.n));
          return (
            <>
              {/* KPIs */}
              <div className="flex flex-wrap gap-2">
                <KPI label="Vivier" value={data.kpis.vivier} />
                <KPI label="En pipeline" value={data.kpis.inPipeline} tone="text-brand-300" />
                <KPI label="Gagnés" value={data.kpis.won} tone="text-emerald-300" />
                <KPI label="Perdus" value={data.kpis.lost} tone="text-rose-300" />
                <KPI label="Conversion" value={data.kpis.conversion == null ? "—" : `${data.kpis.conversion}%`} tone="text-amber-300" />
              </div>

              {/* Entonnoir */}
              <section className="rounded-xl bg-white/[0.02] ring-1 ring-white/[0.06] p-3 space-y-2">
                <p className="text-[10px] uppercase tracking-wider font-bold text-white/40">Entonnoir</p>
                {data.funnel.map((f) => (
                  <Bar key={f.k} label={stageLabel(f.k)} n={f.n} max={funnelMax} color={getStage(f.k)?.color} />
                ))}
              </section>

              {/* Perdus par motif */}
              {data.lostByReason.length > 0 && (
                <section className="rounded-xl bg-white/[0.02] ring-1 ring-white/[0.06] p-3 space-y-2">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-white/40">Perdus — motifs</p>
                  {data.lostByReason.map((f, i) => (
                    <Bar key={i} label={f.k ?? "Non précisé"} n={f.n} max={lostMax} color="#ef4444" />
                  ))}
                </section>
              )}

              {/* Par commercial */}
              {data.byOwner.length > 0 && (
                <section className="rounded-xl bg-white/[0.02] ring-1 ring-white/[0.06] p-3">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-white/40 mb-2">Par commercial</p>
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 text-[12px]">
                    <span className="text-white/40 text-[10.5px]">Commercial</span>
                    <span className="text-emerald-300/70 text-[10.5px] text-right">Gagnés</span>
                    <span className="text-rose-300/70 text-[10.5px] text-right">Perdus</span>
                    <span className="text-brand-300/70 text-[10.5px] text-right">En cours</span>
                    {data.byOwner.map((o, i) => (
                      <div key={i} className="contents">
                        <span className="text-white/80 truncate">{o.k ?? "Non attribué"}</span>
                        <span className="text-right tabular-nums text-emerald-300">{o.won}</span>
                        <span className="text-right tabular-nums text-rose-300">{o.lost}</span>
                        <span className="text-right tabular-nums text-brand-300">{o.active}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Composition du vivier */}
              <section className="rounded-xl bg-white/[0.02] ring-1 ring-white/[0.06] p-3 space-y-3">
                <p className="text-[10px] uppercase tracking-wider font-bold text-white/40">Vivier — composition</p>
                <div className="space-y-1.5">
                  {data.vivierComposition.byEnseigne.map((f, i) => (
                    <Bar key={i} label={ENSEIGNE_LABELS[f.k ?? ""] ?? f.k ?? "—"} n={f.n} max={ensMax} color="#0ea5e9" />
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {data.vivierComposition.byFormat.map((f, i) => (
                    <span key={i} className="text-[11px] px-2 py-1 rounded-lg bg-white/[0.05] text-white/70">{f.k ?? "—"} : <b className="text-white/90">{f.n}</b></span>
                  ))}
                  {data.vivierComposition.byProba.map((f, i) => (
                    <span key={i} className={`text-[11px] px-2 py-1 rounded-lg ring-1 ${PROBA_COLOR[f.k ?? ""] ?? "bg-white/[0.05] ring-white/10 text-white/70"}`}>{f.k ?? "—"} : <b>{f.n}</b></span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {data.vivierComposition.bySource.map((f, i) => (
                    <span key={i} className="text-[11px] px-2 py-1 rounded-lg bg-white/[0.05] text-white/70">
                      {f.k === "ancien-client" ? "Anciens clients" : f.k === "import-gms-idf-patisserie" ? "GMS" : (f.k ?? "—")} : <b className="text-white/90">{f.n}</b>
                    </span>
                  ))}
                </div>
              </section>
            </>
          );
        })()}
      </aside>
    </div>
  );
}

function FichePanel({ row, onClose, onPatch, onReload }: {
  row: Row; onClose: () => void;
  onPatch: (id: string, body: Record<string, unknown>, okMsg?: string) => Promise<void>;
  onReload: () => void;
}) {
  const stage = getStage(row.prospectStage);
  const next = nextStage(row.prospectStage);
  const [note, setNote] = useState("");
  const [rdvOpen, setRdvOpen] = useState(false);

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/50" onClick={onClose}>
    <aside onClick={(e) => e.stopPropagation()}
      className="w-full sm:w-[380px] h-full overflow-y-auto bg-[#0f141c] ring-1 ring-white/[0.08] p-4 space-y-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h2 className="text-[15px] font-bold text-white/90 leading-tight">{row.nom}</h2>
          <p className="text-[12px] text-white/45">{[row.city, row.zipCode].filter(Boolean).join(" · ")}</p>
        </div>
        <button onClick={onClose} className="h-7 w-7 grid place-items-center rounded-lg text-white/40 hover:text-white hover:bg-white/[0.06]"><X className="h-4 w-4" /></button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] px-2 py-1 rounded-lg ring-1 ring-white/10 text-white/80" style={{ background: (stage?.color ?? "#334") + "22" }}>
          {stage?.label ?? "—"}
        </span>
        {row.tel1 && <a href={`tel:${row.tel1}`} className="text-[11px] inline-flex items-center gap-1 text-white/70 hover:text-white"><Phone className="h-3 w-3" />{row.tel1}</a>}
        <a target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${encodeURIComponent(`${row.nom} ${row.city ?? ""} téléphone`)}`}
          className="text-[11px] inline-flex items-center gap-1 text-brand-300 hover:underline"><MapPin className="h-3 w-3" />Trouver le tél</a>
      </div>

      {/* Script de l'étape */}
      {stage && (
        <div className="rounded-lg bg-white/[0.03] ring-1 ring-white/[0.06] p-3">
          <p className="text-[10px] uppercase tracking-wider font-bold text-white/40 mb-1.5">Script — {stage.label}</p>
          <p className="text-[12.5px] text-white/80 whitespace-pre-line leading-relaxed">{stage.script}</p>
        </div>
      )}

      {/* Qualif labo */}
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-white/60">Labo pâtisserie&nbsp;:</span>
        <button onClick={() => onPatch(row.id, { qualifieLabo: true }, "Qualifié : labo OK")}
          className={`text-[12px] px-2.5 py-1 rounded-lg ring-1 ${row.qualifieLabo === true ? "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40" : "ring-white/10 text-white/60 hover:bg-white/[0.06]"}`}>Oui</button>
        <button onClick={() => onPatch(row.id, { qualifieLabo: false }, "Marqué : pas de labo")}
          className={`text-[12px] px-2.5 py-1 rounded-lg ring-1 ${row.qualifieLabo === false ? "bg-rose-500/20 text-rose-300 ring-rose-500/40" : "ring-white/10 text-white/60 hover:bg-white/[0.06]"}`}>Non</button>
      </div>

      {/* Actions d'étape */}
      <div className="flex flex-wrap gap-2">
        {next && (
          <button onClick={() => onPatch(row.id, { stage: next }, `→ ${stageLabel(next)}`)}
            className="inline-flex items-center gap-1 text-[12.5px] px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-semibold">
            {stageLabel(next)} <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
        <button onClick={() => setRdvOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-[12.5px] px-3 py-1.5 rounded-lg ring-1 ring-white/10 text-white/80 hover:bg-white/[0.06]">
          <CalendarPlus className="h-3.5 w-3.5" /> Rendez-vous
        </button>
        <select onChange={(e) => { if (e.target.value) onPatch(row.id, { stage: "PERDU", lostReason: e.target.value }, "Marqué perdu"); }}
          defaultValue="" className="text-[12px] px-2 py-1.5 rounded-lg bg-[#11161f] ring-1 ring-white/10 text-white/70">
          <option value="" disabled>Perdu…</option>
          {LOST_REASONS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {rdvOpen && <RdvForm clientId={row.id} defaultTitle={row.nom} onDone={() => { setRdvOpen(false); onReload(); }} />}

      {/* Note rapide */}
      <div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ajouter une note…"
          className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[12.5px] text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-brand-500" />
        <button disabled={!note.trim()} onClick={() => { onPatch(row.id, { note }, "Note ajoutée"); setNote(""); }}
          className="mt-1.5 text-[12px] px-3 py-1 rounded-lg ring-1 ring-white/10 text-white/70 hover:bg-white/[0.06] disabled:opacity-40">Enregistrer la note</button>
      </div>
    </aside>
    </div>
  );
}

function RdvForm({ clientId, defaultTitle, onDone }: { clientId: string; defaultTitle: string; onDone: () => void }) {
  const [type, setType] = useState("R1_PHYSIQUE");
  const [startAt, setStartAt] = useState("");
  const [location, setLocation] = useState("");
  const [notify, setNotify] = useState(DEFAULT_NOTIFY_MINUTES_BEFORE);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!startAt) { toast.error("Choisissez une date/heure"); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/rendez-vous", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, title: defaultTitle, type, startAt: new Date(startAt).toISOString(), location, notifyMinutesBefore: notify }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec");
      toast.success("Rendez-vous créé");
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec"); }
    finally { setSaving(false); }
  }

  return (
    <div className="rounded-lg bg-white/[0.03] ring-1 ring-white/[0.06] p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className="text-[12px] px-2 py-1.5 rounded-lg bg-[#11161f] ring-1 ring-white/10 text-white/80">
          {RDV_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={notify} onChange={(e) => setNotify(Number(e.target.value))} className="text-[12px] px-2 py-1.5 rounded-lg bg-[#11161f] ring-1 ring-white/10 text-white/80" title="Notification avant le RDV">
          {NOTIFY_MINUTES_CHOICES.map((m) => <option key={m} value={m}>Notif {notifyLabel(m)}</option>)}
        </select>
      </div>
      <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)}
        className="w-full text-[12px] px-2 py-1.5 rounded-lg bg-[#11161f] ring-1 ring-white/10 text-white/80" />
      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lieu (adresse magasin)…"
        className="w-full text-[12px] px-2 py-1.5 rounded-lg bg-white/[0.04] ring-1 ring-white/10 text-white/80 placeholder:text-white/30" />
      <button disabled={saving} onClick={save}
        className="w-full inline-flex items-center justify-center gap-1.5 text-[12.5px] px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-semibold disabled:opacity-50">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />} Créer le rendez-vous
      </button>
    </div>
  );
}
