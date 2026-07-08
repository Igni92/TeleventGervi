"use client";

import { useEffect, useState } from "react";
import { Boxes, Loader2, CalendarClock, Warehouse } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

/**
 * Détail des LOTS d'un article — ouvert au CLIC DROIT sur une ligne produit de
 * la console. Réunit les lots connus (EM récentes — /api/lots/candidates) et
 * leur DLC (/api/lots/dlc). Lecture seule, best-effort.
 */

interface Candidate { lot: string; docNum: number; warehouse: string | null; affect: string }
interface Props { item: { code: string; name: string } | null; onClose: () => void }

const fmtDlc = (iso: string | null): string | null =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : null;

export function LotDetailsDialog({ item, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [dlc, setDlc] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setLoading(true); setCands([]); setDlc({});
    (async () => {
      try {
        const r = await fetch(`/api/lots/candidates?items=${encodeURIComponent(item.code)}`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        const list: Candidate[] = j?.ok ? (j.items?.[item.code]?.candidates ?? []) : [];
        if (cancelled) return;
        setCands(list);
        const batches = list.map((c) => c.lot);
        if (batches.length) {
          const rd = await fetch(`/api/lots/dlc?batches=${batches.join(",")}`, { cache: "no-store" });
          const jd = await rd.json().catch(() => null);
          if (!cancelled && jd?.dlc) setDlc(jd.dlc);
        }
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
            Lots — {item?.name}
          </DialogTitle>
          <DialogDescription>
            Code article <span className="font-mono text-foreground">{item?.code}</span> · lots connus (entrées récentes) et leur fraîcheur.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-4 text-[13px] text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement des lots…
          </p>
        ) : cands.length === 0 ? (
          <p className="py-4 text-[13px] italic text-muted-foreground">Aucun lot connu pour cet article.</p>
        ) : (
          <ul className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
            {cands.map((c, i) => {
              const d = fmtDlc(dlc[c.lot] ?? null);
              return (
                <li key={c.lot} className="rounded-lg border border-border bg-secondary/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                      <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Lot {i + 1}</span>
                      <span className="font-mono">{c.lot}</span>
                    </span>
                    {c.affect && c.affect !== "TOUS" && (
                      <span className="rounded-md bg-brand-500/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-brand-700 dark:text-brand-300">{c.affect}</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground tnum">
                    {d
                      ? <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" /> DLC {d}</span>
                      : <span className="italic">DLC non renseignée</span>}
                    {c.warehouse && <span className="inline-flex items-center gap-1"><Warehouse className="h-3 w-3" /> {c.warehouse}</span>}
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
