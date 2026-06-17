"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Snowflake } from "lucide-react";
import { DUR, EASE } from "@/lib/motion";
import { Badge } from "@/components/ui/badge";

/**
 * Encours / limite de crédit du client.
 *
 * Lit /api/sap/clients/[id]/credit (miroir SapBusinessPartner — SAP
 * CreditLimit / CurrentAccountBalance / Frozen). Affiche limite, encours,
 * % utilisé (barre), badge « Compte gelé » (Frozen) et « Encours dépassé ».
 * Le parent ne monte l'encart QUE si available=true (pas de bruit si pas de donnée).
 */

type ApiOk = {
  available: true;
  creditLimit: number | null;
  balance: number | null;
  usagePct: number | null;
  overLimit: boolean;
  frozen: boolean;
};
type ApiHidden = { available: false; frozen?: boolean };
type Api = ApiOk | ApiHidden | { error: string };

const FMT_EUR = (n: number) => new Intl.NumberFormat("fr-FR", {
  style: "currency", currency: "EUR", maximumFractionDigits: 0,
}).format(n);

/** Hook partagé : permet à la fiche de ne pas réserver d'espace si pas de donnée. */
export function useCredit(clientId: string) {
  const [data, setData] = useState<Api | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sap/clients/${clientId}/credit`)
      .then((r) => r.json())
      .then((d: Api) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData({ available: false }); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [clientId]);

  return { data, loaded };
}

/** Barre d'usage du plafond — couleur selon le palier (vert/ambre/rose). */
function UsageBar({ pct, over }: { pct: number; over: boolean }) {
  const reduce = useReducedMotion();
  const clamped = Math.max(2, Math.min(100, pct));
  const color = over || pct >= 100
    ? "bg-rose-500"
    : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="h-2 w-full rounded-full bg-secondary/60 overflow-hidden">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: reduce ? `${clamped}%` : "0%" }}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: DUR.slow, ease: EASE.out }}
      />
    </div>
  );
}

export function EncoursCredit({ data }: { data: ApiOk }) {
  const { creditLimit, balance, usagePct, overLimit, frozen } = data;
  const hasLimit = creditLimit != null && creditLimit > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {frozen && (
          <Badge variant="destructive" className="gap-1">
            <Snowflake className="h-3 w-3" /> Compte gelé
          </Badge>
        )}
        {overLimit && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> Encours dépassé
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-border bg-card/40 px-3 py-2">
          <p className="kicker mb-1">Encours actuel</p>
          <p className={`text-[18px] font-semibold tabular-nums leading-none ${overLimit ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>
            {balance != null ? FMT_EUR(balance) : "—"}
          </p>
        </div>
        <div className="rounded-md border border-border bg-card/40 px-3 py-2">
          <p className="kicker mb-1">Limite de crédit</p>
          <p className="text-[18px] font-semibold tabular-nums leading-none text-foreground">
            {hasLimit ? FMT_EUR(creditLimit!) : "Non définie"}
          </p>
        </div>
      </div>

      {hasLimit && usagePct != null && (
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="kicker">Utilisation du plafond</span>
            <span className={`text-[12px] font-semibold tnum ${overLimit ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>
              {new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(usagePct)} %
            </span>
          </div>
          <UsageBar pct={usagePct} over={overLimit} />
        </div>
      )}

      <p className="text-[10.5px] text-muted-foreground">
        Source : miroir SAP (lecture seule). Modification réservée à SAP B1.
      </p>
    </div>
  );
}
