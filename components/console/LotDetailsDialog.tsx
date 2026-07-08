"use client";

import { useEffect, useState } from "react";
import { Boxes, Loader2, CalendarClock, Warehouse } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

/**
 * Détail des LOTS EN STOCK d'un article — ouvert au clic droit sur une ligne de
 * la console. Source : table locale ProductBatch (rapide, aucun appel SAP) via
 * /api/products/[id]/batches?inStock=1 → seulement les lots encore en stock
 * (quantity > 0), triés FEFO (DLC la plus proche d'abord).
 */

interface Batch {
  batchNumber: string;
  quantity: number;
  warehouseCode: string | null;
  status: string | null;
  expirationDate: string | null;
}
interface Props { item: { id: string; code: string; name: string } | null; onClose: () => void }

const fmtDlc = (iso: string | null): string | null =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : null;
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

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

  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            Lots en stock — {item?.name}
          </DialogTitle>
          <DialogDescription>
            Code article <span className="font-mono text-foreground">{item?.code}</span> · lots encore en stock (quantité &gt; 0), DLC la plus proche d&apos;abord.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-4 text-[13px] text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement des lots…
          </p>
        ) : batches.length === 0 ? (
          <p className="py-4 text-[13px] italic text-muted-foreground">Aucun lot en stock pour cet article.</p>
        ) : (
          <ul className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
            {batches.map((b, i) => {
              const d = fmtDlc(b.expirationDate);
              return (
                <li key={`${b.batchNumber}-${i}`} className="rounded-lg border border-border bg-secondary/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                      <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Lot {i + 1}</span>
                      <span className="font-mono">{b.batchNumber}</span>
                    </span>
                    <span className="rounded-md bg-brand-500/10 px-2 py-0.5 text-[12px] font-bold tnum text-brand-700 dark:text-brand-300">
                      Qté {fmtQty(b.quantity)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground tnum">
                    {d
                      ? <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" /> DLC {d}</span>
                      : <span className="italic">DLC non renseignée</span>}
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
