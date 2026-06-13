"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, History } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { AnimatedNumber } from "@/components/ui/animated-number";
import {
  OpenReceptionIncidents, ReceptionIncidentButton, useReceptionIncidents,
} from "./ReceptionIncidents";

type ReceiptLine = {
  itemCode: string; itemName?: string;
  pieceQuantity: number; packageQuantity: number | null;
  warehouse?: string;
};
type Receipt = {
  docEntry: number; docNum: number; lot: string; docDate: string;
  cardCode: string; cardName?: string; numAtCard: string;
  total: number; comments: string; lineCount: number; lines: ReceiptLine[];
};

/** Liste des derniers BR créés (SAP PurchaseDeliveryNotes). */
export function GoodsReceiptHistory() {
  const [docs, setDocs] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(false);
  const { incidents, loading: incLoading, reload: reloadIncidents, openCountByDoc } = useReceptionIncidents();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sap/goods-receipts?last=20", { cache: "no-store" });
      const json = await res.json();
      setDocs(json.docs ?? []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
    <SurfaceCard accent="sky" className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          Derniers bons de réception
        </h2>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Rafraîchir
        </Button>
      </div>

      {loading && docs.length === 0 && (
        <p className="text-[12px] italic text-muted-foreground py-2">Chargement…</p>
      )}

      {!loading && docs.length === 0 && (
        <p className="text-[12px] italic text-muted-foreground py-2">Aucun BR récent.</p>
      )}

      {docs.length > 0 && (
        <div className="flex flex-wrap gap-6 pb-1">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Réceptions</div>
            <div className="text-[20px] font-bold tnum text-foreground leading-tight">
              <AnimatedNumber value={docs.length} />
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Valeur cumulée</div>
            <div className="text-[20px] font-bold tnum text-emerald-600 dark:text-emerald-400 leading-tight">
              <AnimatedNumber
                value={docs.reduce((s, d) => s + (d.total ?? 0), 0)}
                format={(n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n)}
              />
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Lignes</div>
            <div className="text-[20px] font-bold tnum text-foreground leading-tight">
              <AnimatedNumber value={docs.reduce((s, d) => s + (d.lineCount ?? 0), 0)} />
            </div>
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-semibold w-24">DocNum</th>
                <th className="text-left px-3 py-2 font-semibold w-28">Lot</th>
                <th className="text-left px-3 py-2 font-semibold">Fournisseur</th>
                <th className="text-left px-3 py-2 font-semibold w-32">Date</th>
                <th className="text-right px-3 py-2 font-semibold w-20">Lignes</th>
                <th className="text-right px-3 py-2 font-semibold w-28">Total €</th>
                <th className="text-right px-3 py-2 font-semibold w-24">Incident</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.docEntry} className="border-t border-border hover:bg-secondary/30">
                  <td className="px-3 py-2 font-mono">#{d.docNum}</td>
                  <td className="px-3 py-2 font-mono">{d.lot}</td>
                  <td className="px-3 py-2">
                    <div className="truncate">{d.cardName ?? d.cardCode}</div>
                    {d.numAtCard && <div className="text-[11px] text-muted-foreground">BL {d.numAtCard}</div>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{d.docDate?.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right">{d.lineCount}</td>
                  <td className="px-3 py-2 text-right">{d.total.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">
                    <ReceptionIncidentButton
                      receipt={{ docEntry: d.docEntry, docNum: d.docNum, lot: d.lot, cardCode: d.cardCode, cardName: d.cardName }}
                      openCount={openCountByDoc.get(d.docEntry) ?? 0}
                      onChanged={reloadIncidents}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </SurfaceCard>

    <OpenReceptionIncidents incidents={incidents} loading={incLoading} onChanged={reloadIncidents} />
    </div>
  );
}
