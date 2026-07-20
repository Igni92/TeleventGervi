"use client";

/**
 * ÉTAT DE COMPTE SOFRUCE — bouton (console) + dialogue : choisir une période,
 * relire les entrées marchandises Sofruce (achats à nous facturer), puis
 * APERÇU / TÉLÉCHARGEMENT du PDF à remettre à Sofruce. Données serveur :
 * /api/sap/sofruce/statement ; PDF côté navigateur : lib/sofrucePdf.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Eye, Download, FileText, ReceiptEuro } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { buildSofrucePdf, sofrucePdfFilename, type SofruceStatementData } from "@/lib/sofrucePdf";

const fmtEur = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
};
/** Date murale locale YYYY-MM-DD (input type=date). */
const dayInput = (d: Date) => d.toLocaleDateString("en-CA");

export function SofruceStatementButton() {
  const [open, setOpen] = useState(false);
  // Période par défaut : le mois en cours (1er → aujourd'hui).
  const today = new Date();
  const [from, setFrom] = useState(dayInput(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(dayInput(today));
  const [data, setData] = useState<SofruceStatementData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"preview" | "download" | null>(null);

  const validRange = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;

  // (Re)charge le relevé à l'ouverture et à chaque changement de période valide.
  useEffect(() => {
    if (!open || !validRange) { if (!validRange) setData(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    fetch(`/api/sap/sofruce/statement?from=${from}&to=${to}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok || !j?.ok) { setData(null); setError(j?.error || "Chargement impossible."); return; }
        setData(j as SofruceStatementData);
      })
      .catch(() => { if (!cancelled) { setData(null); setError("Chargement impossible (réseau)."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, from, to, validRange]);

  const makePdf = async (mode: "preview" | "download") => {
    if (!data || data.docs.length === 0) return;
    setBusy(mode);
    try {
      const doc = await buildSofrucePdf(data);
      if (mode === "preview") {
        const url = doc.output("bloburl") as unknown as string;
        if (!window.open(url, "_blank")) toast.error("Aperçu bloqué — autorisez les pop-ups.");
      } else {
        doc.save(sofrucePdfFilename(data.from, data.to));
      }
    } catch {
      toast.error("Génération du PDF impossible.");
    } finally { setBusy(null); }
  };

  const btn = "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-semibold disabled:opacity-50 transition-colors";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="État de compte Sofruce — relevé PDF des achats de la période (ce que Sofruce doit nous facturer)"
        aria-label="État de compte Sofruce (PDF)"
        className="inline-flex items-center justify-center h-8 w-8 shrink-0 rounded-md border border-violet-400/50 text-violet-700 dark:text-violet-300 hover:bg-violet-500/10 transition-colors"
      >
        <ReceiptEuro className="h-3.5 w-3.5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-violet-600 dark:text-violet-400" />
              État de compte Sofruce
            </DialogTitle>
            <DialogDescription>
              Relevé des entrées marchandises Sofruce de la période — la pièce à leur remettre
              pour qu&apos;ils sachent quoi nous facturer (PDF).
            </DialogDescription>
          </DialogHeader>

          {/* Période */}
          <div className="flex flex-wrap items-end gap-2.5">
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Du
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2 text-[13px] font-normal normal-case tracking-normal text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Au
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2 text-[13px] font-normal normal-case tracking-normal text-foreground focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </label>
            {!validRange && (
              <p className="text-[12px] text-rose-600 dark:text-rose-400 pb-2">Période invalide.</p>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={() => makePdf("preview")}
                disabled={loading || busy != null || !data || data.docs.length === 0}
                className={`${btn} border border-border text-foreground hover:bg-secondary/60`}>
                {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Aperçu
              </button>
              <button type="button" onClick={() => makePdf("download")}
                disabled={loading || busy != null || !data || data.docs.length === 0}
                className={`${btn} bg-violet-600 hover:bg-violet-700 text-white`}>
                {busy === "download" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF
              </button>
            </div>
          </div>

          {/* Relevé */}
          {loading && (
            <p className="text-[13px] text-muted-foreground inline-flex items-center gap-2 py-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Lecture des entrées marchandises…
            </p>
          )}
          {error && <p className="text-[13px] text-rose-600 dark:text-rose-400 py-2">⚠️ {error}</p>}
          {!loading && !error && data && data.docs.length === 0 && (
            <p className="text-[13px] text-muted-foreground italic py-2">
              Aucune entrée marchandise Sofruce sur cette période.
            </p>
          )}
          {!loading && !error && data && data.docs.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <ul className="divide-y divide-border/60 max-h-[320px] overflow-y-auto">
                {data.docs.map((d) => (
                  <li key={d.docEntry} className="flex items-center gap-2.5 px-3 py-2 text-[12.5px]">
                    <span className="shrink-0 font-mono tnum text-muted-foreground">{fmtDate(d.docDate)}</span>
                    <span className="shrink-0 font-semibold text-foreground">EM {d.docNum}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {d.clientNote ?? `${d.lines.length} ligne${d.lines.length > 1 ? "s" : ""}`}
                    </span>
                    <span className="shrink-0 font-bold tnum text-foreground">{fmtEur(d.totalHT)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-3 border-t border-border bg-secondary/40 px-3 py-2 text-[12.5px]">
                <span className="text-muted-foreground">
                  {data.totals.docs} entrée{data.totals.docs > 1 ? "s" : ""} · TVA {fmtEur(data.totals.tva)} · TTC {fmtEur(data.totals.ttc)}
                </span>
                <span className="font-bold tnum text-foreground">Total HT {fmtEur(data.totals.ht)}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
