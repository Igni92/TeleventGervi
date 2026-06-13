"use client";

import { useEffect, useState } from "react";
import { ShoppingCart, Package } from "lucide-react";
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

/**
 * Bandeau "Habitudes" en haut de la fiche client (Console 1).
 * 2 tuiles : **dernière commande** (CRM, avec fallback SAP) + **top familles
 * produits** (agrégées par famille de fruit côté API — Fraise mergée, fruits
 * rouges différenciés).
 *
 * NB. La tuile "Dernier achat SAP" a été retirée — c'était un doublon avec
 * "Dernière commande" pour l'agent en plein appel (la précision « date SAP »
 * se lit sur l'Écran 2 / l'historique).
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

  // Fallback : si pas de CRM mais SAP a une date, on l'utilise.
  const lastSrc: string | null = lastCallOrder?.heureAppel ?? data?.lastOrderDate ?? null;

  /** Style commun — bordure nette (pas de gradient), corps tabulaire. */
  const tile = "rounded-md border border-border bg-card px-3 py-2.5 min-w-0";

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {/* Dernière commande */}
      <div className={tile}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <ShoppingCart className="h-3 w-3 text-muted-foreground" />
          <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-foreground/80">
            Dernière commande
          </p>
        </div>
        {lastSrc ? (
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[15px] font-semibold text-foreground tnum leading-tight">
              {formatRelative(lastSrc)}
            </p>
            {ordersCount && ordersCount > 1 ? (
              <p className="text-[10.5px] text-muted-foreground tnum">
                {ordersCount} cdes / 180 j
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] italic text-muted-foreground/60 leading-tight">aucune récente</p>
        )}
      </div>

      {/* Top familles produits */}
      <div className={tile}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Package className="h-3 w-3 text-muted-foreground" />
          <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-foreground/80">
            Familles régulières
          </p>
        </div>
        {loading ? (
          <p className="text-[13px] italic text-muted-foreground/50 leading-tight">…</p>
        ) : data && data.topProducts.length > 0 ? (
          <ul className="space-y-0.5">
            {data.topProducts.map((p) => {
              const kg = p.weightKg ?? 0;
              // Si pas de poids (article sans salesUnitWeight en DB) → fallback compteur ×N
              // pour ne pas afficher "0 kg" trompeur.
              const showWeight = kg > 0;
              return (
                <li key={p.itemCode} className="flex items-baseline gap-2 text-[12.5px] leading-snug">
                  <span className="text-foreground truncate flex-1" title={p.itemName}>{p.itemName}</span>
                  <span
                    className="text-[11px] tnum font-semibold text-foreground/85 shrink-0"
                    title={`${p.orderCount} commande${p.orderCount > 1 ? "s" : ""} sur 10`}
                  >
                    {showWeight
                      ? `${kg < 10 ? kg.toFixed(1) : Math.round(kg)} kg`
                      : `×${p.orderCount}`}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13px] italic text-muted-foreground/60 leading-tight">aucun historique</p>
        )}
      </div>
    </section>
  );
}
