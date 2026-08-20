"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Truck, Receipt, TrendingUp, Trophy, History,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Banner } from "@/components/ui/banner";
import { Delta } from "@/components/ui/delta";
import { TrendArea } from "@/components/charts/TrendArea";
import { ClientLink } from "@/components/ClientLink";
import { displayNameFromSlp } from "@/lib/salespeople";

/**
 * Fiche commercial SAP — deux sources fusionnées dans un seul bloc « État » à
 * deux colonnes : « commercial » (SapOrder / BL) et « comptable » (Invoices −
 * Avoirs). Sélecteur de période (semaine ISO / mois / année) dans l'en-tête,
 * évolution hebdo N vs N-1, top clients + activité récente sous le graphe.
 *
 * Régime SOBRE, accent UNIQUE (or) : la couleur ne sert qu'à l'état (deltas
 * N-1). Skeleton au changement de période.
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

const RANGES: { value: Range; label: string }[] = [
  { value: "week", label: "Semaine" },
  { value: "month", label: "Mois" },
  { value: "year", label: "Année" },
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
      <p className="text-caption2 uppercase tracking-[0.12em] font-semibold text-muted-foreground truncate">{label}</p>
      <p className="text-title3 font-bold tnum text-foreground leading-tight mt-0.5">{value}</p>
      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        {prev && <Delta curr={prev.curr} prev={prev.prev} size="sm" />}
        {sub && <span className="text-caption2 text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

/* En-tête de colonne de l'état fusionné (BL / facturé). */
function StateHeading({ icon: Icon, children }: { icon: typeof Truck; children: React.ReactNode }) {
  return (
    <p className="mb-3 inline-flex items-center gap-1.5 text-caption2 uppercase tracking-[0.12em] font-semibold text-muted-foreground">
      <Icon className="h-3.5 w-3.5" /> {children}
    </p>
  );
}

/* Squelette de contenu — affiché au chargement ET à chaque changement de période. */
function FicheSkeleton() {
  return (
    <div role="status" aria-label="Chargement" className="space-y-5">
      <SurfaceCard accent="brand">
        <div className="grid gap-x-6 gap-y-6 sm:grid-cols-2">
          {[0, 1].map((col) => (
            <div key={col} className={col === 1 ? "sm:border-l sm:border-border sm:pl-6" : ""}>
              <Skeleton className="h-3 w-40" />
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-5">
                {Array.from({ length: col === 0 ? 5 : 3 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-2.5 w-16" />
                    <Skeleton className="h-6 w-20" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SurfaceCard>
      <SurfaceCard>
        <Skeleton className="h-3 w-56" />
        <Skeleton className="mt-3 h-[190px] w-full rounded-lg" />
      </SurfaceCard>
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <SurfaceCard key={i}>
            <Skeleton className="h-3 w-40" />
            <div className="mt-3 space-y-2.5">
              {Array.from({ length: 5 }).map((_, j) => <Skeleton key={j} className="h-4 w-full" />)}
            </div>
          </SurfaceCard>
        ))}
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
      <div className="max-w-xl mx-auto mt-16">
        <Banner tone="warning" title="Accès refusé">{forbidden}</Banner>
      </div>
    );
  }

  const c = data?.commercial;
  const k = data?.comptable;
  const name = displayNameFromSlp(slp) ?? slp;

  return (
    <div className="space-y-5 animate-fade-up">
      {/* En-tête : identité à gauche ; période (segmented + fenêtre) à droite */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/commerciaux"
            className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="h-3 w-3" /> Commerciaux
          </Link>
          <div className="flex items-center gap-3">
            {/* Avatar monogramme neutre (plus de dégradé de marque) */}
            <span className="grid h-12 w-12 place-items-center rounded-full bg-secondary text-callout font-bold text-foreground shrink-0">
              {slp.slice(0, 3)}
            </span>
            <div>
              <p className="kicker mb-0.5">Fiche commercial SAP</p>
              <h1 className="font-display text-title2 sm:text-title1 font-semibold text-foreground tracking-tight leading-none">{name}</h1>
            </div>
          </div>
        </div>

        {/* Sélecteur de période + fenêtre courante (vs N-1), côte à côte */}
        <div className="flex flex-col items-start sm:items-end gap-1.5">
          <SegmentedControl
            aria-label="Période"
            value={range}
            onChange={(v) => setRange(v)}
            options={RANGES}
          />
          {data && (
            <p className="text-caption text-muted-foreground tnum">
              {fmtDate(data.period.from)} → {fmtDate(data.period.to)}
              <span className="text-muted-foreground/70"> · vs N-1</span>
            </p>
          )}
        </div>
      </header>

      {loading ? (
        <FicheSkeleton />
      ) : data && c && k ? (
        <>
          {/* État fusionné — un seul bloc, deux colonnes titrées (accent unique) */}
          <SurfaceCard accent="brand" title="État de la période">
            <div className="grid gap-x-6 gap-y-6 sm:grid-cols-2">
              <div>
                <StateHeading icon={Truck}>Commercial · BL (commandes SAP)</StateHeading>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4">
                  <Kpi label="Volume HT" value={fmtEur(c.ht)} prev={{ curr: c.ht, prev: c.prev.ht }} />
                  <Kpi label="Volume kg" value={fmtKg(c.kg)} prev={{ curr: c.kg, prev: c.prev.kg }} />
                  <Kpi label="Commandes" value={fmtInt(c.nb)} prev={{ curr: c.nb, prev: c.prev.nb }} />
                  <Kpi label="Clients actifs" value={fmtInt(c.clients)} prev={{ curr: c.clients, prev: c.prev.clients }} />
                  <Kpi label="Panier moyen" value={fmtEur2(c.panier)} prev={{ curr: c.panier, prev: c.prev.panier }} />
                </div>
              </div>
              <div className="sm:border-l sm:border-border sm:pl-6 max-sm:border-t max-sm:border-border max-sm:pt-5">
                <StateHeading icon={Receipt}>Comptable · facturé (Invoices − Avoirs)</StateHeading>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4">
                  <Kpi label="CA net" value={fmtEur(k.caNet)} prev={{ curr: k.caNet, prev: k.prev.caNet }} />
                  <Kpi label="Marge (SAP)" value={fmtEur(k.marge)} prev={{ curr: k.marge, prev: k.prev.marge }} />
                  <Kpi
                    label="Factures"
                    value={fmtInt(k.nbFactures)}
                    prev={{ curr: k.nbFactures, prev: k.prev.nbFactures }}
                    sub={k.nbAvoirs > 0 ? `${k.nbAvoirs} avoir${k.nbAvoirs > 1 ? "s" : ""}` : undefined}
                  />
                </div>
              </div>
            </div>
          </SurfaceCard>

          {/* Évolution hebdo N vs N-1 (accent neutre, tendance à la couleur de marque) */}
          <SurfaceCard title="Évolution hebdo — volume HT BL, N vs N-1 (semaines ISO)" icon={<TrendingUp className="h-3.5 w-3.5" />}>
            <TrendArea
              data={data.weekly}
              tone="brand"
              height={190}
              format={(v) => fmtEur(v)}
              currentLabel="N"
              compareLabel="N-1 (même semaine)"
              aria-label={`Volume HT hebdomadaire de ${name} sur 12 semaines, comparé à N-1`}
            />
          </SurfaceCard>

          {/* Top clients + Activité récente — une rangée sous le graphe */}
          <div className="grid gap-3 lg:grid-cols-2">
            <SurfaceCard title="Top clients de la période (CA facturé)" icon={<Trophy className="h-3.5 w-3.5" />}>
              {data.topClients.length === 0 ? (
                <p className="text-caption italic text-muted-foreground py-3 text-center">Aucune facture sur la période.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.topClients.map((t, i) => {
                    const peak = Math.max(1, ...data.topClients.map((x) => x.ca));
                    const pct = Math.max(2, (t.ca / peak) * 100);
                    return (
                      <li key={t.cardCode}>
                        <div className="flex items-baseline justify-between gap-3 mb-0.5">
                          <span className="min-w-0 flex items-baseline gap-1.5">
                            <span className="text-caption2 font-bold tnum text-muted-foreground/70 shrink-0 w-4">{i + 1}.</span>
                            <ClientLink
                              code={t.cardCode}
                              name={t.cardName}
                              className="text-caption font-medium text-foreground truncate text-left hover:underline decoration-primary/60 underline-offset-2"
                            />
                            <span className="text-caption2 text-muted-foreground shrink-0">· {t.nb} fact.</span>
                          </span>
                          <span className="text-caption font-semibold tnum text-foreground shrink-0">
                            {fmtEur(t.ca)}
                            <span className="text-muted-foreground font-normal"> · {fmtKg(t.kg)}</span>
                          </span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-secondary/60 overflow-hidden">
                          <div className="h-full rounded-full bg-primary/80" style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SurfaceCard>

            <SurfaceCard title="Activité récente — dernières commandes (BL)" icon={<History className="h-3.5 w-3.5" />}>
              {data.recentOrders.length === 0 ? (
                <p className="text-caption italic text-muted-foreground py-3 text-center">Aucune commande.</p>
              ) : (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-caption">
                    <thead className="text-caption2 uppercase tracking-wider text-muted-foreground">
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
                          <td className="px-1 py-1.5 font-mono text-caption2 text-muted-foreground">{o.docNum ?? "—"}</td>
                          <td className="px-1 py-1.5 min-w-0 max-w-[220px]">
                            <ClientLink
                              code={o.cardCode}
                              name={o.cardName}
                              className="font-medium text-foreground truncate block text-left hover:underline decoration-primary/60 underline-offset-2"
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
