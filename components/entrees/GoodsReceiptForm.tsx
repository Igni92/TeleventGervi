"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Search, Trash2, PackagePlus, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { DateStepper, todayISO } from "@/components/ui/date-stepper";
import { designationProduit } from "@/lib/produit-designation";
import { DesignationChips } from "./DesignationChips";

/** Montant € à 2 décimales (séparateur FR). */
const fmtEur = (n: number): string =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

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
type Line = {
  itemCode: string; itemName: string;
  packUnit: string;                            // libellé colis affiché ("colis" si null)
  ratio: number;                               // pie par colis (1 si non emballé)
  packageQuantity: number;                     // ⚠️ nb de COLIS saisis
  warehouseCode: "000" | "01" | "R1";
  price: string;                               // prix /pie (HT)
  pays: string | null;                         // désignation : pays
  marque: string | null;                       // désignation : marque
  condt: string | null;                        // désignation : conditionnement
  variete: string | null;                      // désignation : variété (FrgnName)
  dlc: string;                                  // DLC optionnelle (fraîcheur) — "" si non saisie (YYYY-MM-DD)
};

const WAREHOUSES: { code: "000" | "01" | "R1"; label: string }[] = [
  { code: "000", label: "000 · A/C-A/D" },
  { code: "01",  label: "01 · Stock" },
  { code: "R1",  label: "R1 · J+1" },
];

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

/** Combobox supplier (autocomplete BusinessPartners cSupplier). */
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
      <div className="flex items-center justify-between rounded-lg border border-border bg-card/50 px-3 py-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold truncate">{value.cardName}</p>
          <p className="text-[11px] text-muted-foreground font-mono">{value.cardCode}</p>
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
                <div className="text-[13px] font-medium">{s.cardName}</div>
                <div className="text-[11px] text-muted-foreground font-mono">{s.cardCode}</div>
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
                <div className="text-[13px] font-medium truncate">
                  {[p.itemName, p.uPays, p.uMarque, p.uCondi].filter((x) => x && x.trim() && x.trim() !== "-").join(" · ")}
                </div>
                <div className="text-[11px] text-muted-foreground font-mono">{p.itemCode}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Date du jour + n jours, au format YYYY-MM-DD (local). */
function plusDaysISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function GoodsReceiptForm() {
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [docDate, setDocDate] = useState(todayISO());
  const [numAtCard, setNumAtCard] = useState("");
  const [comment, setComment] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<{ docNum: number; lot: string } | null>(null);
  // Durées de vie par défaut (jours) par article → pré-remplit la DLC à l'ajout
  // d'une ligne (= date du jour + jours). Réglées dans Paramètres › Fraîcheur.
  const [shelfLife, setShelfLife] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancel = false;
    fetch("/api/products/shelf-life", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancel || !j?.items) return;
        const map: Record<string, number> = {};
        for (const it of j.items as { itemCode: string; days: number }[]) map[it.itemCode] = it.days;
        setShelfLife(map);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  const addLine = useCallback((p: ProductHit) => {
    setLines((cur) => {
      if (cur.some((l) => l.itemCode === p.itemCode)) {
        toast.info(`${p.itemCode} déjà dans la liste`);
        return cur;
      }
      const ratio = (p.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1) ? p.salesQtyPerPackUnit : 1;
      const sl = shelfLife[p.itemCode];
      return [...cur, {
        itemCode: p.itemCode,
        itemName: p.itemName,
        packUnit: p.salesPackagingUnit?.trim() || "colis",
        ratio,
        packageQuantity: 1,
        warehouseCode: "01",
        price: "",
        pays: p.uPays,
        marque: p.uMarque,
        condt: p.uCondi,
        variete: p.frgnName,
        dlc: sl && sl > 0 ? plusDaysISO(sl) : "",
      }];
    });
  }, [shelfLife]);

  const updateLine = (i: number, patch: Partial<Line>) =>
    setLines((c) => c.map((l, k) => k === i ? { ...l, ...patch } : l));
  const removeLine = (i: number) => setLines((c) => c.filter((_, k) => k !== i));

  // Total HT estimé = Σ (colis × ratio pie × prix /pie) des lignes prix saisi.
  const totalHT = lines.reduce((s, l) => {
    const price = l.price === "" ? null : parseFloat(l.price);
    return s + (price != null ? price * l.packageQuantity * l.ratio : 0);
  }, 0);

  const reset = () => {
    setSupplier(null); setDocDate(todayISO()); setNumAtCard(""); setComment(""); setLines([]);
  };

  const submit = async () => {
    if (!supplier) { toast.error("Sélectionne un fournisseur"); return; }
    if (lines.length === 0) { toast.error("Ajoute au moins 1 ligne"); return; }
    for (const l of lines) {
      if (!l.packageQuantity || l.packageQuantity <= 0) {
        toast.error(`Quantité (colis) invalide sur ${l.itemCode}`);
        return;
      }
    }
    setSubmitting(true);
    setLastReceipt(null);
    try {
      const res = await fetch("/api/sap/goods-receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardCode: supplier.cardCode,
          docDate: docDate || undefined,
          numAtCard: numAtCard.trim() || undefined,
          comment: comment.trim() || undefined,
          lines: lines.map((l) => ({
            itemCode: l.itemCode,
            packageQuantity: l.packageQuantity,
            warehouseCode: l.warehouseCode,
            price: l.price ? parseFloat(l.price) : undefined,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error || "Erreur SAP");
        return;
      }
      const retro = json.retroPatchedLines as number | undefined;
      toast.success(`BR #${json.docNum} créé — lot ${json.lot}`, {
        description: retro && retro > 0
          ? `${lines.length} ligne(s) — stock incrémenté. ${retro} BL ouvert(s) du jour relié(s) à ce lot.`
          : `${lines.length} ligne(s) — stock incrémenté.`,
      });

      // ── DLC (fraîcheur) : best-effort, ne bloque JAMAIS la réception ──
      // Le n° de lot créé est exposé par l'API : json.lot === "EM<DocNum>"
      // (cf. app/api/sap/goods-receipts/route.ts → { lot, docNum }). On POST
      // chaque DLC saisie vers /api/lots/dlc. Une seule DLC par lot (toutes les
      // lignes de cette EM partagent le même batchNumber) : on dédoublonne par
      // itemCode et on laisse l'upsert serveur trancher si plusieurs diffèrent.
      const batchNumber: string | undefined =
        typeof json.lot === "string" && json.lot
          ? json.lot
          : (typeof json.docNum === "number" ? `EM${json.docNum}` : undefined);
      const dlcLines = lines.filter((l) => l.dlc.trim() !== "");
      if (batchNumber && dlcLines.length > 0) {
        const results = await Promise.allSettled(
          dlcLines.map((l) =>
            fetch("/api/lots/dlc", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ batchNumber, itemCode: l.itemCode, expirationDate: l.dlc }),
            }).then((r) => { if (!r.ok) throw new Error(String(r.status)); }),
          ),
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed === 0) {
          toast.info(`Fraîcheur enregistrée pour le lot ${batchNumber} (${dlcLines.length} DLC).`);
        } else {
          toast.info(`Réception OK — ${dlcLines.length - failed}/${dlcLines.length} DLC enregistrée(s) (le reste a échoué, sans impact sur l'entrée).`);
        }
      } else if (!batchNumber && dlcLines.length > 0) {
        // Cas théorique : la réponse n'expose pas le lot → on n'enregistre pas à l'aveugle.
        toast.info("Réception créée, mais le n° de lot n'a pas été renvoyé : DLC non enregistrée(s).");
      }

      setLastReceipt({ docNum: json.docNum, lot: json.lot });
      reset();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SurfaceCard accent="brand" className="p-5 space-y-5">
      {lastReceipt && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Dernier BR : <b>#{lastReceipt.docNum}</b> · lot <b>{lastReceipt.lot}</b> — propagé au résolveur de lots.</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Fournisseur</label>
          <SupplierPicker value={supplier} onChange={setSupplier} />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Date de réception</label>
          <DateStepper value={docDate} onChange={setDocDate} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Référence (BL, Cde, F… — optionnel)</label>
          <Input value={numAtCard} onChange={(e) => setNumAtCard(e.target.value)} placeholder="ex. BL-2026-0123, F-2026-045…" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Ajouter un article</label>
        <ProductPicker onPick={addLine} />
      </div>

      {/* Mobile : lignes empilées (le tableau large déborde sur téléphone) */}
      {lines.length > 0 && (
        <div className="md:hidden space-y-2.5">
          {lines.map((l, i) => {
            const pieceQty = l.packageQuantity * l.ratio;
            const dz = designationProduit({ itemName: l.itemName, uPays: l.pays, uMarque: l.marque, uCondi: l.condt, frgnName: l.variete });
            const priceNum = l.price === "" ? null : parseFloat(l.price);
            const lineHT = priceNum != null ? priceNum * pieceQty : null;
            return (
              <div key={l.itemCode} className="rounded-xl border border-border bg-card/40 p-3 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-foreground leading-tight">{dz.fruit}</div>
                    <div className="text-[12px] font-mono text-muted-foreground mt-0.5">{l.itemCode}</div>
                    <DesignationChips marque={dz.marque} condt={dz.condt} calibre={dz.variete} pays={dz.pays} className="mt-1.5" />
                  </div>
                  <Button variant="ghost" size="icon-sm" tabIndex={-1} onClick={() => removeLine(i)} aria-label="Supprimer">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Qté (colis)</label>
                    <NumberInput
                      value={l.packageQuantity}
                      onValueChange={(n) => updateLine(i, { packageQuantity: n ?? 0 })}
                      min={0} step={1}
                      className="h-11 w-full text-right text-[15px]"
                    />
                    <div className="text-[11px] text-muted-foreground mt-0.5 text-right">{l.ratio > 1 ? `= ${pieceQty} pie` : "à la pièce"}</div>
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Prix /pie HT</label>
                    <NumberInput
                      value={priceNum}
                      onValueChange={(n) => updateLine(i, { price: n == null ? "" : String(n) })}
                      min={0} step={0.01} decimals={2} allowEmpty placeholder="—"
                      className="h-11 w-full text-right text-[15px]"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Entrepôt</label>
                    <select
                      value={l.warehouseCode}
                      onChange={(e) => updateLine(i, { warehouseCode: e.target.value as Line["warehouseCode"] })}
                      tabIndex={-1}
                      className="h-11 w-full rounded-md border border-input bg-background px-2 text-[14px]"
                    >
                      {WAREHOUSES.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">DLC (optionnel)</label>
                    <input
                      type="date"
                      value={l.dlc}
                      onChange={(e) => updateLine(i, { dlc: e.target.value })}
                      className="h-11 w-full rounded-md border border-input bg-background px-2 text-[14px]"
                    />
                  </div>
                </div>
                <div className="flex items-end justify-end gap-3">
                  <div className="text-right shrink-0">
                    <span className="block text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Total HT</span>
                    <span className="text-[18px] font-bold tnum text-foreground">{lineHT != null ? fmtEur(lineHT) : "—"}</span>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between px-1 pt-1 border-t border-border">
            <span className="text-[12px] uppercase tracking-wide font-semibold text-muted-foreground">Total HT</span>
            <span className="text-[20px] font-bold tnum text-foreground">{fmtEur(totalHT)}</span>
          </div>
        </div>
      )}

      {lines.length > 0 && (
        <div className="hidden md:block rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-secondary/40 text-[10.5px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-2 font-semibold w-24">Qté</th>
                <th className="text-left px-2 py-2 font-semibold w-28">Code Article</th>
                <th className="text-left px-2 py-2 font-semibold">Fruit</th>
                <th className="text-left px-2 py-2 font-semibold">Pays</th>
                <th className="text-left px-2 py-2 font-semibold">Marque</th>
                <th className="text-left px-2 py-2 font-semibold">Variété</th>
                <th className="text-left px-2 py-2 font-semibold">Condt</th>
                <th className="text-left px-2 py-2 font-semibold w-36">Entrepôt</th>
                <th className="text-left px-2 py-2 font-semibold w-36">DLC</th>
                <th className="text-right px-2 py-2 font-semibold w-24">Prix /pie HT</th>
                <th className="text-right px-2 py-2 font-semibold w-24">Total HT</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const pieceQty = l.packageQuantity * l.ratio;
                const dz = designationProduit({ itemName: l.itemName, uPays: l.pays, uMarque: l.marque, uCondi: l.condt, frgnName: l.variete });
                const priceNum = l.price === "" ? null : parseFloat(l.price);
                const lineHT = priceNum != null ? priceNum * pieceQty : null;
                return (
                  <tr key={l.itemCode} className="border-t border-border">
                    <td className="px-2 py-2">
                      <NumberInput
                        value={l.packageQuantity}
                        onValueChange={(n) => updateLine(i, { packageQuantity: n ?? 0 })}
                        min={0} step={1}
                        className="text-right h-9 w-20"
                      />
                      <div className="text-[10px] text-muted-foreground mt-0.5 text-right pr-1">
                        {l.ratio > 1 ? `= ${pieceQty} pie` : "pièce"}
                      </div>
                    </td>
                    <td className="px-2 py-2 font-mono">{l.itemCode}</td>
                    <td className="px-2 py-2 text-foreground">{dz.fruit}</td>
                    <td className="px-2 py-2 text-muted-foreground">{dz.pays}</td>
                    <td className="px-2 py-2 text-muted-foreground">{dz.marque}</td>
                    <td className="px-2 py-2 text-muted-foreground">{dz.variete}</td>
                    <td className="px-2 py-2 text-muted-foreground">{dz.condt}</td>
                    <td className="px-2 py-2">
                      <select
                        value={l.warehouseCode}
                        onChange={(e) => updateLine(i, { warehouseCode: e.target.value as Line["warehouseCode"] })}
                        tabIndex={-1}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12.5px]"
                      >
                        {WAREHOUSES.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="date"
                        value={l.dlc}
                        onChange={(e) => updateLine(i, { dlc: e.target.value })}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12.5px]"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <NumberInput
                        value={priceNum}
                        onValueChange={(n) => updateLine(i, { price: n == null ? "" : String(n) })}
                        min={0} step={0.01} decimals={2} allowEmpty placeholder="—"
                        className="text-right h-9 w-24"
                      />
                    </td>
                    <td className="px-2 py-2 text-right tnum font-medium whitespace-nowrap">
                      {lineHT != null ? fmtEur(lineHT) : <span className="text-muted-foreground/60">—</span>}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button variant="ghost" size="icon-sm" tabIndex={-1} onClick={() => removeLine(i)} aria-label="Supprimer">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-secondary/30">
                <td colSpan={10} className="px-2 py-2 text-right text-[10.5px] uppercase tracking-wide font-semibold text-muted-foreground">
                  Total HT
                </td>
                <td className="px-2 py-2 text-right tnum font-bold text-foreground whitespace-nowrap">
                  {fmtEur(totalHT)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {lines.length === 0 && (
        <p className="text-[12px] italic text-muted-foreground text-center py-6">
          Aucune ligne. Recherche un article ci-dessus pour commencer.
        </p>
      )}

      <div className="space-y-1.5">
        <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Commentaire (optionnel)</label>
        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Note libre — visible sur le BR SAP" />
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <Button variant="ghost" onClick={reset} disabled={submitting}>Vider</Button>
        <Button onClick={submit} disabled={submitting || !supplier || lines.length === 0}>
          {submitting ? <Loader2 className="animate-spin" /> : <PackagePlus />}
          {submitting ? "Création SAP…" : "Valider l'entrée"}
        </Button>
      </div>
    </SurfaceCard>
  );
}
