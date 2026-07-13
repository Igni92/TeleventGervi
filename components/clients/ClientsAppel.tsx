"use client";

/**
 * « Clients & plan d'appel » — LISTE UNIQUE (fusion de l'ancien annuaire
 * `ClientTable` et de l'ancien cockpit `PlanAppel`, qui affichaient la même
 * population client sous deux angles quasi identiques). Une seule vue, riche et
 * filtrable, qui sert les deux besoins :
 *
 *   • Annuaire  — chercher, ouvrir la fiche, créer, importer, programmer un rappel.
 *   • Plan d'appel — assigner vendeur/commercial (en ligne ou en série), repérer
 *     les clients en retard de commande et les incidents ouverts, activer/désactiver.
 *
 * Source unique : `/api/plan-appel` (raw SQL) — porte la VRAIE dernière commande
 * SAP (`MAX(docDate)`, pas le proxy « dernier appel COMMANDE » de l'ancien
 * /api/clients), les incidents ouverts et le dernier appel. Base ~340 clients :
 * on charge tout (tri/stat/filtre instantanés côté client, pas de pagination).
 *
 * `canManage` (faux pour le livreur) masque les leviers d'assignation et les
 * outils d'admin (import CSV, déduction vendeurs) ; les écritures restent de
 * toute façon gardées côté API.
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Search, Loader2, Phone, AlertTriangle, PackageX, UserCheck, Users, ExternalLink,
  Check, Columns3, X, UserPlus, Plus, Bell, CalendarClock, MoreHorizontal,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { SALESPEOPLE, displayNameFromSlp, normalizeSlp } from "@/lib/salespeople";
import { SortArrow, nextSort, type SortDir } from "@/components/ui/sort";
import { formatPhoneDisplay, standardizePhone } from "@/lib/phone";
import { ReminderModal } from "@/components/ReminderModal";
import { ImportModal } from "@/components/ImportModal";

interface PlanClient {
  id: string;
  code: string;
  nom: string;
  type: string | null;
  commercial: string | null;
  vendeur: string | null;
  tel1: string | null;
  tel2: string | null;
  joursAppel: string | null;
  activeTelevente: boolean;
  openIncidents: number;
  lastOrderDays: number | null;
  lastCallDays: number | null;
}

const VENDEURS = SALESPEOPLE.map((s) => s.initials); // MM, JMG, AG
const JOURS = ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"];
const JOUR_NUM = [1, 2, 3, 4, 5, 6, 0];

// Colonnes masquables (le nom + cases + actions restent toujours). `manage` =
// colonne réservée aux profils qui pilotent le plan d'appel (masquée au livreur).
const COLS: { id: string; label: string; manage?: boolean }[] = [
  { id: "tel", label: "Tél" },
  { id: "jours", label: "Jours d'appel" },
  { id: "lastOrder", label: "Dernière cde" },
  { id: "incidents", label: "Incidents" },
  { id: "vendeur", label: "Vendeur", manage: true },
  { id: "commercial", label: "Commercial", manage: true },
];

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

function Checkbox({ checked, onChange, indeterminate }: { checked: boolean; onChange: () => void; indeterminate?: boolean }) {
  return (
    <label className="inline-flex items-center justify-center cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only peer" />
      <span className={`h-4 w-4 rounded border flex items-center justify-center transition-all ${
        checked ? "bg-brand-600 border-brand-600" : indeterminate ? "bg-brand-600/30 border-brand-500" : "bg-card border-slate-300 dark:border-slate-600 hover:border-brand-500"
      }`}>
        {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        {!checked && indeterminate && <span className="h-0.5 w-2 bg-brand-600 rounded-full" />}
      </span>
    </label>
  );
}

function JoursBadges({ joursAppel, today }: { joursAppel: string | null; today: number }) {
  if (!joursAppel) return <span className="text-muted-foreground/40 text-[11px]">—</span>;
  const days = joursAppel.split(",").map(Number);
  return (
    <div className="inline-flex gap-[2px]">
      {JOUR_NUM.map((d, i) => {
        const on = days.includes(d);
        const isToday = d === today;
        return (
          <span key={d} className={`inline-flex items-center justify-center h-[17px] w-[18px] text-[9.5px] font-semibold rounded ${
            on ? "bg-brand-600 text-white" : "bg-secondary text-muted-foreground/40"
          } ${isToday ? "ring-1 ring-offset-1 ring-brand-500 dark:ring-offset-card" : ""}`}>{JOURS[i]}</span>
        );
      })}
    </div>
  );
}

function LastOrder({ days }: { days: number | null }) {
  if (days == null) return <span className="text-[12px] font-semibold text-rose-600 dark:text-rose-400">jamais</span>;
  const color = days >= 30 ? "text-rose-600 dark:text-rose-400" : days >= 14 ? "text-amber-600 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400";
  return <span className={`text-[12px] font-semibold ${color} tnum`}>{days === 0 ? "auj." : `${days} j`}</span>;
}

function AssignSelect({ value, options, placeholder, onChange }: {
  value: string | null; options: readonly string[]; placeholder: string; onChange: (v: string | null) => void;
}) {
  const norm = value ? normalizeSlp(value) : null;
  const opts = useMemo(() => {
    const set = new Set(options);
    if (norm) set.add(norm);
    return Array.from(set);
  }, [options, norm]);
  return (
    <select
      value={norm ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-7 w-full max-w-[130px] rounded-md border border-border bg-background text-[11.5px] px-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
    >
      <option value="">{placeholder}</option>
      {opts.map((o) => <option key={o} value={o}>{displayNameFromSlp(o) ?? o}</option>)}
    </select>
  );
}

type AssignPatch = Partial<Pick<PlanClient, "vendeur" | "commercial" | "activeTelevente">>;

/** Ligne mémoïsée : cocher / changer un select ne re-rend QUE la ligne concernée. */
const PlanRow = memo(function PlanRow({
  c, sel, today, canManage, showTel, showJours, showLastOrder, showIncidents, showVendeur, showCommercial,
  onToggle, onAssign, onReminder,
}: {
  c: PlanClient; sel: boolean; today: number; canManage: boolean;
  showTel: boolean; showJours: boolean; showLastOrder: boolean;
  showIncidents: boolean; showVendeur: boolean; showCommercial: boolean;
  onToggle: (id: string) => void;
  onAssign: (id: string, patch: AssignPatch) => void;
  onReminder: (c: PlanClient) => void;
}) {
  return (
    <tr className={`transition-colors ${sel ? "bg-brand-50/60 dark:bg-brand-950/30" : "hover:bg-secondary/30"} ${!c.activeTelevente ? "opacity-60" : ""}`}>
      {canManage && <td className="w-9 px-3 py-2"><Checkbox checked={sel} onChange={() => onToggle(c.id)} /></td>}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Link href={`/clients/${c.id}`} className="font-semibold text-foreground hover:text-brand-600 hover:underline underline-offset-2">{c.nom}</Link>
          {c.type && <Badge variant={c.type === "GMS" ? "gms" : c.type === "EXPORT" ? "export" : "outline"} className="text-[9.5px]">{c.type}</Badge>}
          {!c.activeTelevente && <span className="text-[9px] font-bold uppercase text-amber-600 dark:text-amber-400">inactif</span>}
        </div>
        <span className="text-[10.5px] font-mono text-muted-foreground">{c.code}</span>
      </td>
      {showTel && (
        <td className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground whitespace-nowrap">
          {c.tel1 ? <a href={`tel:${standardizePhone(c.tel1)}`} className="inline-flex items-center gap-1 hover:text-brand-600"><Phone className="h-3 w-3" />{formatPhoneDisplay(c.tel1)}</a> : "—"}
        </td>
      )}
      {showJours && <td className="px-3 py-2"><JoursBadges joursAppel={c.joursAppel} today={today} /></td>}
      {showLastOrder && <td className="px-3 py-2 text-right whitespace-nowrap"><LastOrder days={c.lastOrderDays} /></td>}
      {showIncidents && (
        <td className="px-3 py-2 text-center">
          {c.openIncidents > 0
            ? <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 text-[11px] font-bold"><AlertTriangle className="h-3 w-3" />{c.openIncidents}</span>
            : <span className="text-muted-foreground/40">—</span>}
        </td>
      )}
      {showVendeur && <td className="px-3 py-2">{canManage ? <AssignSelect value={c.vendeur} options={VENDEURS} placeholder="" onChange={(v) => onAssign(c.id, { vendeur: v })} /> : <span className="text-[12px]">{c.vendeur ? displayNameFromSlp(c.vendeur) ?? c.vendeur : "—"}</span>}</td>}
      {showCommercial && <td className="px-3 py-2">{canManage ? <AssignSelect value={c.commercial} options={VENDEURS} placeholder="" onChange={(v) => onAssign(c.id, { commercial: v })} /> : <span className="text-[12px]">{c.commercial ? displayNameFromSlp(c.commercial) ?? c.commercial : "—"}</span>}</td>}
      <td className="px-2 py-2 text-right whitespace-nowrap">
        <button type="button" onClick={() => onReminder(c)} title="Programmer un rappel"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-brand-600 hover:bg-secondary/60">
          <Bell className="h-3.5 w-3.5" />
        </button>
        <Link href={`/clients/${c.id}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60" title="Ouvrir la fiche">
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </td>
    </tr>
  );
});
PlanRow.displayName = "PlanRow";

export function ClientsAppel({ canManage = true }: { canManage?: boolean }) {
  const [search, setSearch] = useState("");
  const debSearch = useDebounced(search, 250);
  const [vendeur, setVendeur] = useState("");
  const [commercial, setCommercial] = useState("");
  const [type, setType] = useState("");
  const [active, setActive] = useState("");
  const [incidents, setIncidents] = useState(false);
  const [stale, setStale] = useState("");
  const [todayOnly, setTodayOnly] = useState(false);
  const [data, setData] = useState<PlanClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ ids: string[] } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [syncingVendeurs, setSyncingVendeurs] = useState(false);
  const [reminderClient, setReminderClient] = useState<PlanClient | null>(null);
  const show = (id: string) => !hidden.has(id);
  const [sort, setSort] = useState<{ key: string | null; dir: SortDir }>({ key: null, dir: "asc" });
  const toggleSort = (key: string) => setSort((cur) => nextSort(cur, key));

  // Jour de la semaine courant (0=Dim … 6=Sam) — pour le filtre « À appeler
  // aujourd'hui » et la mise en évidence du jour dans les badges. Résolu après
  // montage (composant client) : pas de mismatch SSR.
  const [today, setToday] = useState(-1);
  useEffect(() => { setToday(new Date().getDay()); }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (debSearch) p.set("search", debSearch);
      if (vendeur) p.set("vendeur", vendeur);
      if (commercial) p.set("commercial", commercial);
      if (type) p.set("type", type);
      if (active) p.set("active", active);
      if (incidents) p.set("incidents", "1");
      if (stale) p.set("stale", stale);
      const r = await fetch(`/api/plan-appel?${p}`, { cache: "no-store" });
      const j = await r.json();
      setData(j.clients ?? []);
    } catch { toast.error("Erreur de chargement des clients"); }
    finally { setLoading(false); }
  }, [debSearch, vendeur, commercial, type, active, incidents, stale]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setSelected(new Set()); }, [debSearch, vendeur, commercial, type, active, incidents, stale, todayOnly]);

  const assign = useCallback(async (id: string, patch: AssignPatch) => {
    setData((cur) => cur.map((c) => c.id === id ? { ...c, ...patch } : c));
    try {
      const r = await fetch(`/api/clients/${id}/assign`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error();
    } catch { toast.error("Échec de l'assignation"); fetchData(); }
  }, [fetchData]);

  const postBulk = async (
    ids: string[],
    patch: { vendeur?: string | null; commercial?: string | null; activeTelevente?: boolean },
  ): Promise<number> => {
    const idSet = new Set(ids);
    setData((cur) => cur.map((c) => idSet.has(c.id) ? { ...c, ...patch } : c));
    const r = await fetch("/api/clients/assign-bulk", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, ...patch }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error();
    return j.updated as number;
  };

  const bulkAssign = async (patch: { vendeur?: string | null; commercial?: string | null; activeTelevente?: boolean }) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    try {
      const updated = await postBulk(ids, patch);
      const what = patch.vendeur !== undefined ? `vendeur ${patch.vendeur ?? "—"}`
        : patch.commercial !== undefined ? `commercial ${patch.commercial ?? "—"}`
        : patch.activeTelevente ? "activés" : "désactivés";
      toast.success(`${updated} client(s) → ${what}`);
      setSelected(new Set());
    } catch { toast.error("Échec de l'action en série"); fetchData(); }
  };

  const runBulkDeactivate = async (ids: string[]) => {
    setConfirmLoading(true);
    try {
      const updated = await postBulk(ids, { activeTelevente: false });
      setConfirmDeactivate(null);
      setSelected(new Set());
      toast.success(`${updated} client(s) désactivé(s)`, {
        action: {
          label: "Annuler",
          onClick: async () => {
            try {
              await postBulk(ids, { activeTelevente: true });
              toast.success(`${ids.length} client(s) réactivé(s)`);
            } catch { toast.error("Échec de la réactivation"); fetchData(); }
          },
        },
      });
    } catch { toast.error("Échec de l'action en série"); fetchData(); }
    finally { setConfirmLoading(false); }
  };

  const syncVendeurs = async () => {
    setSyncingVendeurs(true);
    try {
      const res = await fetch("/api/clients/sync-vendeurs", { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error();
      toast.success(`Vendeurs déduits du dernier BL — ${j.updated} client(s) mis à jour`);
      fetchData();
    } catch { toast.error("Erreur lors de la déduction des vendeurs"); }
    finally { setSyncingVendeurs(false); }
  };

  const toggleOne = useCallback((id: string) => setSelected((cur) => {
    const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n;
  }), []);
  const toggleCol = (id: string) => setHidden((cur) => {
    const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  // Filtre client « à appeler aujourd'hui » : joursAppel contient le jour courant.
  const withToday = useMemo(
    () => todayOnly && today >= 0
      ? data.filter((c) => (c.joursAppel?.split(",").map(Number) ?? []).includes(today))
      : data,
    [data, todayOnly, today],
  );

  const stats = useMemo(() => ({
    total: data.length,
    today: today >= 0 ? data.filter((c) => (c.joursAppel?.split(",").map(Number) ?? []).includes(today)).length : 0,
    stale30: data.filter((c) => c.lastOrderDays == null || c.lastOrderDays >= 30).length,
    withIncidents: data.filter((c) => c.openIncidents > 0).length,
    noVendeur: data.filter((c) => !c.vendeur).length,
  }), [data, today]);

  const sortedData = useMemo(() => {
    if (!sort.key) return withToday;
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (c: PlanClient): string | number => {
      switch (sort.key) {
        case "nom": return c.nom?.toLowerCase() ?? "";
        case "tel": return c.tel1 || c.tel2 || "";
        case "lastOrder": return c.lastOrderDays == null ? Number.POSITIVE_INFINITY : c.lastOrderDays;
        case "incidents": return c.openIncidents ?? 0;
        case "vendeur": return (c.vendeur ? normalizeSlp(c.vendeur) : "") ?? "";
        case "commercial": return (c.commercial ? normalizeSlp(c.commercial) : "") ?? "";
        default: return "";
      }
    };
    return [...withToday].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "fr") * dir;
    });
  }, [withToday, sort]);

  const allVisibleSelected = sortedData.length > 0 && sortedData.every((c) => selected.has(c.id));
  const someSelected = !allVisibleSelected && sortedData.some((c) => selected.has(c.id));
  const toggleAll = () => setSelected((cur) => {
    if (allVisibleSelected) { const n = new Set(cur); sortedData.forEach((c) => n.delete(c.id)); return n; }
    return new Set([...Array.from(cur), ...sortedData.map((c) => c.id)]);
  });

  const cols = COLS.filter((c) => !c.manage || canManage);
  const colCount = (canManage ? 2 : 1) + 1 + cols.filter((c) => show(c.id)).length;

  return (
    <div className="space-y-4">
      {/* Cartes synthèse — cliquables = filtres rapides */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard icon={Users} label="Clients" value={stats.total} tone="brand" />
        <StatCard icon={CalendarClock} label="À appeler auj." value={stats.today} tone="sky"
          onClick={() => setTodayOnly((v) => !v)} active={todayOnly} />
        <StatCard icon={PackageX} label="Sans cde ≥ 30 j" value={stats.stale30} tone="rose"
          onClick={() => setStale(stale === "30" ? "" : "30")} active={stale === "30"} />
        <StatCard icon={AlertTriangle} label="Avec incident" value={stats.withIncidents} tone="amber"
          onClick={() => setIncidents((v) => !v)} active={incidents} />
        {canManage && <StatCard icon={UserCheck} label="Sans vendeur" value={stats.noVendeur} tone="violet" />}
      </div>

      {/* Filtres + colonnes + actions annuaire */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher (code, nom)…" className="pl-9" />
        </div>
        {canManage && <FilterSelect value={vendeur} onChange={setVendeur} placeholder="Vendeur" options={[["", "Tous vendeurs"], ...VENDEURS.map((v) => [v, displayNameFromSlp(v) ?? v] as [string, string])]} />}
        <FilterSelect value={commercial} onChange={setCommercial} placeholder="Commercial"
          options={[["", "Tous commerciaux"], ["__none__", "Non assigné"], ...VENDEURS.map((v) => [v, displayNameFromSlp(v) ?? v] as [string, string])]} />
        <FilterSelect value={type} onChange={setType} placeholder="Type" options={[["", "Tous types"], ["GMS", "GMS"], ["EXPORT", "EXPORT"], ["CHR", "CHR"]]} />
        <FilterSelect value={active} onChange={setActive} placeholder="Activation" options={[["", "Actif + inactif"], ["actifs", "Actifs"], ["inactifs", "À activer"]]} />
        <FilterSelect value={stale} onChange={setStale} placeholder="Retard cde" options={[["", "Toute ancienneté"], ["14", "≥ 14 j"], ["30", "≥ 30 j"], ["60", "≥ 60 j"]]} />

        {/* Masquer / afficher des colonnes */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="h-9 px-3 rounded-md border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
              <Columns3 className="h-3.5 w-3.5" /> Colonnes
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Colonnes affichées</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {cols.map((c) => (
              <button key={c.id} type="button" onClick={() => toggleCol(c.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[13px] hover:bg-secondary/60 rounded-sm">
                <span className={`h-4 w-4 rounded border flex items-center justify-center ${show(c.id) ? "bg-brand-600 border-brand-600" : "border-slate-300 dark:border-slate-600"}`}>
                  {show(c.id) && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </span>
                {c.label}
              </button>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Actions annuaire (à droite) */}
        <div className="ml-auto flex items-center gap-2">
          {canManage && (
            <>
              <Button variant="outline" size="sm" onClick={syncVendeurs} disabled={syncingVendeurs} className="hidden sm:inline-flex gap-1">
                {syncingVendeurs ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Déduire vendeurs
              </Button>
              <span className="hidden sm:block"><ImportModal onImported={fetchData} /></span>
            </>
          )}
          <Button asChild size="sm" className="gap-1">
            <Link href="/clients/new"><Plus className="h-4 w-4" /> Nouveau client</Link>
          </Button>
        </div>
      </div>

      {/* Barre d'assignation en série */}
      {canManage && selected.size > 0 && (
        <div className="bg-brand-50 dark:bg-brand-950/40 border border-brand-300/60 dark:border-brand-500/40 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-[13px] font-semibold text-brand-900 dark:text-brand-200 inline-flex items-center gap-1.5">
            <UserPlus className="h-4 w-4" /> {selected.size} client{selected.size > 1 ? "s" : ""} coché{selected.size > 1 ? "s" : ""}
          </span>
          <span className="text-brand-400/60">·</span>
          <BulkActionSelect label="Assigner au vendeur" options={VENDEURS} onPick={(v) => bulkAssign({ vendeur: v })} />
          <BulkActionSelect label="Assigner au commercial" options={VENDEURS} onPick={(v) => bulkAssign({ commercial: v })} />
          <span className="text-brand-400/60">·</span>
          <button type="button" onClick={() => bulkAssign({ activeTelevente: true })}
            className="h-8 px-2.5 rounded-md text-[12px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1">
            <Check className="h-3.5 w-3.5" /> Activer
          </button>
          <button type="button" onClick={() => setConfirmDeactivate({ ids: Array.from(selected) })}
            className="h-8 px-2.5 rounded-md text-[12px] font-semibold border border-rose-400/60 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 inline-flex items-center gap-1">
            <X className="h-3.5 w-3.5" /> Désactiver
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" /> Désélectionner
          </button>
        </div>
      )}

      {/* Mobile : cartes */}
      <div className="md:hidden space-y-2.5">
        {loading ? (
          <div className="h-32 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : sortedData.length === 0 ? (
          <p className="text-center text-muted-foreground py-10 text-[15px]">Aucun client pour ces filtres.</p>
        ) : sortedData.map((c) => {
          const tel = c.tel1 || c.tel2 || null;
          const telHref = tel ? standardizePhone(tel) || null : null;
          const tv = c.type === "GMS" ? "gms" : c.type === "EXPORT" ? "export" : c.type === "CHR" ? "chr" : "outline";
          return (
            <div key={c.id} className={`rounded-2xl border border-border bg-card p-4 ${!c.activeTelevente ? "opacity-70" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <Link href={`/clients/${c.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[16px] font-semibold text-foreground leading-tight">{c.nom}</span>
                    {c.type && <Badge variant={tv as "gms" | "export" | "chr" | "outline"}>{c.type}</Badge>}
                    {!c.activeTelevente && (
                      <span className="inline-flex h-[18px] items-center px-1.5 rounded text-[11px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">à activer</span>
                    )}
                    {c.openIncidents > 0 && (
                      <span className="inline-flex items-center gap-1 h-[18px] px-1.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                        <AlertTriangle className="h-3 w-3" />{c.openIncidents}
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] font-mono text-muted-foreground mt-1">
                    {c.code}{c.vendeur ? ` · vend. ${displayNameFromSlp(c.vendeur)}` : ""}
                  </div>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary/60 shrink-0" aria-label="Actions">
                      <MoreHorizontal className="h-5 w-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => setReminderClient(c)} className="cursor-pointer text-[13px] gap-2"><Bell className="h-3.5 w-3.5" /> Programmer un rappel</DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer text-[13px] gap-2"><Link href={`/clients/${c.id}`}><ExternalLink className="h-3.5 w-3.5" /> Ouvrir la fiche</Link></DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex items-center justify-between gap-2 mt-3">
                {telHref ? (
                  <a href={`tel:${telHref}`} className="inline-flex items-center gap-2 h-10 px-3 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[15px] font-semibold tnum active:scale-[0.97]">
                    <Phone className="h-4 w-4" /> {formatPhoneDisplay(tel)}
                  </a>
                ) : (
                  <span className="text-[13px] text-muted-foreground">Pas de téléphone</span>
                )}
                <span className="text-[13px] text-muted-foreground shrink-0">
                  {c.lastOrderDays != null ? `cde il y a ${c.lastOrderDays} j` : "jamais commandé"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Table (desktop) */}
      <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-auto max-h-[68vh]">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-card text-[10.5px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border">
                {canManage && <th className="w-9 px-3 py-2.5 bg-card"><Checkbox checked={allVisibleSelected} indeterminate={someSelected} onChange={toggleAll} /></th>}
                <PlanTh sortKey="nom" sort={sort} onSort={toggleSort}>Client</PlanTh>
                {show("tel") && <PlanTh sortKey="tel" sort={sort} onSort={toggleSort}>Tél</PlanTh>}
                {show("jours") && <th className="text-left px-3 py-2.5 font-semibold bg-card">Jours d&apos;appel</th>}
                {show("lastOrder") && <PlanTh sortKey="lastOrder" sort={sort} onSort={toggleSort} align="right">Dernière cde</PlanTh>}
                {show("incidents") && <PlanTh sortKey="incidents" sort={sort} onSort={toggleSort} align="center">Incidents</PlanTh>}
                {canManage && show("vendeur") && <PlanTh sortKey="vendeur" sort={sort} onSort={toggleSort}>Vendeur</PlanTh>}
                {canManage && show("commercial") && <PlanTh sortKey="commercial" sort={sort} onSort={toggleSort}>Commercial</PlanTh>}
                <th className="w-20 bg-card text-right px-3 py-2.5 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <tr><td colSpan={colCount} className="h-32 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></td></tr>
              ) : sortedData.length === 0 ? (
                <tr><td colSpan={colCount} className="h-32 text-center text-muted-foreground">Aucun client pour ces filtres.</td></tr>
              ) : sortedData.map((c) => (
                <PlanRow
                  key={c.id}
                  c={c}
                  sel={selected.has(c.id)}
                  today={today}
                  canManage={canManage}
                  showTel={show("tel")}
                  showJours={show("jours")}
                  showLastOrder={show("lastOrder")}
                  showIncidents={show("incidents")}
                  showVendeur={canManage && show("vendeur")}
                  showCommercial={canManage && show("commercial")}
                  onToggle={toggleOne}
                  onAssign={assign}
                  onReminder={setReminderClient}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {!loading && (
        <p className="text-[12px] text-muted-foreground">
          {sortedData.length} client(s){todayOnly ? " à appeler aujourd'hui" : ""}
          {sort.key ? " · tri personnalisé (clic sur les colonnes)" : " · triés par commande la plus ancienne"}.
        </p>
      )}

      {/* Rappel — une seule modale, ouverte pour le client choisi. */}
      {reminderClient && (
        <ReminderModal
          client={reminderClient}
          open={reminderClient !== null}
          onOpenChange={(o) => { if (!o) setReminderClient(null); }}
        />
      )}

      {/* Confirmation avant désactivation en série. */}
      <Dialog
        open={confirmDeactivate !== null}
        onOpenChange={(o) => { if (!o && !confirmLoading) setConfirmDeactivate(null); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Désactiver {confirmDeactivate?.ids.length ?? 0} client{(confirmDeactivate?.ids.length ?? 0) > 1 ? "s" : ""} en télévente ?
            </DialogTitle>
            <DialogDescription className="pt-1">
              {confirmDeactivate?.ids.length ?? 0} client{(confirmDeactivate?.ids.length ?? 0) > 1 ? "s ne seront plus" : " ne sera plus"} jamais
              proposé{(confirmDeactivate?.ids.length ?? 0) > 1 ? "s" : ""} au rappel. Vous pourrez
              {(confirmDeactivate?.ids.length ?? 0) > 1 ? " les" : " le"} réactiver à tout moment.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeactivate(null)} disabled={confirmLoading}>Annuler</Button>
            <Button
              variant="destructive"
              onClick={() => { if (confirmDeactivate) runBulkDeactivate(confirmDeactivate.ids); }}
              disabled={confirmLoading || !confirmDeactivate?.ids.length}
            >
              {confirmLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Désactiver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Sous-composants ─────────────────────────────────────── */

function BulkActionSelect({ label, options, onPick }: { label: string; options: readonly string[]; onPick: (v: string | null) => void }) {
  return (
    <select
      value=""
      onChange={(e) => { const v = e.target.value; if (v) onPick(v === "__none__" ? null : v); e.currentTarget.value = ""; }}
      className="h-8 rounded-md border border-brand-400/50 bg-card text-[12px] px-2 font-medium focus:outline-none focus:ring-1 focus:ring-brand-500"
    >
      <option value="">{label}…</option>
      {options.map((o) => <option key={o} value={o}>{displayNameFromSlp(o) ?? o}</option>)}
      <option value="__none__">— retirer —</option>
    </select>
  );
}

function StatCard({
  icon: Icon, label, value, tone, onClick, active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: number; tone: "brand" | "rose" | "amber" | "violet" | "sky";
  onClick?: () => void; active?: boolean;
}) {
  const toneCls = {
    brand: "text-brand-600 dark:text-brand-400",
    rose: "text-rose-600 dark:text-rose-400",
    amber: "text-amber-600 dark:text-amber-400",
    violet: "text-violet-600 dark:text-violet-400",
    sky: "text-sky-600 dark:text-sky-400",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`text-left rounded-xl border bg-card px-4 py-3 transition-colors ${
        active ? "border-brand-500 ring-1 ring-brand-500/40" : "border-border"
      } ${onClick ? "hover:bg-secondary/40 cursor-pointer" : "cursor-default"}`}
    >
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide text-muted-foreground font-semibold">
        <Icon className={`h-3.5 w-3.5 ${toneCls}`} /> {label}
      </div>
      <div className="text-[24px] font-bold tnum text-foreground mt-0.5">{value}</div>
    </button>
  );
}

function PlanTh({
  sortKey, sort, onSort, align = "left", children,
}: {
  sortKey: string;
  sort: { key: string | null; dir: SortDir };
  onSort: (key: string) => void;
  align?: "left" | "right" | "center";
  children: React.ReactNode;
}) {
  const active = sort.key === sortKey;
  const just = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "";
  const txt = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th className={`${txt} px-3 py-2.5 font-semibold bg-card`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${just} ${active ? "text-foreground" : ""}`}
      >
        {children}
        <SortArrow active={active} dir={sort.dir} />
      </button>
    </th>
  );
}

function FilterSelect({
  value, onChange, placeholder, options,
}: { value: string; onChange: (v: string) => void; placeholder: string; options: [string, string][] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder}
      className="h-9 rounded-md border border-border bg-background text-[12.5px] px-2 focus:outline-none focus:ring-1 focus:ring-brand-500"
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
