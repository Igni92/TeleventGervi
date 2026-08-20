"use client";

/**
 * « Clients & plan d'appel » — ANNUAIRE (liste de travail sobre). Fusion de
 * l'ancien annuaire clients et du cockpit /plan-appel : une seule population,
 * une seule liste. La page suit les DEUX régimes visuels de la refonte :
 *
 *   1. ZONE DE PRISE D'INFO — 4 KPI-FILTRES teintés (SurfaceCard tinted+accent)
 *      qui donnent l'état du portefeuille d'un coup d'oeil ET filtrent la liste
 *      au clic (Clients · Programmés aujourd'hui · Sans commande ≥ 30 j · Incidents).
 *   2. ZONE DE TRAVAIL — la liste elle-même : surfaces neutres (GroupedList),
 *      en-tête gris marqué, séparateurs nets, aucune couleur de fond. La couleur
 *      n'y code QUE l'état (retard de commande, incident, inactif).
 *
 * Une barre unique : recherche large + UN bouton « Filtres » (popover portant
 * les 6 critères) ; les filtres actifs se relisent en puces amovibles.
 *
 * Chaque ligne a UNE cible de clic — la fiche client. Les actions de télévente
 * (console, rappel, activation, assignation) vivent dans le menu « … » de fin de
 * ligne. Les tâches d'admin (déduire vendeurs, import SAP, mode sélection) sont
 * regroupées dans un second menu « … ».
 *
 * Source unique : `/api/plan-appel` (dernière commande SAP réelle, incidents,
 * dernier appel), scopée serveur au portefeuille de l'utilisateur (`restricted`).
 * On charge tout et on filtre/trie/compte EN MÉMOIRE. La file d'appel priorisée
 * reste la Console (`/console`).
 *
 * `canManage` (faux pour le livreur) masque les leviers d'assignation/admin ; les
 * écritures restent gardées côté API.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Search, Loader2, Users, AlertTriangle, PackageX, CalendarClock,
  UserCheck, Bell, Power, MoreHorizontal, Plus, Radio, SlidersHorizontal, X,
  Check, UserPlus, Upload, CheckSquare,
} from "lucide-react";
import { classifyByDays } from "@/lib/prospection";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard, type Accent } from "@/components/ui/surface-card";
import { GroupedList } from "@/components/ui/grouped-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SALESPEOPLE, displayNameFromSlp, normalizeSlp } from "@/lib/salespeople";
import { formatPhoneDisplay } from "@/lib/phone";
import { parisDayOfWeek } from "@/lib/paris-time";
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
  prospectStage?: string | null;
  /** Qualification labo : false = écarté d'office (pas de labo pâtisserie). */
  qualifieLabo?: boolean | null;
  openIncidents: number;
  lastOrderDays: number | null;
  lastCallDays: number | null;
}

const VENDEURS = SALESPEOPLE.map((s) => s.initials); // MM, JMG, AG
const JOURS = ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"];
const JOUR_NUM = [1, 2, 3, 4, 5, 6, 0];

const firstTel = (c: PlanClient) => c.tel1 || c.tel2 || null;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
const typeVariant = (t: string | null) =>
  t === "GMS" ? "gms" : t === "EXPORT" ? "export" : t === "CHR" ? "chr" : "outline";

/** Pastilles des jours d'appel — jour actif en accent, jour courant cerclé. */
function JoursBadges({ joursAppel, today }: { joursAppel: string | null; today: number }) {
  const days = joursAppel ? joursAppel.split(",").map(Number) : [];
  return (
    <div className="inline-flex gap-[2px]">
      {JOUR_NUM.map((d, i) => {
        const on = days.includes(d);
        const isToday = d === today;
        return (
          <span key={d} className={cn(
            "inline-flex h-4 w-[17px] items-center justify-center rounded text-caption2 font-semibold",
            on ? "bg-brand-600 text-white" : "bg-secondary text-muted-foreground/50",
            isToday && "ring-1 ring-offset-1 ring-brand-500 dark:ring-offset-card",
          )}>{JOURS[i]}</span>
        );
      })}
    </div>
  );
}

/** Dernière commande — la couleur code l'urgence (vert / ambre / rouge). */
function LastOrder({ days }: { days: number | null }) {
  if (days == null) return <span className="text-caption font-semibold text-destructive">jamais</span>;
  const color = days >= 30 ? "text-destructive" : days >= 14 ? "text-warning" : "text-success";
  return <span className={cn("text-caption font-semibold tnum", color)}>{days === 0 ? "auj." : `${days} j`}</span>;
}

// ── État des filtres (hors recherche, qui a son propre champ) ────────────────
interface Filters {
  vendeur: string;
  commercial: string;
  type: string;
  active: string;
  stale: string;
  statut: string; // clients | prospects | "" (les deux)
  todayOnly: boolean;
  incidents: boolean;
}
const DEFAULT_FILTERS: Filters = {
  vendeur: "", commercial: "", type: "", active: "", stale: "",
  statut: "clients", todayOnly: false, incidents: false,
};

export function ClientsDirectory({ canManage = true }: { canManage?: boolean }) {
  const [clients, setClients] = useState<PlanClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [restricted, setRestricted] = useState(false);
  const [search, setSearch] = useState("");
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  const setFilter = useCallback(<K extends keyof Filters>(k: K, v: Filters[K]) => {
    setF((cur) => ({ ...cur, [k]: v }));
  }, []);

  const [syncingVendeurs, setSyncingVendeurs] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [reminderClient, setReminderClient] = useState<PlanClient | null>(null);

  // Mode SÉLECTION EN SÉRIE (canManage) : réaffecter un portefeuille ou
  // disqualifier un paquet de magasins d'un coup. Désactivé par défaut pour
  // garder une seule cible de clic par ligne (la fiche).
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const today = parisDayOfWeek();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/plan-appel", { cache: "no-store" });
      const json = await res.json();
      setClients(json.clients ?? []);
      setRestricted(!!json.restricted);
    } catch { setClients([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  /** Assignation unitaire (vendeur / commercial / activation) — optimiste. */
  const assign = useCallback(async (id: string, patch: Partial<Pick<PlanClient, "vendeur" | "commercial" | "activeTelevente">>) => {
    setClients((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    try {
      const r = await fetch(`/api/clients/${id}/assign`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Échec");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec de l'assignation"); fetchData(); }
  }, [fetchData]);

  /** Action EN SÉRIE sur la sélection — une seule requête pour tout le lot. */
  const bulk = useCallback(async (
    patch: Partial<Pick<PlanClient, "vendeur" | "commercial" | "activeTelevente" | "qualifieLabo">>,
    label: string,
  ) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const r = await fetch("/api/clients/bulk-assign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, ...patch }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Échec");
      // `skipped` = comptes hors périmètre, écartés côté serveur. Le taire
      // laisserait croire que tout est passé.
      toast.success(
        `${label} · ${j.updated ?? 0} compte(s)`
        + (j.skipped ? ` — ${j.skipped} ignoré(s) (hors périmètre)` : ""),
      );
      setSelected(new Set());
      fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'action groupée");
    } finally { setBulkBusy(false); }
  }, [selected, fetchData]);

  const syncVendeurs = useCallback(async () => {
    setSyncingVendeurs(true);
    try {
      const res = await fetch("/api/clients/sync-vendeurs", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Échec");
      toast.success(`Vendeurs déduits (${json.updated ?? 0} mis à jour)`);
      fetchData();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Échec"); }
    finally { setSyncingVendeurs(false); }
  }, [fetchData]);

  // Statistiques sur le PORTEFEUILLE complet (ne bougent pas avec les filtres).
  const stats = useMemo(() => {
    let today_ = 0, stale30 = 0, withIncidents = 0, clientsN = 0;
    for (const c of clients) {
      if (classifyByDays(c.lastOrderDays, c.prospectStage, c.type) !== "PROSPECT") clientsN++;
      const days = c.joursAppel ? c.joursAppel.split(",").map(Number) : [];
      if (c.activeTelevente && days.includes(today)) today_++;
      if (c.activeTelevente && (c.lastOrderDays == null || c.lastOrderDays >= 30)) stale30++;
      if (c.openIncidents > 0) withIncidents++;
    }
    return { today: today_, stale30, withIncidents, clientsN };
  }, [clients, today]);

  const filtered = useMemo(() => {
    const q = norm(search.trim());
    const staleN = f.stale ? parseInt(f.stale) : 0;
    return clients.filter((c) => {
      if (q) {
        const hay = norm(`${c.nom} ${c.code} ${c.commercial ?? ""} ${c.vendeur ?? ""}`);
        if (!hay.includes(q)) return false;
      }
      if (f.vendeur && normalizeSlp(c.vendeur ?? "") !== f.vendeur) return false;
      if (f.commercial === "__none__") { if (c.commercial) return false; }
      else if (f.commercial && normalizeSlp(c.commercial ?? "") !== f.commercial) return false;
      if (f.type && c.type !== f.type) return false;
      if (f.active === "actifs" && !c.activeTelevente) return false;
      if (f.active === "inactifs" && c.activeTelevente) return false;
      if (staleN && !(c.lastOrderDays == null || c.lastOrderDays >= staleN)) return false;
      if (f.todayOnly) {
        const days = c.joursAppel ? c.joursAppel.split(",").map(Number) : [];
        if (!days.includes(today)) return false;
      }
      if (f.incidents && c.openIncidents === 0) return false;
      const kind = classifyByDays(c.lastOrderDays, c.prospectStage, c.type);
      if (f.statut === "clients" && kind !== "CLIENT") return false;
      if (f.statut === "prospects" && kind !== "PROSPECT") return false;
      return true;
    }).sort((a, b) => {
      // Actifs d'abord, puis les plus « en retard » (jamais commandé = urgent) en tête.
      if (a.activeTelevente !== b.activeTelevente) return a.activeTelevente ? -1 : 1;
      const da = a.lastOrderDays == null ? Infinity : a.lastOrderDays;
      const db = b.lastOrderDays == null ? Infinity : b.lastOrderDays;
      if (da !== db) return db - da;
      return a.nom.localeCompare(b.nom);
    });
  }, [clients, search, f, today]);

  // La sélection ne survit PAS à un changement de filtre : agir sur des lignes
  // devenues invisibles serait la meilleure façon de réassigner un portefeuille
  // par erreur. On élague sur ce qui reste affiché.
  useEffect(() => {
    setSelected((cur) => {
      if (cur.size === 0) return cur;
      const visible = new Set(filtered.map((c) => c.id));
      const next = new Set([...cur].filter((id) => visible.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [filtered]);

  // Quitter le mode sélection vide toujours la sélection courante.
  const exitSelectMode = useCallback(() => { setSelectMode(false); setSelected(new Set()); }, []);

  const activeChips = useMemo(() => buildChips(f, setFilter), [f, setFilter]);

  return (
    <div className="space-y-4">
      {/* ── ZONE DE PRISE D'INFO : 4 KPI-filtres teintés ────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiFilterTile
          icon={<Users className="h-3.5 w-3.5" />} label="Clients" accent="brand"
          value={loading ? null : stats.clientsN}
          active={f.statut === "clients"}
          onClick={() => setFilter("statut", f.statut === "clients" ? "" : "clients")}
        />
        <KpiFilterTile
          icon={<CalendarClock className="h-3.5 w-3.5" />} label="Programmés aujourd'hui" accent="sky"
          value={loading ? null : stats.today}
          active={f.todayOnly}
          onClick={() => setFilter("todayOnly", !f.todayOnly)}
        />
        <KpiFilterTile
          icon={<PackageX className="h-3.5 w-3.5" />} label="Sans commande ≥ 30 j" accent="rose"
          value={loading ? null : stats.stale30}
          active={f.stale === "30"}
          onClick={() => setFilter("stale", f.stale === "30" ? "" : "30")}
        />
        <KpiFilterTile
          icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Incidents ouverts" accent="amber"
          value={loading ? null : stats.withIncidents}
          active={f.incidents}
          onClick={() => setFilter("incidents", !f.incidents)}
        />
      </div>

      {/* ── Barre : recherche large + Filtres + actions ─────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un client (nom, code, commercial…)" className="pl-9" />
        </div>

        <FiltersPopover f={f} setFilter={setFilter} canManage={canManage} onReset={() => setF(DEFAULT_FILTERS)} />

        <div className="ml-auto flex items-center gap-2">
          {canManage && (
            <AdminMenu
              onSyncVendeurs={syncVendeurs}
              syncing={syncingVendeurs}
              onImport={() => setImportOpen(true)}
              selectMode={selectMode}
              onToggleSelect={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            />
          )}
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/console"><Radio className="h-4 w-4 text-brand-500" /> Console d&apos;appels</Link>
          </Button>
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/clients/new"><Plus className="h-4 w-4" /> Nouveau client</Link>
          </Button>
        </div>
      </div>

      {/* Puces des filtres actifs — relecture + retrait au clic. */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map((chip) => (
            <button key={chip.key} type="button" onClick={chip.clear}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-caption font-medium text-foreground ring-1 ring-border transition-colors hover:bg-secondary/70">
              {chip.label}
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          ))}
          <button type="button" onClick={() => setF(DEFAULT_FILTERS)}
            className="px-1 text-caption font-medium text-muted-foreground hover:text-foreground">
            Tout effacer
          </button>
        </div>
      )}

      {/* ── ZONE DE TRAVAIL : la liste ──────────────────────────────────── */}
      {canManage && selectMode && selected.size > 0 && (
        <BulkBar count={selected.size} busy={bulkBusy} onClear={() => setSelected(new Set())} onBulk={bulk} />
      )}

      {loading ? (
        <ListSkeleton />
      ) : restricted ? (
        <GroupedList>
          <EmptyState
            icon={Users}
            title="Aucun client rattaché à votre compte"
            description="Demandez à un administrateur de vous assigner un portefeuille."
          />
        </GroupedList>
      ) : filtered.length === 0 ? (
        <GroupedList>
          <EmptyState
            icon={Search}
            title="Aucun client pour ces filtres"
            description="Ajustez la recherche ou les filtres ci-dessus."
            action={(search || activeChips.length > 0)
              ? <Button variant="tinted" size="sm" onClick={() => { setSearch(""); setF(DEFAULT_FILTERS); }}>Réinitialiser</Button>
              : undefined}
          />
        </GroupedList>
      ) : (
        <ClientList
          clients={filtered} today={today} canManage={canManage}
          selectMode={selectMode} selected={selected} onSelectedChange={setSelected}
          onAssign={assign} onReminder={setReminderClient}
        />
      )}

      {reminderClient && (
        <ReminderModal
          client={{ id: reminderClient.id, nom: reminderClient.nom, code: reminderClient.code, tel1: reminderClient.tel1, tel2: reminderClient.tel2 }}
          open={!!reminderClient}
          onOpenChange={(o) => { if (!o) setReminderClient(null); }}
          onReminderCreated={() => setReminderClient(null)}
        />
      )}

      {/* Import SAP piloté depuis le menu admin « … » (déclencheur masqué). */}
      {canManage && (
        <ImportModal onImported={fetchData} open={importOpen} onOpenChange={setImportOpen} hideTrigger />
      )}
    </div>
  );
}

/* ─────────────────────────── KPI-filtre teinté ─────────────────────────── */

function KpiFilterTile({
  icon, label, value, accent, active, onClick,
}: {
  icon: React.ReactNode; label: string; value: number | null;
  accent: Accent; active: boolean; onClick: () => void;
}) {
  return (
    <SurfaceCard
      accent={accent}
      tinted
      animate={false}
      className={cn("relative py-3.5", active && "ring-2 ring-inset ring-[color:var(--sc-accent)]")}
    >
      {/* Cible de clic pleine surface : le tuile ENTIER filtre la liste. */}
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={`Filtrer : ${label}`}
        className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className="shrink-0 text-muted-foreground/70">{icon}</span>
        <span className="min-w-0 truncate text-caption font-semibold uppercase tracking-[0.08em] leading-none">{label}</span>
        {active && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-[color:var(--sc-accent)]" />}
      </div>
      {value == null ? (
        <Skeleton className="mt-3 h-7 w-16 rounded-md" />
      ) : (
        <div className="mt-2.5 text-title1 font-bold leading-none tnum text-foreground">{value}</div>
      )}
    </SurfaceCard>
  );
}

/* ─────────────────────────── Popover Filtres ──────────────────────────── */

function FiltersPopover({
  f, setFilter, canManage, onReset,
}: {
  f: Filters; setFilter: <K extends keyof Filters>(k: K, v: Filters[K]) => void;
  canManage: boolean; onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fermeture au clic extérieur / Échap (popover maison : on garde le panneau
  // ouvert pendant qu'on empile plusieurs critères).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const activeCount = countActive(f);

  return (
    <div ref={ref} className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)} className="gap-1.5" aria-expanded={open}>
        <SlidersHorizontal className="h-4 w-4" />
        Filtres
        {activeCount > 0 && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-caption2 font-bold text-primary-foreground tnum">
            {activeCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-3 shadow-lg animate-fade-up motion-reduce:animate-none">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-caption font-semibold uppercase tracking-[0.1em] text-muted-foreground">Filtres</span>
            <button type="button" onClick={onReset} className="text-caption font-medium text-muted-foreground hover:text-foreground">
              Réinitialiser
            </button>
          </div>
          <div className="space-y-3">
            <FilterGroup label="Statut" value={f.statut} onChange={(v) => setFilter("statut", v)}
              options={[["clients", "Clients"], ["prospects", "Prospects"], ["", "Les deux"]]} />
            {canManage && (
              <FilterGroup label="Vendeur" value={f.vendeur} onChange={(v) => setFilter("vendeur", v)}
                options={[["", "Tous"], ...VENDEURS.map((v) => [v, displayNameFromSlp(v) ?? v] as [string, string])]} />
            )}
            <FilterGroup label="Commercial" value={f.commercial} onChange={(v) => setFilter("commercial", v)}
              options={[["", "Tous"], ["__none__", "Non assigné"], ...VENDEURS.map((v) => [v, displayNameFromSlp(v) ?? v] as [string, string])]} />
            <FilterGroup label="Type" value={f.type} onChange={(v) => setFilter("type", v)}
              options={[["", "Tous"], ["GMS", "GMS"], ["CHR", "CHR"], ["EXPORT", "EXPORT"]]} />
            <FilterGroup label="Activation" value={f.active} onChange={(v) => setFilter("active", v)}
              options={[["", "Tous"], ["actifs", "Actifs"], ["inactifs", "À activer"]]} />
            <FilterGroup label="Sans commande depuis" value={f.stale} onChange={(v) => setFilter("stale", v)}
              options={[["", "—"], ["14", "≥ 14 j"], ["30", "≥ 30 j"], ["60", "≥ 60 j"]]} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Un critère = une rangée de pastilles (sélection unique). */
function FilterGroup({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <div className="mb-1 text-caption font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map(([v, l]) => {
          const on = value === v;
          return (
            <button key={v} type="button" onClick={() => onChange(v)}
              className={cn(
                "rounded-md px-2 py-1 text-caption font-medium transition-colors",
                on ? "bg-primary/15 text-foreground ring-1 ring-primary/30" : "bg-secondary text-muted-foreground hover:text-foreground",
              )}>
              {l}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Menu admin « … » ─────────────────────────── */

function AdminMenu({
  onSyncVendeurs, syncing, onImport, selectMode, onToggleSelect,
}: {
  onSyncVendeurs: () => void; syncing: boolean; onImport: () => void;
  selectMode: boolean; onToggleSelect: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="Administration du portefeuille">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-caption2 uppercase tracking-wider text-muted-foreground">Portefeuille</DropdownMenuLabel>
        <DropdownMenuItem onClick={onToggleSelect} className="cursor-pointer gap-2 text-body">
          {selectMode ? <CheckSquare className="h-3.5 w-3.5 text-brand-500" /> : <CheckSquare className="h-3.5 w-3.5" />}
          {selectMode ? "Quitter la sélection" : "Sélection en série"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-caption2 uppercase tracking-wider text-muted-foreground">Données SAP</DropdownMenuLabel>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onSyncVendeurs(); }} disabled={syncing} className="cursor-pointer gap-2 text-body">
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
          Déduire les vendeurs
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onImport(); }} className="cursor-pointer gap-2 text-body">
          <Upload className="h-3.5 w-3.5" />
          Importer des clients (CSV)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ─────────────────────────── La liste ─────────────────────────────────── */

function ClientList({
  clients, today, canManage, selectMode, selected, onSelectedChange, onAssign, onReminder,
}: {
  clients: PlanClient[]; today: number; canManage: boolean;
  selectMode: boolean; selected: Set<string>; onSelectedChange: (next: Set<string>) => void;
  onAssign: (id: string, patch: Partial<Pick<PlanClient, "vendeur" | "commercial" | "activeTelevente">>) => void;
  onReminder: (c: PlanClient) => void;
}) {
  // Ancre pour le Maj+clic (sélection de PLAGE) — praticable sur 200 lignes.
  const [anchor, setAnchor] = useState<string | null>(null);
  const allVisible = clients.length > 0 && clients.every((c) => selected.has(c.id));
  const someVisible = clients.some((c) => selected.has(c.id));

  const toggleAll = () => {
    onSelectedChange(allVisible ? new Set() : new Set(clients.map((c) => c.id)));
    setAnchor(null);
  };
  const toggleOne = (id: string, shift: boolean) => {
    const next = new Set(selected);
    if (shift && anchor) {
      const from = clients.findIndex((c) => c.id === anchor);
      const to = clients.findIndex((c) => c.id === id);
      if (from !== -1 && to !== -1) {
        const [a, b] = from < to ? [from, to] : [to, from];
        const turnOn = !selected.has(id);
        for (let i = a; i <= b; i++) { if (turnOn) next.add(clients[i].id); else next.delete(clients[i].id); }
        onSelectedChange(next);
        setAnchor(id);
        return;
      }
    }
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectedChange(next);
    setAnchor(id);
  };

  return (
    <GroupedList title={`Portefeuille · ${clients.length} client${clients.length > 1 ? "s" : ""}`}>
      {/* En-tête GRIS marqué (zone de travail sobre) — oriente la lecture. */}
      <div className="flex items-center gap-3 bg-secondary/60 px-4 py-2 text-caption2 font-semibold uppercase tracking-wide text-muted-foreground">
        {canManage && selectMode && (
          <input
            type="checkbox"
            checked={allVisible}
            ref={(el) => { if (el) el.indeterminate = someVisible && !allVisible; }}
            onChange={toggleAll}
            aria-label={allVisible ? "Tout désélectionner" : "Tout sélectionner"}
            className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand-500"
          />
        )}
        <span className="min-w-0 flex-1">Client</span>
        <span className="hidden w-[128px] shrink-0 text-left sm:block">Jours d&apos;appel</span>
        <span className="w-16 shrink-0 text-right">Dern. cde</span>
        {canManage && !selectMode && <span className="w-8 shrink-0" aria-hidden />}
      </div>

      {clients.map((c) => (
        <ClientRow
          key={c.id} c={c} today={today} canManage={canManage}
          selectMode={selectMode} selected={selected.has(c.id)}
          onToggle={toggleOne} onAssign={onAssign} onReminder={onReminder}
        />
      ))}
    </GroupedList>
  );
}

function ClientRow({
  c, today, canManage, selectMode, selected, onToggle, onAssign, onReminder,
}: {
  c: PlanClient; today: number; canManage: boolean;
  selectMode: boolean; selected: boolean;
  onToggle: (id: string, shift: boolean) => void;
  onAssign: (id: string, patch: Partial<Pick<PlanClient, "vendeur" | "commercial" | "activeTelevente">>) => void;
  onReminder: (c: PlanClient) => void;
}) {
  const tel = firstTel(c);
  const vNorm = c.vendeur ? normalizeSlp(c.vendeur) : null;
  const cNorm = c.commercial ? normalizeSlp(c.commercial) : null;
  const assignLabel = vNorm ? (displayNameFromSlp(vNorm) ?? vNorm) : cNorm ? (displayNameFromSlp(cNorm) ?? cNorm) : null;

  // Méta ligne 2 : code · vendeur/commercial · téléphone (sobre, muted).
  const meta = (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
      <span className="font-mono tnum">{c.code}</span>
      {assignLabel && (
        <span className="inline-flex items-center gap-1"><UserCheck className="h-3 w-3" />{assignLabel}</span>
      )}
      {tel && <span className="hidden font-mono xs:inline">{formatPhoneDisplay(tel)}</span>}
    </span>
  );

  const nameBlock = (
    <span className="min-w-0 flex-1">
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="truncate text-body font-medium text-foreground">{c.nom}</span>
        {c.type && <Badge variant={typeVariant(c.type)} className="px-1.5 py-0 text-caption2">{c.type}</Badge>}
        {/* Inactif : PAS d'opacité (illisible) — un badge discret suffit. */}
        {!c.activeTelevente && (
          <span className="inline-flex items-center rounded bg-secondary px-1.5 py-px text-caption2 font-semibold uppercase tracking-wide text-muted-foreground ring-1 ring-border">inactif</span>
        )}
        {c.qualifieLabo === false && (
          <span className="inline-flex items-center rounded bg-destructive/12 px-1.5 py-px text-caption2 font-semibold uppercase tracking-wide text-destructive ring-1 ring-destructive/25">non qualifié</span>
        )}
      </span>
      {meta}
    </span>
  );

  // Bloc droit d'info (lecture seule) : jours d'appel · dernière commande · incidents.
  const info = (
    <>
      <span className="hidden w-[128px] shrink-0 sm:block"><JoursBadges joursAppel={c.joursAppel} today={today} /></span>
      <span className="flex w-16 shrink-0 items-center justify-end gap-1">
        <LastOrder days={c.lastOrderDays} />
      </span>
      {c.openIncidents > 0 && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-destructive/12 px-1.5 py-0.5 text-caption2 font-semibold text-destructive ring-1 ring-destructive/25" title="Incidents ouverts">
          <AlertTriangle className="h-3 w-3" />{c.openIncidents}
        </span>
      )}
    </>
  );

  // MODE SÉLECTION : la ligne devient une cible de coche (pas de navigation).
  if (canManage && selectMode) {
    return (
      <div className={cn("flex items-center gap-3 px-4 py-2.5", selected && "bg-brand-500/10")}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => { /* piloté par onClick pour capter Maj */ }}
          onClick={(e) => onToggle(c.id, (e as React.MouseEvent).shiftKey)}
          aria-label={`Sélectionner ${c.nom}`}
          className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand-500"
        />
        {nameBlock}
        {info}
      </div>
    );
  }

  // MODE NORMAL : UNE seule cible de clic (la fiche) + menu « … » d'actions.
  return (
    <div className="group flex items-center">
      <Link
        href={`/clients/${c.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)] hover:bg-secondary/60 focus-visible:bg-secondary/60 focus-visible:outline-none"
      >
        {nameBlock}
        {info}
      </Link>
      {canManage ? (
        <div className="shrink-0 pr-2">
          <ClientActionsMenu c={c} onAssign={onAssign} onReminder={onReminder} />
        </div>
      ) : (
        <span className="w-2 shrink-0" aria-hidden />
      )}
    </div>
  );
}

/** Menu d'actions plan d'appel (console · rappel · activation · assignation). */
function ClientActionsMenu({
  c, onAssign, onReminder,
}: {
  c: PlanClient;
  onAssign: (id: string, patch: Partial<Pick<PlanClient, "vendeur" | "commercial" | "activeTelevente">>) => void;
  onReminder: (c: PlanClient) => void;
}) {
  const vNorm = c.vendeur ? normalizeSlp(c.vendeur) : null;
  const cNorm = c.commercial ? normalizeSlp(c.commercial) : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground" title="Actions" aria-label={`Actions pour ${c.nom}`}>
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild className="cursor-pointer gap-2 text-body">
          <Link href={`/console?open=${encodeURIComponent(c.code)}`}>
            <Radio className="h-3.5 w-3.5" /> Ouvrir dans la console
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onReminder(c)} className="cursor-pointer gap-2 text-body">
          <Bell className="h-3.5 w-3.5" /> Programmer un rappel
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAssign(c.id, { activeTelevente: !c.activeTelevente })} className="cursor-pointer gap-2 text-body">
          <Power className="h-3.5 w-3.5" /> {c.activeTelevente ? "Désactiver en télévente" : "Activer en télévente"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-caption2 uppercase tracking-wider text-muted-foreground">Assigner un vendeur</DropdownMenuLabel>
        {VENDEURS.map((v) => (
          <DropdownMenuItem key={`v-${v}`} onClick={() => onAssign(c.id, { vendeur: v })} className="cursor-pointer gap-2 text-body">
            <span className={cn("h-1.5 w-1.5 rounded-full", vNorm === v ? "bg-brand-500" : "bg-muted-foreground/30")} /> {displayNameFromSlp(v) ?? v}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={() => onAssign(c.id, { vendeur: null })} className="cursor-pointer gap-2 text-body text-muted-foreground">
          Retirer le vendeur
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-caption2 uppercase tracking-wider text-muted-foreground">Assigner un commercial</DropdownMenuLabel>
        {VENDEURS.map((v) => (
          <DropdownMenuItem key={`c-${v}`} onClick={() => onAssign(c.id, { commercial: v })} className="cursor-pointer gap-2 text-body">
            <span className={cn("h-1.5 w-1.5 rounded-full", cNorm === v ? "bg-brand-500" : "bg-muted-foreground/30")} /> {displayNameFromSlp(v) ?? v}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ─────────────────────── Barre d'action en série ──────────────────────── */

function BulkBar({
  count, busy, onClear, onBulk,
}: {
  count: number; busy: boolean; onClear: () => void;
  onBulk: (
    patch: Partial<Pick<PlanClient, "vendeur" | "commercial" | "activeTelevente" | "qualifieLabo">>,
    label: string,
  ) => void;
}) {
  return (
    <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/40 bg-card/95 px-3 py-2 shadow-card backdrop-blur">
      <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-foreground">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" /> : <CheckSquare className="h-3.5 w-3.5 text-brand-500" />}
        {count} sélectionné{count > 1 ? "s" : ""}
      </span>
      <span className="mx-1 h-4 w-px bg-border" />
      <BulkMenu label="Vendeur" icon={<UserCheck className="h-3.5 w-3.5" />} disabled={busy}
        onPick={(v) => onBulk({ vendeur: v }, v ? `Vendeur ${displayNameFromSlp(v) ?? v}` : "Vendeur retiré")} />
      <BulkMenu label="Commercial" icon={<Users className="h-3.5 w-3.5" />} disabled={busy}
        onPick={(v) => onBulk({ commercial: v }, v ? `Commercial ${displayNameFromSlp(v) ?? v}` : "Commercial retiré")} />
      <span className="mx-1 h-4 w-px bg-border" />
      <Button variant="outline" size="sm" disabled={busy} className="h-8 gap-1.5"
        onClick={() => onBulk({ activeTelevente: true }, "Activés en télévente")}>
        <Power className="h-3.5 w-3.5" /> Activer
      </Button>
      <Button variant="outline" size="sm" disabled={busy} className="h-8 gap-1.5"
        onClick={() => onBulk({ activeTelevente: false }, "Désactivés en télévente")}>
        <Power className="h-3.5 w-3.5" /> Désactiver
      </Button>
      <span className="mx-1 h-4 w-px bg-border" />
      <Button variant="outline" size="sm" disabled={busy}
        className="h-8 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
        onClick={() => onBulk({ qualifieLabo: false }, "Marqués non qualifiés")}>
        <UserCheck className="h-3.5 w-3.5" /> Non qualifié
      </Button>
      <Button variant="outline" size="sm" disabled={busy}
        className="h-8 gap-1.5 border-success/40 text-success hover:bg-success/10"
        onClick={() => onBulk({ qualifieLabo: true }, "Marqués qualifiés")}>
        <Check className="h-3.5 w-3.5" /> Qualifié
      </Button>
      <button type="button" onClick={onClear} disabled={busy}
        className="ml-auto text-caption font-medium text-muted-foreground hover:text-foreground">
        Annuler la sélection
      </button>
    </div>
  );
}

function BulkMenu({
  label, icon, disabled, onPick,
}: { label: string; icon: React.ReactNode; disabled: boolean; onPick: (v: string | null) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className="h-8 gap-1.5">
          {icon} {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-caption2 uppercase tracking-wider text-muted-foreground">Affecter · {label}</DropdownMenuLabel>
        {VENDEURS.map((v) => (
          <DropdownMenuItem key={v} onClick={() => onPick(v)} className="cursor-pointer text-body">
            {displayNameFromSlp(v) ?? v}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onPick(null)} className="cursor-pointer text-body text-muted-foreground">
          Retirer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ─────────────────────────── Squelette de liste ───────────────────────── */

function ListSkeleton() {
  return (
    <div role="status" aria-label="Chargement des clients" className="overflow-hidden rounded-xl bg-card ring-1 ring-border shadow-card">
      <div className="bg-secondary/60 px-4 py-2"><Skeleton className="h-3 w-24 rounded" /></div>
      <div className="divide-y divide-border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40 rounded" />
              <Skeleton className="h-3 w-28 rounded" />
            </div>
            <Skeleton className="hidden h-4 w-28 rounded sm:block" />
            <Skeleton className="h-3.5 w-10 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── Puces & compteurs ────────────────────────── */

function countActive(f: Filters): number {
  let n = 0;
  if (f.vendeur) n++;
  if (f.commercial) n++;
  if (f.type) n++;
  if (f.active) n++;
  if (f.stale) n++;
  if (f.statut !== "clients") n++;
  if (f.todayOnly) n++;
  if (f.incidents) n++;
  return n;
}

/** Construit la liste des puces de filtres actifs (label + retrait). */
function buildChips(
  f: Filters,
  setFilter: <K extends keyof Filters>(k: K, v: Filters[K]) => void,
): { key: string; label: string; clear: () => void }[] {
  const chips: { key: string; label: string; clear: () => void }[] = [];
  const staleLabel: Record<string, string> = { "14": "Sans commande ≥ 14 j", "30": "Sans commande ≥ 30 j", "60": "Sans commande ≥ 60 j" };
  const statutLabel: Record<string, string> = { prospects: "Prospects", "": "Clients + prospects" };

  if (f.statut !== "clients") chips.push({ key: "statut", label: statutLabel[f.statut] ?? f.statut, clear: () => setFilter("statut", "clients") });
  if (f.vendeur) chips.push({ key: "vendeur", label: `Vendeur ${displayNameFromSlp(f.vendeur) ?? f.vendeur}`, clear: () => setFilter("vendeur", "") });
  if (f.commercial) chips.push({ key: "commercial", label: f.commercial === "__none__" ? "Sans commercial" : `Commercial ${displayNameFromSlp(f.commercial) ?? f.commercial}`, clear: () => setFilter("commercial", "") });
  if (f.type) chips.push({ key: "type", label: f.type, clear: () => setFilter("type", "") });
  if (f.active) chips.push({ key: "active", label: f.active === "actifs" ? "Actifs" : "À activer", clear: () => setFilter("active", "") });
  if (f.stale) chips.push({ key: "stale", label: staleLabel[f.stale] ?? f.stale, clear: () => setFilter("stale", "") });
  if (f.todayOnly) chips.push({ key: "todayOnly", label: "Programmés aujourd'hui", clear: () => setFilter("todayOnly", false) });
  if (f.incidents) chips.push({ key: "incidents", label: "Avec incident", clear: () => setFilter("incidents", false) });
  return chips;
}
