"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Printer, Truck, MapPin, Thermometer, CheckCircle2, AlertTriangle } from "lucide-react";
import { fmtJourDate } from "@/lib/date-fr";
import { CANAL_LABEL, STATUT_LABEL } from "@/lib/transport";

type Stop = {
  id: string; refSuivi: string; numCommande: string | null; clientNom: string; clientAdresse: string | null;
  creneau: string | null; canal: string; ordre: number; statut: string;
  colis: number | null; poidsKg: number | null; tempChargement: number | null; observations: string | null;
};
type Data = {
  ok: boolean; date: string; libelle: string | null;
  chauffeur: { nom: string; type: string; societe?: string | null; tel?: string | null } | null;
  expeditions: Stop[];
};

const STATUT_TONE: Record<string, string> = {
  A_PREPARER: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200",
  PREPAREE: "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200",
  EXPEDIE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
  LIVREE: "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100",
  INCIDENT: "bg-zinc-200 text-zinc-800 dark:bg-zinc-500/30 dark:text-zinc-100",
};

/** Feuille de route CHAUFFEUR — publique (token), mobile d'abord + imprimable.
 *  Le chauffeur consulte ses points et met à jour les statuts (Livrée / Incident). */
export function FeuilleRoute({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(false);
    try {
      const r = await fetch(`/api/transport/feuille/${token}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error();
      setData(j);
    } catch { setErr(true); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const setStatut = async (id: string, statut: string) => {
    setData((d) => d ? { ...d, expeditions: d.expeditions.map((e) => e.id === id ? { ...e, statut } : e) } : d);
    try {
      const r = await fetch(`/api/transport/feuille/${token}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expeditionId: id, statut }),
      });
      if (!r.ok) throw new Error();
    } catch { toast.error("Mise à jour impossible"); load(); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (err || !data) return <div className="min-h-screen flex items-center justify-center p-6 text-center text-muted-foreground">Feuille de route introuvable ou expirée.</div>;

  const { chauffeur, expeditions } = data;
  const done = expeditions.filter((e) => e.statut === "LIVREE").length;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl p-4 sm:p-6 space-y-4">
        {/* En-tête */}
        <header className="flex items-start justify-between gap-3 border-b border-border pb-3">
          <div>
            <div className="flex items-center gap-2 text-brand-600 dark:text-brand-400 font-display text-xl font-bold">
              <Truck className="h-6 w-6" /> Feuille de route
            </div>
            <p className="mt-1 text-[15px] font-semibold tnum">{fmtJourDate(data.date)}</p>
            {chauffeur && (
              <p className="text-[13px] text-muted-foreground">
                {chauffeur.nom}{chauffeur.societe ? ` · ${chauffeur.societe}` : ""}{chauffeur.tel ? ` · ${chauffeur.tel}` : ""}
              </p>
            )}
            {data.libelle && <p className="text-[13px] text-muted-foreground italic">{data.libelle}</p>}
          </div>
          <button type="button" onClick={() => window.print()}
            className="print:hidden inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-[13px] font-medium hover:bg-secondary/60">
            <Printer className="h-4 w-4" /> Imprimer
          </button>
        </header>

        <p className="text-[13px] text-muted-foreground">
          <b className="text-foreground tnum">{done}/{expeditions.length}</b> livrée{done > 1 ? "s" : ""} ·
          {" "}{expeditions.length} point{expeditions.length > 1 ? "s" : ""} de livraison
        </p>

        {/* Points de livraison */}
        <ol className="space-y-3">
          {expeditions.map((s, i) => (
            <li key={s.id} className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-secondary px-1.5 text-[12px] font-bold tnum">{i + 1}</span>
                    <span className="text-[16px] font-bold text-foreground truncate">{s.clientNom}</span>
                  </div>
                  {s.clientAdresse && <p className="mt-0.5 text-[13px] text-muted-foreground flex items-start gap-1"><MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />{s.clientAdresse}</p>}
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground tnum">
                    {CANAL_LABEL[s.canal] ?? s.canal}
                    {s.numCommande ? ` · BL ${s.numCommande}` : ""}
                    {s.colis != null && s.colis > 0 ? ` · ${s.colis} colis` : ""}
                    {s.poidsKg != null && s.poidsKg > 0 ? ` · ${Math.round(s.poidsKg)} kg` : ""}
                    {s.creneau ? ` · créneau ${s.creneau}` : ""}
                  </p>
                  {s.tempChargement != null && (
                    <p className="mt-0.5 text-[12px] text-muted-foreground inline-flex items-center gap-1"><Thermometer className="h-3.5 w-3.5" />{s.tempChargement} °C</p>
                  )}
                  {s.observations && <p className="mt-1 text-[12.5px] text-amber-700 dark:text-amber-300">⚠ {s.observations}</p>}
                </div>
                <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${STATUT_TONE[s.statut] ?? ""}`}>{STATUT_LABEL[s.statut]}</span>
              </div>
              {/* Actions chauffeur (masquées à l'impression) */}
              <div className="print:hidden mt-3 flex items-center gap-2">
                <button type="button" onClick={() => setStatut(s.id, "LIVREE")}
                  className={`inline-flex items-center gap-1.5 h-10 flex-1 justify-center rounded-lg text-[14px] font-semibold transition-colors ${s.statut === "LIVREE" ? "bg-sky-600 text-white" : "border border-border hover:bg-secondary/60"}`}>
                  <CheckCircle2 className="h-4 w-4" /> Livrée
                </button>
                <button type="button" onClick={() => { const note = window.prompt("Motif de l'incident :", s.observations ?? ""); if (note != null) setStatut(s.id, "INCIDENT"); }}
                  className={`inline-flex items-center gap-1.5 h-10 px-3 justify-center rounded-lg text-[14px] font-semibold transition-colors ${s.statut === "INCIDENT" ? "bg-zinc-700 text-white" : "border border-border hover:bg-secondary/60"}`}>
                  <AlertTriangle className="h-4 w-4" /> Incident
                </button>
              </div>
            </li>
          ))}
          {expeditions.length === 0 && <li className="text-center text-muted-foreground py-8">Aucun point de livraison sur cette tournée.</li>}
        </ol>

        <p className="print:hidden pt-2 text-center text-[11px] text-muted-foreground">Gervifrais · module transporteur — mise à jour en temps réel</p>
      </div>
    </div>
  );
}
