"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, ShieldAlert, Users, ArrowRight, Eye, Target } from "lucide-react";
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
  /** CA net YTD du portefeuille (clients affectés) — base du % d'objectif. */
  caPortefeuilleYtd: number;
  /** Objectif CA annuel (0 = non défini). */
  objectifCa: number;
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

  const updateObjectif = (slp: string, obj: number) =>
    setData((cur) => (cur ? cur.map((c) => (c.slpName === slp ? { ...c, objectifCa: obj } : c)) : cur));

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
        <ObjectifCell c={c} isAdmin={isAdmin} onSaved={updateObjectif} />
        </div>
      ))}
    </div>
  );
}

/**
 * Objectif CA du commercial : barre de progression (réalisé portefeuille /
 * objectif) + % atteint. Admin : édition inline de l'objectif annuel.
 * Hors du <Link> de la carte (évite un input imbriqué dans une ancre).
 */
function ObjectifCell({
  c, isAdmin, onSaved,
}: {
  c: CommercialSap;
  isAdmin: boolean;
  onSaved: (slp: string, obj: number) => void;
}) {
  const [val, setVal] = useState(c.objectifCa);
  const [saving, setSaving] = useState(false);
  const pct = c.objectifCa > 0 ? Math.round((c.caPortefeuilleYtd / c.objectifCa) * 100) : null;
  const barW = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const tone = pct === null ? "" : pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-brand-500" : "bg-amber-500";

  async function save(n: number) {
    const obj = Math.max(0, Math.round(n) || 0);
    if (obj === c.objectifCa) return;
    setVal(obj); setSaving(true);
    try {
      const r = await fetch("/api/commerciaux/objectif", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slpName: c.slpName, objectifCa: obj }),
      });
      if (!r.ok) throw new Error();
      onSaved(c.slpName, obj);
      toast.success(`Objectif ${c.slpName} : ${fmtEur(obj)}`);
    } catch { setVal(c.objectifCa); toast.error("Erreur enregistrement objectif"); }
    finally { setSaving(false); }
  }

  return (
    <div className="mt-1.5 px-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="inline-flex items-center gap-1 uppercase tracking-[0.1em] font-semibold text-muted-foreground">
          <Target className="h-3 w-3" /> Objectif
        </span>
        {pct !== null ? (
          <span className={`tnum font-bold ${pct >= 100 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
            {pct}% · {fmtEur(c.caPortefeuilleYtd)} / {fmtEur(c.objectifCa)}
          </span>
        ) : (
          <span className="text-muted-foreground">non défini</span>
        )}
      </div>
      {pct !== null && (
        <div className="mt-1 h-1.5 rounded-full bg-secondary/70 overflow-hidden">
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${barW}%` }} />
        </div>
      )}
      {isAdmin && (
        <label className="mt-1.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
          <span>Objectif annuel €</span>
          <input
            type="number" min={0} step={1000}
            value={val}
            onChange={(e) => setVal(parseFloat(e.target.value) || 0)}
            onBlur={(e) => save(parseFloat(e.target.value) || 0)}
            disabled={saving}
            className="w-24 h-6 px-1.5 rounded-md bg-secondary/60 text-right tnum text-foreground focus-visible:ring-2 focus-visible:ring-brand-500 focus:outline-none disabled:opacity-60"
          />
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
        </label>
      )}
    </div>
  );
}
