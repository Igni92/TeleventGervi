"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, ClipboardList, Search, ChevronRight, ChevronDown,
  AlertTriangle, Truck, X, Maximize2,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { designationProduit } from "@/lib/produit-designation";
import { DesignationChips, Chip } from "./DesignationChips";
import {
  OpenReceptionIncidents, InlineIncidentDeclare, IncidentTypeIcon, useReceptionIncidents,
} from "./ReceptionIncidents";

type ReceiptLine = {
  itemCode: string; itemName?: string;
  pieceQuantity: number; packageQuantity: number | null;
  warehouse?: string;
  price: number | null; lineTotal: number | null; taxPercent: number | null;
  uPays: string | null; uMarque: string | null; uCondi: string | null; frgnName?: string | null;
};
type Receipt = {
  docEntry: number; docNum: number; lot: string; docDate: string;
  cardCode: string; cardName?: string; numAtCard: string;
  total: number; totalTTC: number; totalHT: number; totalTVA: number;
  comments: string; lineCount: number; lines: ReceiptLine[];
};

/** Date au format jj.mm.aa (points, année sur 2 chiffres). */
const fmtDate = (s?: string): string => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${p(d.getFullYear() % 100)}`;
};
/** Montant € à 2 décimales (séparateur FR). */
const eur = (n: number): string =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
/** Nb de colis : entier si rond, sinon 1 décimale. */
const fmtColis = (n: number | null | undefined): string => {
  if (n == null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
};

/** Liste des entrées marchandises (SAP PurchaseDeliveryNotes) — recherche + détail. */
export function GoodsReceiptHistory() {
  const [docs, setDocs] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [largeEntry, setLargeEntry] = useState<number | null>(null);
  const { incidents, loading: incLoading, reload: reloadIncidents, byDoc } = useReceptionIncidents();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sap/goods-receipts?last=50", { cache: "no-store" });
      const json = await res.json();
      setDocs(json.docs ?? []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Recherche : fournisseur (code/nom) · code article · numéro (EM / BL) · date.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (dateFilter && d.docDate?.slice(0, 10) !== dateFilter) return false;
      if (!q) return true;
      const haystack = [
        d.cardCode, d.cardName, d.numAtCard, d.lot,
        `#${d.docNum}`, String(d.docNum),
        ...d.lines.flatMap((l) => [l.itemCode, l.itemName]),
      ];
      return haystack.some((h) => (h ?? "").toString().toLowerCase().includes(q));
    });
  }, [docs, query, dateFilter]);

  const toggle = (docEntry: number) => setExpanded((cur) => (cur === docEntry ? null : docEntry));
  const updateNumAtCard = (docEntry: number, numAtCard: string) =>
    setDocs((cur) => cur.map((d) => (d.docEntry === docEntry ? { ...d, numAtCard } : d)));
  const hasFilters = query.trim() !== "" || dateFilter !== "";
  // Entrée affichée en grand (dérivée de docs → reflète les éditions).
  const largeDoc = largeEntry != null ? docs.find((d) => d.docEntry === largeEntry) ?? null : null;

  return (
    <div className="space-y-6">
      <SurfaceCard accent="sky" className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-[15px] font-semibold flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            Liste des Entrées Marchandises
          </h2>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Rafraîchir
          </Button>
        </div>

        {/* ── Recherche : fournisseur / code article / date / numéro ── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Fournisseur, code article ou n° d'entrée…"
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
          <p className="text-[12px] italic text-muted-foreground py-2">Aucune entrée marchandise récente.</p>
        )}
        {!loading && docs.length > 0 && filtered.length === 0 && (
          <p className="text-[12px] italic text-muted-foreground py-2">Aucune entrée ne correspond à la recherche.</p>
        )}

        {filtered.length > 0 && (
          <div className="flex flex-wrap gap-6 pb-1">
            <Stat label="Entrées" value={<AnimatedNumber value={filtered.length} />} />
            <Stat
              label="Valeur cumulée (HT)"
              tone="emerald"
              value={
                <AnimatedNumber
                  value={filtered.reduce((s, d) => s + (d.totalHT ?? 0), 0)}
                  format={(n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n)}
                />
              }
            />
            <Stat label="Lignes" value={<AnimatedNumber value={filtered.reduce((s, d) => s + (d.lineCount ?? 0), 0)} />} />
          </div>
        )}

        {/* Mobile : liste de cartes — le tap OUVRE le détail en plein écran
            (pas d'accordéon : le détail ne tient pas en ligne sur téléphone). */}
        {filtered.length > 0 && (
          <div className="md:hidden space-y-2.5">
            {filtered.map((d) => {
              const openIncidents = (byDoc.get(d.docEntry) ?? []).filter((i) => !i.resolved);
              return (
                <button
                  key={d.docEntry}
                  type="button"
                  onClick={() => setLargeEntry(d.docEntry)}
                  className="w-full rounded-2xl border border-border bg-card flex items-center gap-3 p-4 text-left active:bg-secondary/40"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-mono font-semibold text-[16px] text-foreground">#{d.docNum}</span>
                    <div className="text-[14px] text-foreground/90 mt-0.5 truncate" title={d.cardName}>
                      {d.cardName || d.cardCode}
                    </div>
                    <div className="text-[13px] text-muted-foreground mt-0.5 tnum">
                      {fmtDate(d.docDate)} · {d.lineCount} ligne{d.lineCount > 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                    <div>
                      <span className="text-[17px] font-bold tnum text-foreground leading-none">{eur(d.totalHT ?? 0)}</span>
                      <span className="ml-1 text-[11px] text-muted-foreground">HT</span>
                    </div>
                    {/* Logo(s) du type d'incident à droite (pas de compteur) */}
                    {openIncidents.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        {openIncidents.map((i) => <IncidentTypeIcon key={i.id} type={i.type} className="h-[18px] w-[18px]" />)}
                      </span>
                    )}
                    <ChevronRight className="h-5 w-5 text-muted-foreground/50" />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="hidden md:block rounded-lg border border-border overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-2" />
                  <th className="text-left px-3 py-2 font-semibold w-24">N° EM</th>
                  <th className="text-left px-3 py-2 font-semibold w-28">Lot</th>
                  <th className="text-left px-3 py-2 font-semibold">Fournisseur</th>
                  <th className="text-left px-3 py-2 font-semibold w-28">Date</th>
                  <th className="text-right px-3 py-2 font-semibold w-16">Lignes</th>
                  <th className="text-right px-3 py-2 font-semibold w-28">Total HT</th>
                  <th className="text-center px-3 py-2 font-semibold w-20">Incident</th>
                </tr>
              </thead>
              <tbody>
                {filtered.flatMap((d) => {
                  const isOpen = expanded === d.docEntry;
                  const rows = [
                    <tr
                      key={d.docEntry}
                      className={`border-t border-border cursor-pointer transition-colors ${isOpen ? "bg-secondary/40" : "hover:bg-secondary/30"}`}
                      onClick={() => toggle(d.docEntry)}
                    >
                      <td className="px-2 py-2 text-center text-muted-foreground">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5 inline" /> : <ChevronRight className="h-3.5 w-3.5 inline" />}
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold">#{d.docNum}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{d.lot}</td>
                      <td className="px-3 py-2">
                        <div className="font-mono font-medium truncate" title={d.cardName}>{d.cardCode}</div>
                        {d.numAtCard && <div className="text-[11px] text-muted-foreground tnum">{d.numAtCard}</div>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground tnum">{fmtDate(d.docDate)}</td>
                      <td className="px-3 py-2 text-right tnum">{d.lineCount}</td>
                      <td className="px-3 py-2 text-right tnum font-semibold">{eur(d.totalHT ?? 0)}</td>
                      <td className="px-3 py-2 text-center">
                        {/* Logo(s) du TYPE d'incident ouvert (thermomètre pour le froid…) — pas de compteur */}
                        {(() => {
                          const open = (byDoc.get(d.docEntry) ?? []).filter((i) => !i.resolved);
                          if (open.length === 0) return <span className="text-muted-foreground/30 text-[11px]">—</span>;
                          return (
                            <span className="inline-flex items-center justify-center gap-1.5">
                              {open.map((i) => <IncidentTypeIcon key={i.id} type={i.type} className="h-[18px] w-[18px]" />)}
                            </span>
                          );
                        })()}
                      </td>
                    </tr>,
                  ];
                  if (isOpen) {
                    rows.push(
                      <tr key={`${d.docEntry}-detail`}>
                        <td colSpan={8} className="bg-secondary/20 px-4 py-4 border-t border-border/60">
                          <ReceiptDetail
                            receipt={d}
                            incidents={byDoc.get(d.docEntry) ?? []}
                            onIncidentChanged={reloadIncidents}
                            onNumAtCardChange={updateNumAtCard}
                            onEnlarge={() => setLargeEntry(d.docEntry)}
                          />
                        </td>
                      </tr>,
                    );
                  }
                  return rows;
                })}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      <OpenReceptionIncidents incidents={incidents} loading={incLoading} onChanged={reloadIncidents} />

      {/* ── Affichage agrandi (plein cadre) d'une entrée marchandise ── */}
      <Dialog open={!!largeDoc} onOpenChange={(o) => { if (!o) setLargeEntry(null); }}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 justify-start pr-8 text-[16px] sm:text-[18px] whitespace-nowrap">
              <ClipboardList className="h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400" />
              <span className="truncate min-w-0">Entrée marchandise N° {largeDoc?.docNum}</span>
              {/* Lot = « EM{docNum} » → redondant avec le N° ci-dessus : masqué sur mobile pour tenir sur UNE ligne. */}
              {largeDoc?.lot && <span className="hidden sm:inline text-[13px] font-normal font-mono text-muted-foreground shrink-0">· {largeDoc.lot}</span>}
            </DialogTitle>
          </DialogHeader>
          {largeDoc && (
            <ReceiptDetail
              large
              receipt={largeDoc}
              incidents={byDoc.get(largeDoc.docEntry) ?? []}
              onIncidentChanged={reloadIncidents}
              onNumAtCardChange={updateNumAtCard}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
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

/* ─────────────────────────────────────────────────────────────────
   Détail d'une entrée — désignation complète + montants HT/TVA/TTC,
   « idem que sur les bons dans la console ». Déclaration d'incident
   directement depuis cette consultation.
   ───────────────────────────────────────────────────────────────── */
function ReceiptDetail({
  receipt, incidents, onIncidentChanged, onNumAtCardChange, large, onEnlarge,
}: {
  receipt: Receipt;
  incidents: { id: string; type: string | null; note: string | null; resolved: boolean; createdAt: string; createdBy: string | null }[];
  onIncidentChanged: () => void;
  onNumAtCardChange: (docEntry: number, numAtCard: string) => void;
  /** Affichage agrandi (modale plein cadre) — textes et espacements plus grands. */
  large?: boolean;
  /** Ouvre l'affichage agrandi (visible seulement en mode normal). */
  onEnlarge?: () => void;
}) {
  const [declareOpen, setDeclareOpen] = useState(false);
  const [savingBl, setSavingBl] = useState(false);

  // Jeu de tailles : compact (inline) vs agrandi (modale).
  const big = !!large;
  const tbl = big ? "text-[15px]" : "text-[12px]";
  const th = big ? "px-3 py-2.5 text-[11.5px]" : "px-2 py-1.5 text-[10px]";
  const td = big ? "px-3 py-2.5" : "px-2 py-1.5";
  const totLbl = big ? "text-[12px]" : "text-[10px]";
  const totVal = big ? "text-[17px]" : "";

  async function saveNumAtCard(v: string) {
    const next = v.trim();
    if (next === (receipt.numAtCard ?? "")) return;
    setSavingBl(true);
    try {
      const res = await fetch("/api/sap/goods-receipts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: receipt.docEntry, numAtCard: next }),
      });
      const j = await res.json();
      if (!res.ok || j.ok === false) throw new Error(j.error || "Échec");
      onNumAtCardChange(receipt.docEntry, next);
      toast.success(`N° BL enregistré sur l'entrée #${receipt.docNum}`);
    } catch (e) {
      toast.error(`Échec de l'enregistrement du N° BL : ${e instanceof Error ? e.message : ""}`);
    } finally {
      setSavingBl(false);
    }
  }

  async function toggleResolved(id: string, resolved: boolean) {
    await fetch("/api/entrees/incidents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, resolved: !resolved }),
    });
    onIncidentChanged();
  }

  return (
    <div className={big ? "space-y-5" : "space-y-3"}>
      {/* En-tête : fournisseur + référence + commentaire (+ bouton Agrandir) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className={`inline-flex items-center gap-1.5 text-foreground ${big ? "text-[15px]" : "text-[12px]"}`}>
          <Truck className={big ? "h-4 w-4 text-muted-foreground" : "h-3.5 w-3.5 text-muted-foreground"} />
          <span className="font-mono font-semibold">{receipt.cardCode}</span>
          {receipt.cardName && <span className="text-muted-foreground">· {receipt.cardName}</span>}
        </span>
        <span className={`text-muted-foreground tnum ${big ? "text-[14px]" : "text-[12px]"}`}>Entrée le {fmtDate(receipt.docDate)}</span>
        {/* Référence fournisseur — éditable, valeur libre (BL, Cde, F…), aucun préfixe imposé */}
        <span className="inline-flex items-center gap-1.5">
          <input
            defaultValue={receipt.numAtCard ?? ""}
            placeholder="Réf. (BL, Cde, F…)"
            disabled={savingBl}
            onBlur={(e) => saveNumAtCard(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className={`rounded-md border border-border bg-background px-2 tnum focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60 ${big ? "h-9 w-56 text-[14px]" : "h-7 w-48 text-[12px]"}`}
          />
          {savingBl && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </span>
        {onEnlarge && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={onEnlarge}>
            <Maximize2 className="h-3.5 w-3.5" />
            Agrandir
          </Button>
        )}
      </div>
      {receipt.comments && <p className={`italic text-muted-foreground ${big ? "text-[13px]" : "text-[11.5px]"}`}>« {receipt.comments} »</p>}

      {/* Mobile : lignes empilées (le tableau large déborde) + totaux */}
      <div className="md:hidden space-y-2">
        {receipt.lines.map((l, i) => {
          const dz = designationProduit({ itemName: l.itemName, uPays: l.uPays, uMarque: l.uMarque, uCondi: l.uCondi, frgnName: l.frgnName });
          const lineHT = l.lineTotal ?? (l.price != null ? l.price * l.pieceQuantity : null);
          return (
            <div key={`m-${l.itemCode}-${i}`} className="rounded-lg border border-border bg-card/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-foreground leading-tight">{dz.fruit}</div>
                  <div className="text-[12px] font-mono text-muted-foreground mt-0.5">{l.itemCode}</div>
                  <DesignationChips marque={dz.marque} condt={dz.condt} calibre={dz.variete} pays={dz.pays} className="mt-1.5" />
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
              </div>
            </div>
          );
        })}
        <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1.5">
          <div className="flex justify-between text-[14px]"><span className="text-muted-foreground">Total HT</span><span className="font-semibold tnum">{eur(receipt.totalHT ?? 0)}</span></div>
          <div className="flex justify-between text-[14px]"><span className="text-muted-foreground">TVA</span><span className="tnum text-muted-foreground">{eur(receipt.totalTVA ?? 0)}</span></div>
          <div className="flex justify-between text-[16px] border-t border-border pt-1.5"><span className="font-semibold text-foreground">Total TTC</span><span className="font-bold tnum text-foreground">{eur(receipt.totalTTC ?? receipt.total ?? 0)}</span></div>
        </div>
      </div>

      {/* Desktop : tableau large — désignation décomposée + HT par ligne */}
      <div className="hidden md:block rounded-lg border border-border overflow-x-auto bg-card/40">
        <table className={`w-full ${tbl}`}>
          <thead className="bg-secondary/40 uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className={`text-left font-semibold w-24 ${th}`}>Qté</th>
              <th className={`text-left font-semibold w-28 ${th}`}>Code Article</th>
              <th className={`text-left font-semibold ${th}`}>Fruit</th>
              <th className={`text-left font-semibold ${th}`}>Pays</th>
              <th className={`text-left font-semibold ${th}`}>Marque</th>
              <th className={`text-left font-semibold ${th}`}>Variété</th>
              <th className={`text-left font-semibold ${th}`}>Condt</th>
              <th className={`text-right font-semibold w-24 ${th}`}>PU HT</th>
              <th className={`text-right font-semibold w-24 ${th}`}>Total HT</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((l, i) => {
              const dz = designationProduit({ itemName: l.itemName, uPays: l.uPays, uMarque: l.uMarque, uCondi: l.uCondi, frgnName: l.frgnName });
              const lineHT = l.lineTotal ?? (l.price != null ? l.price * l.pieceQuantity : null);
              return (
                <tr key={`${l.itemCode}-${i}`} className="border-t border-border/50">
                  <td className={`tnum whitespace-nowrap ${td}`}>{fmtColis(l.packageQuantity)} <span className="text-muted-foreground">colis</span></td>
                  <td className={`font-mono ${td}`}>{l.itemCode}</td>
                  <td className={`text-foreground ${td}`}>{dz.fruit}</td>
                  <td className={td}><Chip kind="pays">{dz.pays}</Chip></td>
                  <td className={td}><Chip kind="marque">{dz.marque}</Chip></td>
                  <td className={td}><Chip kind="calibre">{dz.variete}</Chip></td>
                  <td className={td}><Chip kind="condt">{dz.condt}</Chip></td>
                  <td className={`text-right tnum ${td}`}>{l.price != null ? eur(l.price) : "—"}</td>
                  <td className={`text-right tnum font-medium ${td}`}>{lineHT != null ? eur(lineHT) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-secondary/30">
              <td colSpan={7} className={`text-right uppercase tracking-wide font-semibold text-muted-foreground ${td} ${totLbl}`}>Total HT</td>
              <td colSpan={2} className={`text-right tnum font-semibold text-foreground ${td} ${totVal}`}>{eur(receipt.totalHT ?? 0)}</td>
            </tr>
            <tr className="bg-secondary/20">
              <td colSpan={7} className={`text-right uppercase tracking-wide font-semibold text-muted-foreground ${td} ${totLbl}`}>TVA</td>
              <td colSpan={2} className={`text-right tnum text-muted-foreground ${td}`}>{eur(receipt.totalTVA ?? 0)}</td>
            </tr>
            <tr className="bg-secondary/30 border-t border-border">
              <td colSpan={7} className={`text-right uppercase tracking-wide font-semibold text-muted-foreground ${td} ${totLbl}`}>Total TTC</td>
              <td colSpan={2} className={`text-right tnum font-bold text-foreground ${td} ${totVal}`}>{eur(receipt.totalTTC ?? receipt.total ?? 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Incidents déjà déclarés sur cette entrée */}
      {incidents.length > 0 && (
        <ul className="space-y-1">
          {incidents.map((i) => (
            <li key={i.id} className={`flex items-center gap-2 ${big ? "text-[14px]" : "text-[12px]"}`}>
              <button
                type="button"
                onClick={() => toggleResolved(i.id, i.resolved)}
                title={i.resolved ? "Rouvrir" : "Marquer résolu"}
                className={`h-4 w-4 shrink-0 rounded border inline-flex items-center justify-center ${i.resolved ? "bg-emerald-500 border-emerald-500 text-white" : "border-border"}`}
              >
                {i.resolved && <span className="text-[9px]">✓</span>}
              </button>
              <IncidentTypeIcon type={i.type} className="h-3.5 w-3.5 shrink-0" />
              <span className={i.resolved ? "line-through text-muted-foreground" : ""}>
                <span className="font-medium">{i.type}</span>
                {i.note ? <span className="text-muted-foreground"> — {i.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Déclaration d'un incident depuis la consultation */}
      {declareOpen ? (
        <InlineIncidentDeclare
          receipt={{ docEntry: receipt.docEntry, docNum: receipt.docNum, lot: receipt.lot, cardCode: receipt.cardCode, cardName: receipt.cardName }}
          onCreated={() => { setDeclareOpen(false); onIncidentChanged(); }}
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setDeclareOpen(true)}>
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          Déclarer un incident
        </Button>
      )}
    </div>
  );
}
