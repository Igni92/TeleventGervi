"use client";

import { useCallback, useEffect, useState } from "react";
import { History, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { LotBadge, eur, colis } from "./ui";

/**
 * Historique des runs de fabrication (traçabilité locale FabricationRun) :
 * date, OP, parent, colis, coût, lots affectés, documents SAP, statut.
 */

type RunLine = {
  family: string; familyLabel: string | null; itemCode: string; itemName: string | null;
  batchNumber: string; colisQty: number; purchasePrice: number | null;
  warehouseCode: string | null; // magasin SOURCE de la sortie (multi-magasins)
};
type Run = {
  id: string; opCode: string | null; parentItemCode: string; parentItemName: string | null;
  parentColis: number; warehouseCode: string; totalCost: number | null; parentValue: number | null;
  status: string; error: string | null;
  sapExitDocNum: number | null; sapEntryDocNum: number | null;
  createdAt: string; createdBy: string | null;
  lines: RunLine[];
};

const STATUS_STYLE: Record<string, string> = {
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/25 dark:text-emerald-100",
  error: "bg-rose-100 text-rose-700 dark:bg-rose-500/25 dark:text-rose-200",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-500/25 dark:text-amber-100",
};
const STATUS_LABEL: Record<string, string> = { done: "OK", error: "Erreur", pending: "En cours" };

export function RunsHistory({ version }: { version: number }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/fabrication/runs?last=12", { cache: "no-store" });
      const j = await r.json();
      setRuns(j.runs ?? []);
    } catch { setRuns([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, version]);

  return (
    <SurfaceCard accent="sky" title="Historique des fabrications" icon={<History className="h-3.5 w-3.5" />}
      action={
        <Button variant="ghost" size="icon-sm" onClick={load} disabled={loading} aria-label="Actualiser">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      }
      className="p-5">
      {runs.length === 0 ? (
        <p className="text-[13px] italic text-muted-foreground">
          {loading ? "Chargement…" : "Aucune fabrication enregistrée pour l'instant."}
        </p>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-card/50 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex h-5 items-center px-1.5 rounded text-[11px] font-semibold ${STATUS_STYLE[r.status] ?? STATUS_STYLE.pending}`}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  <span className="font-mono text-[12px] text-muted-foreground">{r.opCode ?? "—"}</span>
                  <span className="text-[14px] font-semibold">
                    {colis(r.parentColis)} colis {r.parentItemName ?? r.parentItemCode}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">({r.parentItemCode} · entrée {r.warehouseCode})</span>
                </div>
                <div className="text-right text-[12.5px] text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  {r.createdBy ? ` · ${r.createdBy}` : ""}
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap text-[12.5px]">
                {r.lines.map((l, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5">
                    <span className="text-muted-foreground">{l.familyLabel ?? l.family}</span>
                    <span className="font-mono text-[11px]">{l.itemCode}</span>
                    <span className="font-semibold tnum">{colis(l.colisQty)} colis</span>
                    {l.warehouseCode && l.warehouseCode !== r.warehouseCode && (
                      <span className="font-mono text-[11px] text-muted-foreground">de {l.warehouseCode}</span>
                    )}
                    <LotBadge batchNumber={l.batchNumber} pending={l.batchNumber === "EM_PENDING"} />
                  </span>
                ))}
              </div>
              <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[12.5px] text-muted-foreground">
                {r.totalCost != null && <span>Coût <b className="text-foreground">{eur(r.totalCost)}</b></span>}
                {r.parentValue != null && r.totalCost != null && (
                  <span>Marge estimée{" "}
                    <b className={r.parentValue - r.totalCost >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}>
                      {eur(Math.round((r.parentValue - r.totalCost) * 100) / 100)}
                    </b>
                  </span>
                )}
                {r.sapExitDocNum != null && <span>Sortie SAP <b className="text-foreground"># {r.sapExitDocNum}</b></span>}
                {r.sapEntryDocNum != null && <span>Entrée SAP <b className="text-foreground"># {r.sapEntryDocNum}</b></span>}
                {r.error && <span className="text-rose-500">{r.error}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}
