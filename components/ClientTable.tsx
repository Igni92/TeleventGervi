"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Search,
  Plus,
  Pencil,
  ChevronLeft,
  ChevronRight,
  Users,
  Loader2,
  Phone,
  CalendarClock,
  ChevronUp,
  ChevronDown,
  MoreHorizontal,
  Bell,
  ExternalLink,
  UserPlus,
  X,
  Check,
  AlertTriangle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReminderModal } from "@/components/ReminderModal";
import { ImportModal } from "@/components/ImportModal";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/utils";
import { SALESPEOPLE, displayNameFromSlp } from "@/lib/salespeople";
import { standardizePhone, formatPhoneDisplay } from "@/lib/phone";

interface Client {
  id: string;
  code: string;
  nom: string;
  type?: string | null;
  commercial?: string | null;
  tel1?: string | null;
  tel2?: string | null;
  tel3?: string | null;
  notes?: string | null;
  joursAppel?: string | null;
  derniereCommande?: string | Date | null;
  activeTelevente?: boolean;
  vendeur?: string | null;
  _count?: { rappels: number; appels: number };
  appels?: { id: string; type: string; heureAppel: string }[];
}

interface ClientsResponse {
  clients: Client[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const typeBadgeVariant: Record<string, "export" | "gms" | "chr"> = {
  EXPORT: "export",
  GMS: "gms",
  CHR: "chr",
};

// 2-letter labels (avoids Mar/Mer ambiguity) — compact, always fits on one line
const JOURS_LABELS: Record<number, string> = {
  0: "Di",
  1: "Lu",
  2: "Ma",
  3: "Me",
  4: "Je",
  5: "Ve",
  6: "Sa",
};

function JoursBadges({ joursAppel }: { joursAppel?: string | null }) {
  if (!joursAppel) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  const days = joursAppel.split(",").map(Number).filter((n) => !isNaN(n));
  const ordered = [1, 2, 3, 4, 5, 6, 0];
  // Show all 7 day-slots; highlight active ones, gray out inactive
  return (
    <div className="inline-flex gap-[2px] whitespace-nowrap">
      {ordered.map((d) => {
        const on = days.includes(d);
        return (
          <span
            key={d}
            className={`inline-flex items-center justify-center h-[18px] w-[20px] text-[10px] font-semibold rounded tnum tracking-tight ${
              on
                ? "bg-brand-600 text-white"
                : "bg-secondary text-muted-foreground/70"
            }`}
            title={["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"][d]}
          >
            {JOURS_LABELS[d]}
          </span>
        );
      })}
    </div>
  );
}

type TabType = "tous" | "aujourdhui";
type SortKey = "code" | "nom" | "type" | "commercial" | "tel1" | "tel2" | "derniereCommande" | "joursAppel";
type SortDir = "asc" | "desc";

export function ClientTable() {
  const router = useRouter();
  const [tab, setTab] = useState<TabType>("tous");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [commercialFilter, setCommercialFilter] = useState("ALL");
  const [activeFilter, setActiveFilter] = useState("ALL"); // ALL | actifs | inactifs
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ClientsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("nom");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [syncingVendeurs, setSyncingVendeurs] = useState(false);

  // Reset selection when data changes (new page, filter, tab)
  useEffect(() => { setSelectedIds(new Set()); }, [tab, typeFilter, commercialFilter, activeFilter, page]);

  const toggleOne = (id: string) => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((cur) => {
      const visible = (data?.clients ?? []).map((c) => c.id);
      const allSelected = visible.length > 0 && visible.every((id) => cur.has(id));
      if (allSelected) {
        const next = new Set(cur);
        visible.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...Array.from(cur), ...visible]);
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const syncVendeurs = async () => {
    setSyncingVendeurs(true);
    try {
      const res = await fetch("/api/clients/sync-vendeurs", { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error();
      toast.success(`Vendeurs déduits du dernier BL — ${j.updated} client(s) mis à jour`);
      fetchClients();
    } catch {
      toast.error("Erreur lors de la déduction des vendeurs");
    } finally {
      setSyncingVendeurs(false);
    }
  };

  const bulkAssignCommercial = async (commercial: string | null) => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const res = await fetch("/api/clients/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientIds: Array.from(selectedIds),
          action: "assignCommercial",
          value: commercial,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success(
        commercial
          ? `${data.affected} client${data.affected > 1 ? "s" : ""} assigné${data.affected > 1 ? "s" : ""} à ${commercial}`
          : `${data.affected} client${data.affected > 1 ? "s" : ""} sans commercial`,
      );
      clearSelection();
      fetchClients();
    } catch {
      toast.error("Erreur lors de l'assignation");
    } finally {
      setBulkLoading(false);
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Sorted client list (client-side, on current page)
  const sortedClients = useMemo(() => {
    if (!data?.clients) return [];
    const arr = [...data.clients];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const va = (a as unknown as Record<string, unknown>)[sortKey];
      const vb = (b as unknown as Record<string, unknown>)[sortKey];
      // Nullish goes to bottom regardless of direction
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      // Dates / ISO strings — sort numerically
      if (sortKey === "derniereCommande") {
        return (new Date(va as string).getTime() - new Date(vb as string).getTime()) * dir;
      }
      // String compare
      return String(va).localeCompare(String(vb), "fr", { numeric: true }) * dir;
    });
    return arr;
  }, [data, sortKey, sortDir]);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
      });
      if (search) params.set("search", search);
      if (typeFilter !== "ALL") params.set("type", typeFilter);
      if (commercialFilter !== "ALL") params.set("commercial", commercialFilter);
      if (activeFilter !== "ALL") params.set("active", activeFilter);
      if (tab === "aujourdhui") params.set("aujourdhui", "true");

      const res = await fetch(`/api/clients?${params}`);
      if (!res.ok) throw new Error("Erreur de chargement");
      const json = await res.json();
      setData(json);
    } catch {
      toast.error("Erreur lors du chargement des clients");
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter, commercialFilter, activeFilter, tab, page]);

  // Reset page and fetch on tab change
  useEffect(() => {
    setPage(1);
    setData(null);
  }, [tab]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchClients();
    }, 300);
    return () => clearTimeout(timer);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPage(1);
    fetchClients();
  }, [typeFilter, commercialFilter, activeFilter, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchClients();
  }, [page, fetchClients]);

  const isAujourdhui = tab === "aujourdhui";

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800/60 rounded-xl w-fit">
        {([
          { id: "tous",        label: "Tous les clients",       icon: Users },
          { id: "aujourdhui",  label: "À appeler aujourd'hui",  icon: Phone },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-150 ${
              tab === id
                ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-xs ring-1 ring-slate-900/[0.04] dark:ring-white/[0.08]"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Search */}
        <div className="relative w-full lg:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            placeholder="Rechercher par code, nom, commercial..."
            aria-label="Rechercher un client par code, nom ou commercial"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {/* Filtres — pleine largeur empilés en mobile, fixes en desktop */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            {/* Type filter */}
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-[130px]" aria-label="Filtrer par type de client">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tous les types</SelectItem>
                <SelectItem value="EXPORT">EXPORT</SelectItem>
                <SelectItem value="GMS">GMS</SelectItem>
                <SelectItem value="CHR">CHR</SelectItem>
              </SelectContent>
            </Select>

            {/* Commercial filter (commercial assigné) */}
            <Select value={commercialFilter} onValueChange={setCommercialFilter}>
              <SelectTrigger className="w-full sm:w-[150px]" aria-label="Filtrer par commercial assigné">
                <SelectValue placeholder="Commercial" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tous commerciaux</SelectItem>
                {SALESPEOPLE.map((s) => (
                  <SelectItem key={s.initials} value={s.initials}>{s.initials}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Activation filter (pleine largeur sur sa ligne en mobile) */}
            <Select value={activeFilter} onValueChange={setActiveFilter}>
              <SelectTrigger className="col-span-2 w-full sm:col-span-1 sm:w-[140px]" aria-label="Filtrer par état d'activation en télévente">
                <SelectValue placeholder="Activation" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tous (actif/inactif)</SelectItem>
                <SelectItem value="actifs">Actifs</SelectItem>
                <SelectItem value="inactifs">À activer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Actions — outils d'admin masqués sur mobile (déduction vendeurs, import CSV) */}
          <div className="flex gap-2 flex-wrap">
            {/* Déduire les vendeurs depuis le dernier BL SAP */}
            <Button variant="outline" size="sm" onClick={syncVendeurs} disabled={syncingVendeurs} className="hidden sm:inline-flex flex-none gap-1">
              {syncingVendeurs ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Déduire vendeurs
            </Button>

            {/* Import CSV */}
            <span className="hidden sm:block">
              <ImportModal onImported={fetchClients} />
            </span>

            {/* New client */}
            <Button
              onClick={() => router.push("/clients/new")}
              className="flex-1 sm:flex-none gap-1"
            >
              <Plus className="h-4 w-4" />
              Nouveau client
            </Button>
          </div>
        </div>
      </div>

      {/* Bulk action bar — shown when selection is active */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          onAssignCommercial={bulkAssignCommercial}
          onClear={clearSelection}
          loading={bulkLoading}
        />
      )}

      {/* Counter */}
      {data && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {isAujourdhui ? (
            <CalendarClock className="h-4 w-4" />
          ) : (
            <Users className="h-4 w-4" />
          )}
          <span>
            <span className="font-semibold text-foreground tnum"><AnimatedNumber value={data.total} /></span>
            {" "}client{data.total !== 1 ? "s" : ""}
            {isAujourdhui ? " à appeler aujourd'hui" : " au total"}
          </span>
        </div>
      )}

      {/* Mobile : liste de cartes (nom + appel direct, actions au kebab) */}
      <div className="md:hidden space-y-2.5">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-secondary/40 animate-pulse" />
          ))
        ) : !sortedClients.length ? (
          <p className="text-center text-muted-foreground py-10 text-[15px]">
            {isAujourdhui ? "Aucun client à appeler aujourd'hui 🎉" : "Aucun client trouvé"}
          </p>
        ) : (
          sortedClients.map((client) => {
            const telRaw = client.tel2 || client.tel1 || client.tel3 || null;
            const telHref = telRaw ? standardizePhone(telRaw) || null : null;
            const tel = telRaw ? formatPhoneDisplay(telRaw) : null;
            return (
              <div key={client.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/clients/${client.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[16px] font-semibold text-foreground leading-tight">{client.nom}</span>
                      {client.type && (
                        <Badge variant={typeBadgeVariant[client.type] || "outline"}>{client.type}</Badge>
                      )}
                      {client.activeTelevente === false && (
                        <span className="inline-flex h-[18px] items-center px-1.5 rounded text-[11px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                          à activer
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] font-mono text-muted-foreground mt-1">
                      {client.code}{client.commercial ? ` · ${displayNameFromSlp(client.commercial)}` : ""}
                    </div>
                  </Link>
                  <ClientRowMenu client={client} onReminderCreated={fetchClients} />
                </div>
                <div className="flex items-center justify-between gap-2 mt-3">
                  {telHref ? (
                    <a
                      href={`tel:${telHref}`}
                      className="inline-flex items-center gap-2 h-10 px-3 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[15px] font-semibold tnum active:scale-[0.97]"
                    >
                      <Phone className="h-4 w-4" /> {tel}
                    </a>
                  ) : (
                    <span className="text-[13px] text-muted-foreground">Pas de téléphone</span>
                  )}
                  {client.derniereCommande ? (
                    <span className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
                      {formatRelative(client.derniereCommande)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center shrink-0 px-2 h-6 rounded-md text-[11px] font-bold uppercase tracking-wide bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/40">
                      New
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Table (desktop) — défile dans le tableau (en-tête figé) */}
      <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
        <Table containerClassName="max-h-[68vh]">
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="bg-slate-50 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-700/50 [&>th]:bg-slate-50 dark:[&>th]:bg-slate-800">
              <TableHead scope="col" className="w-9 px-3 py-3">
                <SelectAllCheckbox
                  visibleIds={(data?.clients ?? []).map((c) => c.id)}
                  selectedIds={selectedIds}
                  onToggle={toggleAllVisible}
                />
              </TableHead>
              <SortableHead label="Code"        skey="code"             sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Nom"         skey="nom"              sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Type"        skey="type"             sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Commercial"  skey="commercial"       sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Standard"    skey="tel1"             sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Direct 1"    skey="tel2"             sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Dernière cde" skey="derniereCommande" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              {!isAujourdhui && (
                <SortableHead label="Jours d'appel" skey="joursAppel"  sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              )}
              <TableHead scope="col" className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-4 py-3 text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <>
                <TableRow className="sr-only">
                  <TableCell colSpan={isAujourdhui ? 9 : 10} role="status">
                    Chargement des clients…
                  </TableCell>
                </TableRow>
                {Array.from({ length: 8 }).map((_, i) => (
                  <ClientRowSkeleton key={i} withJours={!isAujourdhui} />
                ))}
              </>
            ) : !sortedClients.length ? (
              <TableRow>
                <TableCell
                  colSpan={isAujourdhui ? 9 : 10}
                  className="h-32 text-center text-muted-foreground"
                >
                  {isAujourdhui
                    ? "Aucun client à appeler aujourd'hui 🎉"
                    : "Aucun client trouvé"}
                </TableCell>
              </TableRow>
            ) : (
              sortedClients.map((client) => {
                const isSelected = selectedIds.has(client.id);
                return (
                <TableRow
                  key={client.id}
                  className={`border-b border-slate-100/80 dark:border-slate-700/40 transition-colors ${
                    isSelected
                      ? "bg-brand-50/60 dark:bg-brand-950/30"
                      : "hover:bg-slate-50/60 dark:hover:bg-white/[0.025]"
                  }`}
                >
                  <TableCell className="w-9 px-3 py-3">
                    <RowCheckbox checked={isSelected} onChange={() => toggleOne(client.id)} />
                  </TableCell>
                  <TableCell className="px-4 py-3 font-mono text-[12.5px] font-semibold text-slate-600 dark:text-slate-300">
                    {client.code}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-[13px] font-semibold text-slate-800 dark:text-slate-100 min-w-[180px]">
                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                      {client.nom}
                      {client.activeTelevente === false && (
                        <span className="inline-flex h-[17px] items-center px-1.5 rounded text-[9.5px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                          à activer
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    {client.type ? (
                      <Badge variant={typeBadgeVariant[client.type] || "outline"}>
                        {client.type}
                      </Badge>
                    ) : (
                      <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-[12.5px] text-slate-600 dark:text-slate-300">
                    <div>{displayNameFromSlp(client.commercial) || <span className="text-slate-300 dark:text-slate-600">—</span>}</div>
                    {client.vendeur && client.vendeur !== client.commercial && (
                      <div className="text-[10.5px] text-muted-foreground">vend. {displayNameFromSlp(client.vendeur)}</div>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3 font-mono text-[12px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {client.tel1 ? formatPhoneDisplay(client.tel1) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                  </TableCell>
                  <TableCell className="px-4 py-3 font-mono text-[12px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {client.tel2 ? formatPhoneDisplay(client.tel2) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                  </TableCell>
                  <TableCell className="px-4 py-3 whitespace-nowrap">
                    {client.derniereCommande ? (
                      <span className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">
                        {formatRelative(client.derniereCommande)}
                      </span>
                    ) : (
                      <span className="text-slate-300 dark:text-slate-600 text-[12px]">—</span>
                    )}
                  </TableCell>
                  {!isAujourdhui && (
                    <TableCell className="px-4 py-3 whitespace-nowrap">
                      <JoursBadges joursAppel={client.joursAppel} />
                    </TableCell>
                  )}
                  <TableCell className="text-right whitespace-nowrap px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <ClientRowMenu
                        client={client}
                        onReminderCreated={fetchClients}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Pagination des clients">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Page {data.page} sur {data.totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              aria-label="Page précédente"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page >= data.totalPages || loading}
              aria-label="Page suivante"
            >
              Suivant
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}

/* ── Ligne squelette (état de chargement) ───────────────── */
function ClientRowSkeleton({ withJours }: { withJours: boolean }) {
  return (
    <TableRow aria-hidden className="border-b border-slate-100/80 dark:border-slate-700/40">
      <TableCell className="w-9 px-3 py-3"><Skeleton className="h-4 w-4 rounded" /></TableCell>
      <TableCell className="px-4 py-3"><Skeleton className="h-3.5 w-14" /></TableCell>
      <TableCell className="px-4 py-3"><Skeleton className="h-3.5 w-40" /></TableCell>
      <TableCell className="px-4 py-3"><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
      <TableCell className="px-4 py-3"><Skeleton className="h-3.5 w-10" /></TableCell>
      <TableCell className="px-4 py-3"><Skeleton className="h-3.5 w-24" /></TableCell>
      <TableCell className="px-4 py-3"><Skeleton className="h-3.5 w-24" /></TableCell>
      <TableCell className="px-4 py-3"><Skeleton className="h-3.5 w-16" /></TableCell>
      {withJours && (
        <TableCell className="px-4 py-3"><Skeleton className="h-[18px] w-[150px] rounded" /></TableCell>
      )}
      <TableCell className="px-4 py-3">
        <div className="flex justify-end"><Skeleton className="h-8 w-8 rounded-md" /></div>
      </TableCell>
    </TableRow>
  );
}

/* ── Selection checkboxes ────────────────────────────────── */
function RowCheckbox({
  checked, onChange,
}: { checked: boolean; onChange: () => void }) {
  return (
    <label className="inline-flex items-center justify-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="sr-only peer"
      />
      <span className={`h-4 w-4 rounded border transition-all ${
        checked
          ? "bg-brand-600 border-brand-600"
          : "bg-card border-slate-300 dark:border-slate-600 hover:border-brand-500"
      } peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-1 dark:peer-focus-visible:ring-offset-card`}>
        {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
      </span>
    </label>
  );
}

function SelectAllCheckbox({
  visibleIds, selectedIds, onToggle,
}: { visibleIds: string[]; selectedIds: Set<string>; onToggle: () => void }) {
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = !allSelected && visibleIds.some((id) => selectedIds.has(id));
  return (
    <label className="inline-flex items-center justify-center cursor-pointer">
      <input
        type="checkbox"
        checked={allSelected}
        onChange={onToggle}
        className="sr-only peer"
      />
      <span className={`h-4 w-4 rounded border transition-all flex items-center justify-center ${
        allSelected
          ? "bg-brand-600 border-brand-600"
          : someSelected
          ? "bg-brand-600/30 border-brand-500"
          : "bg-card border-slate-300 dark:border-slate-600 hover:border-brand-500"
      }`}>
        {allSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        {someSelected && <span className="h-0.5 w-2 bg-brand-600 rounded-full" />}
      </span>
    </label>
  );
}

/* ── Bulk action bar — appears when items are selected ───── */
function BulkActionBar({
  count, onAssignCommercial, onClear, loading,
}: {
  count: number;
  onAssignCommercial: (commercial: string | null) => void;
  onClear: () => void;
  loading: boolean;
}) {
  const [users, setUsers] = useState<{ id: string; name: string | null; email: string | null }[]>([]);

  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then((d) => setUsers(d.users ?? [])).catch(() => {});
  }, []);

  return (
    <div className="bg-brand-50 dark:bg-brand-950/40 border border-brand-300/60 dark:border-brand-500/40 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap animate-fade-in">
      <span className="text-[13px] font-semibold text-brand-900 dark:text-brand-200">
        {count} client{count > 1 ? "s" : ""} sélectionné{count > 1 ? "s" : ""}
      </span>
      <span className="text-brand-400/60">·</span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            disabled={loading}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-medium bg-brand-600 hover:bg-brand-700 text-white transition-colors active:scale-[0.97] disabled:opacity-60"
          >
            {loading
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <UserPlus className="h-3.5 w-3.5" />}
            Assigner à un commercial
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60 max-h-80 overflow-y-auto">
          <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground">
            Choisir un commercial
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {users.length === 0 && (
            <div className="px-2 py-2 text-[12px] italic text-muted-foreground">
              Aucun commercial enregistré
            </div>
          )}
          {users.map((u) => {
            const name = u.name || u.email || u.id;
            return (
              <DropdownMenuItem
                key={u.id}
                onClick={() => onAssignCommercial(name)}
                className="cursor-pointer text-[13px] flex items-center gap-2"
              >
                <span className="h-5 w-5 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                  {name.charAt(0).toUpperCase()}
                </span>
                <span className="truncate">{name}</span>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onAssignCommercial(null)}
            className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground"
          >
            <X className="mr-2 h-3.5 w-3.5" />
            Retirer le commercial assigné
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        onClick={onClear}
        disabled={loading}
        className="ml-auto inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="h-3 w-3" />
        Désélectionner
      </button>
    </div>
  );
}

/* ── Kebab row menu — Éditer / Rappel / Ouvrir fiche ─────── */
function ClientRowMenu({
  client, onReminderCreated,
}: {
  client: Client;
  onReminderCreated: () => void;
}) {
  const [reminderOpen, setReminderOpen] = useState(false);
  // Confirmation avant désactivation (action lourde : le client ne sera plus rappelé).
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // Appel réseau d'activation/désactivation — logique inchangée.
  const setActivation = async (next: boolean) => {
    const res = await fetch(`/api/clients/${client.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeTelevente: next }),
    });
    if (!res.ok) throw new Error();
  };

  // Activation : 1 clic (action sans risque).
  const activate = async () => {
    try {
      await setActivation(true);
      toast.success(`${client.nom} activé en télévente`);
      onReminderCreated(); // = refresh de la liste
    } catch {
      toast.error("Erreur lors du changement d'activation");
    }
  };

  // Désactivation : exécutée seulement après confirmation explicite (modale).
  const confirmDeactivate = async () => {
    setConfirmLoading(true);
    try {
      await setActivation(false);
      setConfirmOpen(false);
      onReminderCreated(); // = refresh de la liste
      toast.success(`1 client désactivé`, {
        description: client.nom,
        action: {
          label: "Annuler",
          onClick: async () => {
            try {
              await setActivation(true);
              toast.success(`${client.nom} réactivé en télévente`);
              onReminderCreated();
            } catch {
              toast.error("Erreur lors de la réactivation");
            }
          },
        },
      });
    } catch {
      toast.error("Erreur lors du changement d'activation");
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            {client.code}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => (client.activeTelevente ? setConfirmOpen(true) : activate())}
            className="cursor-pointer text-[13px]"
          >
            {client.activeTelevente ? (
              <><X className="mr-2 h-3.5 w-3.5 text-rose-500" /> Désactiver en télévente</>
            ) : (
              <><Check className="mr-2 h-3.5 w-3.5 text-emerald-600" /> Activer en télévente</>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="cursor-pointer text-[13px]">
            <Link href={`/clients/${client.id}`}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Éditer la fiche
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setReminderOpen(true)}
            className="cursor-pointer text-[13px]"
          >
            <Bell className="mr-2 h-3.5 w-3.5" />
            Programmer un rappel
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="cursor-pointer text-[13px]">
            <Link href={`/clients/${client.id}`}>
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Ouvrir la fiche
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Reminder modal — controlled from kebab */}
      <ReminderModal
        client={client}
        open={reminderOpen}
        onOpenChange={setReminderOpen}
        onReminderCreated={onReminderCreated}
      />

      {/* Confirmation avant désactivation — le client ne sera plus jamais rappelé. */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !confirmLoading && setConfirmOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Désactiver ce client en télévente ?
            </DialogTitle>
            <DialogDescription className="pt-1">
              <span className="font-semibold text-foreground">{client.nom}</span> ne sera plus
              jamais proposé au rappel. Vous pourrez le réactiver à tout moment depuis sa fiche
              ou cette liste.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={confirmLoading}
            >
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeactivate}
              disabled={confirmLoading}
            >
              {confirmLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Désactiver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Sortable column header ─────────────────────────────────── */
function SortableHead({
  label, skey, sortKey, sortDir, onClick,
}: {
  label: string;
  skey: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === skey;
  return (
    <TableHead
      scope="col"
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      className="px-4 py-3"
    >
      <button
        type="button"
        onClick={() => onClick(skey)}
        aria-label={`Trier par ${label}${active ? (sortDir === "asc" ? " (croissant)" : " (décroissant)") : ""}`}
        className={`group inline-flex items-center gap-1 rounded text-[11px] font-semibold uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          active
            ? "text-foreground"
            : "text-slate-500 dark:text-slate-400 hover:text-foreground"
        }`}
      >
        {label}
        <span className="inline-flex flex-col -my-1 leading-none" aria-hidden>
          <ChevronUp
            className={`h-2.5 w-2.5 -mb-0.5 ${active && sortDir === "asc" ? "text-foreground" : "text-muted-foreground/30"}`}
            strokeWidth={3}
          />
          <ChevronDown
            className={`h-2.5 w-2.5 ${active && sortDir === "desc" ? "text-foreground" : "text-muted-foreground/30"}`}
            strokeWidth={3}
          />
        </span>
      </button>
    </TableHead>
  );
}
