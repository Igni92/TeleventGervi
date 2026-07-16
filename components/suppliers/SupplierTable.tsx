"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Search, Loader2, Truck, Users, Phone, Mail, Link2, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (active) params.set("active", active);
      const res = await fetch(`/api/suppliers?${params}`, { cache: "no-store" });
      const json = await res.json();
      setSuppliers(json.suppliers ?? []);
    } catch { setSuppliers([]); }
    finally { setLoading(false); }
  }, [search, active]);

  // Débounce léger sur la recherche.
  useEffect(() => {
    const t = setTimeout(load, 220);
    return () => clearTimeout(t);
  }, [load]);

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
      </div>

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
      ) : (
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {suppliers.map((s) => (
            <li key={s.id}>
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
      )}
    </div>
  );
}
