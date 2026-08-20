"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, Target, CalendarPlus, Check, X, Phone, MapPin, ChevronLeft, ChevronRight,
  ArrowLeft, Plus, Search, BarChart3, MoreHorizontal, MoreVertical, Upload, RefreshCw,
  Inbox, RotateCcw, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SurfaceCard, type Accent } from "@/components/ui/surface-card";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  PIPELINE_STAGES, getStage, nextStage, stageLabel,
  LOST_REASONS, NON_QUAL_REASONS, RDV_TYPES, NOTIFY_MINUTES_CHOICES, notifyLabel, DEFAULT_NOTIFY_MINUTES_BEFORE,
} from "@/lib/prospection";

type Row = {
  id: string; code: string; nom: string; city: string | null; zipCode: string | null;
  tel1: string | null; email: string | null; probaLabo: string | null;
  prospectStage: string | null; prospectOwner: string | null; qualifieLabo: boolean | null;
  prospectLostReason: string | null; nextRdvAt: string | null;
  prospectEnseigne: string | null; prospectFormat: string | null;
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

/** Pilule d'état PROBA (composition du vivier) — la couleur code l'estimation. */
const PROBA_COLOR: Record<string, string> = {
  "Élevée": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
  "Moyenne-haute": "bg-lime-500/15 text-lime-700 dark:text-lime-300 ring-lime-500/30",
  "Moyenne": "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30",
  "À qualifier": "bg-secondary text-muted-foreground ring-border",
};

/**
 * Badge d'état LABO de la carte (un seul, allégé). La couleur ne code que l'état :
 *   confirmé → vert ; sans labo → neutre ; estimation → ambre (à qualifier).
 */
function LaboBadge({ row }: { row: Row }) {
  if (row.qualifieLabo === true) return <Badge variant="fait">Labo confirmé</Badge>;
  if (row.qualifieLabo === false) return <Badge variant="secondary">Sans labo</Badge>;
  if (row.probaLabo) return <Badge variant="planifie">Labo {row.probaLabo.toLowerCase()}</Badge>;
  return null;
}

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
  const [lostOpen, setLostOpen] = useState(false);
  const [mobileIdx, setMobileIdx] = useState(0);
  const stageKeys = PIPELINE_STAGES.map((s) => s.key);
  // Menu contextuel (clic droit OU bouton « … ») : sur une carte (id) ou une
  // colonne (stageKey). La position est celle du curseur / du bouton.
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
  const lost = useMemo(() => rows.filter((r) => r.prospectStage === "PERDU"), [rows]);
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

  /** Ouvre le menu (carte ou colonne) à la position d'un événement souris. */
  function openMenu(e: React.MouseEvent, spec: { kind: "card" | "col"; id?: string; stageKey?: string }) {
    e.preventDefault(); e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, view: "root", ...spec });
  }
  /** Ouvre le menu ancré sous un bouton « … » (tablettes, pas de clic droit). */
  function openMenuFromButton(e: React.MouseEvent<HTMLButtonElement>, spec: { kind: "card" | "col"; id?: string; stageKey?: string }) {
    e.preventDefault(); e.stopPropagation();
    const b = e.currentTarget.getBoundingClientRect();
    setMenu({ x: b.right - 8, y: b.bottom + 4, view: "root", ...spec });
  }

  /** Carte prospect partagée (desktop Kanban + mobile) — allégée. */
  function card(r: Row, draggable: boolean) {
    return (
      <div key={r.id}
        draggable={draggable}
        onDragStart={draggable ? () => setDragId(r.id) : undefined}
        onDragEnd={draggable ? () => { setDragId(null); setOverStage(null); } : undefined}
        onContextMenu={(e) => openMenu(e, { kind: "card", id: r.id })}
        className={cn(
          "group relative rounded-lg bg-card ring-1 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)]",
          selId === r.id ? "ring-brand-500" : "ring-border hover:ring-brand-400/50",
          dragId === r.id && "opacity-40",
        )}
      >
        <button onClick={() => setSelId(r.id)}
          className="w-full text-left px-3 py-2.5 pr-9 transition-transform duration-100 active:scale-[0.98]">
          <span className="block text-body font-semibold text-foreground leading-snug">{r.nom}</span>
          <span className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {r.city && <span className="text-caption text-muted-foreground">{r.city}</span>}
            <LaboBadge row={r} />
            {r.nextRdvAt && (
              <Badge variant="outline" className="gap-1">
                <CalendarPlus className="h-3 w-3" />
                {new Date(r.nextRdvAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
              </Badge>
            )}
          </span>
        </button>
        {/* Menu « … » toujours visible (tablettes) — mêmes actions que le clic droit. */}
        <button type="button" title="Actions"
          onClick={(e) => openMenuFromButton(e, { kind: "card", id: r.id })}
          className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/* Barre d'outils */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="flex items-center gap-2 text-foreground">
          <Target className="h-5 w-5 text-brand-500" />
          <span className="text-callout font-semibold">Pipeline</span>
          <span className="text-muted-foreground text-body">{rows.length} en cours</span>
        </div>

        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer la pipeline…"
            className="h-9 w-52 rounded-lg border border-border bg-secondary/30 pl-8 pr-3 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <Button variant="outline" size="sm" className="h-9" onClick={() => setLostOpen(true)}>
          <XCircle className="h-4 w-4" /> Perdus {lost.length > 0 && <span className="tnum text-muted-foreground">· {lost.length}</span>}
        </Button>
        <Button variant="outline" size="sm" className="h-9" onClick={() => setStatsOpen(true)}>
          <BarChart3 className="h-4 w-4" /> Stats
        </Button>
        <Button size="sm" className="h-9" onClick={() => setPoolOpen(true)}>
          <Plus className="h-4 w-4" /> Ajouter des prospects
        </Button>

        {/* Actions d'administration regroupées dans un menu « … ». */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" className="h-9 w-9" title="Administration">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Administration du vivier</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={importingH} onSelect={(e) => { e.preventDefault(); doImportHypers(); }}>
              {importingH ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Importer les hypers France
            </DropdownMenuItem>
            <DropdownMenuItem disabled={importing} onSelect={(e) => { e.preventDefault(); doImport(); }}>
              {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Recharger le vivier
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {err && (
        <div className="rounded-lg bg-destructive/10 text-destructive ring-1 ring-destructive/30 px-3 py-2 text-body">
          {err} — la migration prospection est-elle appliquée ?
        </div>
      )}

      {loading ? (
        // Squelette de colonnes (chargement du pipeline).
        <div className="hidden md:flex gap-4">
          {PIPELINE_STAGES.map((st) => (
            <div key={st.key} className="flex-1 min-w-[256px] rounded-xl bg-secondary/20 ring-1 ring-border p-2.5 space-y-2.5">
              <div className="skeleton h-6 w-full rounded-md" />
              <div className="skeleton h-16 w-full rounded-lg" />
              <div className="skeleton h-16 w-full rounded-lg" />
            </div>
          ))}
        </div>
      ) : (
      <>
        {/* ─────────── Desktop — Kanban ─────────── */}
        <div className="hidden md:flex min-h-0 gap-4 overflow-x-auto pb-1">
          {PIPELINE_STAGES.map((st) => {
            const items = byStage(st.key);
            return (
              <div key={st.key}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); if (overStage !== st.key) setOverStage(st.key); } }}
                onDragLeave={(e) => { if (dragId && !e.currentTarget.contains(e.relatedTarget as Node)) setOverStage((s) => (s === st.key ? null : s)); }}
                onDrop={() => { onDrop(st.key); setOverStage(null); }}
                onContextMenu={(e) => openMenu(e, { kind: "col", stageKey: st.key })}
                className="relative flex-1 min-w-[256px] flex flex-col rounded-xl bg-secondary/20 ring-1 ring-border"
              >
                {/* Surbrillance de dépôt : la colonne survolée s'illumine. */}
                {dragId && overStage === st.key && (
                  <div className="pointer-events-none absolute inset-0 z-20 rounded-xl bg-warning/10 ring-2 ring-warning transition-opacity duration-150" />
                )}
                {/* En-tête SOBRE : point couleur d'étape + libellé + compteur. */}
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: st.color }} />
                  <span className="text-body font-semibold text-foreground">{st.label}</span>
                  <span className="ml-auto text-caption font-medium tnum text-muted-foreground rounded-full bg-secondary px-2 py-0.5">{items.length}</span>
                  <button type="button" title="Actions de la colonne"
                    onClick={(e) => openMenuFromButton(e, { kind: "col", stageKey: st.key })}
                    className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                  {items.map((r) => card(r, true))}
                  {items.length === 0 && (
                    <button onClick={() => setPoolOpen(true)}
                      className="w-full rounded-lg border border-dashed border-border py-8 text-center text-caption text-muted-foreground transition-colors hover:border-brand-500/40 hover:bg-secondary/20 hover:text-foreground active:scale-[0.99]">
                      <Plus className="mx-auto mb-1 h-4 w-4" />
                      Ajouter un prospect
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ─────────── Mobile — une étape à la fois ─────────── */}
        <div className="md:hidden min-h-0 flex flex-col">
          {(() => {
            const st = PIPELINE_STAGES[Math.min(mobileIdx, PIPELINE_STAGES.length - 1)];
            const items = byStage(st.key);
            return (
              <>
                {/* Sélecteur d'étape sobre avec flèches */}
                <div className="flex items-center gap-2 rounded-xl bg-secondary/30 ring-1 ring-border px-2 py-2"
                  onContextMenu={(e) => openMenu(e, { kind: "col", stageKey: st.key })}>
                  <button disabled={mobileIdx <= 0} onClick={() => setMobileIdx((i) => Math.max(0, i - 1))}
                    className="h-10 w-10 grid place-items-center rounded-lg bg-secondary text-foreground transition active:scale-90 disabled:opacity-25">
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div className="flex-1 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />
                      <span className="text-callout font-bold text-foreground">{st.label}</span>
                    </div>
                    <span className="text-caption text-muted-foreground">{items.length} prospect{items.length > 1 ? "s" : ""}</span>
                  </div>
                  <button disabled={mobileIdx >= PIPELINE_STAGES.length - 1} onClick={() => setMobileIdx((i) => Math.min(PIPELINE_STAGES.length - 1, i + 1))}
                    className="h-10 w-10 grid place-items-center rounded-lg bg-secondary text-foreground transition active:scale-90 disabled:opacity-25">
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
                {/* Points de progression */}
                <div className="flex items-center justify-center gap-1.5 py-2.5">
                  {PIPELINE_STAGES.map((s, i) => (
                    <button key={s.key} onClick={() => setMobileIdx(i)} aria-label={s.label}
                      className={cn("h-1.5 rounded-full transition-all duration-200", i === mobileIdx ? "w-6" : "w-1.5 bg-border")}
                      style={i === mobileIdx ? { background: s.color } : undefined} />
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto space-y-2.5 pb-1">
                  {items.map((r) => card(r, false))}
                  {items.length === 0 && (
                    <button onClick={() => setPoolOpen(true)}
                      className="w-full rounded-lg border border-dashed border-border py-10 text-center text-body text-muted-foreground transition active:scale-[0.99]">
                      <Plus className="mx-auto mb-1.5 h-5 w-5" />
                      Ajouter un prospect
                    </button>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      </>
      )}

      {/* Fiche prospect — feuille standard (Dialog) */}
      {sel && <FichePanel key={sel.id} row={sel} onClose={() => setSelId(null)} onPatch={patch} onReload={load} />}
      {poolOpen && <AddProspectsPanel onClose={() => setPoolOpen(false)} onAdded={load} />}
      {statsOpen && <StatsPanel onClose={() => setStatsOpen(false)} />}
      {lostOpen && (
        <PerdusPanel
          rows={lost}
          onClose={() => setLostOpen(false)}
          onRestore={(id) => patch(id, { stage: "A_CONTACTER" }, "Prospect ré-ouvert (À contacter)")}
          onRemove={(id) => removeFromPipeline(id)}
        />
      )}

      {/* Menu contextuel (clic droit / bouton « … ») */}
      {menu && (() => {
        const mrow = menu.kind === "card" ? rows.find((r) => r.id === menu.id) ?? null : null;
        const close = () => setMenu(null);
        const item =
          "w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-body text-foreground/85 hover:bg-secondary active:scale-[0.985] transition disabled:opacity-30 disabled:pointer-events-none";
        const left = Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 236);
        const top = Math.min(menu.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 320);
        return (
          <>
            <div className="fixed inset-0 z-[90]" onClick={close}
              onContextMenu={(e) => { e.preventDefault(); close(); }} />
            <div className="fixed z-[91] w-56 rounded-xl bg-card p-1 text-foreground shadow-modal ring-1 ring-border"
              style={{ left, top }}>
              {menu.kind === "card" && mrow && (
                <>
                  <div className="truncate px-2.5 pb-1.5 pt-1 text-caption font-semibold text-muted-foreground">{mrow.nom}</div>
                  {menu.view === "root" && (
                    <>
                      <button className={item} onClick={() => { setSelId(mrow.id); close(); }}>
                        <Target className="h-4 w-4 text-brand-500" /> Ouvrir la fiche
                      </button>
                      <button className={item} onClick={() => setMenu({ ...menu, view: "move" })}>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" /> Déplacer vers…
                      </button>
                      <button className={item} onClick={() => setMenu({ ...menu, view: "lost" })}>
                        <X className="h-4 w-4 text-destructive" /> Marquer perdu…
                      </button>
                      <div className="my-1 border-t border-border" />
                      <button className={item} onClick={() => { removeFromPipeline(mrow.id); close(); }}>
                        <ArrowLeft className="h-4 w-4 text-warning" /> Retirer du pipeline
                      </button>
                    </>
                  )}
                  {menu.view === "move" && (
                    <>
                      <button className={`${item} text-muted-foreground`} onClick={() => setMenu({ ...menu, view: "root" })}>
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
                      <button className={`${item} text-muted-foreground`} onClick={() => setMenu({ ...menu, view: "root" })}>
                        <ChevronLeft className="h-4 w-4" /> Retour
                      </button>
                      {LOST_REASONS.map((m) => (
                        <button key={m} className={item}
                          onClick={() => { patch(mrow.id, { stage: "PERDU", lostReason: m }, "Marqué perdu"); close(); }}>
                          <X className="h-3.5 w-3.5 text-destructive" /> {m}
                        </button>
                      ))}
                    </>
                  )}
                </>
              )}
              {menu.kind === "col" && menu.stageKey && (
                <>
                  <div className="px-2.5 pb-1.5 pt-1 text-caption font-semibold text-muted-foreground">
                    Catégorie « {stageLabel(menu.stageKey)} » · {byStage(menu.stageKey).length}
                  </div>
                  <button className={item} onClick={() => { clearStage(menu.stageKey!); close(); }}>
                    <ArrowLeft className="h-4 w-4 text-warning" /> Vider la catégorie (→ vivier)
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

/** Zone PERDUS consultable — liste des prospects marqués perdus (feuille Dialog). */
function PerdusPanel({ rows, onClose, onRestore, onRemove }: {
  rows: Row[]; onClose: () => void;
  onRestore: (id: string) => void; onRemove: (id: string) => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="lg" className="max-h-[88vh] overflow-hidden flex flex-col">
        <DialogTitle className="flex items-center gap-2 text-title3">
          <XCircle className="h-5 w-5 text-destructive" /> Prospects perdus
        </DialogTitle>
        <DialogDescription>
          {rows.length} prospect{rows.length > 1 ? "s" : ""} marqué{rows.length > 1 ? "s" : ""} perdu{rows.length > 1 ? "s" : ""}.
          Vous pouvez les ré-ouvrir (retour « À contacter ») ou les remettre au vivier.
        </DialogDescription>
        <div className="-mx-4 sm:-mx-6 flex-1 overflow-y-auto border-t border-border">
          {rows.length === 0 ? (
            <EmptyState icon={Inbox} title="Aucun prospect perdu" description="Les prospects marqués perdus apparaîtront ici." />
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 sm:px-6 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-foreground">{r.nom}</span>
                    <span className="block truncate text-caption text-muted-foreground">
                      {[r.city, r.prospectLostReason].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => onRestore(r.id)} title="Ré-ouvrir (À contacter)">
                    <RotateCcw className="h-3.5 w-3.5" /> Ré-ouvrir
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onRemove(r.id)} title="Remettre au vivier">
                    <ArrowLeft className="h-3.5 w-3.5" /> Vivier
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type PoolRow = { id: string; code: string; nom: string; city: string | null; zipCode: string | null; probaLabo: string | null; prospectEnseigne: string | null; prospectFormat: string | null; prospectSource: string | null; prospectLostReason: string | null };

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
  // Ligne dont la croix « retirer » a ouvert le mini-menu de motif.
  const [removeId, setRemoveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ search, sort, limit: "100" });
      if (enseigne) p.set("enseigne", enseigne);
      if (source === "nonqual") p.set("qualif", "non");   // revue des non qualifiés
      else if (source) p.set("source", source);
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

  // Retrait rapide du vivier : on marque le prospect NON qualifié avec un motif
  // (déjà client ailleurs, pas qualifié…). Réversible — il rejoint « Non qualifiés
  // (revue) », il n'est PAS supprimé. Optimiste : la ligne disparaît aussitôt,
  // restaurée si le PATCH échoue. Trace laissée dans la timeline (note).
  async function disqualify(id: string, reason: string) {
    setRemoveId(null);
    const prev = rows;
    setRows((rs) => rs.filter((x) => x.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    setSel((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });
    try {
      const r = await fetch(`/api/prospection/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qualifieLabo: false, lostReason: reason, note: `Retiré du vivier — ${reason}` }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Échec");
      toast.success(`Retiré du vivier — ${reason}`);
    } catch (e) {
      setRows(prev); setTotal((t) => t + 1);   // rollback
      toast.error(e instanceof Error ? e.message : "Échec");
    }
  }

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

  // Zone de TRAVAIL (sélection) → surfaces sobres : filtres neutres, listes bg-card.
  const selectCls = "h-8 flex-1 min-w-[110px] rounded-lg bg-secondary/30 ring-1 ring-border text-caption text-foreground px-2";

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/50" onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} className="w-[440px] max-w-[92vw] h-full overflow-y-auto bg-card ring-1 ring-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-callout font-bold text-foreground flex-1">Ajouter des prospects</h2>
          <span className="text-caption text-muted-foreground">{total} dans le vivier</span>
          <button onClick={onClose} className="h-7 w-7 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher (nom, ville, CP)…"
              className="w-full h-9 rounded-lg border border-border bg-secondary/30 pl-8 pr-3 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={source} onChange={(e) => setSource(e.target.value)} className={selectCls} title="Origine du prospect">
              <option value="">Tous types</option>
              <option value="gms">GMS (prospection)</option>
              <option value="ancien">Anciens clients</option>
              <option value="nonqual">Non qualifiés (revue)</option>
            </select>
            <select value={format} onChange={(e) => setFormat(e.target.value)} className={selectCls} title="Format du magasin (proxy taille / labo)">
              <option value="">Tous formats</option>
              <option value="Hyper">Hyper (labo probable)</option>
              <option value="Super">Super</option>
            </select>
            <button type="button" onClick={() => setZoneOpen((v) => !v)}
              className={cn("h-8 flex-1 min-w-[110px] inline-flex items-center gap-1 rounded-lg bg-secondary/30 ring-1 text-caption px-2 justify-between", zones.size ? "ring-brand-500/50 text-foreground" : "ring-border text-foreground")}>
              <span className="truncate">{zones.size ? `${zones.size} dépt${zones.size > 1 ? "s" : ""}` : "Toutes zones"}</span>
              <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", zoneOpen && "rotate-90")} />
            </button>
            <select value={enseigne} onChange={(e) => setEnseigne(e.target.value)} className={selectCls} title="Enseigne">
              <option value="">Toutes enseignes</option>
              {ENSEIGNE_CHOICES.map((c) => <option key={c} value={c}>{ENSEIGNE_LABELS[c] ?? c}</option>)}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className={selectCls} title="Trier par">
              <option value="proba">Tri : proba labo</option>
              <option value="zone">Tri : zone (CP)</option>
              <option value="enseigne">Tri : enseigne</option>
              <option value="ville">Tri : ville</option>
              <option value="nom">Tri : nom</option>
            </select>
          </div>
          {/* Sélecteur de départements (multi) — inline, pleine largeur (jamais rogné). */}
          {zoneOpen && (
            <div className="rounded-xl bg-secondary/30 ring-1 ring-border p-2">
              <div className="flex items-center justify-between px-0.5 pb-1.5">
                <span className="text-caption2 uppercase tracking-wide text-muted-foreground">Départements ({zones.size})</span>
                <div className="flex items-center gap-2">
                  {zones.size > 0 && <button onClick={() => setZones(new Set())} className="text-caption2 text-brand-600 dark:text-brand-400 hover:underline">Effacer</button>}
                  <button onClick={() => setZoneOpen(false)} className="text-caption2 text-muted-foreground hover:text-foreground">Fermer</button>
                </div>
              </div>
              <div className="max-h-[220px] overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-0.5">
                {DEPARTEMENTS.map(([code, name]) => {
                  const on = zones.has(code);
                  return (
                    <button key={code} onClick={() => setZones((s) => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n; })}
                      className={cn("flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-caption2 transition-colors", on ? "bg-brand-500/15 text-foreground" : "text-foreground hover:bg-secondary")}>
                      <span className={cn("h-3 w-3 shrink-0 grid place-items-center rounded-[3px] ring-1", on ? "bg-brand-500 ring-brand-500" : "ring-border")}>{on && <Check className="h-2.5 w-2.5 text-brand-950" />}</span>
                      <span className="truncate"><b className="text-foreground">{code}</b> {name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" disabled={adding || !sel.size} onClick={() => add({ ids: [...sel] }, "sélection")}>
            <Plus className="h-3.5 w-3.5" /> Ajouter la sélection ({sel.size})
          </Button>
          <Button variant="outline" size="sm" disabled={adding || !total} onClick={() => add({ all: true, search, enseigne, source, format, zone: zoneCsv }, `${total} résultats`)}>
            Tout ajouter ({total})
          </Button>
        </div>

        {loading ? (
          <div className="space-y-1.5">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Search} title="Aucun prospect" description="Aucun prospect dans le vivier pour cette recherche." />
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.id} className="relative">
                <button onClick={() => toggle(r.id)}
                  className={cn("w-full text-left rounded-lg px-2.5 py-2 pr-9 ring-1 flex items-center gap-2 transition-colors", sel.has(r.id) ? "ring-brand-500 bg-brand-500/10" : "ring-border bg-card hover:ring-brand-400/50")}>
                  <span className={cn("h-4 w-4 shrink-0 rounded grid place-items-center ring-1", sel.has(r.id) ? "bg-brand-500 ring-brand-500" : "ring-border")}>
                    {sel.has(r.id) && <Check className="h-3 w-3 text-brand-950" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-body text-foreground truncate">{r.nom}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span className="text-caption text-muted-foreground">{[r.city, r.zipCode].filter(Boolean).join(" · ")}</span>
                      {r.prospectEnseigne && r.prospectEnseigne !== "AUTRE" && (
                        <Badge variant="outline">{ENSEIGNE_LABELS[r.prospectEnseigne] ?? r.prospectEnseigne}</Badge>
                      )}
                      {r.prospectFormat && (
                        <Badge variant={r.prospectFormat === "Hyper" ? "fait" : "secondary"}>{r.prospectFormat}</Badge>
                      )}
                      {r.prospectSource === "ancien-client" && <Badge variant="planifie">ancien client</Badge>}
                      {r.prospectLostReason && <Badge variant="destructive">{r.prospectLostReason}</Badge>}
                    </span>
                  </span>
                  {r.probaLabo && <span className="text-caption2 px-1.5 py-0.5 rounded bg-secondary text-muted-foreground shrink-0">{r.probaLabo}</span>}
                </button>
                {/* Croix « retirer du vivier » — motif rapide (pas qualifié / déjà
                    client ailleurs). Masquée dans la revue des non qualifiés. */}
                {source !== "nonqual" && (
                  <button type="button" title="Retirer du vivier (non qualifié / déjà client)"
                    onClick={(e) => { e.stopPropagation(); setRemoveId((v) => (v === r.id ? null : r.id)); }}
                    className={cn("absolute top-1.5 right-1.5 h-6 w-6 grid place-items-center rounded-md transition-colors", removeId === r.id ? "text-destructive bg-destructive/15" : "text-muted-foreground hover:text-destructive hover:bg-destructive/10")}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                {removeId === r.id && (
                  <div onClick={(e) => e.stopPropagation()}
                    className="absolute z-20 right-1.5 top-9 w-56 rounded-lg bg-card ring-1 ring-border p-1 shadow-modal">
                    <p className="px-2 py-1 text-caption2 uppercase tracking-wide text-muted-foreground">Retirer du vivier — motif</p>
                    <button onClick={() => disqualify(r.id, "Pas qualifié")}
                      className="w-full text-left px-2 py-1.5 rounded-md text-caption text-foreground hover:bg-secondary">Pas qualifié</button>
                    <button onClick={() => disqualify(r.id, "Déjà client (autre compte)")}
                      className="w-full text-left px-2 py-1.5 rounded-md text-caption text-foreground hover:bg-secondary">Déjà client (autre compte)</button>
                  </div>
                )}
              </li>
            ))}
            {total > rows.length && <li className="text-caption2 text-muted-foreground text-center pt-1">{rows.length} affichés sur {total} — affinez la recherche ou « Tout ajouter ».</li>}
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
      <span className="w-28 shrink-0 truncate text-caption text-foreground" title={label}>{label}</span>
      <span className="relative h-4 flex-1 overflow-hidden rounded bg-secondary">
        <span className="absolute inset-y-0 left-0 rounded transition-[width] duration-500" style={{ width: `${pct}%`, background: color ?? "hsl(var(--brand-500))" }} />
      </span>
      <span className="w-14 shrink-0 text-right text-caption tnum text-foreground">{n}{sub}</span>
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

  // KPIs = zone de PRISE D'INFO → cartes teintées, chacune son identité couleur.
  const KPI = ({ label, value, accent }: { label: string; value: string | number; accent: Accent }) => (
    <SurfaceCard tinted accent={accent} animate={false} className="flex-1 min-w-[92px] p-3">
      <div className="text-title3 font-bold tnum text-foreground">{value}</div>
      <div className="text-caption2 uppercase tracking-wide text-muted-foreground">{label}</div>
    </SurfaceCard>
  );

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/50" onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} className="w-[520px] max-w-[94vw] h-full overflow-y-auto bg-card ring-1 ring-border p-4 space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-brand-500" />
          <h2 className="text-callout font-bold text-foreground flex-1">Statistiques de prospection</h2>
          <button onClick={onClose} className="h-7 w-7 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>

        {err && <div className="rounded-lg bg-destructive/10 text-destructive ring-1 ring-destructive/30 px-3 py-2 text-body">{err}</div>}
        {!data && !err && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-16 flex-1 min-w-[92px] rounded-xl" />)}</div>
            <div className="skeleton h-40 w-full rounded-xl" />
            <div className="skeleton h-40 w-full rounded-xl" />
          </div>
        )}

        {data && (() => {
          const funnelMax = Math.max(1, ...data.funnel.map((f) => f.n));
          const lostMax = Math.max(1, ...data.lostByReason.map((f) => f.n));
          const ensMax = Math.max(1, ...data.vivierComposition.byEnseigne.map((f) => f.n));
          return (
            <>
              {/* KPIs */}
              <div className="flex flex-wrap gap-2">
                <KPI label="Vivier" value={data.kpis.vivier} accent="sky" />
                <KPI label="En pipeline" value={data.kpis.inPipeline} accent="brand" />
                <KPI label="Gagnés" value={data.kpis.won} accent="emerald" />
                <KPI label="Perdus" value={data.kpis.lost} accent="rose" />
                <KPI label="Conversion" value={data.kpis.conversion == null ? "—" : `${data.kpis.conversion}%`} accent="amber" />
              </div>

              {/* Entonnoir */}
              <section className="rounded-xl bg-secondary/20 ring-1 ring-border p-3 space-y-2">
                <p className="kicker">Entonnoir</p>
                {data.funnel.map((f) => (
                  <Bar key={f.k} label={stageLabel(f.k)} n={f.n} max={funnelMax} color={getStage(f.k)?.color} />
                ))}
              </section>

              {/* Perdus par motif */}
              {data.lostByReason.length > 0 && (
                <section className="rounded-xl bg-secondary/20 ring-1 ring-border p-3 space-y-2">
                  <p className="kicker">Perdus — motifs</p>
                  {data.lostByReason.map((f, i) => (
                    <Bar key={i} label={f.k ?? "Non précisé"} n={f.n} max={lostMax} color="hsl(var(--destructive))" />
                  ))}
                </section>
              )}

              {/* Par commercial */}
              {data.byOwner.length > 0 && (
                <section className="rounded-xl bg-secondary/20 ring-1 ring-border p-3">
                  <p className="kicker mb-2">Par commercial</p>
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 text-caption">
                    <span className="text-muted-foreground text-caption2">Commercial</span>
                    <span className="text-emerald-700 dark:text-emerald-300 text-caption2 text-right">Gagnés</span>
                    <span className="text-rose-700 dark:text-rose-300 text-caption2 text-right">Perdus</span>
                    <span className="text-brand-700 dark:text-brand-300 text-caption2 text-right">En cours</span>
                    {data.byOwner.map((o, i) => (
                      <div key={i} className="contents">
                        <span className="text-foreground truncate">{o.k ?? "Non attribué"}</span>
                        <span className="text-right tnum text-emerald-700 dark:text-emerald-300">{o.won}</span>
                        <span className="text-right tnum text-rose-700 dark:text-rose-300">{o.lost}</span>
                        <span className="text-right tnum text-brand-700 dark:text-brand-300">{o.active}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Composition du vivier */}
              <section className="rounded-xl bg-secondary/20 ring-1 ring-border p-3 space-y-3">
                <p className="kicker">Vivier — composition</p>
                <div className="space-y-1.5">
                  {data.vivierComposition.byEnseigne.map((f, i) => (
                    <Bar key={i} label={ENSEIGNE_LABELS[f.k ?? ""] ?? f.k ?? "—"} n={f.n} max={ensMax} color="hsl(var(--info))" />
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {data.vivierComposition.byFormat.map((f, i) => (
                    <span key={i} className="text-caption px-2 py-1 rounded-lg bg-secondary text-muted-foreground">{f.k ?? "—"} : <b className="text-foreground">{f.n}</b></span>
                  ))}
                  {data.vivierComposition.byProba.map((f, i) => (
                    <span key={i} className={cn("text-caption px-2 py-1 rounded-lg ring-1", PROBA_COLOR[f.k ?? ""] ?? "bg-secondary ring-border text-muted-foreground")}>{f.k ?? "—"} : <b>{f.n}</b></span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {data.vivierComposition.bySource.map((f, i) => (
                    <span key={i} className="text-caption px-2 py-1 rounded-lg bg-secondary text-muted-foreground">
                      {f.k === "ancien-client" ? "Anciens clients" : f.k === "import-gms-idf-patisserie" ? "GMS" : (f.k ?? "—")} : <b className="text-foreground">{f.n}</b>
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
  const [creating, setCreating] = useState(false);

  async function requestCreation() {
    setCreating(true);
    try {
      const r = await fetch(`/api/prospection/${row.id}/request-creation`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Échec");
      toast.success(j.notified > 0 ? `Notification envoyée (${j.notified}) — client à créer dans SAP` : "Demandé — active les notifications pour être alerté");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec"); }
    finally { setCreating(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        {/* En-tête de fiche = prise d'info : identité + coordonnées d'accès rapide. */}
        <div className="pr-8">
          <DialogTitle className="text-title3 leading-tight">{row.nom}</DialogTitle>
          <DialogDescription>{[row.city, row.zipCode].filter(Boolean).join(" · ") || "—"}</DialogDescription>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {stage && (
            <span className="inline-flex items-center gap-1.5 text-caption font-semibold px-2 py-1 rounded-lg ring-1 ring-border text-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: stage.color }} /> {stage.label}
            </span>
          )}
          {row.tel1 && <a href={`tel:${row.tel1}`} className="text-caption inline-flex items-center gap-1 text-foreground hover:text-brand-600 dark:hover:text-brand-400"><Phone className="h-3 w-3" />{row.tel1}</a>}
          <a target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${encodeURIComponent(`${row.nom} ${row.city ?? ""} téléphone`)}`}
            className="text-caption inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline"><MapPin className="h-3 w-3" />Trouver le tél</a>
        </div>

        {/* Script de l'étape */}
        {stage && (
          <div className="rounded-lg bg-secondary/30 ring-1 ring-border p-3">
            <p className="kicker mb-1.5">Script — {stage.label}</p>
            <p className="text-body text-foreground whitespace-pre-line leading-relaxed">{stage.script}</p>
          </div>
        )}

        {/* Qualif labo — « Non qualifié » sort le prospect de la liste (avec motif) */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-caption text-muted-foreground">Labo pâtisserie&nbsp;:</span>
          <Button variant={row.qualifieLabo === true ? "success" : "outline"} size="sm"
            onClick={() => onPatch(row.id, { qualifieLabo: true }, "Qualifié : labo OK")}>
            Oui, qualifié
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant={row.qualifieLabo === false ? "destructive" : "outline"} size="sm">
                Non qualifié… <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Motif de non-qualification</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {NON_QUAL_REASONS.map((m) => (
                <DropdownMenuItem key={m}
                  onSelect={() => { onPatch(row.id, { qualifieLabo: false, lostReason: m, remove: true }, "Non qualifié — sorti de la liste"); onClose(); }}>
                  {m}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {row.qualifieLabo === false && row.prospectLostReason && (
            <span className="text-caption text-destructive">motif : {row.prospectLostReason}</span>
          )}
        </div>

        {/* Actions d'étape */}
        <div className="flex flex-wrap gap-2">
          {next && (
            <Button size="sm" onClick={() => onPatch(row.id, { stage: next }, `→ ${stageLabel(next)}`)}>
              {stageLabel(next)} <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="warning" size="sm" onClick={requestCreation} disabled={creating}
            title="Le prospect veut une 1re commande : notifie qu'il faut le créer dans SAP (partenaire)">
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Client à créer (1re cde)
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRdvOpen((v) => !v)}>
            <CalendarPlus className="h-3.5 w-3.5" /> Rendez-vous
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <X className="h-3.5 w-3.5 text-destructive" /> Perdu… <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Motif de perte</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {LOST_REASONS.map((m) => (
                <DropdownMenuItem key={m}
                  onSelect={() => onPatch(row.id, { stage: "PERDU", lostReason: m }, "Marqué perdu")}>
                  {m}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {rdvOpen && <RdvForm clientId={row.id} defaultTitle={row.nom} onDone={() => { setRdvOpen(false); onReload(); }} />}

        {/* Note rapide */}
        <div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ajouter une note…"
            className="w-full rounded-lg border border-border bg-secondary/30 px-2.5 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-500" />
          <Button variant="outline" size="sm" className="mt-1.5" disabled={!note.trim()}
            onClick={() => { onPatch(row.id, { note }, "Note ajoutée"); setNote(""); }}>
            Enregistrer la note
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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

  const fieldCls = "text-caption px-2 py-1.5 rounded-lg bg-secondary/30 ring-1 ring-border text-foreground";

  return (
    <div className="rounded-lg bg-secondary/30 ring-1 ring-border p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className={fieldCls}>
          {RDV_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={notify} onChange={(e) => setNotify(Number(e.target.value))} className={fieldCls} title="Notification avant le RDV">
          {NOTIFY_MINUTES_CHOICES.map((m) => <option key={m} value={m}>Notif {notifyLabel(m)}</option>)}
        </select>
      </div>
      <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)}
        className={cn(fieldCls, "w-full")} />
      <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lieu (adresse magasin)…"
        className={cn(fieldCls, "w-full placeholder:text-muted-foreground")} />
      <Button size="sm" className="w-full" disabled={saving} onClick={save}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />} Créer le rendez-vous
      </Button>
    </div>
  );
}
