"use client";

import { useEffect, useState } from "react";
import { Delta } from "@/components/ui/delta";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { formatKg } from "@/components/clients/FamillesVsGroupe";

/**
 * Analyse comportementale YoY du client (B8).
 *
 * 3 KPI sur **N vs N-1 même période YTD** :
 *   - Volume (pcs)
 *   - CA HT (€)
 *   - Nb commandes (Invoices)
 *
 * Source = /api/clients/[id]/comportement-yoy (SapInvoice mirror).
 * Réutilise `Delta` (icône + signe, pas couleur seule) et `AnimatedNumber`.
 */

type Agg = { kg: number; ca: number; nbOrders: number };

type Api = {
  ok: true;
  period: { currentYear: number; previousYear: number; from: string; to: string };
  current: Agg;
  previous: Agg;
};

const FMT_NUM = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);
const FMT_EUR = (n: number) => new Intl.NumberFormat("fr-FR", {
  style: "currency", currency: "EUR", maximumFractionDigits: 0,
}).format(n);

export function ComportementYoY({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Api | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/clients/${clientId}/comportement-yoy`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok) setData(d);
        else setError(d.error ?? "Erreur");
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading) return <p className="text-sm text-muted-foreground">Chargement…</p>;
  if (error) return <p className="text-sm text-rose-500">{error}</p>;
  if (!data) return null;

  return (
    <div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Année en cours <span className="font-mono text-foreground">{data.period.currentYear}</span>
        <span className="mx-1.5 opacity-50">·</span>
        comparé à la même période <span className="font-mono text-foreground">{data.period.previousYear}</span>
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Volume"      curr={data.current.kg}       prev={data.previous.kg}       fmt={formatKg} />
        <Kpi label="CA HT"       curr={data.current.ca}       prev={data.previous.ca}       fmt={FMT_EUR} />
        <Kpi label="Commandes"   curr={data.current.nbOrders} prev={data.previous.nbOrders} fmt={(v) => FMT_NUM(v)} />
      </div>
    </div>
  );
}

function Kpi({
  label, curr, prev, fmt,
}: { label: string; curr: number; prev: number; fmt: (v: number) => string }) {
  return (
    <div className="rounded-md border border-border bg-card/40 px-3 py-2">
      <p className="kicker mb-1">{label}</p>
      <p className="text-[18px] font-semibold tabular-nums leading-none mb-1.5">
        <AnimatedNumber value={curr} format={fmt} />
      </p>
      <Delta curr={curr} prev={prev} size="sm" />
    </div>
  );
}
