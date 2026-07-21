"use client";

/**
 * « Clients & plan d'appel » — ANNUAIRE EN CARTES (même grammaire visuelle que la
 * fiche Fournisseurs : grille de cartes propres, lift au survol, pastilles). Il
 * REMPLACE le cockpit tableau historique tout en conservant les leviers de
 * télévente essentiels, portés sur chaque carte :
 *
 *   • assignation VENDEUR / COMMERCIAL (menu par carte) ;
 *   • ACTIVATION télévente (activer / désactiver) ;
 *   • JOURS D'APPEL (badges), DERNIÈRE COMMANDE, INCIDENTS ouverts ;
 *   • programmer un RAPPEL ;
 *   • déduire les vendeurs depuis SAP, importer les clients SAP.
 *
 * Source unique : `/api/plan-appel` (dernière commande SAP réelle, incidents,
 * dernier appel) — on charge tout et on filtre/trie/compte EN MÉMOIRE. La vraie
 * file d'appel priorisée reste la Console (`/console`).
 *
 * `canManage` (faux pour le livreur) masque les leviers d'assignation/admin ; les
 * écritures restent gardées côté API.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Search, Loader2, Users, Phone, ChevronRight, AlertTriangle, PackageX,
  CalendarClock, UserCheck, Bell, Power, MoreHorizontal, UserPlus, Plus, Radio, Target,
} from "lucide-react";
import { classifyByDays } from "@/lib/prospection";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ViewToggle, useViewMode } from "@/components/ui/view-toggle";
import { SALESPEOPLE, displayNameFromSlp, normalizeSlp } from "@/lib/salespeople";
import { formatPhoneDisplay, standardizePhone } from "@/lib/phone";
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

function JoursBadges({ joursAppel, today }: { joursAppel: string | null; today: number }) {
  const days = joursAppel ? joursAppel.split(",").map(Number) : [];
  return (
    <div className="inline-flex gap-[2px]">
      {JOUR_NUM.map((d, i) => {
        const on = days.includes(d);
        const isToday = d === today;
        return (
          <span key={d} className={`inline-flex items-center justify-center h-[16px] w-[17px] text-[9px] font-semibold rounded ${
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

export function ClientsDirectory({ canManage = true }: { canManage?: boolean }) {
  const [clients, setClients] = useState<PlanClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [restricted, setRestricted] = useState(false);
  const [search, setSearch] = useState("");
  const [vendeur, setVendeur] = useState("");
  const [commercial, setCommercial] = useState("");
  const [type, setType] = useState("");
  const [active, setActive] = useState("");
  const [stale, setStale] = useState("");
  const [statut, setStatut] = useState("clients"); // clients | prospects | "" (les deux)
  const [todayOnly, setTodayOnly] = useState(false);
  const [incidents, setIncidents] = useState(false);
  const [syncingVendeurs, setSyncingVendeurs] = useState(false);
  const [reminderClient, setReminderClient] = useState<PlanClient | null>(null);
  const [view, setView] = useViewMode("televent-clients-view");

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
    let total = 0, todayCount = 0, stale30 = 0, withIncidents = 0, noVendeur = 0, clientsN = 0, prospectsN = 0;
    for (const c of clients) {
      total++;
      if (classifyByDays(c.lastOrderDays, c.prospectStage) === "PROSPECT") prospectsN++; else clientsN++;
      const days = c.joursAppel ? c.joursAppel.split(",").map(Number) : [];
      if (c.activeTelevente && days.includes(today)) todayCount++;
      if (c.activeTelevente && (c.lastOrderDays == null || c.lastOrderDays >= 30)) stale30++;
      if (c.openIncidents > 0) withIncidents++;
      if (c.activeTelevente && !c.vendeur) noVendeur++;
    }
    return { total, today: todayCount, stale30, withIncidents, noVendeur, clientsN, prospectsN };
  }, [clients, today]);

  const filtered = useMemo(() => {
    const q = norm(search.trim());
    const staleN = stale ? parseInt(stale) : 0;
    return clients.filter((c) => {
      if (q) {
        const hay = norm(`${c.nom} ${c.code} ${c.commercial ?? ""} ${c.vendeur ?? ""}`);
        if (!hay.includes(q)) return false;
      }
      if (vendeur && normalizeSlp(c.vendeur ?? "") !== vendeur) return false;
      if (commercial === "__none__") { if (c.commercial) return false; }
      else if (commercial && normalizeSlp(c.commercial ?? "") !== commercial) return false;
      if (type && c.type !== type) return false;
      if (active === "actifs" && !c.activeTelevente) return false;
      if (active === "inactifs" && c.activeTelevente) return false;
      if (staleN && !(c.lastOrderDays == null || c.lastOrderDays >= staleN)) return false;
      if (todayOnly) {
        const days = c.joursAppel ? c.joursAppel.split(",").map(Number) : [];
        if (!days.includes(today)) return false;
      }
      if (incidents && c.openIncidents === 0) return false;
      const kind = classifyByDays(c.lastOrderDays, c.prospectStage);
      if (statut === "clients" && kind !== "CLIENT") return false;
      if (statut === "prospects" && kind !== "PROSPECT") return false;
      return true;
    }).sort((a, b) => {
      // Actifs d'abord, puis les plus « en retard » (jamais commandé = urgent) en tête.
      if (a.activeTelevente !== b.activeTelevente) return a.activeTelevente ? -1 : 1;
      const da = a.lastOrderDays == null ? Infinity : a.lastOrderDays;
      const db = b.lastOrderDays == null ? Infinity : b.lastOrderDays;
      if (da !== db) return db - da;
      return a.nom.localeCompare(b.nom);
    });
  }, [clients, search, vendeur, commercial, type, active, stale, statut, todayOnly, incidents, today]);

  return (
    <div className="space-y-4">
      {/* Cartes synthèse — cliquables = filtres rapides. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard icon={Users} label="Clients" value={stats.clientsN} tone="brand"
          onClick={() => setStatut(statut === "clients" ? "" : "clients")} active={statut === "clients"} />
        <StatCard icon={Target} label="Prospects" value={stats.prospectsN} tone="violet"
          onClick={() => setStatut(statut === "prospects" ? "" : "prospects")} active={statut === "prospects"} />
        <StatCard icon={CalendarClock} label="Programmés auj." value={stats.today} tone="sky"
          onClick={() => setTodayOnly((v) => !v)} active={todayOnly} />
        <StatCard icon={PackageX} label="Sans cde ≥ 30 j" value={stats.stale30} tone="rose"
          onClick={() => setStale(stale === "30" ? "" : "30")} active={stale === "30"} />
        <StatCard icon={AlertTriangle} label="Avec incident" value={stats.withIncidents} tone="amber"
          onClick={() => setIncidents((v) => !v)} active={incidents} />
        {canManage && <StatCard icon={UserCheck} label="Sans vendeur" value={stats.noVendeur} tone="violet" />}
      </div>

      {/* Filtres + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher (nom, code, commercial…)" className="pl-9" />
        </div>
        {canManage && <FilterSelect value={vendeur} onChange={setVendeur} placeholder="Vendeur" options={[["", "Tous vendeurs"], ...VENDEURS.map((v) => [v, displayNameFromSlp(v) ?? v] as [string, string])]} />}
        <FilterSelect value={commercial} onChange={setCommercial} placeholder="Commercial"
          options={[["", "Tous commerciaux"], ["__none__", "Non assigné"], ...VENDEURS.map((v) => [v, displayNameFromSlp(v) ?? v] as [string, string])]} />
        <FilterSelect value={type} onChange={setType} placeholder="Type" options={[["", "Tous types"], ["GMS", "GMS"], ["EXPORT", "EXPORT"], ["CHR", "CHR"]]} />
        <FilterSelect value={active} onChange={setActive} placeholder="Activation" options={[["", "Actif + inactif"], ["actifs", "Actifs"], ["inactifs", "À activer"]]} />
        <FilterSelect value={stale} onChange={setStale} placeholder="Sans cde depuis" options={[["", "Toute ancienneté"], ["14", "Sans cde ≥ 14 j"], ["30", "Sans cde ≥ 30 j"], ["60", "Sans cde ≥ 60 j"]]} />
        <FilterSelect value={statut} onChange={setStatut} placeholder="Statut" options={[["clients", "Clients"], ["prospects", "Prospects"], ["", "Clients + prospects"]]} />
        {statut === "prospects" && (
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/prospection"><Target className="h-4 w-4 text-brand-500" /> Pipeline</Link>
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          {canManage && (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/console"><Radio className="h-4 w-4 text-brand-500" /> Console d&apos;appels</Link>
            </Button>
          )}
          {canManage && (
            <>
              <Button variant="outline" size="sm" onClick={syncVendeurs} disabled={syncingVendeurs} className="hidden lg:inline-flex gap-1">
                {syncingVendeurs ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Déduire vendeurs
              </Button>
              <span className="hidden lg:block"><ImportModal onImported={fetchData} /></span>
            </>
          )}
          <Button asChild size="sm" className="gap-1">
            <Link href="/clients/new"><Plus className="h-4 w-4" /> Nouveau client</Link>
          </Button>
        </div>
      </div>

      {/* Grille de cartes */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : restricted ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-[14px] font-medium text-foreground">Aucun client rattaché à votre compte</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">Demandez à un administrateur de vous assigner un portefeuille.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-[14px] font-medium text-foreground">Aucun client pour ces filtres</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">Ajustez la recherche ou les filtres ci-dessus.</p>
        </div>
      ) : view === "cards" ? (
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <ClientCard
              key={c.id}
              c={c}
              today={today}
              canManage={canManage}
              onAssign={assign}
              onReminder={setReminderClient}
            />
          ))}
        </ul>
      ) : (
        <ClientListView clients={filtered} today={today} canManage={canManage} onAssign={assign} onReminder={setReminderClient} />
      )}

      {reminderClient && (
        <ReminderModal
          client={{ id: reminderClient.id, nom: reminderClient.nom, code: reminderClient.code, tel1: reminderClient.tel1, tel2: reminderClient.tel2 }}
          open={!!reminderClient}
          onOpenChange={(o) => { if (!o) setReminderClient(null); }}
          onReminderCreated={() => setReminderClient(null)}
        />
      )}
    </div>
  );
}

function ClientCard({
  c, today, canManage, onAssign, onReminder,
}: {
  c: PlanClient; today: number; canManage: boolean;
  onAssign: (id: string, patch: Partial<Pick<PlanClient, "vendeur" | "commercial" | "activeTelevente">>) => void;
  onReminder: (c: PlanClient) => void;
}) {
  const tel = firstTel(c);
  const telHref = tel ? standardizePhone(tel) || null : null;
  const vNorm = c.vendeur ? normalizeSlp(c.vendeur) : null;
  const cNorm = c.commercial ? normalizeSlp(c.commercial) : null;

  return (
    <li className={`group relative flex h-full flex-col rounded-2xl border border-border bg-card p-4 shadow-card transition-all duration-200 hover:-translate-y-px hover:shadow-card-hover hover:border-brand-400/50 ${!c.activeTelevente ? "opacity-70" : ""}`}>
      {/* En-tête cliquable → fiche */}
      <div className="flex items-start justify-between gap-2">
        <Link href={`/console?open=${encodeURIComponent(c.code)}`} title="Ouvrir dans la console d'appels" className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="truncate text-[14.5px] font-semibold text-foreground group-hover:text-brand-600">{c.nom}</p>
            {!c.activeTelevente && <span className="text-[9px] font-bold uppercase text-amber-600 dark:text-amber-400">inactif</span>}
          </div>
          <p className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">{c.code}</p>
        </Link>
        <div className="flex items-center gap-1 shrink-0">
          {canManage && <ClientActionsMenu c={c} onAssign={onAssign} onReminder={onReminder} />}
          <Link href={`/clients/${c.id}`} className="h-7 w-7 inline-flex items-center justify-center" aria-label="Ouvrir la fiche">
            <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500" />
          </Link>
        </div>
      </div>

      {/* Badges type / assignation */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {c.type && <Badge variant={typeVariant(c.type)} className="text-[10px]">{c.type}</Badge>}
        {vNorm && (
          <span className="inline-flex items-center gap-1 rounded-md bg-brand-500/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-brand-700 ring-1 ring-brand-500/20 dark:text-brand-300" title="Vendeur">
            <UserCheck className="h-3 w-3" /> {displayNameFromSlp(vNorm) ?? vNorm}
          </span>
        )}
        {cNorm && (
          <span className="inline-flex items-center gap-1 rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-violet-700 ring-1 ring-violet-500/20 dark:text-violet-300" title="Commercial">
            <Users className="h-3 w-3" /> {displayNameFromSlp(cNorm) ?? cNorm}
          </span>
        )}
        {canManage && c.activeTelevente && !vNorm && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-300">
            sans vendeur
          </span>
        )}
      </div>

      {/* Contact + jours d'appel */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {tel ? (
          <a href={telHref ? `tel:${telHref}` : undefined} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-brand-600">
            <Phone className="h-3 w-3" /> <span className="font-mono">{formatPhoneDisplay(tel)}</span>
          </a>
        ) : <span className="text-[12px] text-muted-foreground/50">Pas de téléphone</span>}
        <JoursBadges joursAppel={c.joursAppel} today={today} />
      </div>

      {/* Pied : dernière commande + incidents */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <PackageX className="h-3 w-3" /> Dernière cde <LastOrder days={c.lastOrderDays} />
        </span>
        <div className="flex items-center gap-2">
          {c.openIncidents > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-rose-700 ring-1 ring-rose-500/25 dark:text-rose-300" title="Incidents ouverts">
              <AlertTriangle className="h-3 w-3" /> {c.openIncidents}
            </span>
          )}
          {canManage && (
            <button type="button" onClick={() => onReminder(c)} title="Programmer un rappel"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 hover:text-brand-600 hover:bg-secondary/60">
              <Bell className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** Menu d'actions plan d'appel (rappel · activation · assignation), partagé
 *  entre la carte et la ligne de liste. */
function ClientActionsMenu({
  c, onAssign, onReminder, align = "end",
}: {
  c: PlanClient;
  onAssign: (id: string, patch: Partial<Pick<PlanClient, "vendeur" | "commercial" | "activeTelevente">>) => void;
  onReminder: (c: PlanClient) => void;
  align?: "end" | "start";
}) {
  const vNorm = c.vendeur ? normalizeSlp(c.vendeur) : null;
  const cNorm = c.commercial ? normalizeSlp(c.commercial) : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-secondary/60" title="Actions">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Plan d&apos;appel</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onReminder(c)} className="cursor-pointer text-[13px] gap-2">
          <Bell className="h-3.5 w-3.5" /> Programmer un rappel
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAssign(c.id, { activeTelevente: !c.activeTelevente })} className="cursor-pointer text-[13px] gap-2">
          <Power className="h-3.5 w-3.5" /> {c.activeTelevente ? "Désactiver en télévente" : "Activer en télévente"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Assigner un vendeur</DropdownMenuLabel>
        {VENDEURS.map((v) => (
          <DropdownMenuItem key={`v-${v}`} onClick={() => onAssign(c.id, { vendeur: v })} className="cursor-pointer text-[13px] gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${vNorm === v ? "bg-brand-500" : "bg-muted-foreground/30"}`} /> {displayNameFromSlp(v) ?? v}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={() => onAssign(c.id, { vendeur: null })} className="cursor-pointer text-[13px] gap-2 text-muted-foreground">
          Retirer le vendeur
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Assigner un commercial</DropdownMenuLabel>
        {VENDEURS.map((v) => (
          <DropdownMenuItem key={`c-${v}`} onClick={() => onAssign(c.id, { commercial: v })} className="cursor-pointer text-[13px] gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${cNorm === v ? "bg-brand-500" : "bg-muted-foreground/30"}`} /> {displayNameFromSlp(v) ?? v}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Vue LISTE classique (tableau compact) du portefeuille clients. */
function ClientListView({
  clients, today, canManage, onAssign, onReminder,
}: {
  clients: PlanClient[]; today: number; canManage: boolean;
  onAssign: (id: string, patch: Partial<Pick<PlanClient, "vendeur" | "commercial" | "activeTelevente">>) => void;
  onReminder: (c: PlanClient) => void;
}) {
  const dash = <span className="text-muted-foreground/40">—</span>;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5 text-left font-semibold">Client</th>
              <th className="px-3 py-2.5 text-left font-semibold">Type</th>
              {canManage && <th className="px-3 py-2.5 text-left font-semibold">Vendeur</th>}
              <th className="px-3 py-2.5 text-left font-semibold">Commercial</th>
              <th className="px-3 py-2.5 text-left font-semibold">Téléphone</th>
              <th className="px-3 py-2.5 text-left font-semibold">Jours d&apos;appel</th>
              <th className="px-3 py-2.5 text-right font-semibold">Dernière cde</th>
              <th className="px-3 py-2.5 text-center font-semibold">Inc.</th>
              {canManage && <th className="px-3 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {clients.map((c) => {
              const tel = firstTel(c);
              const vNorm = c.vendeur ? normalizeSlp(c.vendeur) : null;
              const cNorm = c.commercial ? normalizeSlp(c.commercial) : null;
              return (
                <tr key={c.id} className={`transition-colors hover:bg-secondary/30 ${!c.activeTelevente ? "opacity-60" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Link href={`/console?open=${encodeURIComponent(c.code)}`} title="Ouvrir dans la console d'appels" className="font-semibold text-foreground hover:text-brand-600 hover:underline underline-offset-2">{c.nom}</Link>
                      {!c.activeTelevente && <span className="text-[9px] font-bold uppercase text-amber-600 dark:text-amber-400">inactif</span>}
                    </div>
                    <span className="font-mono text-[10.5px] text-muted-foreground">{c.code}</span>
                  </td>
                  <td className="px-3 py-2">{c.type ? <Badge variant={typeVariant(c.type)} className="text-[9.5px]">{c.type}</Badge> : dash}</td>
                  {canManage && <td className="px-3 py-2">{vNorm ? (displayNameFromSlp(vNorm) ?? vNorm) : dash}</td>}
                  <td className="px-3 py-2">{cNorm ? (displayNameFromSlp(cNorm) ?? cNorm) : dash}</td>
                  <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground">{tel ? formatPhoneDisplay(tel) : dash}</td>
                  <td className="px-3 py-2"><JoursBadges joursAppel={c.joursAppel} today={today} /></td>
                  <td className="px-3 py-2 text-right"><LastOrder days={c.lastOrderDays} /></td>
                  <td className="px-3 py-2 text-center">
                    {c.openIncidents > 0
                      ? <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-rose-700 ring-1 ring-rose-500/25 dark:text-rose-300"><AlertTriangle className="h-3 w-3" /> {c.openIncidents}</span>
                      : dash}
                  </td>
                  {canManage && (
                    <td className="px-3 py-2 text-right">
                      <ClientActionsMenu c={c} onAssign={onAssign} onReminder={onReminder} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
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
