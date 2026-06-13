"use client";

import { libelleUnite } from "@/lib/fabrication-optim";

/**
 * Petits éléments visuels partagés de la page Fabrication —
 * chips colorés marque / condi / origine (même DA que la Console Écran 2),
 * badges de lot (réel vs à découvert) et formats quantité/unité réelle.
 */

export function ChipMarque({ value }: { value: string }) {
  return (
    <span className="inline-flex h-5 items-center px-1.5 rounded text-[11px] font-semibold bg-violet-100 text-violet-800 dark:bg-violet-500/30 dark:text-violet-100 dark:ring-1 dark:ring-inset dark:ring-violet-400/50">
      {value}
    </span>
  );
}

export function ChipCondi({ value }: { value: string }) {
  return (
    <span className="inline-flex h-5 items-center px-1.5 rounded text-[11px] font-semibold bg-sky-100 text-sky-800 dark:bg-sky-500/30 dark:text-sky-100 dark:ring-1 dark:ring-inset dark:ring-sky-400/50">
      {value}
    </span>
  );
}

export function ChipPays({ value }: { value: string }) {
  return (
    <span className="inline-flex h-5 items-center px-1.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-500/30 dark:text-amber-100 dark:ring-1 dark:ring-inset dark:ring-amber-400/50">
      {value}
    </span>
  );
}

/** Badge lot : EM<DocNum> (neutre) ou EM_PENDING (rose « à découvert »). */
export function LotBadge({ batchNumber, pending }: { batchNumber: string; pending: boolean }) {
  if (pending) {
    return (
      <span className="inline-flex h-5 items-center gap-1 px-1.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-200 dark:ring-1 dark:ring-inset dark:ring-rose-400/50">
        À découvert · lot à réception
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 items-center px-1.5 rounded text-[11px] font-mono font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/25 dark:text-emerald-100 dark:ring-1 dark:ring-inset dark:ring-emerald-400/50">
      {batchNumber}
    </span>
  );
}

export const WAREHOUSES = [
  { code: "000", label: "000 · A/C-A/D" },
  { code: "01", label: "01 · Stock" },
  { code: "R1", label: "R1 · J+1" },
] as const;
export type WarehouseCode = (typeof WAREHOUSES)[number]["code"];

/** Format € lisible (2 décimales, espace insécable). */
export const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
/** Quantité colis : entier si rond, sinon 1 décimale. */
export const colis = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));
/** Quantité physique : entier si rond, sinon jusqu'à 3 décimales (virgule FR). */
export const qtePhys = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r).replace(".", ",");
};
/** « 8 colis », « 36 kg », « 3 barquettes » — unité de gestion réelle accordée. */
export const qte = (n: number, unite: string) => `${qtePhys(n)} ${libelleUnite(unite, n)}`;
