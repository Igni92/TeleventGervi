"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Minus, Users } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { DUR, EASE } from "@/lib/motion";

/**
 * Familles régulières du client vs **médiane du même groupe SAP** sur N-1.
 *
 * - Volume en **kg** (poids = quantity × salesUnitWeight, agrégé).
 * - **Familles effectives** : sous-groupes fruits rouges (myrtille / groseille /
 *   mûre / framboise / cassis) séparés, fraises fusionnées (cf. lib/familles.ts).
 * - Dead-band ±10 % autour de la médiane.
 */

type Direction = "up" | "down" | "neutral";

type Family = {
  familyKey: string;
  familyLabel: string;
  clientKg: number;
  groupMedianKg: number;
  peerCount: number;
  ratio: number | null;
  direction: Direction;
};

type ApiOk = {
  ok: true;
  sapGroupCode?: number | null;
  sapGroupName?: string | null;
  groupSize: number;
  period?: { year: number };
  families: Family[];
  reason?: "no-group" | "no-peers" | "no-data";
};

type ApiErr = { ok: false; error?: string };

export function formatKg(kg: number): string {
  if (!Number.isFinite(kg)) return "—";
  if (Math.abs(kg) >= 1000) {
    return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(kg / 1000)} t`;
  }
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(kg)} kg`;
}

export function FamillesVsGroupe({ clientId }: { clientId: string }) {
  const [data, setData] = useState<ApiOk | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/clients/${clientId}/familles-vs-groupe`)
      .then((r) => r.json())
      .then((d: ApiOk | ApiErr) => {
        if (cancelled) return;
        if (d.ok) setData(d);
        else setError(d.error ?? "Erreur inattendue");
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading) return <p className="text-sm text-muted-foreground">Chargement…</p>;
  if (error) return <p className="text-sm text-rose-500">{error}</p>;
  if (!data) return null;

  const reasonMsg: Record<NonNullable<ApiOk["reason"]>, string> = {
    "no-group": "Groupe SAP non renseigné pour ce client — la comparaison nécessite un sapGroupCode (relance /api/sap/sync/client-groups si manquant).",
    "no-peers": "Aucun autre client dans ce groupe SAP — rien à comparer.",
    "no-data": `Aucune facture sur l'année ${new Date().getFullYear() - 1} pour ce client.`,
  };
  if (data.reason) return <p className="text-sm text-muted-foreground">{reasonMsg[data.reason]}</p>;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 opacity-70" />
          Groupe{" "}
          <span className="text-foreground font-medium">
            {data.sapGroupName ?? `#${data.sapGroupCode ?? "—"}`}
          </span>
          <span className="opacity-60">· {data.groupSize} pair{data.groupSize > 1 ? "s" : ""}</span>
        </span>
        {data.period?.year != null && (
          <span className="font-mono opacity-70">N-1 = {data.period.year}</span>
        )}
      </div>

      <ul className="space-y-1.5">
        {data.families.map((f, i) => (
          <FamilyRow key={f.familyKey} family={f} index={i} />
        ))}
      </ul>
    </div>
  );
}

function FamilyRow({ family, index }: { family: Family; index: number }) {
  const reduce = useReducedMotion();
  const Icon = family.direction === "up" ? ArrowUp : family.direction === "down" ? ArrowDown : Minus;
  const tone =
    family.direction === "up"
      ? "text-emerald-500 bg-emerald-500/10 ring-emerald-500/20"
      : family.direction === "down"
        ? "text-orange-500 bg-orange-500/10 ring-orange-500/20"
        : "text-muted-foreground bg-muted/40 ring-border";

  const pct =
    family.ratio != null
      ? `${family.ratio >= 1 ? "+" : ""}${Math.round((family.ratio - 1) * 100)} %`
      : "nouveau";

  const content = (
    <li
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-card/40 px-3 py-2"
      aria-label={`${family.familyLabel} : ${formatKg(family.clientKg)} vs médiane ${formatKg(family.groupMedianKg)} (${family.peerCount} pairs) — ${family.direction === "up" ? "au-dessus" : family.direction === "down" ? "en-dessous" : "proche"}`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{family.familyLabel}</p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {formatKg(family.clientKg)}
          <span className="mx-1.5 opacity-50">·</span>
          médiane {formatKg(family.groupMedianKg)}
          <span className="mx-1.5 opacity-50">·</span>
          {family.peerCount} pair{family.peerCount > 1 ? "s" : ""}
        </p>
      </div>
      <div className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 ring-1 ${tone}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span className="text-[11px] font-medium tabular-nums">{pct}</span>
      </div>
    </li>
  );

  if (reduce) return content;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.base, ease: EASE.out, delay: 0.04 * index }}
    >
      {content}
    </motion.div>
  );
}
