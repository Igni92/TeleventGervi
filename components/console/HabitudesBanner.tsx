"use client";

import { useEffect, useState } from "react";
import { Truck, Package } from "lucide-react";
import { formatRelative } from "@/lib/utils";

interface HabitsData {
  lastOrderDate: string | null;
  topProducts: { itemCode: string; itemName: string; orderCount: number; weightKg?: number }[];
}

interface Props {
  /** Client DB id */
  clientId: string;
  /** Dernière commande CRM (depuis appels.COMMANDE) — fallback si SAP indisponible */
  lastCallOrder?: { heureAppel: string } | null;
  /** Nombre total de commandes (CRM) sur la fenêtre 180j — pour info */
  ordersCount?: number;
}

/** Tons des 3 pastilles — hiérarchie forte, rang 1 = accent principal (or). */
const TONES = [
  { pill: "border-brand-500/35 bg-brand-500/12", name: "text-brand-700 dark:text-brand-300" },
  { pill: "border-emerald-500/35 bg-emerald-500/12", name: "text-emerald-700 dark:text-emerald-300" },
  { pill: "border-sky-500/35 bg-sky-500/12", name: "text-sky-700 dark:text-sky-300" },
] as const;

const fmtKg = (kg: number) => (kg < 10 ? kg.toFixed(1).replace(".", ",") : String(Math.round(kg)));

/**
 * Bandeau "Habitudes" en haut de la fiche client (Console 1).
 * 2 tuiles :
 *   - **Dernière livraison** : date du dernier BL SAP (fallback CRM si SAP KO).
 *   - **Familles régulières** : 3 pastilles très visuelles des familles de fruit
 *     classées par **poids médian par commande** (côté API). C'est le « quand
 *     ils en prennent, ils en prennent combien » — plus parlant que le cumul.
 */
export function HabitudesBanner({ clientId, lastCallOrder, ordersCount }: Props) {
  const [data, setData] = useState<HabitsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    fetch(`/api/sap/clients/${clientId}/habits`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: HabitsData) => { if (!cancelled) setData(j); })
      .catch(() => { if (!cancelled) setData({ lastOrderDate: null, topProducts: [] }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  // Dernière **livraison** = dernier BL SAP en priorité ; à défaut, la dernière
  // commande CRM (fallback si SAP indisponible).
  const lastSrc: string | null = data?.lastOrderDate ?? lastCallOrder?.heureAppel ?? null;

  return (
    <section className="grid grid-cols-1 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] gap-2.5">
      {/* Dernière livraison */}
      <div className="rounded-xl border border-border bg-card px-3.5 py-3 min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Truck className="h-3 w-3 text-muted-foreground" />
          <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-foreground/80">
            Dernière livraison
          </p>
        </div>
        {lastSrc ? (
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[17px] font-bold text-foreground tnum leading-tight">
              {formatRelative(lastSrc)}
            </p>
            {ordersCount && ordersCount > 1 ? (
              <p className="text-[10.5px] text-muted-foreground tnum shrink-0">
                {ordersCount} cdes / 180 j
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] italic text-muted-foreground/60 leading-tight">aucune récente</p>
        )}
      </div>

      {/* Familles régulières — 3 pastilles très visuelles */}
      <div className="rounded-xl border border-border bg-card px-3.5 py-3 min-w-0">
        <div className="flex items-center gap-1.5 mb-2">
          <Package className="h-3 w-3 text-muted-foreground" />
          <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-foreground/80">
            Familles régulières
          </p>
          <span className="text-[9.5px] text-muted-foreground/60 normal-case tracking-normal font-normal">
            poids médian / commande
          </span>
        </div>
        {loading ? (
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[62px] rounded-xl border border-border/60 bg-secondary/30 animate-pulse" />
            ))}
          </div>
        ) : data && data.topProducts.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {data.topProducts.map((p, i) => {
              const tone = TONES[i] ?? TONES[TONES.length - 1];
              const kg = p.weightKg ?? 0;
              const showWeight = kg > 0;
              return (
                <div
                  key={p.itemCode}
                  className={`rounded-xl border ${tone.pill} px-2 py-2 text-center min-w-0`}
                  title={`${p.itemName} — ${showWeight ? `${fmtKg(kg)} kg médian / commande` : `${p.orderCount} cde${p.orderCount > 1 ? "s" : ""}`} sur 10 cdes`}
                >
                  <p className={`text-[11px] font-semibold truncate ${tone.name}`}>{p.itemName}</p>
                  {showWeight ? (
                    <>
                      <p className="text-[19px] font-bold text-foreground tnum leading-none mt-0.5">
                        {fmtKg(kg)}<span className="text-[11px] font-semibold ml-0.5">kg</span>
                      </p>
                      <p className="text-[8.5px] uppercase tracking-[0.1em] text-muted-foreground/70 mt-0.5">/ cde</p>
                    </>
                  ) : (
                    <p className="text-[15px] font-bold text-foreground tnum leading-tight mt-1">
                      ×{p.orderCount}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] italic text-muted-foreground/60 leading-tight">aucun historique</p>
        )}
      </div>
    </section>
  );
}
