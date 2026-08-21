"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import { DateStepper } from "@/components/ui/date-stepper";
import { StarRating } from "@/components/ui/star-rating";
import { designationProduit } from "@/lib/produit-designation";
import { eur as fmtEur } from "@/lib/format";
import { DesignationStrong, DesignationMuted, type DesignationFields } from "@/components/livraisons/ArticleDesignation";

/* ─────────────────────────────────────────────────────────────────
   ÉDITEUR DE LIGNES PARTAGÉ — fournisseur + dates + tableau de lignes +
   totaux, commun à l'entrée marchandise (EM) et à la commande fournisseur
   (CF). Les deux écrans manipulaient ~400 lignes identiques : ils partagent
   désormais ce composant, la même `DocLine` et les mêmes dérivations de prix.

   ZONE DE SAISIE → sobre : fond carte neutre, en-têtes gris marqués, filets
   nets, zébrage. Aucun fond coloré derrière le tableau ; l'ambre ne signale
   qu'un état (total forcé).
   ───────────────────────────────────────────────────────────────── */

export type Supplier = { cardCode: string; cardName: string };
export type ProductHit = {
  id: string; itemCode: string; itemName: string;
  salesUnit: string | null;                    // ex. "pie" — unité de stock
  salesPackagingUnit: string | null;           // ex. "CAT I" — libellé du colis
  salesQtyPerPackUnit: number | null;          // ex. 12 — pie par colis
  uPays: string | null;                        // pays d'origine
  uMarque: string | null;                      // marque
  uCondi: string | null;                       // conditionnement (ex. "12x125g")
  frgnName: string | null;                     // variété (SAP FrgnName)
};

export type WarehouseCode = "000" | "01" | "R1";
export const WAREHOUSES: { code: WarehouseCode; label: string }[] = [
  { code: "000", label: "000 · A/C-A/D" },
  { code: "01",  label: "01 · Stock" },
  { code: "R1",  label: "R1 · J+1" },
];

/** Ligne de document (EM ou CF). `dlc`/`note` ne servent qu'à l'EM. */
export type DocLine = {
  itemCode: string; itemName: string;
  ratio: number;                               // pie par colis (1 si non emballé)
  packageQuantity: number;                     // nb de COLIS saisis
  warehouseCode: WarehouseCode;
  price: string;                               // prix /pie (HT), "" si non saisi
  // Total HT FORCÉ de la ligne (facture fournisseur) : quand `forceTotal` est
  // vrai, le PU est DÉRIVÉ (total / pièces). Saisir un PU re-bascule en mode PU.
  lineTotal: string;
  forceTotal: boolean;
  pays: string | null; marque: string | null; condt: string | null; variete: string | null;
  dlc: string;                                 // DDM optionnelle (YYYY-MM-DD), "" si absente
  note: number | null;                         // note qualité 1..5 (étoiles), null si non notée
};

/** PU /pie effectif — dérivé du total forcé quand présent. */
export const effPU = (l: DocLine): number | null => {
  const pieces = l.packageQuantity * l.ratio;
  if (l.forceTotal) {
    const t = parseFloat(l.lineTotal);
    return Number.isFinite(t) && pieces > 0 ? Math.round((t / pieces) * 10000) / 10000 : null;
  }
  const p = l.price === "" ? null : parseFloat(l.price);
  return p != null && Number.isFinite(p) ? p : null;
};
/** Total HT effectif — total forcé, sinon PU × pièces. */
export const effTotal = (l: DocLine): number | null => {
  if (l.forceTotal) {
    const t = parseFloat(l.lineTotal);
    return Number.isFinite(t) ? t : null;
  }
  const p = effPU(l);
  return p != null ? p * l.packageQuantity * l.ratio : null;
};

/** Construit une ligne neuve depuis un article, avec DDM par défaut optionnelle. */
export function makeLine(p: ProductHit, defaultDlc = ""): DocLine {
  const ratio = p.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1 ? p.salesQtyPerPackUnit : 1;
  return {
    itemCode: p.itemCode, itemName: p.itemName, ratio,
    packageQuantity: 1, warehouseCode: "01", price: "", lineTotal: "", forceTotal: false,
    pays: p.uPays, marque: p.uMarque, condt: p.uCondi, variete: p.frgnName,
    dlc: defaultDlc, note: null,
  };
}

/** Champs de désignation d'une ligne (fruit rendu à part). */
function dzFieldsOf(l: DocLine): { fruit: string; fields: DesignationFields } {
  const dz = designationProduit({ itemName: l.itemName, uPays: l.pays, uMarque: l.marque, uCondi: l.condt, frgnName: l.variete });
  return { fruit: dz.fruit, fields: { marque: dz.marque, condt: dz.condt, variete: dz.variete, pays: dz.pays } };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Ferme un panneau (liste déroulante) quand on clique/tape en dehors. */
function useClickOutside<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T>(null);
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    const handler = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);
  return ref;
}

/** Combobox fournisseur (autocomplete BusinessPartners cSupplier). */
export function SupplierPicker({ value, onChange }: {
  value: Supplier | null; onChange: (s: Supplier | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Supplier[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounced(query, 220);
  const boxRef = useClickOutside<HTMLDivElement>(() => setOpen(false));

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/sap/suppliers?q=${encodeURIComponent(debounced)}`);
        const json = await res.json();
        if (!cancel) setResults(json.suppliers ?? []);
      } catch {
        if (!cancel) setResults([]);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [debounced]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
        <div className="min-w-0">
          <p className="text-body font-semibold truncate">{value.cardName}</p>
          <p className="text-caption text-muted-foreground font-mono">{value.cardCode}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Changer</Button>
      </div>
    );
  }

  return (
    <div className="relative" ref={boxRef}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        placeholder="Fournisseur (code ou nom)…"
        className="pl-9"
      />
      {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover shadow-modal max-h-72 overflow-auto">
          {results.map((s) => (
            <li key={s.cardCode}>
              <button
                type="button"
                onClick={() => { onChange(s); setQuery(""); setOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-secondary/60 transition-colors"
              >
                <div className="text-body font-medium">{s.cardName}</div>
                <div className="text-caption text-muted-foreground font-mono">{s.cardCode}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Combobox produit (search /api/products). */
export function ProductPicker({ onPick }: { onPick: (p: ProductHit) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounced(query, 220);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useClickOutside<HTMLDivElement>(() => setOpen(false));

  useEffect(() => {
    let cancel = false;
    if (!debounced.trim()) { setResults([]); return; }
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ search: debounced.trim(), limit: "8" });
        const res = await fetch(`/api/products?${params}`);
        const json = await res.json();
        if (!cancel) setResults(json.products ?? []);
      } catch {
        if (!cancel) setResults([]);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [debounced]);

  return (
    <div className="relative" ref={boxRef}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        placeholder="Code ou nom article…"
        className="pl-9"
      />
      {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover shadow-modal max-h-72 overflow-auto">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => { onPick(p); setQuery(""); setOpen(false); inputRef.current?.focus(); }}
                className="w-full text-left px-3 py-2 hover:bg-secondary/60 transition-colors"
              >
                <div className="text-body font-medium truncate">
                  {[p.itemName, p.uMarque, p.uCondi, p.uPays].filter((x) => x && x.trim() && x.trim() !== "-").join(" · ")}
                </div>
                <div className="text-caption text-muted-foreground font-mono">{p.itemCode}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const LABEL = "text-caption uppercase tracking-wide text-muted-foreground font-semibold";

interface DocumentLinesEditorProps {
  supplier: Supplier | null;
  onSupplierChange: (s: Supplier | null) => void;
  date: string; onDateChange: (v: string) => void;
  time: string; onTimeChange: (v: string) => void;
  dateLabel: string; timeLabel: string;
  reference: string; onReferenceChange: (v: string) => void;
  referencePlaceholder?: string;
  lines: DocLine[];
  onLinesChange: (updater: (cur: DocLine[]) => DocLine[]) => void;
  /** DDM par défaut à l'ajout d'une ligne (EM) — renvoie "" pour aucune. */
  makeDefaultDlc?: (p: ProductHit) => string;
  /** Colonne DDM (fraîcheur) — entrée marchandise uniquement. */
  showDDM?: boolean;
  /** Note qualité par article (étoiles) — entrée marchandise uniquement. */
  showNote?: boolean;
  /** Bloc inséré après la référence (ex. « Affecté à »). */
  headerExtra?: React.ReactNode;
  /** Commentaire + barre d'actions rendus sous les totaux. */
  children?: React.ReactNode;
}

/** Éditeur partagé : fournisseur + dates + lignes (~5 colonnes) + totaux. */
export function DocumentLinesEditor({
  supplier, onSupplierChange,
  date, onDateChange, time, onTimeChange, dateLabel, timeLabel,
  reference, onReferenceChange, referencePlaceholder,
  lines, onLinesChange, makeDefaultDlc,
  showDDM = false, showNote = false, headerExtra, children,
}: DocumentLinesEditorProps) {
  const addLine = (p: ProductHit) => onLinesChange((cur) => {
    if (cur.some((l) => l.itemCode === p.itemCode)) {
      toast.info(`${p.itemCode} déjà dans la liste`);
      return cur;
    }
    return [...cur, makeLine(p, makeDefaultDlc ? makeDefaultDlc(p) : "")];
  });
  const updateLine = (i: number, patch: Partial<DocLine>) =>
    onLinesChange((c) => c.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) =>
    onLinesChange((c) => c.filter((_, k) => k !== i));

  const totalHT = lines.reduce((s, l) => s + (effTotal(l) ?? 0), 0);
  // Colonnes du tableau sobre : Qté · Article · Entrepôt · [DDM] · Prix/Total.
  const colCount = showDDM ? 5 : 4;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className={LABEL}>Fournisseur</label>
          <SupplierPicker value={supplier} onChange={onSupplierChange} />
        </div>
        <div className="space-y-1.5">
          <label className={LABEL}>{dateLabel}</label>
          <DateStepper value={date} onChange={onDateChange} time={time} onTimeChange={onTimeChange} timeLabel={timeLabel} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className={LABEL}>Référence (BL, Cde, F… — optionnel)</label>
          <Input value={reference} onChange={(e) => onReferenceChange(e.target.value)} placeholder={referencePlaceholder ?? "ex. BL-2026-0123, F-2026-045…"} />
        </div>
        {headerExtra && <div className="sm:col-span-2">{headerExtra}</div>}
      </div>

      <div className="space-y-1.5">
        <label className={LABEL}>Ajouter un article</label>
        <ProductPicker onPick={addLine} />
      </div>

      {/* Mobile : lignes empilées (le tableau large déborde sur téléphone). */}
      {lines.length > 0 && (
        <div className="md:hidden space-y-2.5">
          {lines.map((l, i) => {
            const pieceQty = l.packageQuantity * l.ratio;
            const { fruit, fields } = dzFieldsOf(l);
            return (
              <div key={l.itemCode} className="rounded-xl border border-border bg-card p-3 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-callout font-semibold text-foreground leading-tight">
                      {fruit} <DesignationStrong l={fields} className="text-body" />
                    </div>
                    <div className="text-caption font-mono text-muted-foreground mt-0.5">{l.itemCode}</div>
                    <DesignationMuted l={fields} className="text-caption mt-0.5" />
                  </div>
                  <Button variant="ghost" size="icon-sm" tabIndex={-1} onClick={() => removeLine(i)} aria-label="Supprimer">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {showNote && (
                  <div className="flex items-center justify-between gap-2">
                    <span className={LABEL}>Note qualité</span>
                    <StarRating value={l.note} onChange={(v) => updateLine(i, { note: v })} size="md" ariaLabel={`Note qualité ${fruit}`} />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className={`block ${LABEL} mb-1`}>Qté (colis)</label>
                    <NumberInput
                      value={l.packageQuantity}
                      onValueChange={(n) => updateLine(i, { packageQuantity: n ?? 0 })}
                      min={0} step={1}
                      className="h-11 w-full text-right"
                    />
                    <div className="text-caption text-muted-foreground mt-0.5 text-right">{l.ratio > 1 ? `= ${pieceQty} pie` : "à la pièce"}</div>
                  </div>
                  <div>
                    <label className={`block ${LABEL} mb-1`}>Entrepôt</label>
                    <select
                      value={l.warehouseCode}
                      onChange={(e) => updateLine(i, { warehouseCode: e.target.value as WarehouseCode })}
                      tabIndex={-1}
                      className="h-11 w-full rounded-md border border-input bg-background px-2 text-body"
                    >
                      {WAREHOUSES.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className={`block ${LABEL} mb-1`}>Prix /pie HT</label>
                    <NumberInput
                      value={effPU(l)}
                      onValueChange={(n) => updateLine(i, { price: n == null ? "" : String(n), forceTotal: false, lineTotal: "" })}
                      min={0} step={0.01} decimals={2} allowEmpty placeholder="—"
                      className="h-11 w-full text-right"
                    />
                  </div>
                  <div>
                    <label className={`block ${LABEL} mb-1`}>Total HT{l.forceTotal ? " (forcé)" : ""}</label>
                    <NumberInput
                      value={effTotal(l)}
                      onValueChange={(n) => updateLine(i, { lineTotal: n == null ? "" : String(n), forceTotal: n != null })}
                      min={0} step={0.01} decimals={2} allowEmpty placeholder="—"
                      className={`h-11 w-full text-right font-bold ${l.forceTotal ? "ring-1 ring-warning" : ""}`}
                    />
                  </div>
                </div>
                {showDDM && (
                  <div>
                    <label className={`block ${LABEL} mb-1`}>DDM (optionnel)</label>
                    <input
                      type="date"
                      value={l.dlc}
                      onChange={(e) => updateLine(i, { dlc: e.target.value })}
                      className="h-11 w-full rounded-md border border-input bg-background px-2 text-body"
                    />
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-between px-1 pt-1 border-t border-border">
            <span className={LABEL}>Total HT</span>
            <span className="text-title2 font-bold tnum text-foreground">{fmtEur(totalHT)}</span>
          </div>
        </div>
      )}

      {/* Desktop : tableau sobre (~5 colonnes). En-tête gris marqué, zébrage. */}
      {lines.length > 0 && (
        <div className="hidden md:block rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-body">
            <thead className="bg-secondary/60 text-caption uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2.5 font-semibold w-28">Qté colis</th>
                <th className="text-left px-3 py-2.5 font-semibold">Article</th>
                <th className="text-left px-3 py-2.5 font-semibold w-40">Entrepôt</th>
                {showDDM && <th className="text-left px-3 py-2.5 font-semibold w-40">DDM</th>}
                <th className="text-right px-3 py-2.5 font-semibold w-32">Prix / Total HT</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="[&>tr:nth-child(even)]:bg-muted/40">
              {lines.map((l, i) => {
                const pieceQty = l.packageQuantity * l.ratio;
                const { fruit, fields } = dzFieldsOf(l);
                return (
                  <tr key={l.itemCode} className="border-t border-border">
                    <td className="px-3 py-2.5 align-top">
                      <NumberInput
                        value={l.packageQuantity}
                        onValueChange={(n) => updateLine(i, { packageQuantity: n ?? 0 })}
                        min={0} step={1}
                        className="text-right h-9 w-20"
                      />
                      <div className="text-caption2 text-muted-foreground mt-0.5 text-right pr-1">
                        {l.ratio > 1 ? `= ${pieceQty} pie` : "pièce"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="font-semibold text-foreground">{fruit}</span>
                        <DesignationStrong l={fields} className="text-caption" />
                      </div>
                      <div className="font-mono text-caption text-muted-foreground">{l.itemCode}</div>
                      <DesignationMuted l={fields} className="text-caption" />
                      {showNote && (
                        <StarRating value={l.note} onChange={(v) => updateLine(i, { note: v })} size="sm" className="mt-1" ariaLabel={`Note qualité ${fruit}`} />
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <select
                        value={l.warehouseCode}
                        onChange={(e) => updateLine(i, { warehouseCode: e.target.value as WarehouseCode })}
                        tabIndex={-1}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-body"
                      >
                        {WAREHOUSES.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}
                      </select>
                    </td>
                    {showDDM && (
                      <td className="px-3 py-2.5 align-top">
                        <input
                          type="date"
                          value={l.dlc}
                          onChange={(e) => updateLine(i, { dlc: e.target.value })}
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-body"
                        />
                      </td>
                    )}
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex flex-col items-end gap-1">
                        <NumberInput
                          value={effPU(l)}
                          onValueChange={(n) => updateLine(i, { price: n == null ? "" : String(n), forceTotal: false, lineTotal: "" })}
                          min={0} step={0.01} decimals={2} allowEmpty placeholder="PU /pie"
                          className="text-right h-8 w-28"
                        />
                        <NumberInput
                          value={effTotal(l)}
                          onValueChange={(n) => updateLine(i, { lineTotal: n == null ? "" : String(n), forceTotal: n != null })}
                          min={0} step={0.01} decimals={2} allowEmpty placeholder="Total HT"
                          title={l.forceTotal ? "Total forcé — le PU est recalculé (total / pièces)" : "Saisis le total HT de la ligne pour forcer le PU"}
                          className={`text-right h-9 w-28 font-semibold ${l.forceTotal ? "ring-1 ring-warning" : ""}`}
                        />
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right align-top">
                      <Button variant="ghost" size="icon-sm" tabIndex={-1} onClick={() => removeLine(i)} aria-label="Supprimer">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-secondary/60">
                <td colSpan={colCount} className="px-3 py-2.5 text-right text-caption uppercase tracking-wide font-semibold text-muted-foreground">
                  Total HT
                </td>
                <td className="px-3 py-2.5 text-right tnum font-bold text-foreground whitespace-nowrap">
                  {fmtEur(totalHT)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {lines.length === 0 && (
        <p className="text-caption italic text-muted-foreground text-center py-6">
          Aucune ligne. Recherche un article ci-dessus pour commencer.
        </p>
      )}

      {children}
    </div>
  );
}
