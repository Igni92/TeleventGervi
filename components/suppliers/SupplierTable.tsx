"use client";

import { useEffect, useRef, useState, useCallback, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, Loader2, Truck, Users, Phone, Mail, Link2, ChevronRight, DownloadCloud, Pencil, ExternalLink, Archive, ArchiveRestore } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ViewToggle, useViewMode } from "@/components/ui/view-toggle";
import { ContextMenu, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, useContextMenu } from "@/components/ui/context-menu";
import { SupplierQuickEdit } from "@/components/suppliers/SupplierQuickEdit";
import { formatPhoneDisplay } from "@/lib/phone";

interface SupplierRow {
  id: string;
  code: string;
  nom: string;
  type: string | null;
  sapCardCode: string | null;
  email: string | null;
  tel1: string | null;
  active: boolean;
  _count?: { contacts: number };
}

const FILTERS = [
  { key: "", label: "Tous" },
  { key: "actifs", label: "Actifs" },
  { key: "inactifs", label: "Archivés" },
] as const;

export function SupplierTable() {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<string>("actifs");
  const [importing, setImporting] = useState(false);
  const [view, setView] = useViewMode("televent-suppliers-view");
  const router = useRouter();
  const { menu, openAt, close } = useContextMenu(230, 260);
  const [ctx, setCtx] = useState<SupplierRow | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  // Auto-amorçage tenté une seule fois par montage (évite les boucles d'import).
  const autoSeedTried = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (active) params.set("active", active);
      const res = await fetch(`/api/suppliers?${params}`, { cache: "no-store" });
      const json = await res.json();
      setSuppliers(json.suppliers ?? []);
      return (json.suppliers ?? []) as SupplierRow[];
    } catch { setSuppliers([]); return [] as SupplierRow[]; }
    finally { setLoading(false); }
  }, [search, active]);

  /** Importe les 50 derniers fournisseurs SAP à qui on a passé une commande. */
  const runImport = useCallback(async (opts: { silent?: boolean } = {}) => {
    setImporting(true);
    try {
      const res = await fetch("/api/sap/suppliers/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error || "Import échoué");
      if (!opts.silent) {
        toast.success(`${json.imported ?? 0} fournisseur${(json.imported ?? 0) > 1 ? "s" : ""} importé${(json.imported ?? 0) > 1 ? "s" : ""}`, {
          description: `Les ${json.distinctVendors ?? 0} derniers fournisseurs commandés (${json.company ?? "SAP"}).`,
        });
      }
      await load();
    } catch (e) {
      if (!opts.silent) toast.error(e instanceof Error ? e.message : "Import échoué");
    } finally { setImporting(false); }
  }, [load]);

  const openCtx = (e: ReactMouseEvent, s: SupplierRow) => { setCtx(s); openAt(e); };

  /** Archive / réactive sans ouvrir la fiche (repart de la fiche complète pour
   *  ne pas écraser les champs non chargés dans la liste). */
  const toggleActive = useCallback(async (s: SupplierRow) => {
    close();
    try {
      const cur = await fetch(`/api/suppliers/${s.id}`).then((r) => r.json());
      const res = await fetch(`/api/suppliers/${s.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nom: cur.nom,
          type: cur.type ?? "",
          sapCardCode: cur.sapCardCode ?? "",
          email: cur.email ?? "",
          tel1: cur.tel1 ?? "",
          tel2: cur.tel2 ?? "",
          tel3: cur.tel3 ?? "",
          adresse: cur.adresse ?? "",
          notes: cur.notes ?? "",
          active: !s.active,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Échec");
      toast.success(s.active ? "Fournisseur archivé" : "Fournisseur réactivé");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec");
    }
  }, [close, load]);

  // Débounce léger sur la recherche + auto-amorçage si le référentiel est vide.
  useEffect(() => {
    const t = setTimeout(async () => {
      const rows = await load();
      // Liste vide, sans recherche, sur l'onglet « Actifs » (défaut) → on amorce
      // automatiquement une première fois avec les 50 derniers fournisseurs
      // commandés (import silencieux, non destructif).
      if (rows.length === 0 && !search.trim() && active === "actifs" && !autoSeedTried.current) {
        autoSeedTried.current = true;
        await runImport({ silent: true });
      }
    }, 220);
    return () => clearTimeout(t);
  }, [load, runImport, search, active]);

  return (
    <div className="space-y-4">
      {/* Barre de filtres */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un fournisseur (code, nom, famille)…"
            className="pl-9"
          />
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key || "all"}
              type="button"
              onClick={() => setActive(f.key)}
              className={`px-3 h-8 rounded-md text-[12.5px] font-medium transition-colors ${
                active === f.key
                  ? "bg-brand-500 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => runImport()}
          disabled={importing}
          title="Importer les 50 derniers fournisseurs à qui on a passé une commande (SAP)"
        >
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
          Importer les 50 derniers
        </Button>
        <div className="ml-auto"><ViewToggle value={view} onChange={setView} /></div>
      </div>
      <p className="-mt-1 text-[11.5px] text-muted-foreground">
        Astuce : <b>clic droit</b> sur un fournisseur pour le modifier sans ouvrir la fiche.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : suppliers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center">
          <Truck className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-[14px] font-medium text-foreground">Aucun fournisseur</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Créez une première fiche pour renseigner ses interlocuteurs.
          </p>
        </div>
      ) : view === "cards" ? (
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {suppliers.map((s) => (
            <li key={s.id} onContextMenu={(e) => openCtx(e, s)}>
              <Link
                href={`/fournisseurs/${s.id}`}
                className="group flex h-full flex-col rounded-2xl border border-border bg-card p-4 shadow-card transition-all duration-200 hover:-translate-y-px hover:shadow-card-hover hover:border-brand-400/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-semibold text-foreground">{s.nom}</p>
                    <p className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">{s.code}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500" />
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {s.type && <Badge variant="secondary">{s.type}</Badge>}
                  {!s.active && <Badge variant="annule">Archivé</Badge>}
                  {s.sapCardCode && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300">
                      <Link2 className="h-3 w-3" /> SAP
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                  {s.tel1 && (
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="h-3 w-3" /> <span className="font-mono">{formatPhoneDisplay(s.tel1)}</span>
                    </span>
                  )}
                  {s.email && (
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{s.email}</span>
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3 w-3" /> {s._count?.contacts ?? 0} contact{(s._count?.contacts ?? 0) > 1 ? "s" : ""}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <SupplierListView suppliers={suppliers} onContext={openCtx} />
      )}

      <ContextMenu menu={menu} onClose={close}>
        {ctx && (
          <>
            <ContextMenuLabel>{ctx.nom}</ContextMenuLabel>
            <ContextMenuItem icon={Pencil} onClick={() => { setEditId(ctx.id); close(); }}>Modifier…</ContextMenuItem>
            <ContextMenuItem icon={ExternalLink} onClick={() => { router.push(`/fournisseurs/${ctx.id}`); close(); }}>Ouvrir la fiche</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem icon={ctx.active ? Archive : ArchiveRestore} onClick={() => toggleActive(ctx)}>
              {ctx.active ? "Archiver" : "Réactiver"}
            </ContextMenuItem>
          </>
        )}
      </ContextMenu>

      <SupplierQuickEdit id={editId} onClose={() => setEditId(null)} onSaved={load} />
    </div>
  );
}

/** Vue LISTE classique (tableau compact) des fournisseurs. */
function SupplierListView({ suppliers, onContext }: { suppliers: SupplierRow[]; onContext: (e: ReactMouseEvent, s: SupplierRow) => void }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5 text-left font-semibold">Fournisseur</th>
              <th className="px-3 py-2.5 text-left font-semibold">Code</th>
              <th className="px-3 py-2.5 text-left font-semibold">Famille</th>
              <th className="px-3 py-2.5 text-left font-semibold">Téléphone</th>
              <th className="px-3 py-2.5 text-left font-semibold">Email</th>
              <th className="px-3 py-2.5 text-right font-semibold">Contacts</th>
              <th className="px-3 py-2.5 text-center font-semibold">SAP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {suppliers.map((s) => (
              <tr key={s.id} onContextMenu={(e) => onContext(e, s)} title="Clic droit pour modifier" className="cursor-context-menu transition-colors hover:bg-secondary/30">
                <td className="px-3 py-2">
                  <Link href={`/fournisseurs/${s.id}`} className="font-semibold text-foreground hover:text-brand-600 hover:underline underline-offset-2">
                    {s.nom}
                  </Link>
                  {!s.active && <Badge variant="annule" className="ml-2 text-[9.5px]">Archivé</Badge>}
                </td>
                <td className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground">{s.code}</td>
                <td className="px-3 py-2">{s.type ? <Badge variant="secondary" className="text-[10px]">{s.type}</Badge> : <span className="text-muted-foreground/40">—</span>}</td>
                <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground">{s.tel1 ? formatPhoneDisplay(s.tel1) : "—"}</td>
                <td className="px-3 py-2 text-[12px] text-muted-foreground max-w-[220px] truncate">{s.email || "—"}</td>
                <td className="px-3 py-2 text-right tnum text-muted-foreground">{s._count?.contacts ?? 0}</td>
                <td className="px-3 py-2 text-center">
                  {s.sapCardCode
                    ? <Link2 className="inline h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    : <span className="text-muted-foreground/30">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
