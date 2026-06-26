"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Loader2, Truck, Receipt, TrendingUp, Trophy, History, ShieldAlert,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Delta } from "@/components/ui/delta";
import { TrendArea } from "@/components/charts/TrendArea";
import { ClientLink } from "@/components/ClientLink";
import { displayNameFromSlp } from "@/lib/salespeople";

/**
 * Fiche commercial SAP — deux états, deux sources :
 *   « État commercial » (SapOrder / BL) et « État comptable » (Invoices − Avoirs),
 * sélecteur de période (semaine ISO / mois / année), évolution hebdo N vs N-1,
 * top clients (ClientLink → fiche client) et activité récente.
 */

type Range = "week" | "month" | "year";

interface Kpis { ht: number; nb: number; clients: number; panier: number; kg: number }
interface Compta { caNet: number; marge: number; nbFactures: number; nbAvoirs: number }
interface FicheData {
  ok: boolean;
  slp: string;
  range: Range;
  period: { from: string; to: string; prevFrom: string; prevTo: string };
  commercial: Kpis & { prev: Kpis };
  comptable: Compta & { prev: Compta };
  weekly: { label: string; value: number; compare: number }[];
  topClients: { cardCode: string; cardName: string | null; ca: number; nb: number; kg: number }[];
  recentOrders: { docNum: number | null; docDate: string; cardCode: string; cardName: string | null; docTotal: number }[];
}

const RANGES: { id: Range; label: string }[] = [
  { id: "week", label: "Semaine" },
  { id: "month", label: "Mois" },
  { id: "year", label: "Année" },
];

const fmtEur = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const fmtEur2 = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fmtKg = (v: number) =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v)} kg`;
const fmtInt = (v: number) => new Intl.NumberFormat("fr-FR").format(v);
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });

function Kpi({ label, value, prev, sub }: { label: string; value: string; prev?: { curr: number; prev: number }; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground truncate">{label}</p>
      <p className="text-[20px] font-bold tnum text-foreground leading-tight mt-0.5">{value}</p>
      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        {prev && <Delta curr={prev.curr} prev={prev.prev} size="sm" />}
        {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

export function FicheCommercial({ slp }: { slp: string }) {
  const [range, setRange] = useState<Range>("month");
  const [data, setData] = useState<FicheData | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/commerciaux/${encodeURIComponent(slp)}?range=${range}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (cancelled) return;
        if (r.status === 403) { setForbidden(j.error ?? "Accès refusé."); return; }
        if (j.ok) setData(j);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slp, range]);

  if (forbidden) {
    return (
      <div className="max-w-xl mx-auto mt-16 flex items-start gap-3 rounded-xl border border-amber-300/60 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 px-5 py-4">
        <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[13px] font-medium text-amber-800 dark:text-amber-300">{forbidden}</p>
      </div>
    );
  }

  const c = data?.commercial;
  const k = data?.comptable;
  const periodHint = data ? `vs ${fmtDate(data.period.prevFrom)} → ${fmtDate(data.period.prevTo)}` : "";

  return (
    <div className="space-y-5 animate-fade-up">
      {/* En-tête */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/commerciaux"
            className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="h-3 w-3" /> Commerciaux
          </Link>
          <div className="flex items-center gap-3">
            <span className="h-12 w-12 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-[15px] font-bold shrink-0">
              {slp.slice(0, 3)}
            </span>
            <div>
              <p className="kicker mb-0.5">Fiche commercial SAP</p>
              <h1 className="font-display text-[30px] font-semibold text-foreground tracking-tight leading-none">{displayNameFromSlp(slp) ?? slp}</h1>
            </div>
          </div>
        </div>

        {/* Sélecteur de période */}
        <div className="flex gap-1 p-1 bg-secondary/60 rounded-xl">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`px-3.5 py-1.5 rounded-lg text-[12.5px] font-medium transition-all ${
                range === r.id
                  ? "bg-card text-foreground shadow-xs ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {data && (
        <p className="text-[11.5px] text-muted-foreground -mt-2">
          Période : <span className="font-medium text-foreground">{fmtDate(data.period.from)} → {fmtDate(data.period.to)}</span>
          {" "}· comparée à la même fenêtre N-1.
        </p>
      )}

      {loading && !data ? (
        <div className="h-48 flex items-center justify-center border border-border rounded-xl bg-card">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : data && c && k ? (
        <>
          {/* Les deux états */}
          <div className={`grid gap-3 lg:grid-cols-2 transition-opacity ${loading ? "opacity-60" : ""}`}>
            <SurfaceCard accent="brand" title="État commercial — BL (commandes SAP)" icon={<Truck className="h-3.5 w-3.5" />}>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4">
                <Kpi label="Volume HT" value={fmtEur(c.ht)} prev={{ curr: c.ht, prev: c.prev.ht }} sub={periodHint} />
                <Kpi label="Volume kg" value={fmtKg(c.kg)} prev={{ curr: c.kg, prev: c.prev.kg }} />
                <Kpi label="Commandes" value={fmtInt(c.nb)} prev={{ curr: c.nb, prev: c.prev.nb }} />
                <Kpi label="Clients actifs" value={fmtInt(c.clients)} prev={{ curr: c.clients, prev: c.prev.clients }} />
                <Kpi label="Panier moyen" value={fmtEur2(c.panier)} prev={{ curr: c.panier, prev: c.prev.panier }} />
              </div>
            </SurfaceCard>

            <SurfaceCard accent="emerald" title="État comptable — facturé (Invoices − Avoirs)" icon={<Receipt className="h-3.5 w-3.5" />}>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4">
                <Kpi label="CA net" value={fmtEur(k.caNet)} prev={{ curr: k.caNet, prev: k.prev.caNet }} sub={periodHint} />
                <Kpi label="Marge (SAP)" value={fmtEur(k.marge)} prev={{ curr: k.marge, prev: k.prev.marge }} />
                <Kpi
                  label="Factures"
                  value={fmtInt(k.nbFactures)}
                  prev={{ curr: k.nbFactures, prev: k.prev.nbFactures }}
                  sub={k.nbAvoirs > 0 ? `${k.nbAvoirs} avoir${k.nbAvoirs > 1 ? "s" : ""}` : undefined}
                />
              </div>
            </SurfaceCard>
          </div>

          {/* Évolution hebdo N vs N-1 */}
          <SurfaceCard accent="violet" title="Évolution hebdo — volume HT BL, N vs N-1 (semaines ISO)" icon={<TrendingUp className="h-3.5 w-3.5" />}>
            <TrendArea
              data={data.weekly}
              tone="violet"
              height={190}
              format={(v) => fmtEur(v)}
              currentLabel="N"
              compareLabel="N-1 (même semaine)"
              aria-label={`Volume HT hebdomadaire de ${slp} sur 12 semaines, comparé à N-1`}
            />
          </SurfaceCard>

          <div className="grid gap-3 lg:grid-cols-2">
            {/* Top clients */}
            <SurfaceCard accent="amber" title="Top clients de la période (CA facturé)" icon={<Trophy className="h-3.5 w-3.5" />}>
              {data.topClients.length === 0 ? (
                <p className="text-[12px] italic text-muted-foreground py-3 text-center">Aucune facture sur la période.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.topClients.map((t, i) => {
                    const peak = Math.max(1, ...data.topClients.map((x) => x.ca));
                    const pct = Math.max(2, (t.ca / peak) * 100);
                    return (
                      <li key={t.cardCode}>
                        <div className="flex items-baseline justify-between gap-3 mb-0.5">
                          <span className="min-w-0 flex items-baseline gap-1.5">
                            <span className="text-[10px] font-bold tnum text-muted-foreground/70 shrink-0 w-4">{i + 1}.</span>
                            <ClientLink
                              code={t.cardCode}
                              name={t.cardName}
                              className="text-[12.5px] font-medium text-foreground truncate text-left hover:underline decoration-brand-500/60 underline-offset-2"
                            />
                            <span className="text-[10px] text-muted-foreground shrink-0">· {t.nb} fact.</span>
                          </span>
                          <span className="text-[12px] font-semibold tnum text-foreground shrink-0">
                            {fmtEur(t.ca)}
                            <span className="text-muted-foreground font-normal"> · {fmtKg(t.kg)}</span>
                          </span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-secondary/60 overflow-hidden">
                          <div className="h-full rounded-full bg-amber-500/80" style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SurfaceCard>

            {/* Activité récente */}
            <SurfaceCard accent="sky" title="Activité récente — dernières commandes (BL)" icon={<History className="h-3.5 w-3.5" />}>
              {data.recentOrders.length === 0 ? (
                <p className="text-[12px] italic text-muted-foreground py-3 text-center">Aucune commande.</p>
              ) : (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-[12px]">
                    <thead className="text-[9.5px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="text-left px-1 py-1 font-semibold">Date</th>
                        <th className="text-left px-1 py-1 font-semibold">N°</th>
                        <th className="text-left px-1 py-1 font-semibold">Client</th>
                        <th className="text-right px-1 py-1 font-semibold">Total HT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {data.recentOrders.map((o, i) => (
                        <tr key={`${o.docNum ?? "x"}-${i}`} className="hover:bg-secondary/30 transition-colors">
                          <td className="px-1 py-1.5 whitespace-nowrap text-muted-foreground tnum">{fmtDate(o.docDate)}</td>
                          <td className="px-1 py-1.5 font-mono text-[11px] text-muted-foreground">{o.docNum ?? "—"}</td>
                          <td className="px-1 py-1.5 min-w-0 max-w-[220px]">
                            <ClientLink
                              code={o.cardCode}
                              name={o.cardName}
                              className="font-medium text-foreground truncate block text-left hover:underline decoration-brand-500/60 underline-offset-2"
                            />
                          </td>
                          <td className="px-1 py-1.5 text-right font-semibold tnum whitespace-nowrap">{fmtEur2(o.docTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SurfaceCard>
          </div>
        </>
      ) : null}
    </div>
  );
}
