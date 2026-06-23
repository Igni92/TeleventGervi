"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, PackageCheck, PackageOpen, Ban, FileText,
  ChevronDown, ChevronRight, AlertTriangle, Plus, Check, Trash2, Maximize2,
} from "lucide-react";
import { TypeCombobox } from "@/components/TypeCombobox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface SapOrder {
  docEntry: number; docNum: number; docDate: string; dueDate: string;
  total: number; totalHT: number; status?: string; numAtCard?: string;
  weightKg?: number | null;
  colis?: number | null;
  invoiceNum?: number | null; invoiceEntry?: number | null;
}
interface OrderLine { lineNum: number; itemCode: string; itemName?: string; quantity: number; price: number; lineTotal: number; unit?: string; warehouse?: string; lot?: string | null; }
interface Incident { id: string; docEntry: number | null; type: string | null; note: string | null; resolved: boolean; createdAt: string; createdBy?: string | null; }

export function SapOrderHistory({ clientId }: { clientId: string }) {
  const [orders, setOrders] = useState<SapOrder[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [lines, setLines] = useState<Record<number, OrderLine[]>>({});
  const [lineDraft, setLineDraft] = useState<Record<string, { quantity: number; price: number }>>({});
  const [busy, setBusy] = useState<number | null>(null);
  // confirmation d'annulation BL (modale thémée, plus de window.confirm)
  const [cancelTarget, setCancelTarget] = useState<SapOrder | null>(null);
  // facture dépliée
  const [expInvoice, setExpInvoice] = useState<number | null>(null);
  const [invLines, setInvLines] = useState<Record<number, OrderLine[]>>({});
  // ajout incident
  const [incType, setIncType] = useState("");
  const [incNote, setIncNote] = useState("");
  // affichage en grand (plein cadre) d'un BL
  const [largeEntry, setLargeEntry] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [o, inc] = await Promise.all([
        fetch(`/api/sap/orders?clientId=${encodeURIComponent(clientId)}&last=10`).then((r) => r.json()),
        fetch(`/api/incidents?clientId=${encodeURIComponent(clientId)}`).then((r) => r.json()),
      ]);
      if (o.ok === false) throw new Error(o.error || "Erreur SAP");
      setOrders(o.docs ?? []);
      setIncidents(inc.incidents ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur réseau"); setOrders([]); }
    finally { setLoading(false); }
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  const fmt = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Nb de colis : entier si rond, sinon 1 décimale (virgule FR).
  const fmtColis = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const incCount = (de: number) => incidents.filter((i) => i.docEntry === de && !i.resolved).length;

  const fetchLines = useCallback(async (docEntry: number) => {
    try {
      const d = await fetch(`/api/sap/orders/${docEntry}`).then((r) => r.json());
      setLines((cur) => ({ ...cur, [docEntry]: d.lines ?? [] }));
      const dr: Record<string, { quantity: number; price: number }> = {};
      for (const l of (d.lines ?? [])) dr[`${docEntry}:${l.lineNum}`] = { quantity: l.quantity, price: l.price };
      setLineDraft((cur) => ({ ...cur, ...dr }));
    } catch { toast.error("Erreur chargement lignes"); }
  }, []);

  const toggle = async (o: SapOrder) => {
    if (expanded === o.docEntry) { setExpanded(null); return; }
    setExpanded(o.docEntry);
    if (!lines[o.docEntry]) await fetchLines(o.docEntry);
  };

  // Ouvre le BL en grand (charge les lignes si besoin).
  const largeOrder = largeEntry != null ? orders.find((o) => o.docEntry === largeEntry) ?? null : null;
  const openLarge = async (o: SapOrder) => {
    setLargeEntry(o.docEntry);
    if (!lines[o.docEntry]) await fetchLines(o.docEntry);
  };

  const saveLines = async (o: SapOrder) => {
    const ls = lines[o.docEntry] || [];
    const changed = ls
      .map((l) => ({ l, d: lineDraft[`${o.docEntry}:${l.lineNum}`] }))
      .filter(({ l, d }) => d && (d.quantity !== l.quantity || d.price !== l.price))
      .map(({ l, d }) => ({ lineNum: l.lineNum, quantity: d!.quantity, price: d!.price }));
    if (changed.length === 0) { toast("Aucune modification"); return; }
    setBusy(o.docEntry);
    try {
      const res = await fetch(`/api/sap/orders/${o.docEntry}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: changed }),
      });
      const j = await res.json();
      if (!res.ok || j.ok === false) throw new Error(j.error || "Échec");
      toast.success(`BL #${o.docNum} modifié`);
      setOrders((cur) => cur.map((x) => x.docEntry === o.docEntry ? { ...x, total: j.total, totalHT: j.totalHT } : x));
      setLines((cur) => ({ ...cur, [o.docEntry]: ls.map((l) => { const d = lineDraft[`${o.docEntry}:${l.lineNum}`]; return d ? { ...l, quantity: d.quantity, price: d.price, lineTotal: d.quantity * d.price } : l; }) }));
    } catch (e) { toast.error(`Échec : ${e instanceof Error ? e.message : ""}`); }
    finally { setBusy(null); }
  };

  const cancelOrder = async (o: SapOrder) => {
    setCancelTarget(null);
    setBusy(o.docEntry);
    try {
      const res = await fetch("/api/sap/orders/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docEntry: o.docEntry }) });
      const j = await res.json(); if (!res.ok || j.ok === false) throw new Error(j.error);
      setOrders((cur) => cur.map((x) => x.docEntry === o.docEntry ? { ...x, status: "bost_Close" } : x));
      toast.success(`BL #${o.docNum} annulé`);
    } catch (e) { toast.error(`Échec : ${e instanceof Error ? e.message : ""}`); }
    finally { setBusy(null); }
  };

  const toggleInvoice = async (o: SapOrder) => {
    if (!o.invoiceEntry) return;
    if (expInvoice === o.invoiceEntry) { setExpInvoice(null); return; }
    setExpInvoice(o.invoiceEntry);
    if (!invLines[o.invoiceEntry]) {
      try {
        const d = await fetch(`/api/sap/invoices/${o.invoiceEntry}`).then((r) => r.json());
        setInvLines((cur) => ({ ...cur, [o.invoiceEntry!]: d.lines ?? [] }));
      } catch { toast.error("Erreur chargement facture"); }
    }
  };

  const addIncident = async (o: SapOrder) => {
    if (!incType && !incNote.trim()) return;
    try {
      const res = await fetch("/api/incidents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, docEntry: o.docEntry, docNum: o.docNum, type: incType, note: incNote }),
      });
      const j = await res.json();
      if (j.incident) setIncidents((cur) => [j.incident, ...cur]);
      setIncType(""); setIncNote("");
    } catch { toast.error("Erreur incident"); }
  };
  const toggleIncident = async (inc: Incident) => {
    setIncidents((cur) => cur.map((i) => i.id === inc.id ? { ...i, resolved: !i.resolved } : i));
    await fetch("/api/incidents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: inc.id, resolved: !inc.resolved }) });
  };
  const deleteIncident = async (id: string) => {
    setIncidents((cur) => cur.filter((i) => i.id !== id));
    await fetch(`/api/incidents?id=${id}`, { method: "DELETE" });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-muted-foreground">{orders.length > 0 ? `${orders.length} dernier(s) BL` : ""}</span>
        <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Rafraîchir
        </button>
      </div>

      {loading && orders.length === 0 && <p className="text-[12px] text-muted-foreground italic py-2 inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement…</p>}
      {error && <p className="text-[12px] text-rose-600 dark:text-rose-400 py-1">⚠️ {error}</p>}
      {!loading && !error && orders.length === 0 && <p className="text-[12px] text-muted-foreground italic py-1">Aucun BL pour ce client.</p>}

      {orders.length > 0 && (
        <ul className="divide-y divide-border/50">
          {orders.map((o) => {
            const closed = o.status === "bost_Close";
            const nbInc = incCount(o.docEntry);
            const isOpen = expanded === o.docEntry;
            return (
              <li key={o.docEntry} className="py-1">
                {/* ── Ligne compacte : tout sur 1 ligne (HT + poids inclus) ── */}
                <div className="flex items-center gap-1.5 text-[11.5px] whitespace-nowrap">
                  <button type="button" onClick={() => toggle(o)} className="shrink-0 text-muted-foreground/60 hover:text-foreground">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                  <span className={`shrink-0 inline-flex items-center justify-center h-5 w-5 rounded ${closed ? "bg-muted text-muted-foreground" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"}`} title={closed ? "Clôturé/annulé" : "Ouvert"}>
                    {closed ? <PackageCheck className="h-3 w-3" /> : <PackageOpen className="h-3 w-3" />}
                  </span>
                  <button type="button" onClick={() => toggle(o)} className="font-semibold text-foreground shrink-0">#{o.docNum}</button>
                  <span className="text-muted-foreground/70 tnum shrink-0 text-[10px]">{fmtDate(o.docDate)}</span>
                  {/* Nb de colis (remplace le HT) + poids */}
                  {o.colis != null && o.colis > 0 && (
                    <span className="tnum text-muted-foreground shrink-0">{fmtColis(o.colis)} colis</span>
                  )}
                  {o.weightKg != null && o.weightKg > 0 && <span className="tnum text-muted-foreground shrink-0">· {o.weightKg} kg</span>}
                  {nbInc > 0 && (
                    <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1 py-px rounded bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" title={`${nbInc} incident(s)`}>
                      <AlertTriangle className="h-2.5 w-2.5" />{nbInc}
                    </span>
                  )}
                  {o.invoiceNum && (
                    <button type="button" onClick={() => toggleInvoice(o)} title="Voir la facture liée"
                      className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1 py-px rounded bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 hover:bg-blue-200">
                      <FileText className="h-2.5 w-2.5" />Fact.{o.invoiceNum}
                    </button>
                  )}
                  <span className="ml-auto font-bold tnum text-foreground shrink-0">{fmt(o.total)} €</span>
                  <button type="button" onClick={() => openLarge(o)} title="Afficher en grand" className="shrink-0 h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground/50 hover:text-foreground">
                    <Maximize2 className="h-3 w-3" />
                  </button>
                  {!closed && (
                    <button type="button" onClick={() => setCancelTarget(o)} disabled={busy === o.docEntry} title="Annuler" className="shrink-0 h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground/40 hover:text-rose-500">
                      {busy === o.docEntry ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                    </button>
                  )}
                </div>

                {/* ── Facture dépliée (lecture seule) ── */}
                {expInvoice === o.invoiceEntry && o.invoiceEntry && (
                  <div className="pl-7 pr-1 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400 font-semibold mb-1">Facture #{o.invoiceNum}</p>
                    {!invLines[o.invoiceEntry] ? (
                      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Chargement…</p>
                    ) : (
                      <div className="space-y-0.5">
                        {invLines[o.invoiceEntry].map((l, k) => (
                          <div key={k} className="flex items-center gap-1.5 text-[11.5px]">
                            <span className="flex-1 min-w-0 truncate">{l.itemName || l.itemCode}</span>
                            <span className="tnum text-muted-foreground">{l.quantity} × {fmt(l.price)} = {fmt(l.lineTotal)}€</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Détail dépliable : lignes (éditables si ouvert) + incidents ── */}
                {isOpen && (
                  <div className="pl-7 pr-1 py-2 space-y-3">
                    {/* N° de commande client (NumAtCard) — éditable */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">N° cmd</span>
                      <input
                        defaultValue={o.numAtCard ?? ""}
                        placeholder="réf. client"
                        onBlur={async (e) => {
                          const v = e.target.value.trim();
                          if (v === (o.numAtCard ?? "")) return;
                          await fetch(`/api/sap/orders/${o.docEntry}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ numAtCard: v }) });
                          setOrders((cur) => cur.map((x) => x.docEntry === o.docEntry ? { ...x, numAtCard: v } : x));
                          toast.success("N° de commande enregistré");
                        }}
                        className="flex-1 h-7 rounded border border-border bg-background px-2 text-[11.5px] tnum"
                      />
                    </div>
                    {/* Lignes */}
                    {!lines[o.docEntry] ? (
                      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Chargement…</p>
                    ) : (
                      <div className="space-y-1">
                        {lines[o.docEntry].map((l) => {
                          const key = `${o.docEntry}:${l.lineNum}`;
                          const d = lineDraft[key] ?? { quantity: l.quantity, price: l.price };
                          return (
                            <div key={l.lineNum} className="flex items-center gap-1.5 text-[11.5px]">
                              <span className="flex-1 min-w-0 truncate text-foreground">{l.itemName || l.itemCode} <span className="text-muted-foreground/60 text-[10px]">{l.warehouse}{l.lot ? ` · ${l.lot}` : ""}</span></span>
                              {closed ? (
                                <span className="tnum text-muted-foreground">{l.quantity} × {fmt(l.price)} = {fmt(l.lineTotal)}€</span>
                              ) : (
                                <>
                                  <input type="number" step={0.1} value={d.quantity} onChange={(e) => setLineDraft((c) => ({ ...c, [key]: { ...d, quantity: parseFloat(e.target.value) || 0 } }))}
                                    className="h-6 w-14 text-right tnum rounded border border-border bg-background px-1" />
                                  <span className="text-muted-foreground">×</span>
                                  <input type="number" step={0.001} value={d.price} onChange={(e) => setLineDraft((c) => ({ ...c, [key]: { ...d, price: parseFloat(e.target.value) || 0 } }))}
                                    className="h-6 w-16 text-right tnum rounded border border-border bg-background px-1" />
                                  <span className="w-16 text-right tnum font-medium">{fmt(d.quantity * d.price)}€</span>
                                </>
                              )}
                            </div>
                          );
                        })}
                        {!closed && (
                          <button type="button" onClick={() => saveLines(o)} disabled={busy === o.docEntry}
                            className="mt-1 inline-flex items-center gap-1 h-6 px-2 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-[11px] disabled:opacity-50">
                            {busy === o.docEntry ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Enregistrer les modifs
                          </button>
                        )}
                      </div>
                    )}

                    {/* Incidents */}
                    <div className="border-t border-border/50 pt-2">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Incidents</p>
                      <ul className="space-y-1 mb-1.5">
                        {incidents.filter((i) => i.docEntry === o.docEntry).map((i) => (
                          <li key={i.id} className="flex items-center gap-1.5 text-[11.5px]">
                            <button type="button" onClick={() => toggleIncident(i)} title={i.resolved ? "Rouvrir" : "Résolu"}
                              className={`h-4 w-4 shrink-0 rounded border inline-flex items-center justify-center ${i.resolved ? "bg-emerald-500 border-emerald-500 text-white" : "border-border"}`}>
                              {i.resolved && <Check className="h-2.5 w-2.5" />}
                            </button>
                            <span className={`${i.resolved ? "line-through text-muted-foreground" : ""}`}>
                              {i.type && <span className="font-medium text-rose-600 dark:text-rose-400">{i.type}</span>}
                              {i.type && i.note ? " — " : ""}{i.note}
                            </span>
                            <button type="button" onClick={() => deleteIncident(i.id)} className="ml-auto text-muted-foreground/40 hover:text-rose-500 shrink-0"><Trash2 className="h-3 w-3" /></button>
                          </li>
                        ))}
                      </ul>
                      <div className="flex items-center gap-1.5">
                        <TypeCombobox kind="incident" value={incType || null} onChange={setIncType} placeholder="Type d'incident" className="w-40" />
                        <input value={incNote} onChange={(e) => setIncNote(e.target.value)} placeholder="Détail (facultatif)"
                          className="flex-1 h-7 rounded border border-border bg-background px-2 text-[11.5px]" />
                        <button type="button" onClick={() => addIncident(o)} className="h-7 w-7 inline-flex items-center justify-center rounded bg-secondary hover:bg-secondary/70"><Plus className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Confirmation d'annulation BL — modale thémée (remplace window.confirm) */}
      <Dialog open={!!cancelTarget} onOpenChange={(o) => { if (!o) setCancelTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <Ban className="h-4 w-4" /> Annuler le BL
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[13px]">
            Annuler définitivement le BL <b>#{cancelTarget?.docNum}</b> dans SAP ? Cette action est irréversible.
          </DialogDescription>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>Retour</Button>
            <Button variant="destructive" onClick={() => cancelTarget && cancelOrder(cancelTarget)}>
              Annuler le BL
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Affichage en grand (plein cadre) d'un bon de livraison ── */}
      <Dialog open={!!largeOrder} onOpenChange={(o) => { if (!o) setLargeEntry(null); }}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              Bon de livraison N° {largeOrder?.docNum}
              {largeOrder?.status === "bost_Close" && <span className="text-[13px] font-normal text-muted-foreground">· clôturé</span>}
            </DialogTitle>
          </DialogHeader>
          {largeOrder && <BLLarge order={largeOrder} lines={lines[largeOrder.docEntry]} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Affichage agrandi d'un BL — lecture, gros caractères ──────────── */
function BLLarge({ order, lines }: { order: SapOrder; lines?: OrderLine[] }) {
  const fmt = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-[14px]">
        <span className="text-muted-foreground">Date <span className="text-foreground font-medium tnum">{fmtDate(order.docDate)}</span></span>
        {order.numAtCard && <span className="text-muted-foreground">Réf. <span className="text-foreground font-medium">{order.numAtCard}</span></span>}
        {order.colis != null && order.colis > 0 && <span className="text-muted-foreground tnum">{order.colis} colis</span>}
        {order.weightKg != null && order.weightKg > 0 && <span className="text-muted-foreground tnum">{order.weightKg} kg</span>}
        {order.invoiceNum && <span className="text-muted-foreground">Facture <span className="text-foreground font-medium tnum">{order.invoiceNum}</span></span>}
      </div>

      {!lines ? (
        <p className="text-muted-foreground inline-flex items-center gap-2 text-[14px]"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</p>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead className="bg-secondary/40 text-[11.5px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2.5 font-semibold">Désignation</th>
                <th className="text-left px-3 py-2.5 font-semibold w-36">Entrepôt / Lot</th>
                <th className="text-right px-3 py-2.5 font-semibold w-24">Qté</th>
                <th className="text-right px-3 py-2.5 font-semibold w-28">PU HT</th>
                <th className="text-right px-3 py-2.5 font-semibold w-28">Total HT</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, k) => (
                <tr key={k} className="border-t border-border/50">
                  <td className="px-3 py-2.5">
                    <span className="text-foreground">{l.itemName || l.itemCode}</span>
                    <span className="ml-2 text-[12px] font-mono text-muted-foreground">{l.itemCode}</span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground text-[13px]">{l.warehouse}{l.lot ? ` · ${l.lot}` : ""}</td>
                  <td className="px-3 py-2.5 text-right tnum">{l.quantity}{l.unit ? ` ${l.unit}` : ""}</td>
                  <td className="px-3 py-2.5 text-right tnum">{fmt(l.price)} €</td>
                  <td className="px-3 py-2.5 text-right tnum font-medium">{fmt(l.lineTotal)} €</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-secondary/30">
                <td colSpan={4} className="px-3 py-2.5 text-right text-[12px] uppercase tracking-wide font-semibold text-muted-foreground">Total HT</td>
                <td className="px-3 py-2.5 text-right tnum font-semibold text-[16px] text-foreground">{fmt(order.totalHT)} €</td>
              </tr>
              <tr className="bg-secondary/30 border-t border-border">
                <td colSpan={4} className="px-3 py-2.5 text-right text-[12px] uppercase tracking-wide font-semibold text-muted-foreground">Total TTC</td>
                <td className="px-3 py-2.5 text-right tnum font-bold text-[16px] text-foreground">{fmt(order.total)} €</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
