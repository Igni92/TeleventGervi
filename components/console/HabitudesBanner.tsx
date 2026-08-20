"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Truck, Package, ArrowUpRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
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

const fmtKg = (kg: number) => (kg < 10 ? kg.toFixed(1).replace(".", ",") : String(Math.round(kg)));

/**
 * Bandeau "Habitudes" en haut de la fiche client (Console 1).
 * 2 tuiles :
 *   - **Dernière livraison** : date du dernier BL SAP (fallback CRM si SAP KO).
 *   - **Familles régulières** : pastilles des familles de fruit classées par
 *     poids médian par commande. Chaque pastille est CLIQUABLE : elle ouvre
 *     l'historique du client (nouvel onglet) sans quitter la console.
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
          <p className="text-caption2 uppercase tracking-[0.14em] font-semibold text-foreground/80">
            Dernière livraison
          </p>
        </div>
        {lastSrc ? (
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-title3 font-bold text-foreground tnum leading-tight">
              {formatRelative(lastSrc)}
            </p>
            {ordersCount && ordersCount > 1 ? (
              <p className="text-caption2 text-muted-foreground tnum shrink-0">
                {ordersCount} cdes / 180 j
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-body italic text-muted-foreground/60 leading-tight">aucune récente</p>
        )}
      </div>

      {/* Familles régulières — pastilles cliquables (→ historique client) */}
      <div className="rounded-xl border border-border bg-card px-3.5 py-3 min-w-0">
        <div className="flex items-center gap-1.5 mb-2">
          <Package className="h-3 w-3 text-muted-foreground" />
          <p className="text-caption2 uppercase tracking-[0.14em] font-semibold text-foreground/80">
            Familles régulières
          </p>
          <span className="text-caption2 text-muted-foreground/60 normal-case tracking-normal font-normal">
            poids médian / commande
          </span>
        </div>
        {loading ? (
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[62px] rounded-xl" />
            ))}
          </div>
        ) : data && data.topProducts.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {data.topProducts.map((p) => {
              const kg = p.weightKg ?? 0;
              const showWeight = kg > 0;
              const nb = `${p.orderCount} cde${p.orderCount > 1 ? "s" : ""}`;
              return (
                <Link
                  key={p.itemCode}
                  href={`/clients/${clientId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Voir l'historique — ${p.itemName} · ${showWeight ? `${fmtKg(kg)} kg médian / commande` : nb} (médiane saisonnière sur ${nb})`}
                  className="group relative rounded-xl border border-border bg-secondary/40 px-2 py-2 text-center min-w-0 transition-all hover:border-primary/50 hover:bg-secondary active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowUpRight className="absolute right-1.5 top-1.5 h-3 w-3 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" aria-hidden />
                  <p className="text-caption2 font-semibold truncate text-foreground">{p.itemName}</p>
                  {showWeight ? (
                    <>
                      <p className="text-title3 font-bold text-foreground tnum leading-none mt-0.5">
                        {fmtKg(kg)}<span className="text-caption2 font-semibold ml-0.5">kg</span>
                      </p>
                      <p className="text-caption2 uppercase tracking-[0.1em] text-foreground/55 mt-0.5">/ cde</p>
                    </>
                  ) : (
                    <p className="text-callout font-bold text-foreground tnum leading-tight mt-1">
                      ×{p.orderCount}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="text-body italic text-muted-foreground/60 leading-tight">aucun historique</p>
        )}
      </div>
    </section>
  );
}
