"use client";

/**
 * ÉTAT DES COMMISSIONS (onglet Effectifs) — LIGNE À LIGNE, avec le TRAIT de paie.
 *
 * Une ligne = UN MOIS, parce que le mois EST l'unité de paie : la commission
 * tombe sur le bulletin du mois, au fur et à mesure (cf. lib/commissions).
 * Les mois sont listés du plus récent au plus ancien, et un TRAIT marque la
 * dernière échéance réglée : au-dessus ce qui reste à verser, en dessous
 * l'historique déjà payé, avec la date d'envoi au cabinet et son auteur.
 *
 * Un mois déjà payé affiche le montant FIGÉ au versement (snapshot immuable),
 * pas le montant recalculé aujourd'hui. Quand les deux diffèrent — une facture
 * arrivée après coup — l'écart est affiché explicitement : c'est une
 * régularisation à passer, et sans ce rappel elle resterait invisible.
 */

import { useEffect, useState } from "react";
import { Wallet, Loader2, Check, Clock3, AlertTriangle } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";

interface PaidInfo {
  payslipMonth: string;
  sentAt: string;
  sentBy: string;
  prime: number;
  base: number;
}

interface Line {
  month: string;
  invoices: number;
  creditNotes: number;
  base: number;
  avoirs: number;
  prime: number;
  settled: boolean;
  paid: PaidInfo | null;
  drift: number;
}

interface Commercial {
  slp: string;
  rate: number;
  since: string;
  lines: Line[];
  totals: { paid: number; due: number; drift: number };
}

interface Payload {
  ok: boolean;
  paidThrough: string | null;
  lastPayment: { payslipMonth: string; sentAt: string; sentBy: string; total: number } | null;
  commerciaux: Commercial[];
  restricted?: boolean;
  message?: string;
}

const eur2 = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
/** « 2025-11 » → « novembre 2025 ». */
const monthLabelFr = (m: string) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const dateFr = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

export function CommissionsPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/effectif/commissions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? r.statusText))))
      .then((j: Payload) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, []);

  return (
    <SurfaceCard
      accent="brand"
      icon={<Wallet className="h-4 w-4" />}
      title="État des commissions"
    >
      {err && <p className="py-5 text-[13px] text-rose-400">Erreur : {err}</p>}
      {!err && !data && (
        <p className="py-6 flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Calcul mois par mois…
        </p>
      )}

      {data?.restricted && (
        <p className="py-5 text-[13px] text-muted-foreground">{data.message}</p>
      )}

      {data && !data.restricted && (
        <div className="space-y-5">
          <p className="text-[12px] text-muted-foreground max-w-3xl">
            La commission est payée <span className="text-foreground font-medium">tous les mois</span>, sur le
            bulletin. Une ligne = un mois. Le trait marque la dernière échéance réglée : au-dessus ce qui
            reste à verser, en dessous l&apos;historique payé.
            {data.lastPayment && (
              <> Dernier versement : <span className="text-foreground font-medium">paie de {monthLabelFr(data.lastPayment.payslipMonth)}</span>,
              envoyée au cabinet le {dateFr(data.lastPayment.sentAt)} par {data.lastPayment.sentBy}.</>
            )}
          </p>

          {data.commerciaux.length === 0 && (
            <p className="py-6 text-center text-[13px] text-muted-foreground">
              Aucune commission calculée — aucune facture depuis la date de début de prime.
            </p>
          )}

          {data.commerciaux.map((c) => (
            <CommercialStatement key={c.slp} c={c} paidThrough={data.paidThrough} />
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}

function CommercialStatement({ c, paidThrough }: { c: Commercial; paidThrough: string | null }) {
  // Les lignes arrivent du plus RÉCENT au plus ancien : le trait se pose donc
  // juste AVANT le premier mois réglé (tout ce qui suit est de l'historique).
  const firstSettled = c.lines.findIndex((l) => l.settled);

  return (
    <div className="rounded-xl border border-border bg-secondary/15 overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3.5 py-2.5 border-b border-border/60">
        <span className="text-[15px] font-bold text-foreground">{c.slp}</span>
        <span className="text-[10.5px] text-muted-foreground">
          prime {(c.rate * 100).toFixed(0)} % · depuis le {dateFr(c.since)}
        </span>
        <span className="ml-auto inline-flex items-baseline gap-4">
          <Total label="Reste à payer" v={eur2(c.totals.due)} tone="brand" />
          <Total label="Déjà payé" v={eur2(c.totals.paid)} />
          {Math.abs(c.totals.drift) >= 0.01 && (
            <Total label="À régulariser" v={eur2(c.totals.drift)} tone="amber" />
          )}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px] tnum tabular-nums">
          <thead>
            <tr className="text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground/80 border-b border-border/60">
              <th className="text-left font-semibold px-3.5 py-1.5">Mois</th>
              <th className="text-right font-semibold px-3 py-1.5">Factures</th>
              <th className="text-right font-semibold px-3 py-1.5">Base retenue</th>
              <th className="text-right font-semibold px-3 py-1.5">Commission</th>
              <th className="text-left font-semibold px-3 py-1.5">Statut</th>
            </tr>
          </thead>
          <tbody>
            {c.lines.map((l, i) => (
              <MonthRow
                key={l.month}
                l={l}
                /* Le TRAIT : posé sur la première ligne réglée. */
                rule={i === firstSettled ? paidThrough : null}
              />
            ))}
            {c.lines.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3.5 py-5 text-center text-[12px] text-muted-foreground">
                  Aucun mois commissionné.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {firstSettled === -1 && c.lines.length > 0 && (
        <p className="px-3.5 py-2 text-[11px] text-muted-foreground border-t border-border/60">
          Aucune échéance réglée à ce jour — l&apos;intégralité reste à verser.
        </p>
      )}
    </div>
  );
}

/** Le TRAIT de paie + la ligne d'un mois. */
function MonthRow({ l, rule }: { l: Line; rule: string | null }) {
  return (
    <>
      {rule && (
        <tr>
          <td colSpan={5} className="px-3.5 pt-3 pb-1">
            <div className="flex items-center gap-2.5">
              <span className="h-px flex-1 bg-foreground/40" />
              <span className="text-[10px] uppercase tracking-[0.12em] font-bold text-foreground whitespace-nowrap">
                Payé jusqu&apos;à {monthLabelFr(rule)}
              </span>
              <span className="h-px flex-1 bg-foreground/40" />
            </div>
          </td>
        </tr>
      )}
      <tr className={`border-b border-border/30 ${l.settled ? "" : "bg-brand-500/[0.06]"}`}>
        <td className="px-3.5 py-1.5 whitespace-nowrap capitalize font-medium text-foreground">
          {monthLabelFr(l.month)}
        </td>
        <td className="px-3 py-1.5 text-right text-foreground/70">
          {l.invoices}
          {l.avoirs > 0 && (
            <span className="text-[9.5px] text-rose-300/90 ml-1">avoirs −{eur2(l.avoirs)}</span>
          )}
        </td>
        <td className="px-3 py-1.5 text-right text-foreground/80">{eur2(l.base)}</td>
        <td className="px-3 py-1.5 text-right font-bold whitespace-nowrap">
          {/* Un mois payé montre le montant VERSÉ (figé), pas le recalcul du jour. */}
          <span className={l.settled ? "text-foreground" : "text-brand-400"}>
            {eur2(l.settled && l.paid ? l.paid.prime : l.prime)}
          </span>
          {l.settled && Math.abs(l.drift) >= 0.01 && (
            <span className="block text-[9.5px] font-semibold text-amber-300 leading-tight">
              {l.drift > 0 ? "+" : "−"}{eur2(Math.abs(l.drift))} depuis
            </span>
          )}
        </td>
        <td className="px-3 py-1.5 text-[10.5px] whitespace-nowrap">
          {l.settled ? (
            l.paid ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Check className="h-3 w-3 text-emerald-400" />
                Payé le {dateFr(l.paid.sentAt)}
                <span className="text-muted-foreground/70">· paie {monthLabelFr(l.paid.payslipMonth)}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted-foreground" title="Mois antérieur au curseur, mais sans trace de versement dans l'application (curseur posé à la main).">
                <Check className="h-3 w-3 text-emerald-400/60" /> Réglé — sans trace détaillée
              </span>
            )
          ) : (
            <span className="inline-flex items-center gap-1 font-semibold text-brand-400">
              <Clock3 className="h-3 w-3" /> À payer
            </span>
          )}
          {l.settled && Math.abs(l.drift) >= 0.01 && (
            <span className="ml-1.5 inline-flex items-center gap-1 text-amber-300" title="Des documents sont arrivés après le versement : l'écart est à régulariser sur une prochaine paie.">
              <AlertTriangle className="h-3 w-3" /> à régulariser
            </span>
          )}
        </td>
      </tr>
    </>
  );
}

function Total({ label, v, tone }: { label: string; v: string; tone?: "brand" | "amber" }) {
  const c = tone === "brand" ? "text-brand-400" : tone === "amber" ? "text-amber-300" : "text-foreground";
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[9.5px] uppercase tracking-[0.1em] font-semibold text-muted-foreground">{label}</span>
      <span className={`text-[13px] font-bold tnum ${c}`}>{v}</span>
    </span>
  );
}
