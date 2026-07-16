"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, PackageCheck, PackageOpen, Ban, FileText,
  ChevronRight, AlertTriangle, Plus, Check, Trash2, Search, X, Boxes, Scale,
} from "lucide-react";
import { TypeCombobox } from "@/components/TypeCombobox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { InfoHint } from "@/components/ui/info-hint";

interface SapOrder {
  docEntry: number; docNum: number; docDate: string; dueDate: string;
  total: number; totalHT: number; status?: string; numAtCard?: string;
  weightKg?: number | null;
  colis?: number | null;
  invoiceNum?: number | null; invoiceEntry?: number | null;
}
interface OrderLine { lineNum: number; itemCode: string; itemName?: string; quantity: number; price: number; lineTotal: number; unit?: string; warehouse?: string; lot?: string | null; }
interface Incident { id: string; docEntry: number | null; type: string | null; note: string | null; resolved: boolean; createdAt: string; createdBy?: string | null; }

const TAG = "inline-flex items-center justify-center whitespace-nowrap rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 px-2 h-5 min-w-[2.25rem] text-[11px] font-semibold tnum";

/**
 * Historique des commandes (BL) du client actif — présentation « Dernières
 * commandes » de l'accueil : lignes épurées (date · n° · colis · poids), clic =
 * détail du BL dans une fenêtre. Le détail CONSERVE les actions métier : n° de
 * commande, modification des lignes, incidents, annulation. Une recherche par
 * CODE client permet aussi de consulter/agir sur un AUTRE compte sans quitter
 * la console (revient au client de l'appel via la croix).
 */
export function SapOrderHistory({ clientId }: { clientId: string }) {
  // Client affiché : celui de l'appel, ou un autre trouvé par code (recherche).
  const [search, setSearch] = useState<{ id: string; code: string } | null>(null);
  const [term, setTerm] = useState("");
  const [resolving, setResolving] = useState(false);
  const activeId = search?.id ?? clientId;

  const [orders, setOrders] = useState<SapOrder[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<number, OrderLine[]>>({});
  const [lineDraft, setLineDraft] = useState<Record<string, { quantity: number; price: number }>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SapOrder | null>(null);
  const [invLines, setInvLines] = useState<Record<number, OrderLine[]>>({});
  const [showInvoice, setShowInvoice] = useState(false);
  const [incType, setIncType] = useState("");
  const [incNote, setIncNote] = useState("");
  // BL ouvert dans la fenêtre de détail (remplace le dépliage en ligne).
  const [detailEntry, setDetailEntry] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [o, inc] = await Promise.all([
        fetch(`/api/sap/orders?clientId=${encodeURIComponent(activeId)}&last=12`).then((r) => r.json()),
        fetch(`/api/incidents?clientId=${encodeURIComponent(activeId)}`).then((r) => r.json()),
      ]);
      if (o.ok === false) throw new Error(o.error || "Erreur SAP");
      setOrders(o.docs ?? []);
      setIncidents(inc.incidents ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur réseau"); setOrders([]); }
    finally { setLoading(false); }
  }, [activeId]);
  useEffect(() => { load(); }, [load]);

  const fmt = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtColis = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const incCount = (de: number) => incidents.filter((i) => i.docEntry === de && !i.resolved).length;

  // ── Recherche par CODE client ──
  const doSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = term.trim();
    if (!code) { setSearch(null); return; }
    setResolving(true);
    try {
      const j = await fetch(`/api/clients/resolve?code=${encodeURIComponent(code)}`).then((r) => r.json());
      if (!j?.id) { toast.error(`Aucun client pour le code « ${code.toUpperCase()} ».`); return; }
      setSearch({ id: j.id, code: code.toUpperCase() });
    } catch { toast.error("Recherche impossible."); }
    finally { setResolving(false); }
  };
  const clearSearch = () => { setTerm(""); setSearch(null); };

  const fetchLines = useCallback(async (docEntry: number) => {
    try {
      const d = await fetch(`/api/sap/orders/${docEntry}`).then((r) => r.json());
      setLines((cur) => ({ ...cur, [docEntry]: d.lines ?? [] }));
      const dr: Record<string, { quantity: number; price: number }> = {};
      for (const l of (d.lines ?? [])) dr[`${docEntry}:${l.lineNum}`] = { quantity: l.quantity, price: l.price };
      setLineDraft((cur) => ({ ...cur, ...dr }));
    } catch { toast.error("Erreur chargement lignes"); }
  }, []);

  // Ouvre le détail d'un BL (charge les lignes si besoin).
  const detail = detailEntry != null ? orders.find((o) => o.docEntry === detailEntry) ?? null : null;
  const openDetail = async (o: SapOrder) => {
    setDetailEntry(o.docEntry); setShowInvoice(false);
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

  const loadInvoice = async (o: SapOrder) => {
    if (!o.invoiceEntry) return;
    setShowInvoice((v) => !v);
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
        body: JSON.stringify({ clientId: activeId, docEntry: o.docEntry, docNum: o.docNum, type: incType, note: incNote }),
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

  const detailClosed = detail?.status === "bost_Close";

  return (
    <div>
      {/* ── Recherche par code client (autre compte) + rafraîchir ── */}
      <form onSubmit={doSearch} className="mb-2.5 flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Autre client par code (ex. APLAI)…"
            aria-label="Consulter les commandes d'un autre client par code"
            className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-8 text-[12px] uppercase placeholder:normal-case placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          />
          {(term || search) && (
            <button type="button" onClick={clearSearch} aria-label="Effacer" title="Revenir au client de l'appel"
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button type="submit" disabled={resolving}
          className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50" title="Chercher">
          {resolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        </button>
        <button type="button" onClick={load} disabled={loading} title="Rafraîchir"
          className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </form>
      {search && (
        <p className="-mt-1 mb-2 text-[11.5px] text-muted-foreground">
          Commandes du client <span className="font-mono font-semibold text-foreground">{search.code}</span>
          {" · "}
          <button type="button" onClick={clearSearch} className="underline underline-offset-2 hover:text-foreground">revenir au client de l&apos;appel</button>
        </p>
      )}

      {loading && orders.length === 0 && <p className="text-[12px] text-muted-foreground italic py-2 inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement…</p>}
      {error && <p className="text-[12px] text-rose-600 dark:text-rose-400 py-1">⚠️ {error}</p>}
      {!loading && !error && orders.length === 0 && <p className="text-[12px] text-muted-foreground italic py-1">Aucun BL pour ce client.</p>}

      {orders.length > 0 && (
        <>
          {/* En-tête de colonnes : icônes une seule fois (façon accueil) */}
          <div className="flex items-center gap-2 pb-1.5 mb-0.5 border-b border-border/60 text-muted-foreground">
            <span className="w-10 shrink-0" />
            <span className="flex-1 min-w-0" />
            <span className="w-12 shrink-0 flex items-center justify-center"><Boxes className="h-4 w-4" /><InfoHint label="Colis" size={14} className="ml-1">Nombre de colis</InfoHint></span>
            <span className="w-16 shrink-0 flex items-center justify-center"><Scale className="h-4 w-4" /><InfoHint label="Poids" size={14} className="ml-1">Poids (kg)</InfoHint></span>
            <span className="w-[70px] shrink-0" />
            <span className="w-4 shrink-0" />
          </div>
          <ul className="divide-y divide-border/60">
            {orders.map((o) => {
              const closed = o.status === "bost_Close";
              const nbInc = incCount(o.docEntry);
              return (
                <li key={o.docEntry}>
                  <button
                    type="button"
                    onClick={() => openDetail(o)}
                    title={`Ouvrir le BL # ${o.docNum}`}
                    className="w-full flex items-center gap-2 py-1.5 -mx-1 px-1 rounded-md hover:bg-secondary/50 transition-colors text-left group"
                  >
                    <span className={`shrink-0 inline-flex items-center justify-center h-5 w-10 rounded text-[10px] font-semibold tnum ${closed ? "bg-muted text-muted-foreground" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"}`} title={closed ? "Clôturé/annulé" : "Ouvert"}>
                      {closed ? <PackageCheck className="h-3 w-3" /> : <PackageOpen className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 flex items-baseline gap-1.5">
                      <span className="text-[12.5px] font-semibold text-foreground shrink-0"># {o.docNum}</span>
                      <span className="text-[11px] text-muted-foreground tnum shrink-0">{fmtDate(o.docDate)}</span>
                      {nbInc > 0 && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1 py-px rounded bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" title={`${nbInc} incident(s)`}>
                          <AlertTriangle className="h-2.5 w-2.5" />{nbInc}
                        </span>
                      )}
                      {o.invoiceNum && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1 py-px rounded bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" title="Facture liée">
                          <FileText className="h-2.5 w-2.5" />{o.invoiceNum}
                        </span>
                      )}
                    </span>
                    <span className="w-12 shrink-0 flex justify-center">
                      {o.colis != null && o.colis > 0 ? <span className={TAG}>{fmtColis(o.colis)}</span> : <span className="text-muted-foreground/40 text-[11px]">—</span>}
                    </span>
                    <span className="w-16 shrink-0 flex justify-center">
                      {o.weightKg != null && o.weightKg > 0 ? <span className={TAG}>{o.weightKg} kg</span> : <span className="text-muted-foreground/40 text-[11px]">—</span>}
                    </span>
                    <span className="w-[70px] shrink-0 text-right font-bold tnum text-[12px] text-foreground">{fmt(o.total)} €</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* ── Détail du BL (façon accueil) + ACTIONS conservées ── */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) { setDetailEntry(null); setShowInvoice(false); } }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              Bon de livraison{detail ? ` N° ${detail.docNum}` : ""}
              {detailClosed && <span className="text-[13px] font-normal text-muted-foreground">· clôturé</span>}
            </DialogTitle>
            <DialogDescription className="sr-only">Détail et actions du bon de livraison sélectionné.</DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="space-y-4">
              {/* Bandeau infos */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[13.5px]">
                <span className="text-muted-foreground">Date <span className="text-foreground font-medium tnum">{fmtDate(detail.docDate)}</span></span>
                {detail.colis != null && detail.colis > 0 && <span className="text-muted-foreground tnum">{fmtColis(detail.colis)} colis</span>}
                {detail.weightKg != null && detail.weightKg > 0 && <span className="text-muted-foreground tnum">{detail.weightKg} kg</span>}
                {detail.invoiceNum && (
                  <button type="button" onClick={() => loadInvoice(detail)}
                    className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
                    <FileText className="h-3.5 w-3.5" /> Facture {detail.invoiceNum}
                  </button>
                )}
                {!detailClosed && (
                  <button type="button" onClick={() => setCancelTarget(detail)} disabled={busy === detail.docEntry}
                    className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-rose-400/50 text-rose-600 dark:text-rose-400 text-[12.5px] font-semibold hover:bg-rose-500/10 transition-colors disabled:opacity-50">
                    {busy === detail.docEntry ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Annuler le BL
                  </button>
                )}
              </div>

              {/* N° de commande client (éditable) */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">N° cmd client</span>
                <input
                  defaultValue={detail.numAtCard ?? ""}
                  placeholder="réf. client"
                  onBlur={async (e) => {
                    const v = e.target.value.trim();
                    if (v === (detail.numAtCard ?? "")) return;
                    await fetch(`/api/sap/orders/${detail.docEntry}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ numAtCard: v }) });
                    setOrders((cur) => cur.map((x) => x.docEntry === detail.docEntry ? { ...x, numAtCard: v } : x));
                    toast.success("N° de commande enregistré");
                  }}
                  className="flex-1 h-8 rounded-lg border border-border bg-background px-2.5 text-[13px]"
                />
              </div>

              {/* Facture liée (lecture) */}
              {showInvoice && detail.invoiceEntry && (
                <div className="rounded-lg border border-blue-400/30 bg-blue-500/[0.04] p-3">
                  <p className="text-[11px] uppercase tracking-wider text-blue-600 dark:text-blue-400 font-semibold mb-1.5">Facture # {detail.invoiceNum}</p>
                  {!invLines[detail.invoiceEntry] ? (
                    <p className="text-[12px] text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Chargement…</p>
                  ) : (
                    <div className="space-y-0.5">
                      {invLines[detail.invoiceEntry].map((l, k) => (
                        <div key={k} className="flex items-center gap-2 text-[12.5px]">
                          <span className="flex-1 min-w-0 truncate">{l.itemName || l.itemCode}</span>
                          <span className="tnum text-muted-foreground">{l.quantity} × {fmt(l.price)} = {fmt(l.lineTotal)}€</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Lignes du BL — éditables si non clôturé */}
              {!lines[detail.docEntry] ? (
                <p className="text-muted-foreground inline-flex items-center gap-2 text-[14px] py-2"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</p>
              ) : (
                <div className="rounded-lg border border-border overflow-x-auto">
                  <table className="w-full text-[14px]">
                    <thead className="bg-secondary/40 text-[11.5px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2.5 font-semibold">Désignation</th>
                        <th className="text-left px-3 py-2.5 font-semibold w-32">Entrepôt / Lot</th>
                        <th className="text-right px-3 py-2.5 font-semibold w-24">Qté</th>
                        <th className="text-right px-3 py-2.5 font-semibold w-28">PU HT</th>
                        <th className="text-right px-3 py-2.5 font-semibold w-24">Total HT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines[detail.docEntry].map((l) => {
                        const key = `${detail.docEntry}:${l.lineNum}`;
                        const d = lineDraft[key] ?? { quantity: l.quantity, price: l.price };
                        return (
                          <tr key={l.lineNum} className="border-t border-border/50">
                            <td className="px-3 py-2">
                              <span className="text-foreground">{l.itemName || l.itemCode}</span>
                              <span className="ml-2 text-[11px] font-mono text-muted-foreground">{l.itemCode}</span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground text-[12.5px]">{l.warehouse}{l.lot ? ` · ${l.lot}` : ""}</td>
                            {detailClosed ? (
                              <>
                                <td className="px-3 py-2 text-right tnum">{l.quantity}{l.unit ? ` ${l.unit}` : ""}</td>
                                <td className="px-3 py-2 text-right tnum">{fmt(l.price)} €</td>
                                <td className="px-3 py-2 text-right tnum font-medium">{fmt(l.lineTotal)} €</td>
                              </>
                            ) : (
                              <>
                                <td className="px-3 py-2 text-right">
                                  <input type="number" step={0.1} value={d.quantity} onChange={(e) => setLineDraft((c) => ({ ...c, [key]: { ...d, quantity: parseFloat(e.target.value) || 0 } }))}
                                    className="h-7 w-16 text-right tnum rounded border border-border bg-background px-1" />
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <input type="number" step={0.001} value={d.price} onChange={(e) => setLineDraft((c) => ({ ...c, [key]: { ...d, price: parseFloat(e.target.value) || 0 } }))}
                                    className="h-7 w-20 text-right tnum rounded border border-border bg-background px-1" />
                                </td>
                                <td className="px-3 py-2 text-right tnum font-medium">{fmt(d.quantity * d.price)} €</td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border bg-secondary/30">
                        <td colSpan={4} className="px-3 py-2 text-right text-[12px] uppercase tracking-wide font-semibold text-muted-foreground">Total HT</td>
                        <td className="px-3 py-2 text-right tnum font-semibold text-[15px] text-foreground">{fmt(detail.totalHT)} €</td>
                      </tr>
                      <tr className="bg-secondary/30 border-t border-border">
                        <td colSpan={4} className="px-3 py-2 text-right text-[12px] uppercase tracking-wide font-semibold text-muted-foreground">Total TTC</td>
                        <td className="px-3 py-2 text-right tnum font-bold text-[15px] text-foreground">{fmt(detail.total)} €</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              {!detailClosed && lines[detail.docEntry] && (
                <button type="button" onClick={() => saveLines(detail)} disabled={busy === detail.docEntry}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-[12.5px] font-semibold disabled:opacity-50 transition-colors">
                  {busy === detail.docEntry ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Enregistrer les modifications
                </button>
              )}

              {/* Incidents */}
              <div className="border-t border-border/60 pt-3">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Incidents</p>
                <ul className="space-y-1 mb-2">
                  {incidents.filter((i) => i.docEntry === detail.docEntry).map((i) => (
                    <li key={i.id} className="flex items-center gap-2 text-[12.5px]">
                      <button type="button" onClick={() => toggleIncident(i)} title={i.resolved ? "Rouvrir" : "Résolu"}
                        className={`h-4 w-4 shrink-0 rounded border inline-flex items-center justify-center ${i.resolved ? "bg-emerald-500 border-emerald-500 text-white" : "border-border"}`}>
                        {i.resolved && <Check className="h-2.5 w-2.5" />}
                      </button>
                      <span className={`${i.resolved ? "line-through text-muted-foreground" : ""}`}>
                        {i.type && <span className="font-medium text-rose-600 dark:text-rose-400">{i.type}</span>}
                        {i.type && i.note ? " — " : ""}{i.note}
                      </span>
                      <button type="button" onClick={() => deleteIncident(i.id)} className="ml-auto text-muted-foreground/40 hover:text-rose-500 shrink-0"><Trash2 className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                  {incidents.filter((i) => i.docEntry === detail.docEntry).length === 0 && (
                    <li className="text-[12px] text-muted-foreground italic">Aucun incident sur ce BL.</li>
                  )}
                </ul>
                <div className="flex items-center gap-2">
                  <TypeCombobox kind="incident" value={incType || null} onChange={setIncType} placeholder="Type d'incident" className="w-44" />
                  <input value={incNote} onChange={(e) => setIncNote(e.target.value)} placeholder="Détail (facultatif)"
                    className="flex-1 h-8 rounded-lg border border-border bg-background px-2.5 text-[12.5px]" />
                  <button type="button" onClick={() => addIncident(detail)} title="Ajouter l'incident"
                    className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-secondary hover:bg-secondary/70"><Plus className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation d'annulation BL */}
      <Dialog open={!!cancelTarget} onOpenChange={(o) => { if (!o) setCancelTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <Ban className="h-4 w-4" /> Annuler le BL
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[13px]">
            Annuler définitivement le BL <b># {cancelTarget?.docNum}</b> dans SAP ? Cette action est irréversible.
          </DialogDescription>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>Retour</Button>
            <Button variant="destructive" onClick={() => cancelTarget && cancelOrder(cancelTarget)}>
              Annuler le BL
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
