"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Truck, ReceiptText, FileMinus, AlertTriangle, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PdfPreviewDialog } from "@/components/documents/PdfPreviewDialog";
import { formatDate } from "@/lib/utils";

interface Doc {
  id: string; docType: string; docNum: string | null; docEntry: number | null; invoiceEntry: number | null;
  fileName: string; docDate: string | null; receivedAt: string; lastSentAt: string | null;
}
interface InvoiceLine { lineNum: number; itemCode: string; itemName?: string; quantity: number; price: number; }

const COLS = [
  { type: "BL", label: "Bons de livraison", icon: Truck, hint: "Glisser vers Factures pour facturer" },
  { type: "FACTURE", label: "Factures", icon: ReceiptText, hint: "Glisser vers Avoirs pour créer un avoir" },
  { type: "AVOIR", label: "Avoirs", icon: FileMinus, hint: "" },
] as const;
const PILL: Record<string, string> = {
  BL: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  FACTURE: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  AVOIR: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
};

export function DocumentsKanban({ docs, onChanged }: { docs: Doc[]; onChanged: () => void }) {
  const [drag, setDrag] = useState<Doc | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; fileName: string } | null>(null);
  const [env, setEnv] = useState<string>("");

  // Confirmation « facturer »
  const [facturer, setFacturer] = useState<Doc | null>(null);
  const [working, setWorking] = useState(false);

  // Dialogue « avoir »
  const [avoirFor, setAvoirFor] = useState<Doc | null>(null);
  const [invLines, setInvLines] = useState<InvoiceLine[] | null>(null);
  const [sel, setSel] = useState<Record<number, number>>({}); // lineNum → qty

  useEffect(() => {
    fetch("/api/sap/environment", { cache: "no-store" }).then((r) => r.json()).then((j) => setEnv(j?.env ?? j?.active ?? "")).catch(() => {});
  }, []);

  const cards = (type: string) => docs.filter((d) => d.docType === type);

  const onDrop = (col: string) => {
    setOver(null);
    const d = drag; setDrag(null);
    if (!d) return;
    if (d.docType === "BL" && col === "FACTURE") setFacturer(d);
    else if (d.docType === "FACTURE" && col === "AVOIR") openAvoir(d);
  };

  const doFacturer = useCallback(async () => {
    if (!facturer?.docEntry) return;
    setWorking(true);
    try {
      const r = await fetch("/api/sap/invoices/create-from-order", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderDocEntry: facturer.docEntry }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Échec de la facturation");
      toast.success(`Facture N° ${j.docNum} créée${j.env ? ` (SAP ${String(j.env).toUpperCase()})` : ""}.`);
      setFacturer(null);
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
    finally { setWorking(false); }
  }, [facturer, onChanged]);

  const openAvoir = useCallback(async (facture: Doc) => {
    if (!facture.docEntry) { toast.error("Facture non résolue à SAP."); return; }
    setAvoirFor(facture); setInvLines(null); setSel({});
    try {
      const j = await fetch(`/api/sap/invoices/${facture.docEntry}`, { cache: "no-store" }).then((r) => r.json());
      setInvLines(j.lines ?? []);
    } catch { toast.error("Chargement des lignes de la facture impossible."); setInvLines([]); }
  }, []);

  const doAvoir = useCallback(async () => {
    if (!avoirFor?.docEntry) return;
    const lines = Object.entries(sel).map(([lineNum, quantity]) => ({ lineNum: Number(lineNum), quantity })).filter((l) => l.quantity > 0);
    if (lines.length === 0) { toast.error("Sélectionnez au moins une ligne."); return; }
    setWorking(true);
    try {
      const r = await fetch("/api/sap/credit-notes/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceDocEntry: avoirFor.docEntry, lines }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Échec de l'avoir");
      toast.success(`Avoir N° ${j.docNum} créé${j.env ? ` (SAP ${String(j.env).toUpperCase()})` : ""}.`);
      setAvoirFor(null);
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
    finally { setWorking(false); }
  }, [avoirFor, sel, onChanged]);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border border-amber-400/50 bg-amber-50 dark:bg-amber-950/25 px-3 py-2 text-[11.5px] text-amber-800 dark:text-amber-200">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          Glissez un <b>BL → Factures</b> pour créer la facture, ou une <b>Facture → Avoirs</b> pour créer un avoir.
          Ces actions créent de <b>vrais documents SAP</b> {env ? <>sur l&apos;environnement <b>{env.toUpperCase()}</b></> : null} (réservé à la direction). Un BL déjà facturé est refusé.
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {COLS.map((col) => {
          const Icon = col.icon;
          const list = cards(col.type);
          const isTarget = (drag?.docType === "BL" && col.type === "FACTURE") || (drag?.docType === "FACTURE" && col.type === "AVOIR");
          return (
            <div
              key={col.type}
              onDragOver={(e) => { if (isTarget) { e.preventDefault(); setOver(col.type); } }}
              onDragLeave={() => setOver((o) => (o === col.type ? null : o))}
              onDrop={() => onDrop(col.type)}
              className={`rounded-2xl border bg-card p-2.5 min-h-[160px] transition-colors ${over === col.type && isTarget ? "border-brand-400 bg-brand-500/10 ring-2 ring-brand-400/40" : "border-border"}`}
            >
              <header className="flex items-center gap-2 px-1 pb-2 mb-1 border-b border-border">
                <span className={`h-6 w-6 rounded-md flex items-center justify-center ${PILL[col.type]}`}><Icon className="h-3.5 w-3.5" /></span>
                <h3 className="text-[13px] font-semibold text-foreground">{col.label}</h3>
                <span className="text-[11px] text-muted-foreground tnum ml-auto">{list.length}</span>
              </header>
              {col.hint && <p className="px-1 pb-1.5 text-[10.5px] text-muted-foreground/70">{col.hint}</p>}
              <ul className="space-y-1.5">
                {list.map((d) => (
                  <li
                    key={d.id}
                    draggable={col.type !== "AVOIR"}
                    onDragStart={() => setDrag(d)}
                    onDragEnd={() => { setDrag(null); setOver(null); }}
                    className={`rounded-lg border border-border bg-background/50 px-2.5 py-2 ${col.type !== "AVOIR" ? "cursor-grab active:cursor-grabbing" : ""} ${drag?.id === d.id ? "opacity-40" : "hover:border-brand-400/50"}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[12px] font-semibold text-foreground truncate">{d.docNum ?? "—"}</span>
                      <button type="button" onClick={() => setPreview({ id: d.id, fileName: d.fileName })} title="Aperçu" className="ml-auto text-muted-foreground/50 hover:text-brand-500 shrink-0"><Eye className="h-3.5 w-3.5" /></button>
                    </div>
                    <p className="text-[10.5px] text-muted-foreground tnum mt-0.5">{d.docDate ? formatDate(d.docDate).slice(0, 10) : ""}</p>
                  </li>
                ))}
                {list.length === 0 && <li className="px-1 py-4 text-center text-[11px] text-muted-foreground/40">—</li>}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Confirmation facturer */}
      <Dialog open={!!facturer} onOpenChange={(o) => { if (!o) setFacturer(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-brand-600 dark:text-brand-400" /> Facturer le BL</DialogTitle>
            <DialogDescription className="text-[13px]">
              Créer la <b>facture SAP</b> à partir du BL <b>N° {facturer?.docNum}</b> ? SAP recopie articles, quantités, prix, lots, TPF et TVA. {env ? <>Environnement : <b>{env.toUpperCase()}</b>.</> : null}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setFacturer(null)} className="h-9 px-3 rounded-lg text-[13px] text-muted-foreground hover:text-foreground">Annuler</button>
            <button type="button" onClick={doFacturer} disabled={working} className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-brand-600 text-white text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-60">
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />} Créer la facture
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialogue avoir */}
      <Dialog open={!!avoirFor} onOpenChange={(o) => { if (!o) setAvoirFor(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileMinus className="h-5 w-5 text-amber-600 dark:text-amber-400" /> Avoir sur la facture N° {avoirFor?.docNum}</DialogTitle>
            <DialogDescription className="text-[12.5px]">Choisissez les lignes et les quantités à créditer.{env ? <> Environnement SAP : <b>{env.toUpperCase()}</b>.</> : null}</DialogDescription>
          </DialogHeader>
          {invLines === null ? (
            <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Chargement des lignes…</div>
          ) : invLines.length === 0 ? (
            <p className="py-4 text-[13px] text-muted-foreground">Aucune ligne sur cette facture.</p>
          ) : (
            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
              {invLines.map((l) => {
                const qty = sel[l.lineNum] ?? 0;
                return (
                  <div key={l.lineNum} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
                    <input
                      type="checkbox"
                      checked={qty > 0}
                      onChange={(e) => setSel((s) => ({ ...s, [l.lineNum]: e.target.checked ? l.quantity : 0 }))}
                      className="h-4 w-4 accent-brand-600"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] text-foreground truncate">{l.itemName || l.itemCode}</p>
                      <p className="text-[11px] text-muted-foreground">facturé : {l.quantity} · {l.price?.toFixed(2)} €</p>
                    </div>
                    <input
                      type="number" min={0} max={l.quantity} step="0.001"
                      value={qty}
                      onChange={(e) => setSel((s) => ({ ...s, [l.lineNum]: Math.max(0, Math.min(l.quantity, parseFloat(e.target.value) || 0)) }))}
                      className="h-8 w-20 text-right tnum rounded-lg border border-border bg-background px-2 text-[12.5px]"
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setAvoirFor(null)} className="h-9 px-3 rounded-lg text-[13px] text-muted-foreground hover:text-foreground">Annuler</button>
            <button type="button" onClick={doAvoir} disabled={working || !invLines?.length} className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-amber-600 text-white text-[13px] font-semibold hover:bg-amber-700 disabled:opacity-60">
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileMinus className="h-4 w-4" />} Créer l&apos;avoir
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <PdfPreviewDialog docId={preview?.id ?? null} fileName={preview?.fileName} open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }} />
    </div>
  );
}
