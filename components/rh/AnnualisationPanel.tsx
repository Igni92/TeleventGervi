"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ChevronLeft, ChevronRight, Gauge } from "lucide-react";

type Result = { heuresTheoAnnee: number; heuresTheoADate: number; heuresRealisees: number; soldeModulH: number; heuresSuppAnnee: number; contingent: number; contingentRestant: number; depasseContingent: boolean };
type Row = { employeeId: string; name: string; poste: string | null; saisonnier: boolean; contractHours: number; fractionPresence: number; fractionEcoulee: number; result: Result };
type Board = { year: number; badgeuse: boolean; rows: Row[] };

const h = (n: number) => `${n.toFixed(0)} h`;

/** Annualisation 1600 h (IDCC 1405) — dû prorata présence, réalisé, solde de
 *  modulation, contingent 200 h. Remplace le compteur dispersé de l'ancien système. */
export function AnnualisationPanel({ initialYear }: { initialYear: number }) {
  const [year, setYear] = useState(initialYear);
  const [data, setData] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (y: number) => {
    setLoading(true);
    try { const r = await fetch(`/api/rh/annualisation?year=${y}`, { cache: "no-store" }); const j = await r.json(); if (r.ok && j.ok) setData(j); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(year); }, [year, load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => setYear((y) => y - 1)} className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"><ChevronLeft className="h-4 w-4" /></button>
        <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 h-9 text-[13px] font-semibold text-foreground"><Gauge className="h-4 w-4 text-muted-foreground" /> Année {year}</span>
        <button type="button" onClick={() => setYear((y) => y + 1)} className="h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"><ChevronRight className="h-4 w-4" /></button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !data || data.rows.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">Aucun salarié actif.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-secondary/50 text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2">Salarié</th>
                <th className="text-right font-medium px-3 py-2">Dû (année)</th>
                <th className="text-right font-medium px-3 py-2">Dû à date</th>
                <th className="text-right font-medium px-3 py-2">Réalisé</th>
                <th className="text-right font-medium px-3 py-2">Solde modul.</th>
                <th className="text-right font-medium px-3 py-2">H. supp année</th>
                <th className="text-right font-medium px-3 py-2">Contingent 200 h</th>
                <th className="text-right font-medium px-3 py-2">% écoulé</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((r) => {
                const solde = r.result.soldeModulH;
                const pct = Math.min(100, Math.round((r.result.heuresRealisees / Math.max(1, r.result.heuresTheoAnnee)) * 100));
                return (
                  <tr key={r.employeeId} className="hover:bg-secondary/30">
                    <td className="px-3 py-2">
                      <span className="font-medium text-foreground">{r.name}</span>
                      <span className="block text-[11px] text-muted-foreground">{r.contractHours}h/sem{r.saisonnier ? " · saisonnier" : ""}{r.fractionPresence < 0.999 ? ` · présence ${Math.round(r.fractionPresence * 100)}%` : ""}</span>
                      <span className="mt-1 block h-1.5 w-full max-w-[160px] rounded bg-secondary overflow-hidden"><span className="block h-full rounded bg-brand-500" style={{ width: `${pct}%` }} /></span>
                    </td>
                    <td className="text-right px-3 py-2 tnum text-muted-foreground">{h(r.result.heuresTheoAnnee)}</td>
                    <td className="text-right px-3 py-2 tnum text-muted-foreground">{h(r.result.heuresTheoADate)}</td>
                    <td className="text-right px-3 py-2 tnum font-semibold text-foreground">{h(r.result.heuresRealisees)}</td>
                    <td className={`text-right px-3 py-2 tnum font-medium ${solde > 0 ? "text-amber-600 dark:text-amber-400" : solde < 0 ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground"}`}>{solde > 0 ? "+" : ""}{h(solde)}</td>
                    <td className="text-right px-3 py-2 tnum text-amber-600 dark:text-amber-400">{r.result.heuresSuppAnnee > 0 ? h(r.result.heuresSuppAnnee) : "—"}</td>
                    <td className={`text-right px-3 py-2 tnum ${r.result.depasseContingent ? "text-rose-600 dark:text-rose-400 font-semibold" : "text-muted-foreground"}`}>{h(r.result.contingentRestant)} rest.</td>
                    <td className="text-right px-3 py-2 tnum text-muted-foreground">{Math.round(r.fractionEcoulee * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-center text-[11px] text-muted-foreground">
        Dû 1600 h proraté à la présence (IDCC 1405). Solde de modulation = réalisé − dû à date (avance/retard). Les heures supp de l&apos;année se régularisent dans la Paie en fin de période. Réalisé = {data?.badgeuse === false ? "horaires du contrat (badgeuse désactivée)" : "pointages badgeuse"}. À valider par le cabinet.
      </p>
    </div>
  );
}
