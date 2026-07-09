"use client";

import { useEffect, useState } from "react";
import { Boxes, Loader2, CalendarClock, Warehouse, Truck, BadgeEuro } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { StarRating } from "@/components/ui/star-rating";

/**
 * Détail des LOTS d'un article — ouvert au clic droit sur une ligne de la console.
 * Source : table locale ProductBatch (rapide, aucun appel SAP) via
 * /api/products/[id]/batches?inStock=1 (lots dont la DLC n'est pas dépassée),
 * triés FEFO. Le stock PAR LOT est tenu par TeleVent (registre lib/lotLedger) :
 * crédité à la réception (quantité + fournisseur + prix d'achat), décrémenté à la
 * vente — quand la valeur est là, on affiche la quantité restante, le fournisseur
 * et le prix d'achat du lot. Les lots avec du stock (quantité > 0) sont en tête.
 */

interface Batch {
  batchNumber: string;
  quantity: number;               // registre TeleVent : quantité restante (unité SAP)
  warehouseCode: string | null;
  status: string | null;
  expirationDate: string | null;
  supplierName?: string | null;   // fournisseur (crédité à la réception)
  purchasePrice?: number | null;  // prix d'achat €/unité SAP
  currency?: string | null;
  rating?: number | null;         // note qualité 1..5 (étoiles) du lot
}
interface Props {
  item: { id: string; code: string; name: string; dispo?: number; unit?: string; packDivisor?: number } | null;
  onClose: () => void;
}

const fmtDlc = (iso: string | null): string | null =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : null;
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
/** Lot verrouillé côté SAP (bdsStatus_Locked) — non vendable, signalé. */
const isLocked = (status: string | null | undefined): boolean => /lock/i.test(status ?? "");

export function LotDetailsDialog({ item, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setLoading(true); setBatches([]);
    (async () => {
      try {
        const r = await fetch(`/api/products/${encodeURIComponent(item.id)}/batches?inStock=1`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (!cancelled) setBatches(Array.isArray(j?.batches) ? j.batches : []);
      } catch { /* silencieux */ } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [item]);

  const dispo = item?.dispo;
  const unit = item?.unit || "colis";
  const packDivisor = item?.packDivisor && item.packDivisor > 0 ? item.packDivisor : 1;
  const hasStock = dispo == null || dispo > 0;   // dispo inconnu → on n'exclut rien

  // Lots AVEC stock (registre) en tête, puis l'ordre FEFO renvoyé par l'API.
  const sorted = [...batches].sort((a, b) => (b.quantity > 0 ? 1 : 0) - (a.quantity > 0 ? 1 : 0));
  // Quantité d'un lot en unité d'affichage (colis) — le registre stocke en pie/kg.
  const lotColis = (q: number) => Math.round((q / packDivisor) * 10) / 10;

  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            Lots — {item?.name}
          </DialogTitle>
          <DialogDescription>
            Code article <span className="font-mono text-foreground">{item?.code}</span>
            {dispo != null && <> · en stock <span className="font-semibold text-foreground tnum">{fmtQty(dispo)} {unit}</span></>}
            {" "}· quantité par lot, fournisseur &amp; prix d&apos;achat (décrémentés à la vente).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-4 text-[13px] text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement des lots…
          </p>
        ) : sorted.length === 0 ? (
          <p className="py-4 text-[13px] italic text-muted-foreground">
            {hasStock
              ? "Article en stock, mais aucun lot suivi en base pour cet article (non géré par lot)."
              : "Aucun lot — article épuisé."}
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
            {sorted.map((b, i) => {
              const d = fmtDlc(b.expirationDate);
              const locked = isLocked(b.status);
              const hasQty = b.quantity > 0;
              return (
                <li key={`${b.batchNumber}-${i}`} className="rounded-lg border border-border bg-secondary/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                      <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Lot {i + 1}</span>
                      <span className="font-mono">{b.batchNumber}</span>
                      {b.rating ? <StarRating value={b.rating} size="sm" /> : null}
                    </span>
                    {/* Quantité restante du registre (en colis). Le stock par lot
                        n'existe pas dans SAP : on ne l'affiche que si le registre
                        TeleVent l'a alimentée (> 0). */}
                    {hasQty ? (
                      <span className="rounded-md bg-brand-500/10 px-2 py-0.5 text-[12px] font-bold tnum text-brand-700 dark:text-brand-300">
                        {fmtQty(lotColis(b.quantity))} {unit}
                      </span>
                    ) : locked ? (
                      <span className="rounded-md bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-600 dark:text-rose-300">Bloqué</span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground tnum">
                    {d
                      ? <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" /> DLC {d}</span>
                      : <span className="italic">DLC non renseignée</span>}
                    {b.supplierName && <span className="inline-flex items-center gap-1 min-w-0"><Truck className="h-3 w-3 shrink-0" /> <span className="truncate">{b.supplierName}</span></span>}
                    {b.purchasePrice != null && b.purchasePrice > 0 && (
                      <span className="inline-flex items-center gap-1"><BadgeEuro className="h-3 w-3" /> {b.purchasePrice.toFixed(2)} €{b.currency && b.currency !== "EUR" ? ` ${b.currency}` : ""}</span>
                    )}
                    {b.warehouseCode && <span className="inline-flex items-center gap-1"><Warehouse className="h-3 w-3" /> {b.warehouseCode}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
