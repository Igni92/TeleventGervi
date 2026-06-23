"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, ClipboardList, Search, ChevronRight, ChevronDown,
  AlertTriangle, Truck, X,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { designationProduit } from "@/lib/produit-designation";
import {
  OpenReceptionIncidents, InlineIncidentDeclare, IncidentTypeIcon, useReceptionIncidents,
} from "./ReceptionIncidents";

type ReceiptLine = {
  itemCode: string; itemName?: string;
  pieceQuantity: number; packageQuantity: number | null;
  warehouse?: string;
  price: number | null; lineTotal: number | null; taxPercent: number | null;
  uPays: string | null; uMarque: string | null; uCondi: string | null;
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
  const { incidents, loading: incLoading, reload: reloadIncidents, openCountByDoc, byDoc } = useReceptionIncidents();

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
              label="Valeur cumulée (TTC)"
              tone="emerald"
              value={
                <AnimatedNumber
                  value={filtered.reduce((s, d) => s + (d.totalTTC ?? d.total ?? 0), 0)}
                  format={(n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n)}
                />
              }
            />
            <Stat label="Lignes" value={<AnimatedNumber value={filtered.reduce((s, d) => s + (d.lineCount ?? 0), 0)} />} />
          </div>
        )}

        {filtered.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-2" />
                  <th className="text-left px-3 py-2 font-semibold w-24">N° EM</th>
                  <th className="text-left px-3 py-2 font-semibold w-28">Lot</th>
                  <th className="text-left px-3 py-2 font-semibold">Fournisseur</th>
                  <th className="text-left px-3 py-2 font-semibold w-28">Date</th>
                  <th className="text-right px-3 py-2 font-semibold w-16">Lignes</th>
                  <th className="text-right px-3 py-2 font-semibold w-28">Total TTC</th>
                  <th className="text-center px-3 py-2 font-semibold w-20">Incident</th>
                </tr>
              </thead>
              <tbody>
                {filtered.flatMap((d) => {
                  const isOpen = expanded === d.docEntry;
                  const openInc = openCountByDoc.get(d.docEntry) ?? 0;
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
                      <td className="px-3 py-2 text-right tnum font-semibold">{eur(d.totalTTC ?? d.total ?? 0)}</td>
                      <td className="px-3 py-2 text-center">
                        {/* Icône incident visible UNIQUEMENT s'il y a un incident ouvert */}
                        {openInc > 0 ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 h-6 rounded-md text-[11px] font-semibold bg-amber-500/15 border border-amber-500/60 text-amber-600 dark:text-amber-400"
                            title={`${openInc} incident(s) ouvert(s)`}
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {openInc}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/30 text-[11px]">—</span>
                        )}
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
  receipt, incidents, onIncidentChanged, onNumAtCardChange,
}: {
  receipt: Receipt;
  incidents: { id: string; type: string | null; note: string | null; resolved: boolean; createdAt: string; createdBy: string | null }[];
  onIncidentChanged: () => void;
  onNumAtCardChange: (docEntry: number, numAtCard: string) => void;
}) {
  const [declareOpen, setDeclareOpen] = useState(false);
  const [savingBl, setSavingBl] = useState(false);

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
    <div className="space-y-3">
      {/* En-tête : fournisseur + référence + commentaire */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span className="inline-flex items-center gap-1.5 text-foreground">
          <Truck className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono font-semibold">{receipt.cardCode}</span>
          {receipt.cardName && <span className="text-muted-foreground">· {receipt.cardName}</span>}
        </span>
        <span className="text-muted-foreground tnum">Entrée le {fmtDate(receipt.docDate)}</span>
        {/* Référence fournisseur — éditable, valeur libre (BL, Cde, F…), aucun préfixe imposé */}
        <span className="inline-flex items-center gap-1.5">
          <input
            defaultValue={receipt.numAtCard ?? ""}
            placeholder="Réf. (BL, Cde, F…)"
            disabled={savingBl}
            onBlur={(e) => saveNumAtCard(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="h-7 w-48 rounded-md border border-border bg-background px-2 text-[12px] tnum focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
          />
          {savingBl && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </span>
      </div>
      {receipt.comments && <p className="text-[11.5px] italic text-muted-foreground">« {receipt.comments} »</p>}

      {/* Lignes — désignation décomposée + HT par ligne */}
      <div className="rounded-lg border border-border overflow-hidden bg-card/40">
        <table className="w-full text-[12px]">
          <thead className="bg-secondary/40 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-2 py-1.5 font-semibold w-24">Qté</th>
              <th className="text-left px-2 py-1.5 font-semibold w-28">Code Article</th>
              <th className="text-left px-2 py-1.5 font-semibold">Fruit</th>
              <th className="text-left px-2 py-1.5 font-semibold">Pays</th>
              <th className="text-left px-2 py-1.5 font-semibold">Marque</th>
              <th className="text-left px-2 py-1.5 font-semibold">Variété</th>
              <th className="text-left px-2 py-1.5 font-semibold">Condt</th>
              <th className="text-right px-2 py-1.5 font-semibold w-24">PU HT</th>
              <th className="text-right px-2 py-1.5 font-semibold w-24">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((l, i) => {
              const dz = designationProduit({ itemName: l.itemName, uPays: l.uPays, uMarque: l.uMarque, uCondi: l.uCondi });
              const lineHT = l.lineTotal ?? (l.price != null ? l.price * l.pieceQuantity : null);
              return (
                <tr key={`${l.itemCode}-${i}`} className="border-t border-border/50">
                  <td className="px-2 py-1.5 tnum whitespace-nowrap">{fmtColis(l.packageQuantity)} <span className="text-muted-foreground">colis</span></td>
                  <td className="px-2 py-1.5 font-mono">{l.itemCode}</td>
                  <td className="px-2 py-1.5 text-foreground">{dz.fruit}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{dz.pays}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{dz.marque}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{dz.variete}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{dz.condt}</td>
                  <td className="px-2 py-1.5 text-right tnum">{l.price != null ? eur(l.price) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tnum font-medium">{lineHT != null ? eur(lineHT) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-secondary/30">
              <td colSpan={7} className="px-2 py-1.5 text-right text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Total HT</td>
              <td colSpan={2} className="px-2 py-1.5 text-right tnum font-semibold text-foreground">{eur(receipt.totalHT ?? 0)}</td>
            </tr>
            <tr className="bg-secondary/20">
              <td colSpan={7} className="px-2 py-1 text-right text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">TVA</td>
              <td colSpan={2} className="px-2 py-1 text-right tnum text-muted-foreground">{eur(receipt.totalTVA ?? 0)}</td>
            </tr>
            <tr className="bg-secondary/30 border-t border-border">
              <td colSpan={7} className="px-2 py-1.5 text-right text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Total TTC</td>
              <td colSpan={2} className="px-2 py-1.5 text-right tnum font-bold text-foreground">{eur(receipt.totalTTC ?? receipt.total ?? 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Incidents déjà déclarés sur cette entrée */}
      {incidents.length > 0 && (
        <ul className="space-y-1">
          {incidents.map((i) => (
            <li key={i.id} className="flex items-center gap-2 text-[12px]">
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
