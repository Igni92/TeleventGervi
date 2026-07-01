"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  FileText, Plus, Trash2, Loader2, Search, Truck, Calendar, ShoppingCart,
  LayoutGrid, ChevronRight, ChevronDown, RotateCcw, AlertTriangle,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatDateInput } from "@/lib/utils";
import { parseDeliveryDays, defaultDeliveryDate } from "@/lib/deliveryDays";
import { splitByWarehouse, totalAvailable, personalStock, unitInfo } from "@/lib/gervifrais-calc";

interface DeliveryMode { id: string; name: string; sapCardCode: string; isDefault: boolean }
interface ProductHit {
  id: string; itemCode: string; itemName: string;
  itemGroup?: number | null; groupName?: string | null;
  salesUnit: string | null; salesPackagingUnit: string | null;
  salesQtyPerPackUnit: number | null;
  manageBatch?: boolean;
  stockByWarehouse: Record<string, { available: number }>;
}
interface BLLine {
  itemCode: string;
  itemName: string;
  quantity: number;            // dans l'unité d'affichage (Colis, barquette, etc.)
  packDivisor: number;         // 104 pour K100 (104 pie/colis), 12 pour FRAMB, 1 sinon
  warehouseCode: string;
  displayUnit: string;         // ex. "Colis", "barquette" — unité que le user manipule
  /** Unité du prix unitaire = unité de stock SAP (ex: "pie", "kg"). Toujours fixe. */
  priceUnit: string;
  manageBatch: boolean;
  availByWarehouse: Record<string, number>;
  /** Prix unitaire HT, exprimé en € par {priceUnit}. Ex: 0.95 €/pie pour un kiwi. */
  price: number | null;
}

/** Ligne envoyée à l'API /orders (après découpe multi-entrepôt). */
interface BLApiLine {
  itemCode: string;
  quantity: number;
  displayQuantity: number;
  displayUnit: string;
  warehouseCode: string;
  manageBatch: boolean;
  price?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  clientName: string;
  /** % du stock total attribué au commercial connecté (aide à la répartition). */
  stockSharePct?: number;
  onCreated?: (docNum: number) => void;
}

const WAREHOUSE_LABELS: Record<string, string> = {
  "000": "000 — Réception",
  "01":  "01 — Stock physique",
  "R1":  "R1 — J+1 livraison",
};

// Découpe multi-entrepôt + total dispo : logique pure centralisée (testée).

export function BLDialog({ open, onOpenChange, clientId, clientName, stockSharePct = 100, onCreated }: Props) {
  const [modes, setModes] = useState<DeliveryMode[]>([]);
  const [modeId, setModeId] = useState<string>("");
  const [deliveryDate, setDeliveryDate] = useState<string>("");
  const [comment, setComment] = useState<string>("");
  const [numAtCard, setNumAtCard] = useState<string>("");      // N° de commande client → SAP NumAtCard
  const [lines, setLines] = useState<BLLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Confirmation encours en ligne (dans la modale — pas de window.confirm ni modale imbriquée)
  const [encoursPrompt, setEncoursPrompt] = useState<{ lines: BLApiLine[]; message: string } | null>(null);
  // Product search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductHit[]>([]);
  const [searching, setSearching] = useState(false);
  // Grouped picker
  const [mode, setMode] = useState<"search" | "groups">("groups");
  const [grouped, setGrouped] = useState<Record<string, ProductHit[]>>({});
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  // Prix conseillés + attributs (marque/calibre/pays) par itemCode — aide à la saisie
  type PriceHint = {
    prixConseille: number | null; coef: number; isDefault: boolean; prixAchat: number | null;
    marque: string | null; calibre: string | null; pays: string | null;
  };
  const [hints, setHints] = useState<Record<string, PriceHint>>({});

  // ── Init when opened ──────────────────────────────────
  useEffect(() => {
    if (!open) return;
    // Date par défaut PROVISOIRE = demain 9 h (raffinée juste après selon les
    // jours de livraison du client : prochain jour livré, ou le jour même si le
    // client ne se fait pas livrer).
    const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0);
    setDeliveryDate(formatDateInput(t));
    setComment("");
    setNumAtCard("");
    setLines([]);
    setQuery("");
    setResults([]);
    setHints({});
    setLastDocNum(null);
    // Load delivery modes
    fetch(`/api/clients/${clientId}/delivery-modes`).then((r) => r.json()).then((d) => {
      const ms: DeliveryMode[] = d.modes ?? [];
      setModes(ms);
      const def = ms.find((m) => m.isDefault) ?? ms[0];
      if (def) setModeId(def.id);
    }).catch(() => {});
    // Date de livraison selon les jours de livraison du client (#logistique).
    fetch(`/api/clients/${clientId}`).then((r) => r.json()).then((c) => {
      setDeliveryDate(formatDateInput(defaultDeliveryDate(parseDeliveryDays(c?.joursLivraison))));
    }).catch(() => {});
  }, [open, clientId]);

  // ── Prix conseillés : récupère pour les articles des lignes (selon groupe client) ──
  useEffect(() => {
    if (!open) return;
    const codes = Array.from(new Set(lines.map((l) => l.itemCode))).filter((c) => !(c in hints));
    if (codes.length === 0) return;
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ clientId, items: codes.join(",") });
        const res = await fetch(`/api/sap/prices?${params}`);
        const json = await res.json();
        if (json.prices) {
          setHints((cur) => ({ ...cur, ...json.prices }));
          // PRÉ-REMPLISSAGE du prix conseillé sur les lignes sans prix saisi (#34).
          // Ne s'exécute qu'une fois par article (les hints ne sont fetchés qu'une fois).
          setLines((cur) => cur.map((l) => {
            const h = json.prices[l.itemCode];
            if (l.price == null && h && h.prixConseille != null) return { ...l, price: h.prixConseille };
            return l;
          }));
        }
      } catch { /* aide optionnelle — on ignore les erreurs */ }
    }, 150);
    return () => clearTimeout(t);
  }, [open, lines, clientId, hints]);

  // ── Product search (debounced) ────────────────────────
  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const params = new URLSearchParams({ search: q.trim(), inStock: "true", limit: "8" });
      const res = await fetch(`/api/products?${params}`);
      const json = await res.json();
      setResults(json.products ?? []);
    } catch { setResults([]); }
    finally { setSearching(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(query), 220);
    return () => clearTimeout(t);
  }, [query, search]);

  // ── Load all in-stock products grouped by groupName (groups mode) ─────
  const loadGrouped = useCallback(async () => {
    setLoadingGroups(true);
    try {
      const params = new URLSearchParams({ inStock: "true", limit: "200" });
      const res = await fetch(`/api/products?${params}`);
      const json = await res.json();
      const byGroup: Record<string, ProductHit[]> = {};
      for (const p of (json.products ?? []) as ProductHit[]) {
        const g = p.groupName?.trim() || "Sans groupe";
        (byGroup[g] ||= []).push(p);
      }
      // Tri alpha sur les produits dans chaque groupe
      Object.values(byGroup).forEach((arr) => arr.sort((a, b) => a.itemName.localeCompare(b.itemName)));
      setGrouped(byGroup);
    } catch { setGrouped({}); }
    finally { setLoadingGroups(false); }
  }, []);

  useEffect(() => {
    if (open && mode === "groups" && Object.keys(grouped).length === 0) {
      loadGrouped();
    }
  }, [open, mode, grouped, loadGrouped]);

  // ── Add a line from a product hit ─────────────────────
  // L'unité affichée/saisie = l'UNITÉ DE VENTE réelle (salesUnit : kg, pie) — JAMAIS
  // la catégorie qualité "CAT I" (salesPackagingUnit). On saisit et on price à l'unité
  // de stock (kg/pie). Le découpage en colis (DDG) est recalculé côté serveur.
  const addLine = (p: ProductHit) => {
    const { packDivisor, displayUnit, priceUnit } = unitInfo(p.salesUnit, p.salesQtyPerPackUnit);
    const availByWarehouse: Record<string, number> = {};
    for (const w of ["000", "01", "R1"]) {
      const a = (p.stockByWarehouse[w]?.available ?? 0) / packDivisor;  // pièces → colis (ou kg)
      availByWarehouse[w] = Math.floor(a * 10) / 10;
    }
    const wh = (["R1", "01", "000"].find((w) => availByWarehouse[w] > 0)) ?? "01";
    setLines((cur) => {
      if (cur.some((l) => l.itemCode === p.itemCode)) return cur;     // évite doublon
      return [...cur, {
        itemCode: p.itemCode,
        itemName: p.itemName,
        quantity: 1,
        packDivisor,                                    // 1 (kg) ou nb pièces/colis
        warehouseCode: wh,
        displayUnit,                                    // "kg" ou "colis"
        priceUnit,                                      // "kg" ou "pie" — prix à la pièce
        manageBatch: !!p.manageBatch,
        availByWarehouse,
        price: null,
      }];
    });
    setQuery(""); setResults([]);
  };

  // ── Rejouer la dernière commande (1 clic) ────────────────
  const [replaying, setReplaying] = useState(false);
  const [lastDocNum, setLastDocNum] = useState<number | null>(null);
  const replayLast = async () => {
    setReplaying(true);
    try {
      const res = await fetch(`/api/sap/orders/last?clientId=${encodeURIComponent(clientId)}`);
      const json = await res.json();
      if (!json.found || !json.lines?.length) { toast("Aucune commande précédente pour ce client"); return; }
      setLines(json.lines.map((l: BLLine) => ({ ...l })));
      setLastDocNum(json.docNum ?? null);
      toast.success(`Dernière commande #${json.docNum} rejouée — ajuste les quantités si besoin`);
    } catch { toast.error("Erreur lors du rejeu"); }
    finally { setReplaying(false); }
  };

  const updateLine = (idx: number, patch: Partial<BLLine>) => {
    setLines((cur) => cur.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const removeLine = (idx: number) => setLines((cur) => cur.filter((_, i) => i !== idx));

  // ── Submit ────────────────────────────────────────────
  const buildApiLines = (): BLApiLine[] =>
    lines.flatMap((l) =>
      splitByWarehouse(l.quantity, l.availByWarehouse).map((c) => ({
        itemCode: l.itemCode,
        quantity: c.qty * l.packDivisor,          // unité de stock SAP
        displayQuantity: c.qty,
        displayUnit: l.displayUnit,
        warehouseCode: c.warehouse,
        manageBatch: l.manageBatch,
        price: l.price != null && l.price > 0 ? l.price : undefined,
      })),
    );

  const postOrder = (apiLines: BLApiLine[], confirmEncours: boolean) =>
    fetch("/api/sap/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        deliveryModeId: modeId || undefined,
        deliveryDate: new Date(deliveryDate).toISOString(),
        comment: comment.trim() || undefined,
        numAtCard: numAtCard.trim() || undefined,
        confirmEncours,
        lines: apiLines,
      }),
    });

  const submit = async () => {
    if (lines.length === 0) { toast.error("Au moins 1 ligne"); return; }
    if (!deliveryDate) { toast.error("Date de livraison requise"); return; }
    setSubmitting(true);
    try {
      const apiLines = buildApiLines();
      const res = await postOrder(apiLines, false);
      const json = await res.json();
      // Garde-fou encours : 409 + needsConfirm → confirmation EN LIGNE (pas de window.confirm).
      if (!res.ok && json?.needsConfirm === "encours") {
        setEncoursPrompt({ lines: apiLines, message: json.error ?? "Encours dépassé." });
        return;
      }
      await finalizeOrder(res, json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur réseau";
      toast.error(`❌ Échec (réseau) : ${msg}`, { duration: 10_000 });
      console.error("[Order] Erreur réseau :", e);
    } finally {
      setSubmitting(false);
    }
  };

  // Confirme l'encours → re-post forcé avec les lignes mémorisées.
  const forceEncours = async () => {
    if (!encoursPrompt) return;
    const apiLines = encoursPrompt.lines;
    setEncoursPrompt(null);
    setSubmitting(true);
    try {
      const res = await postOrder(apiLines, true);
      const json = await res.json();
      await finalizeOrder(res, json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur réseau";
      toast.error(`❌ Échec (réseau) : ${msg}`, { duration: 10_000 });
    } finally {
      setSubmitting(false);
    }
  };

  // Traite la réponse finale (toast riche + fermeture).
  const finalizeOrder = async (res: Response, json: any) => {
      if (!res.ok) {
        toast.error(json?.blocked ? `🚫 Client bloqué` : `❌ Échec création Commande`, {
          description: json.error || "Erreur inconnue",
          duration: 12_000,
        });
        console.error("[Order] Échec création :", json);
        return;
      }
      // Toast riche avec totaux SAP réels + lots assignés
      const lotsAssigned = (json.lines || [])
        .filter((l: { lot?: string | null }) => l.lot)
        .map((l: { itemCode: string; lot: string }) => `${l.itemCode}: lot ${l.lot}`)
        .join(" · ");
      const fmt = (n: number | null | undefined) => n != null ? n.toFixed(2) : "—";
      // Détail des frais (CTIFL / INTERFEL / DDG / transport…) — labels SAP réels
      const expensesLine = Array.isArray(json.expenses) && json.expenses.length > 0
        ? json.expenses
            .map((e: { label: string; amount: number; taxPercent: number | null }) =>
              `${e.label} ${fmt(e.amount)}€${e.taxPercent ? ` (+${e.taxPercent}% TVA)` : ""}`)
            .join(" · ")
        : null;
      toast.success(
        `✅ Commande #${json.docNum} créée — Total ${fmt(json.totalTTC)} € TTC`,
        {
          description: [
            `${lines.length} ligne(s) · ${clientName} · CardCode ${json.cardCode}`,
            `HT ${fmt(json.totalHT)} € · TVA ${fmt(json.totalTVA)} €`,
            json.totalWeightKg != null && `Poids net ${fmt(json.totalWeightKg)} kg`,
            expensesLine && `Frais : ${expensesLine}`,
            lotsAssigned && `Lot: ${lotsAssigned}`,
            `DB: ${json.db}`,
          ].filter(Boolean).join("\n"),
          duration: 14_000,
        },
      );
      onCreated?.(json.docNum);
      onOpenChange(false);
  };

  const isTestDb = (process.env.NEXT_PUBLIC_SAP_DB || "").includes("TEST"); // optionnel
  const selectedMode = modes.find((m) => m.id === modeId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[18px] font-semibold tracking-tight">
            <FileText className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            Créer une commande client
          </DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted-foreground mt-1">
            Client : <span className="font-semibold text-foreground">{clientName}</span>
            {selectedMode && (
              <> · Mode : <span className="font-medium">{selectedMode.name}</span> ({selectedMode.sapCardCode})</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Mode + Date — empilés sur mobile (le champ datetime-local natif a une
              largeur minimale incompressible qui faisait déborder la modale). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground inline-flex items-center gap-1.5">
                <Truck className="h-3 w-3" />Mode de livraison
              </Label>
              <Select value={modeId} onValueChange={setModeId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Choisir un mode" />
                </SelectTrigger>
                <SelectContent>
                  {modes.length === 0 && (
                    <div className="px-2 py-1.5 text-[12px] italic text-muted-foreground">
                      Aucun mode — utilise le code client par défaut
                    </div>
                  )}
                  {modes.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} <span className="text-muted-foreground">({m.sapCardCode})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground inline-flex items-center gap-1.5">
                <Calendar className="h-3 w-3" />Date de livraison
              </Label>
              <Input
                type="datetime-local"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          {/* Rejouer la dernière commande — 1 clic */}
          <button
            type="button"
            onClick={replayLast}
            disabled={replaying}
            className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-xl border border-brand-400/40 bg-brand-500/10 text-brand-700 dark:text-brand-300 text-[13px] font-semibold hover:bg-brand-500/20 transition-colors disabled:opacity-60"
          >
            {replaying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Rejouer la dernière commande
            {lastDocNum && <span className="text-[11px] font-normal opacity-70">(#{lastDocNum} chargée)</span>}
          </button>

          {/* N° de commande client (→ SAP NumAtCard) */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              N° de commande (réf. client)
            </Label>
            <Input
              placeholder="Ex : BC-2024-1287 — repris dans le champ NumAtCard du BL"
              value={numAtCard}
              onChange={(e) => setNumAtCard(e.target.value)}
              className="h-9"
            />
          </div>

          {/* Comment */}
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              Commentaire (facultatif)
            </Label>
            <Textarea
              rows={2}
              placeholder="Précisions de livraison, conditions particulières…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>

          {/* Product picker — toggle Groupes / Recherche */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                Ajouter des produits
              </Label>
              <div className="inline-flex rounded-md border border-border bg-secondary/30 p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setMode("groups")}
                  className={`px-2 py-1 rounded inline-flex items-center gap-1 transition-colors ${
                    mode === "groups" ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(250,204,21,0.45)]" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <LayoutGrid className="h-3 w-3" /> Groupes
                </button>
                <button
                  type="button"
                  onClick={() => setMode("search")}
                  className={`px-2 py-1 rounded inline-flex items-center gap-1 transition-colors ${
                    mode === "search" ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(250,204,21,0.45)]" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Search className="h-3 w-3" /> Recherche
                </button>
              </div>
            </div>

            {/* ── Mode RECHERCHE ─────────────────────────── */}
            {mode === "search" && (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Code ou nom produit…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-9 h-9"
                  />
                  {searching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                {results.length > 0 && (
                  <ul className="border border-border rounded-lg bg-card mt-1 max-h-64 overflow-y-auto">
                    {results.map((p) => {
                      const { packDivisor, displayUnit } = unitInfo(p.salesUnit, p.salesQtyPerPackUnit);
                      const total = ["R1", "01", "000"].reduce((s, w) => s + (p.stockByWarehouse[w]?.available ?? 0), 0) / packDivisor;
                      const unitLabel = displayUnit;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => addLine(p)}
                            className="w-full px-3 py-2 text-left hover:bg-secondary/40 flex items-center justify-between gap-3 border-b border-border/40 last:border-0 transition-colors"
                          >
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-foreground truncate">{p.itemName}</p>
                              <p className="text-[10.5px] font-mono text-muted-foreground/80">{p.itemCode}</p>
                            </div>
                            <span className="text-[12px] tnum font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                              {total.toFixed(0)} {unitLabel}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}

            {/* ── Mode GROUPES — accordéon avec boutons + ──── */}
            {mode === "groups" && (
              <div className="border border-border rounded-lg bg-card max-h-80 overflow-y-auto">
                {loadingGroups && (
                  <div className="px-3 py-6 text-center text-[12px] text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement des produits…
                  </div>
                )}
                {!loadingGroups && Object.keys(grouped).length === 0 && (
                  <p className="px-3 py-6 text-center text-[12px] text-muted-foreground italic">
                    Aucun produit en stock.
                  </p>
                )}
                {!loadingGroups && Object.entries(grouped)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([groupName, prods]) => {
                    const isOpen = openGroups[groupName] ?? false;
                    const totalStock = prods.reduce((s, p) => {
                      const { packDivisor } = unitInfo(p.salesUnit, p.salesQtyPerPackUnit);
                      return s + ["R1", "01", "000"].reduce((x, w) => x + (p.stockByWarehouse[w]?.available ?? 0), 0) / packDivisor;
                    }, 0);
                    return (
                      <div key={groupName} className="border-b border-border/40 last:border-0">
                        <button
                          type="button"
                          onClick={() => setOpenGroups((o) => ({ ...o, [groupName]: !isOpen }))}
                          className="w-full px-3 py-2 flex items-center justify-between gap-3 hover:bg-secondary/40 transition-colors"
                        >
                          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            {groupName}
                            <span className="text-[10.5px] font-normal text-muted-foreground">({prods.length} réf.)</span>
                          </span>
                          <span className="text-[11px] tnum font-semibold text-emerald-600 dark:text-emerald-400">
                            {totalStock.toFixed(0)} dispo
                          </span>
                        </button>
                        {isOpen && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 px-2 pb-2 pt-1">
                            {prods.map((p) => {
                              const { packDivisor, displayUnit } = unitInfo(p.salesUnit, p.salesQtyPerPackUnit);
                              const total = ["R1", "01", "000"].reduce((s, w) => s + (p.stockByWarehouse[w]?.available ?? 0), 0) / packDivisor;
                              const unitLabel = displayUnit;   // kg / colis
                              const inCart = lines.some((l) => l.itemCode === p.itemCode);
                              const dispo = total;
                              const noStock = dispo <= 0;
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  disabled={noStock || inCart}
                                  onClick={() => addLine(p)}
                                  className={`text-left px-2 py-1.5 rounded-md border transition-colors inline-flex items-center gap-2 ${
                                    inCart
                                      ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 cursor-default"
                                      : noStock
                                        ? "border-border/40 opacity-40 cursor-not-allowed"
                                        : "border-border hover:border-brand-400 hover:bg-secondary/40"
                                  }`}
                                  title={`${p.itemCode} — ${dispo.toFixed(1)} ${unitLabel} dispo`}
                                >
                                  <span className={`h-5 w-5 shrink-0 inline-flex items-center justify-center rounded ${
                                    inCart ? "bg-emerald-500 text-white" : "bg-brand-500/10 text-brand-600 dark:text-brand-400"
                                  }`}>
                                    <Plus className="h-3 w-3" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-[12px] font-medium text-foreground truncate">{p.itemName}</span>
                                    <span className="block text-[10px] font-mono text-muted-foreground/70 truncate">{p.itemCode}</span>
                                  </span>
                                  <span className={`text-[10.5px] tnum font-semibold shrink-0 ${
                                    noStock ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400"
                                  }`}>
                                    {dispo.toFixed(0)} {unitLabel}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Lines */}
          {lines.length > 0 && (
            <div className="space-y-3">
              {/* ── MOBILE : éditeur de lignes en CARTES (le tableau large était
                    coupé hors-écran → qté/prix inaccessibles). Mêmes contrôles
                    que sur PC : qté, prix, conseillé, répartition entrepôts,
                    total HT par ligne, suppression. ── */}
              <div className="md:hidden space-y-2.5">
                {lines.map((l, i) => {
                  const max = totalAvailable(l.availByWarehouse);
                  const perso = personalStock(max, stockSharePct);
                  const overPerso = stockSharePct < 100 && l.quantity > perso && l.quantity <= max;
                  const over = l.quantity > max;
                  const noStock = max <= 0;
                  const chunks = splitByWarehouse(l.quantity, l.availByWarehouse);
                  const h = hints[l.itemCode];
                  const lineHT = l.price != null && l.price > 0 ? l.quantity * l.packDivisor * l.price : null;
                  return (
                    <div
                      key={`m-${i}`}
                      className={`rounded-xl border p-3 ${over || noStock ? "border-rose-300 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/15" : "border-border bg-card/40"}`}
                    >
                      {/* Nom + suppression */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground text-[14px] leading-tight">{l.itemName}</p>
                          <p className="text-[11px] font-mono text-muted-foreground mt-0.5">{l.itemCode}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(i)}
                          aria-label="Retirer la ligne"
                          className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg text-muted-foreground/60 hover:text-rose-500 hover:bg-secondary/60 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Attributs marque / calibre / pays */}
                      {h && (h.marque || h.calibre || h.pays) && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {h.marque && <span className="text-[10px] px-1.5 py-px rounded bg-secondary text-muted-foreground">{h.marque}</span>}
                          {h.calibre && <span className="text-[10px] px-1.5 py-px rounded bg-secondary text-muted-foreground">cal. {h.calibre}</span>}
                          {h.pays && <span className="text-[10px] px-1.5 py-px rounded bg-secondary text-muted-foreground">{h.pays}</span>}
                        </div>
                      )}

                      {/* Quantité + Prix */}
                      <div className="grid grid-cols-2 gap-2.5 mt-2.5">
                        <div className="space-y-1 min-w-0">
                          <span className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Quantité</span>
                          <div className="flex items-center gap-1.5">
                            <NumberInput
                              min={0}
                              max={max > 0 ? max : undefined}
                              step={l.packDivisor > 1 ? 1 : 0.1}
                              value={l.quantity}
                              onValueChange={(n) => updateLine(i, { quantity: n ?? 0 })}
                              className={`h-9 w-full text-right text-[14px] tnum ${over ? "border-rose-500 focus-visible:ring-rose-500" : ""}`}
                            />
                            <span className="text-[12px] text-muted-foreground shrink-0 w-9">{l.displayUnit}</span>
                          </div>
                          <span className={`block text-[10.5px] tnum ${
                            noStock ? "text-rose-500 font-medium" :
                            over ? "text-amber-600 dark:text-amber-400 font-semibold" :
                            overPerso ? "text-orange-600 dark:text-orange-400 font-medium" :
                            "text-muted-foreground/70"
                          }`}>
                            {noStock ? "❌ Rupture"
                              : over ? `⚠️ sur-vente (dispo ${max})`
                              : overPerso ? `⚠️ > perso (${perso})`
                              : stockSharePct < 100 ? `perso ${perso} · max ${max}`
                              : `max ${max}`}
                          </span>
                        </div>
                        <div className="space-y-1 min-w-0">
                          <span className="block text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Prix unitaire HT</span>
                          <div className="flex items-center gap-1.5">
                            <NumberInput
                              min={0}
                              step={0.1}
                              allowEmpty
                              placeholder="auto"
                              value={l.price}
                              onValueChange={(n) => updateLine(i, { price: n })}
                              className="h-9 w-full text-right text-[14px] tnum"
                            />
                            <span className="text-[12px] text-muted-foreground shrink-0 w-9">€/{l.priceUnit}</span>
                          </div>
                          {h && h.prixConseille != null && (() => {
                            const applied = l.price != null && Math.abs(l.price - h.prixConseille) < 0.001;
                            return (
                              <button
                                type="button"
                                onClick={() => updateLine(i, { price: h.prixConseille })}
                                className={`block text-[10.5px] tnum transition-colors ${
                                  applied ? "text-emerald-600 dark:text-emerald-400" : "text-brand-600 dark:text-brand-400 hover:underline"
                                }`}
                              >
                                {applied ? "✓ conseillé appliqué" : `conseillé ${h.prixConseille.toFixed(2)} €${h.isDefault ? " (×1,5)" : ""}`}
                              </button>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Répartition entrepôts + total HT ligne */}
                      <div className="flex items-end justify-between gap-2 mt-2.5 pt-2.5 border-t border-border/50">
                        <div className="flex flex-wrap gap-1 min-w-0">
                          {chunks.length === 0 ? (
                            <span className="text-[10.5px] italic text-muted-foreground/70">—</span>
                          ) : chunks.map((c, ci) => {
                            const avail = Math.max(0, l.availByWarehouse[c.warehouse] ?? 0);
                            const spill = c.qty > avail;
                            return (
                              <span
                                key={ci}
                                title={`${WAREHOUSE_LABELS[c.warehouse] ?? c.warehouse} — ${avail} dispo`}
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] tnum font-medium ${
                                  spill ? "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400" : "bg-secondary text-foreground/80"
                                }`}
                              >
                                <span className="font-mono">{c.warehouse}</span>
                                <span className="font-semibold">{c.qty}</span>
                                <span className="text-muted-foreground">{l.displayUnit}</span>
                              </span>
                            );
                          })}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="block text-[9.5px] uppercase tracking-wider text-muted-foreground">Total HT</span>
                          <span className="text-[15px] font-bold tnum text-foreground">{lineHT != null ? `${lineHT.toFixed(2)} €` : "—"}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {/* Total HT estimé (mobile) */}
                {(() => {
                  const totalHT = lines.reduce((s, l) => s + (l.price != null && l.price > 0 ? l.quantity * l.packDivisor * l.price : 0), 0);
                  const pricedCount = lines.filter((l) => l.price != null && l.price > 0).length;
                  return (
                    <div className="rounded-xl border border-border bg-secondary/30 p-3 flex items-center justify-between gap-3">
                      <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                        Total HT estimé
                        {pricedCount < lines.length && (
                          <span className="ml-1.5 italic normal-case font-normal text-[10px] text-amber-600 dark:text-amber-400">
                            ({lines.length - pricedCount} en tarif SAP)
                          </span>
                        )}
                      </span>
                      <span className="text-[16px] font-bold tnum text-foreground">{totalHT.toFixed(2)} €</span>
                    </div>
                  );
                })()}
              </div>

              {/* ── DESKTOP : tableau complet ── */}
              <div className="hidden md:block border border-border rounded-lg overflow-hidden">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="bg-secondary/50 border-b border-border">
                    <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Produit</th>
                    <th className="text-left px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Répartition entrepôts</th>
                    <th className="text-right px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Qté</th>
                    <th className="text-right px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Prix unitaire&nbsp;HT</th>
                    <th className="text-right px-2 py-2 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Total HT</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const max = totalAvailable(l.availByWarehouse);       // dispo tous entrepôts
                    const perso = personalStock(max, stockSharePct);      // stock perso commercial
                    const overPerso = stockSharePct < 100 && l.quantity > perso && l.quantity <= max;
                    const over = l.quantity > max;
                    const noStock = max <= 0;
                    const chunks = splitByWarehouse(l.quantity, l.availByWarehouse);
                    return (
                      <tr key={i} className={`border-b border-border/30 last:border-0 ${over || noStock ? "bg-rose-50/30 dark:bg-rose-950/15" : ""}`}>
                        <td className="px-3 py-2">
                          <p className="font-semibold text-foreground">{l.itemName}</p>
                          <p className="text-[10px] font-mono text-muted-foreground">{l.itemCode}</p>
                          {/* Attributs produit : marque / calibre / pays (#37) */}
                          {(() => {
                            const h = hints[l.itemCode];
                            if (!h || (!h.marque && !h.calibre && !h.pays)) return null;
                            return (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {h.marque && <span className="text-[9.5px] px-1 py-px rounded bg-secondary text-muted-foreground">{h.marque}</span>}
                                {h.calibre && <span className="text-[9.5px] px-1 py-px rounded bg-secondary text-muted-foreground">cal. {h.calibre}</span>}
                                {h.pays && <span className="text-[9.5px] px-1 py-px rounded bg-secondary text-muted-foreground">{h.pays}</span>}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-2 py-2">
                          {/* Aperçu de la découpe automatique par entrepôt (ordre 000→01→R1) */}
                          <div className="flex flex-wrap gap-1">
                            {chunks.length === 0 ? (
                              <span className="text-[10.5px] italic text-muted-foreground/70">—</span>
                            ) : (
                              chunks.map((c, ci) => {
                                const avail = Math.max(0, l.availByWarehouse[c.warehouse] ?? 0);
                                const spill = c.qty > avail;     // surplus au-delà du dispo
                                return (
                                  <span
                                    key={ci}
                                    title={`${WAREHOUSE_LABELS[c.warehouse] ?? c.warehouse} — ${avail} dispo`}
                                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] tnum font-medium ${
                                      spill
                                        ? "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400"
                                        : "bg-secondary text-foreground/80"
                                    }`}
                                  >
                                    <span className="font-mono">{c.warehouse}</span>
                                    <span className="font-semibold">{c.qty}</span>
                                    <span className="text-muted-foreground">{l.displayUnit}</span>
                                  </span>
                                );
                              })
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="inline-flex flex-col items-end gap-0.5">
                            <div className="inline-flex items-center gap-1">
                              <NumberInput
                                min={0}
                                max={max > 0 ? max : undefined}
                                step={l.packDivisor > 1 ? 1 : 0.1}
                                value={l.quantity}
                                onValueChange={(n) => updateLine(i, { quantity: n ?? 0 })}
                                className={`h-7 w-20 text-right text-[12px] tnum ${over ? "border-rose-500 focus-visible:ring-rose-500" : ""}`}
                              />
                              <span className="text-[10.5px] text-muted-foreground w-12 text-left">{l.displayUnit}</span>
                            </div>
                            <span className={`text-[10px] tnum ${
                              noStock ? "text-rose-500 font-medium" :
                              over ? "text-amber-600 dark:text-amber-400 font-semibold" :
                              overPerso ? "text-orange-600 dark:text-orange-400 font-medium" :
                              "text-muted-foreground/70"
                            }`}>
                              {noStock ? "❌ Rupture"
                                : over ? `⚠️ sur-vente (dispo ${max})`
                                : overPerso ? `⚠️ > stock perso (${perso})`
                                : stockSharePct < 100 ? `perso ${perso} · max ${max}`
                                : `max ${max}`}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="inline-flex flex-col items-end gap-0.5">
                            <div className="inline-flex items-center gap-1">
                              <NumberInput
                                min={0}
                                step={0.1}
                                allowEmpty
                                placeholder="auto"
                                value={l.price}
                                onValueChange={(n) => updateLine(i, { price: n })}
                                className="h-7 w-20 text-right text-[12px] tnum"
                              />
                              {/* Prix toujours saisi à l'unité de stock (pie, kg) — JAMAIS au colis */}
                              <span className="text-[10.5px] text-muted-foreground w-12 text-left">€/{l.priceUnit}</span>
                            </div>
                            <span className="text-[10px] text-muted-foreground/70 italic">
                              {l.price == null ? "tarif SAP" : `${l.quantity * l.packDivisor} ${l.priceUnit} × ${l.price}€`}
                            </span>
                            {/* Prix conseillé (aide cliquable, non figé) — #34 */}
                            {(() => {
                              const h = hints[l.itemCode];
                              if (!h || h.prixConseille == null) return null;
                              const applied = l.price != null && Math.abs(l.price - h.prixConseille) < 0.001;
                              return (
                                <button
                                  type="button"
                                  onClick={() => updateLine(i, { price: h.prixConseille })}
                                  title={`Prix achat ${h.prixAchat ?? "?"}€ × coef ${h.coef}${h.isDefault ? " (défaut)" : ""} — clic pour appliquer`}
                                  className={`text-[10px] tnum mt-0.5 transition-colors ${
                                    applied ? "text-emerald-600 dark:text-emerald-400"
                                            : "text-brand-600 dark:text-brand-400 hover:underline"
                                  }`}
                                >
                                  {applied ? "✓ conseillé appliqué" : `conseillé ${h.prixConseille.toFixed(2)} €${h.isDefault ? " (×1,5)" : ""}`}
                                </button>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right tnum">
                          {l.price != null && l.price > 0 ? (
                            <span className="text-[12.5px] font-semibold text-foreground">
                              {(l.quantity * l.packDivisor * l.price).toFixed(2)} €
                            </span>
                          ) : (
                            <span className="text-[11px] italic text-muted-foreground/70">—</span>
                          )}
                        </td>
                        <td className="px-1 py-2">
                          <button
                            type="button"
                            onClick={() => removeLine(i)}
                            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground/50 hover:text-rose-500 hover:bg-secondary/60 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {(() => {
                    const totalHT = lines.reduce((s, l) =>
                      s + (l.price != null && l.price > 0 ? l.quantity * l.packDivisor * l.price : 0), 0);
                    const pricedCount = lines.filter((l) => l.price != null && l.price > 0).length;
                    return (
                      <tr className="bg-secondary/30 border-t border-border">
                        <td colSpan={4} className="px-3 py-2 text-right text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                          Total HT estimé
                          {pricedCount < lines.length && (
                            <span className="ml-2 italic normal-case font-normal text-[10.5px] text-amber-600 dark:text-amber-400">
                              ({lines.length - pricedCount} ligne(s) en tarif SAP)
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tnum text-[13px] font-bold text-foreground">
                          {totalHT.toFixed(2)} €
                        </td>
                        <td></td>
                      </tr>
                    );
                  })()}
                </tfoot>
              </table>
              </div>
            </div>
          )}

          {/* Submit — sur-vente autorisée (commande client peut dépasser le stock),
              affichée en avertissement non-bloquant. Le surplus est rattaché à 000. */}
          {(() => {
            const overLines = lines.filter((l) => l.quantity > totalAvailable(l.availByWarehouse));
            // nb total de lignes SAP générées après découpe multi-entrepôt
            const sapLineCount = lines.reduce(
              (s, l) => s + Math.max(1, splitByWarehouse(l.quantity, l.availByWarehouse).length), 0);
            const splitCount = lines.filter(
              (l) => splitByWarehouse(l.quantity, l.availByWarehouse).length > 1).length;
            return (
              <>
                {overLines.length > 0 && (
                  <div className="text-[11.5px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2">
                    ⚠️ {overLines.length} ligne{overLines.length > 1 ? "s" : ""} en sur-vente (qté &gt; stock dispo).
                    Le surplus sera rattaché à l&apos;entrepôt 000. La commande client reste créable.
                  </div>
                )}
                {splitCount > 0 && (
                  <div className="text-[11.5px] text-muted-foreground bg-secondary/40 border border-border rounded-lg px-3 py-2">
                    ℹ️ {splitCount} produit{splitCount > 1 ? "s" : ""} réparti{splitCount > 1 ? "s" : ""} sur plusieurs entrepôts
                    → {sapLineCount} ligne{sapLineCount > 1 ? "s" : ""} dans SAP (chacune avec son n° de lot).
                  </div>
                )}
                {/* Confirmation encours EN LIGNE (remplace window.confirm) */}
                {encoursPrompt && (
                  <div className="rounded-lg border border-amber-400/60 bg-amber-50 dark:bg-amber-950/25 px-3 py-2.5 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] text-amber-800 dark:text-amber-300">{encoursPrompt.message}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Button size="sm" variant="warning" onClick={forceEncours} disabled={submitting}>
                          Forcer la commande
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEncoursPrompt(null); toast("Commande non envoyée"); }} disabled={submitting}>
                          Annuler
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <Button
                    onClick={submit}
                    disabled={submitting || lines.length === 0 || !!encoursPrompt}
                    className="flex-1"
                  >
                    {submitting
                      ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      : <ShoppingCart className="h-4 w-4 mr-2" />}
                    Créer la commande ({sapLineCount} ligne{sapLineCount > 1 ? "s" : ""})
                  </Button>
                  <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                    Annuler
                  </Button>
                </div>
              </>
            );
          })()}

          <p className="text-[10.5px] text-muted-foreground italic">
            ℹ️ La commande sera créée dans SAP (table <b>Commandes Clients</b>).
            Le BL d&apos;expédition est généré ensuite côté SAP lors de la préparation/livraison.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
