"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ClientLink } from "@/components/ClientLink";
import { useJson } from "./use-json";

/**
 * Alertes — encours dépassés / factures en retard (GET /api/encours).
 *
 * Top 5 clients en retard (> 30 j au-delà de l'échéance, règle métier 30 j de
 * conditions de paiement). État vide = vert rassurant. Lecture SAP directe →
 * pas d'auto-refresh (appel coûteux), un chargement par visite suffit.
 */

interface EncoursClient {
  cardCode?: string;
  cardName?: string;
  encours?: number;
  b3045?: number;
  b4590?: number;
  b90?: number;
  countLate?: number;
  maxOverdueDays?: number;
}
interface EncoursResponse {
  ok?: boolean;
  totals?: { overdueTotal?: number; encours?: number };
  clients?: EncoursClient[];
}

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n) + " €";

/** Montant en retard d'un client (tranches exclusives sommées). */
const lateOf = (c: EncoursClient) => (c.b3045 ?? 0) + (c.b4590 ?? 0) + (c.b90 ?? 0);

export function AlertesEncours() {
  const { data, state } = useJson<EncoursResponse>("/api/encours");
  const late = (data?.clients ?? [])
    .filter((c) => (c.countLate ?? 0) > 0)
    .sort((a, b) => lateOf(b) - lateOf(a))
    .slice(0, 5);
  const overdueTotal = data?.totals?.overdueTotal ?? 0;

  return (
    <SurfaceCard
      title="Alertes encours"
      icon={<AlertTriangle className="h-3.5 w-3.5" />}
      accent={state === "ok" && late.length === 0 ? "emerald" : "rose"}
      delay={110}
      action={
        state === "ok" && late.length > 0 ? (
          <span className="inline-flex items-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 px-2 h-5 text-[10.5px] font-bold tnum">
            {eur(overdueTotal)} en retard
          </span>
        ) : undefined
      }
    >
      {state === "loading" && (
        <ul className="space-y-1.5">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-8 rounded-lg bg-secondary/60 animate-pulse" />
          ))}
        </ul>
      )}

      {state === "error" && (
        <p className="text-[12px] text-muted-foreground py-3 text-center">
          Encours indisponibles pour le moment (lecture SAP).
        </p>
      )}

      {state === "ok" && late.length === 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-emerald-500/[0.07] border border-emerald-500/20 px-3 py-3">
          <ShieldCheck className="h-5 w-5 text-emerald-500 shrink-0" aria-hidden />
          <div>
            <p className="text-[12.5px] font-semibold text-emerald-600 dark:text-emerald-400">
              Aucun retard de paiement
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Tous les encours sont dans les délais. Rien à signaler.
            </p>
          </div>
        </div>
      )}

      {state === "ok" && late.length > 0 && (
        <>
          <ul className="divide-y divide-border/60">
            {late.map((c) => (
              <li key={c.cardCode ?? c.cardName} className="flex items-center gap-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                  {c.cardCode ? <ClientLink code={c.cardCode} name={c.cardName} preferCode /> : c.cardName ?? "—"}
                </span>
                <span className="shrink-0 text-[12px] font-semibold text-rose-600 dark:text-rose-400 tnum">
                  {eur(lateOf(c))}
                </span>
                <span
                  className="shrink-0 inline-flex items-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 px-1.5 h-[18px] min-w-[34px] justify-center text-[10px] font-bold tnum"
                  title="Retard maximal au-delà de l'échéance"
                >
                  {c.maxOverdueDays ?? 0} j
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/encours"
            className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-500 hover:text-brand-400 transition-colors"
          >
            Voir tous les encours
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </>
      )}
    </SurfaceCard>
  );
}
