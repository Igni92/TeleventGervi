"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, PackageCheck, Search, ChevronRight, X, Truck, AlertTriangle,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { designationProduit } from "@/lib/produit-designation";
import { DesignationChips } from "./DesignationChips";

type PoLine = {
  itemCode: string; itemName?: string;
  pieceQuantity: number; packageQuantity: number | null;
  warehouse?: string;
  price: number | null; lineTotal: number | null; taxPercent: number | null;
  open: boolean;
  uPays: string | null; uMarque: string | null; uCondi: string | null;
};
type PurchaseOrder = {
  docEntry: number; docNum: number; docDate: string; dueDate: string | null;
  cardCode: string; cardName?: string; numAtCard: string;
  open: boolean;
  total: number; totalTTC: number; totalHT: number; totalTVA: number;
  comments: string; lineCount: number; lines: PoLine[];
};

/** Date jj.mm.aa (points, année sur 2 chiffres). */
const fmtDate = (s?: string | null): string => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${p(d.getFullYear() % 100)}`;
};
const eur = (n: number): string =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const fmtColis = (n: number | null | undefined): string => {
  if (n == null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
};

function StatusBadge({ open, large }: { open: boolean; large?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md font-semibold ${large ? "px-2.5 h-7 text-[12px]" : "px-2 h-6 text-[11px]"} ${
      open
        ? "bg-amber-500/15 border border-amber-500/50 text-amber-600 dark:text-amber-400"
        : "bg-emerald-500/15 border border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
    }`}>
      {open ? "Ouverte" : "Clôturée"}
    </span>
  );
}

/** Commande ouverte dont la livraison prévue est atteinte (≤ aujourd'hui).
 *  Comparaison sur la DATE CALENDAIRE (yyyy-mm-dd) pour éviter tout décalage de
 *  fuseau : une livraison datée de demain ne doit jamais s'afficher « à réceptionner ». */
function isDue(d: { open: boolean; dueDate: string | null }): boolean {
  if (!d.open || !d.dueDate) return false;
  const dueStr = d.dueDate.slice(0, 10);                 // yyyy-mm-dd (date SAP)
  const n = new Date();
  const todayStr = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  return dueStr <= todayStr;
}

function DueBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-2 h-6 text-[11px] font-semibold bg-amber-500/15 border border-amber-500/60 text-amber-600 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3" /> À réceptionner
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "emerald" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className={`text-[20px] font-bold tnum leading-tight ${tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

/** Liste des COMMANDES FOURNISSEURS (SAP PurchaseOrders) — lecture seule. */
export function PurchaseOrderHistory() {
  const [docs, setDocs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [largeEntry, setLargeEntry] = useState<number | null>(null);
  const [receiving, setReceiving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sap/purchase-orders?last=40", { cache: "no-store" });
      const json = await res.json();
      setDocs(json.docs ?? []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (dateFilter && d.docDate?.slice(0, 10) !== dateFilter) return false;
      if (!q) return true;
      const haystack = [
        d.cardCode, d.cardName, d.numAtCard, `#${d.docNum}`, String(d.docNum),
        ...d.lines.flatMap((l) => [l.itemCode, l.itemName]),
      ];
      return haystack.some((h) => (h ?? "").toString().toLowerCase().includes(q));
    });
  }, [docs, query, dateFilter]);

  const hasFilters = query.trim() !== "" || dateFilter !== "";
  const largeDoc = largeEntry != null ? docs.find((d) => d.docEntry === largeEntry) ?? null : null;
  const dueCount = useMemo(() => docs.filter(isDue).length, [docs]);

  // Valide la réception d'une commande → crée l'entrée marchandise (PDN) côté SAP.
  const receive = useCallback(async (docEntry: number) => {
    setReceiving(true);
    try {
      const res = await fetch("/api/sap/purchase-orders/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry }),
      });
      const j = await res.json();
      if (!res.ok || j.ok === false) throw new Error(j.error || "Échec");
      toast.success(`Réception validée — entrée marchandise #${j.docNum} créée (lot ${j.lot})`, { duration: 9000 });
      setLargeEntry(null);
      await load();
    } catch (e) {
      toast.error(`Échec de la réception : ${e instanceof Error ? e.message : ""}`, { duration: 10000 });
    } finally {
      setReceiving(false);
    }
  }, [load]);

  return (
    <div className="space-y-6">
      <SurfaceCard accent="violet" className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-[15px] font-semibold flex items-center gap-2">
            <PackageCheck className="h-4 w-4 text-muted-foreground" />
            Commandes fournisseurs
          </h2>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Rafraîchir
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Fournisseur, code article ou n° de commande…"
              className="pl-9"
            />
          </div>
          <Input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-auto"
            aria-label="Filtrer par date"
          />
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setDateFilter(""); }}>
              <X className="h-3.5 w-3.5" /> Effacer
            </Button>
          )}
        </div>

        {loading && docs.length === 0 && (
          <p className="text-[12px] italic text-muted-foreground py-2">Chargement…</p>
        )}
        {!loading && docs.length === 0 && (
          <p className="text-[12px] italic text-muted-foreground py-2">Aucune commande fournisseur récente.</p>
        )}
        {!loading && docs.length > 0 && filtered.length === 0 && (
          <p className="text-[12px] italic text-muted-foreground py-2">Aucune commande ne correspond à la recherche.</p>
        )}

        {filtered.length > 0 && (
          <div className="flex flex-wrap gap-6 pb-1">
            <Stat label="Commandes" value={<AnimatedNumber value={filtered.length} />} />
            <Stat
              label="Engagé (HT)"
              tone="emerald"
              value={
                <AnimatedNumber
                  value={filtered.reduce((s, d) => s + (d.totalHT ?? 0), 0)}
                  format={(n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n)}
                />
              }
            />
            <Stat label="Ouvertes" value={<AnimatedNumber value={filtered.filter((d) => d.open).length} />} />
            {dueCount > 0 && <Stat label="À réceptionner" value={<span className="text-amber-600 dark:text-amber-400">{dueCount}</span>} />}
          </div>
        )}

        {/* Mobile : cartes — tap ouvre le détail plein écran */}
        {filtered.length > 0 && (
          <div className="md:hidden space-y-2.5">
            {filtered.map((d) => (
              <button
                key={d.docEntry}
                type="button"
                onClick={() => setLargeEntry(d.docEntry)}
                className="w-full rounded-2xl border border-border bg-card flex items-center gap-3 p-4 text-left active:bg-secondary/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-semibold text-[16px] text-foreground">#{d.docNum}</span>
                    {isDue(d) ? <DueBadge /> : <StatusBadge open={d.open} />}
                  </div>
                  <div className="text-[14px] text-foreground/90 mt-0.5 truncate" title={d.cardName}>
                    {d.cardName || d.cardCode}
                  </div>
                  <div className="text-[13px] text-muted-foreground mt-0.5 tnum">
                    Cmd {fmtDate(d.docDate)}{d.dueDate ? ` · livr. ${fmtDate(d.dueDate)}` : ""} · {d.lineCount} ligne{d.lineCount > 1 ? "s" : ""}
                  </div>
                </div>
                <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                  <div>
                    <span className="text-[17px] font-bold tnum text-foreground leading-none">{eur(d.totalHT ?? 0)}</span>
                    <span className="ml-1 text-[11px] text-muted-foreground">HT</span>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground/50" />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Desktop : tableau */}
        {filtered.length > 0 && (
          <div className="hidden md:block rounded-lg border border-border overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold w-24">N° Cde</th>
                  <th className="text-left px-3 py-2 font-semibold">Fournisseur</th>
                  <th className="text-left px-3 py-2 font-semibold w-24">Commande</th>
                  <th className="text-left px-3 py-2 font-semibold w-24">Livraison</th>
                  <th className="text-left px-3 py-2 font-semibold w-28">Statut</th>
                  <th className="text-right px-3 py-2 font-semibold w-28">Total HT</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr
                    key={d.docEntry}
                    onClick={() => setLargeEntry(d.docEntry)}
                    className="border-t border-border/60 hover:bg-secondary/30 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2 font-mono font-semibold">#{d.docNum}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-foreground">{d.cardName || d.cardCode}</span>
                      <span className="text-muted-foreground ml-1.5 font-mono text-[11px]">{d.cardCode}</span>
                    </td>
                    <td className="px-3 py-2 tnum text-muted-foreground">{fmtDate(d.docDate)}</td>
                    <td className="px-3 py-2 tnum text-muted-foreground">{fmtDate(d.dueDate)}</td>
                    <td className="px-3 py-2">{isDue(d) ? <DueBadge /> : <StatusBadge open={d.open} />}</td>
                    <td className="px-3 py-2 text-right tnum font-semibold">{eur(d.totalHT ?? 0)}</td>
                    <td className="px-2 py-2 text-right"><ChevronRight className="h-4 w-4 text-muted-foreground/50 inline" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      {/* ── Détail plein écran ── */}
      <Dialog open={!!largeDoc} onOpenChange={(o) => { if (!o) setLargeEntry(null); }}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 justify-start pr-8 text-[16px] sm:text-[18px] whitespace-nowrap">
              <PackageCheck className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
              <span className="truncate min-w-0">Commande fournisseur N° {largeDoc?.docNum}</span>
            </DialogTitle>
          </DialogHeader>
          {largeDoc && <PoDetail po={largeDoc} onReceive={receive} receiving={receiving} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PoDetail({ po, onReceive, receiving }: { po: PurchaseOrder; onReceive: (docEntry: number) => void; receiving: boolean }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-5">
      {/* Action : valider la réception → crée l'entrée marchandise */}
      {po.open && (
        <div className="rounded-xl border border-amber-400/50 bg-amber-50/60 dark:bg-amber-950/20 p-3">
          {!confirm ? (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-[14px] font-semibold transition-colors"
            >
              <PackageCheck className="h-4 w-4" /> Réceptionner → entrée marchandise
            </button>
          ) : (
            <div className="space-y-2.5">
              <p className="text-[13px] text-foreground">
                Créer l&apos;entrée marchandise pour cette commande&nbsp;? La commande sera clôturée
                et le stock incrémenté.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onReceive(po.docEntry)}
                  disabled={receiving}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-[13px] font-semibold disabled:opacity-60"
                >
                  {receiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                  Confirmer la réception
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm(false)}
                  disabled={receiving}
                  className="inline-flex items-center h-10 px-4 rounded-lg border border-border text-[13px] font-medium text-muted-foreground hover:text-foreground"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* En-tête : fournisseur + dates + statut + réf */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-[15px] text-foreground">
          <Truck className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono font-semibold">{po.cardCode}</span>
          {po.cardName && <span className="text-muted-foreground">· {po.cardName}</span>}
        </span>
        <StatusBadge open={po.open} large />
        <span className="text-[14px] text-muted-foreground tnum">Commandé le {fmtDate(po.docDate)}</span>
        {po.dueDate && <span className="text-[14px] text-muted-foreground tnum">Livraison prévue {fmtDate(po.dueDate)}</span>}
        {po.numAtCard && <span className="text-[14px] text-muted-foreground">Réf. {po.numAtCard}</span>}
      </div>
      {po.comments && <p className="italic text-muted-foreground text-[13px]">« {po.comments} »</p>}

      {/* Mobile : lignes empilées */}
      <div className="md:hidden space-y-2">
        {po.lines.map((l, i) => {
          const dz = designationProduit({ itemName: l.itemName, uPays: l.uPays, uMarque: l.uMarque, uCondi: l.uCondi });
          const lineHT = l.lineTotal ?? (l.price != null ? l.price * l.pieceQuantity : null);
          return (
            <div key={`m-${l.itemCode}-${i}`} className="rounded-lg border border-border bg-card/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-foreground leading-tight">{dz.fruit}</div>
                  <div className="text-[12px] font-mono text-muted-foreground mt-0.5">{l.itemCode}</div>
                  <DesignationChips marque={dz.marque} condt={dz.condt} pays={dz.pays} className="mt-1.5" />
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[15px] font-bold tnum text-foreground">{lineHT != null ? eur(lineHT) : "—"}</div>
                  <div className="text-[11px] text-muted-foreground">HT</div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2 text-[13px] text-muted-foreground tnum">
                <span className="text-foreground font-medium">{fmtColis(l.packageQuantity)} colis</span>
                <span>·</span>
                <span>PU {l.price != null ? eur(l.price) : "—"}</span>
                {!l.open && <span className="text-emerald-600 dark:text-emerald-400">· reçue</span>}
              </div>
            </div>
          );
        })}
        <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1.5">
          <div className="flex justify-between text-[14px]"><span className="text-muted-foreground">Total HT</span><span className="font-semibold tnum">{eur(po.totalHT ?? 0)}</span></div>
          <div className="flex justify-between text-[14px]"><span className="text-muted-foreground">TVA</span><span className="tnum text-muted-foreground">{eur(po.totalTVA ?? 0)}</span></div>
          <div className="flex justify-between text-[16px] border-t border-border pt-1.5"><span className="font-semibold text-foreground">Total TTC</span><span className="font-bold tnum text-foreground">{eur(po.totalTTC ?? po.total ?? 0)}</span></div>
        </div>
      </div>

      {/* Desktop : tableau */}
      <div className="hidden md:block rounded-lg border border-border overflow-x-auto bg-card/40">
        <table className="w-full text-[15px]">
          <thead className="bg-secondary/40 uppercase tracking-wide text-muted-foreground text-[11.5px]">
            <tr>
              <th className="text-left px-3 py-2.5 font-semibold">Article</th>
              <th className="text-left px-3 py-2.5 font-semibold">Désignation</th>
              <th className="text-right px-3 py-2.5 font-semibold">Colis</th>
              <th className="text-right px-3 py-2.5 font-semibold">PU HT</th>
              <th className="text-right px-3 py-2.5 font-semibold">Total HT</th>
              <th className="text-left px-3 py-2.5 font-semibold">Statut</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l, i) => {
              const dz = designationProduit({ itemName: l.itemName, uPays: l.uPays, uMarque: l.uMarque, uCondi: l.uCondi });
              const lineHT = l.lineTotal ?? (l.price != null ? l.price * l.pieceQuantity : null);
              return (
                <tr key={`${l.itemCode}-${i}`} className="border-t border-border/60">
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-foreground">{dz.fruit}</div>
                    <div className="font-mono text-[12px] text-muted-foreground">{l.itemCode}</div>
                  </td>
                  <td className="px-3 py-2.5"><DesignationChips marque={dz.marque} condt={dz.condt} pays={dz.pays} /></td>
                  <td className="px-3 py-2.5 text-right tnum">{fmtColis(l.packageQuantity)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{l.price != null ? eur(l.price) : "—"}</td>
                  <td className="px-3 py-2.5 text-right tnum font-semibold">{lineHT != null ? eur(lineHT) : "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={l.open ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
                      {l.open ? "Ouverte" : "Reçue"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-secondary/30 text-[14px]">
              <td colSpan={4} className="px-3 py-2.5 text-right font-semibold text-muted-foreground">Total HT</td>
              <td className="px-3 py-2.5 text-right tnum font-bold text-foreground">{eur(po.totalHT ?? 0)}</td>
              <td />
            </tr>
            <tr className="bg-secondary/20 text-[13px]">
              <td colSpan={4} className="px-3 py-1.5 text-right text-muted-foreground">TVA</td>
              <td className="px-3 py-1.5 text-right tnum text-muted-foreground">{eur(po.totalTVA ?? 0)}</td>
              <td />
            </tr>
            <tr className="bg-secondary/30 text-[15px] border-t border-border">
              <td colSpan={4} className="px-3 py-2.5 text-right font-semibold text-foreground">Total TTC</td>
              <td className="px-3 py-2.5 text-right tnum font-bold text-foreground">{eur(po.totalTTC ?? po.total ?? 0)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
