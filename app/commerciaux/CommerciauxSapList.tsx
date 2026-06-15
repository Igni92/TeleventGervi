"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldAlert, Users, ArrowRight, Eye } from "lucide-react";
import { Sparkline } from "@/components/charts/Sparkline";

/**
 * Liste des commerciaux SAP (slpName, activité 12 mois) — KPI YTD + tendance.
 * Source : /api/commerciaux/sap (scopé : un non-admin ne voit que sa carte).
 * Clic → fiche /commerciaux/[slp].
 */

interface CommercialSap {
  slpName: string;
  clientsActifs: number;
  caNetYtd: number;
  nbFacturesYtd: number;
  caBlYtd: number;
  nbCommandesYtd: number;
  volumeKgYtd: number;
  spark: number[];
}

const fmtEur = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const fmtKg = (v: number) =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v)} kg`;

export function CommerciauxSapList() {
  const [data, setData] = useState<CommercialSap[] | null>(null);
  const [restricted, setRestricted] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/commerciaux/sap", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.restricted && j.message) setRestricted(j.message);
        setIsAdmin(!!j.scope?.all);
        setData(j.commerciaux ?? []);
      })
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <p className="text-[13px] text-rose-600 dark:text-rose-400 py-6 text-center border border-border rounded-xl bg-card">
        Erreur de chargement des commerciaux.
      </p>
    );
  }
  if (restricted) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-amber-300/60 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 px-4 py-3">
        <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <p className="text-[13px] font-medium text-amber-800 dark:text-amber-300">{restricted}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="h-32 flex items-center justify-center border border-border rounded-xl bg-card">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground py-8 text-center border border-border rounded-xl bg-card">
        Aucun commercial SAP avec activité sur les 12 derniers mois.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {data.map((c) => (
        <div key={c.slpName} className="relative">
        {isAdmin && (
          <Link
            href={`/dashboard?as=${encodeURIComponent(c.slpName)}`}
            title={`Voir le cockpit comme ${c.slpName}`}
            className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10.5px] font-semibold bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus:outline-none"
          >
            <Eye className="h-3 w-3" /> Voir comme
          </Link>
        )}
        <Link
          href={`/commerciaux/${encodeURIComponent(c.slpName)}`}
          className="group relative block bg-card border border-border border-l-4 border-l-brand-500 rounded-xl p-4 hover:bg-secondary/30 transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="h-9 w-9 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-[12px] font-bold shrink-0">
                {c.slpName.slice(0, 3)}
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-foreground leading-tight">{c.slpName}</p>
                <p className="text-[10.5px] text-muted-foreground inline-flex items-center gap-1">
                  <Users className="h-3 w-3" /> {c.clientsActifs} client{c.clientsActifs > 1 ? "s" : ""} actifs · 12 mois
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-brand-500 group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
            <div>
              <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">CA net YTD</p>
              <p className="text-[17px] font-bold tnum text-foreground leading-tight">{fmtEur(c.caNetYtd)}</p>
              <p className="text-[10px] text-muted-foreground tnum">{c.nbFacturesYtd} factures</p>
            </div>
            <div>
              <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">Volume BL YTD</p>
              <p className="text-[17px] font-bold tnum text-foreground leading-tight">{fmtKg(c.volumeKgYtd)}</p>
              <p className="text-[10px] text-muted-foreground tnum">{fmtEur(c.caBlYtd)} HT · {c.nbCommandesYtd} cdes</p>
            </div>
          </div>

          <div className="mt-2.5">
            <Sparkline
              data={c.spark}
              responsive
              height={30}
              tone="brand"
              aria-label={`CA hebdo de ${c.slpName} sur 12 semaines`}
            />
            <p className="text-[9.5px] text-muted-foreground mt-0.5">CA facturé · 12 dernières semaines</p>
          </div>
        </Link>
        </div>
      ))}
    </div>
  );
}
