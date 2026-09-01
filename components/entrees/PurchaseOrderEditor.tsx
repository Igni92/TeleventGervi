"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, PackageCheck, Plus, Save, Trash2, Ban, Truck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { StarRating } from "@/components/ui/star-rating";
import { DateStepper, todayISO, nowHM } from "@/components/ui/date-stepper";
import { designationProduit } from "@/lib/produit-designation";
import { eur, fmtColis } from "@/lib/format";
import { fmtJourDate } from "@/lib/date-fr";
import {
  SupplierPicker, ProductPicker, WAREHOUSES,
  type Supplier, type ProductHit, type WarehouseCode,
} from "./DocumentLinesEditor";
import { DesignationChips } from "./DesignationChips";
import { INCIDENT_TYPES, notifyReceptionIncidentsChanged } from "./ReceptionIncidents";
import type { PurchaseOrder, PoLine } from "./poTypes";

const LABEL = "text-caption uppercase tracking-wide text-muted-foreground font-semibold";

/* ─────────────────────────────────────────────────────────────────
   ÉDITEUR UNIFIÉ « Commande fournisseur » — création + modification +
   transfert vers entrée marchandise, en une seule page. En-tête façon
   « nouvelle commande » (fournisseur / référence / livraison prévue /
   commentaire), corps « document » (lignes avec tags, magasin, prix
   unitaire), puis les actions (Créer / Enregistrer / Annuler / Réceptionner).
   Le PU seul est saisi (pas de total HT par ligne — total en pied).
   ───────────────────────────────────────────────────────────────── */

/** Ligne éditable (PU /pie uniquement). */
type EditLine = {
  itemCode: string; itemName: string; ratio: number;
  packageQuantity: number; price: string;      // PU /pie HT, "" si non saisi
  warehouseCode: WarehouseCode;
  pays: string | null; marque: string | null; condt: string | null; variete: string | null;
  open: boolean;                               // ligne encore réceptionnable
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;
/** PU /pie effectif (ou null). */
const effPU = (l: EditLine): number | null => {
  const p = l.price === "" ? null : parseFloat(l.price);
  return p != null && Number.isFinite(p) ? p : null;
};
/** Total HT de la ligne = PU × colis × ratio (ou null). */
const effTotal = (l: EditLine): number | null => {
  const p = effPU(l);
  return p != null ? p * l.packageQuantity * l.ratio : null;
};

function lineFromHit(p: ProductHit): EditLine {
  const ratio = p.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1 ? p.salesQtyPerPackUnit : 1;
  return {
    itemCode: p.itemCode, itemName: p.itemName, ratio,
    packageQuantity: 1, price: "", warehouseCode: "01",
    pays: p.uPays, marque: p.uMarque, condt: p.uCondi, variete: p.frgnName, open: true,
  };
}
function lineFromPo(l: PoLine): EditLine {
  const pkg = l.packageQuantity ?? l.pieceQuantity ?? 0;
  const ratio = pkg > 0 && l.pieceQuantity ? Math.max(1, Math.round((l.pieceQuantity / pkg) * 1000) / 1000) : 1;
  const whs = (["000", "01", "R1"] as const).find((w) => w === l.warehouse) ?? "01";
  // PU /pie : direct si connu, sinon dérivé du total HT / pièces (ancien « total forcé »).
  const pu = l.price != null && l.price > 0
    ? l.price
    : (l.lineTotal != null && l.lineTotal > 0 && pkg * ratio > 0 ? round4(l.lineTotal / (pkg * ratio)) : null);
  return {
    itemCode: l.itemCode, itemName: l.itemName ?? l.itemCode, ratio,
    packageQuantity: pkg, price: pu != null ? String(pu) : "", warehouseCode: whs,
    pays: l.uPays, marque: l.uMarque, condt: l.uCondi, variete: l.frgnName ?? null, open: l.open,
  };
}
/** Charge utile ligne pour create/modif (PU /pie). */
const linePayload = (l: EditLine) => {
  const pu = effPU(l);
  return { itemCode: l.itemCode, packageQuantity: l.packageQuantity, warehouseCode: l.warehouseCode, price: pu != null && pu > 0 ? pu : undefined };
};

/**
 * @param po        commande existante (modif/réception) ou null (création).
 * @param restricted agréeur « pur » : aucun prix, ni création ni modif/annulation
 *                    — seulement réceptionner.
 * @param onDone     ferme l'éditeur + rafraîchit la liste (après create/cancel/receive).
 * @param onModified rafraîchit la liste en gardant l'éditeur ouvert (après modif).
 */
export function PurchaseOrderEditor({
  po, restricted = false, onDone, onModified,
}: {
  po?: PurchaseOrder | null;
  restricted?: boolean;
  onDone: () => void;
  onModified?: () => void | Promise<void>;
}) {
  const isNew = !po;
  const readOnlyHeader = !isNew;                 // l'en-tête d'une commande existante n'est pas modifiable (comme aujourd'hui)
  const editable = isNew || (!!po?.open && !po?.cancelled && !restricted);

  // ── En-tête ──
  const [supplier, setSupplier] = useState<Supplier | null>(po ? { cardCode: po.cardCode, cardName: po.cardName ?? po.cardCode } : null);
  const [reference, setReference] = useState(po?.numAtCard ?? "");
  const [dueDate, setDueDate] = useState((po?.dueDate ?? "").slice(0, 10) || todayISO());
  const [orderTime, setOrderTime] = useState(nowHM());
  const [comment, setComment] = useState(po?.comments ?? "");

  // ── Lignes ──
  const [lines, setLines] = useState<EditLine[]>(po ? po.lines.map(lineFromPo) : []);
  const [dirty, setDirty] = useState(false);

  // ── États d'action ──
  const [submitting, setSubmitting] = useState(false);   // création
  const [saving, setSaving] = useState(false);           // modif
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [receiveMode, setReceiveMode] = useState(false); // agréage ouvert
  const [processing, setProcessing] = useState(false);   // réception en cours

  // Re-synchronise si la commande passée change (rechargement parent après modif).
  useEffect(() => {
    setSupplier(po ? { cardCode: po.cardCode, cardName: po.cardName ?? po.cardCode } : null);
    setReference(po?.numAtCard ?? "");
    setDueDate((po?.dueDate ?? "").slice(0, 10) || todayISO());
    setComment(po?.comments ?? "");
    setLines(po ? po.lines.map(lineFromPo) : []);
    setDirty(false);
    setReceiveMode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po?.docEntry]);

  const addLine = (p: ProductHit) => {
    if (lines.some((l) => l.itemCode === p.itemCode)) { toast.info(`${p.itemCode} déjà présent`); return; }
    setLines((c) => [...c, lineFromHit(p)]); setDirty(true);
  };
  const updateLine = (i: number, patch: Partial<EditLine>) => { setLines((c) => c.map((l, k) => (k === i ? { ...l, ...patch } : l))); setDirty(true); };
  const removeLine = (i: number) => { setLines((c) => c.filter((_, k) => k !== i)); setDirty(true); };

  const totalHT = useMemo(() => lines.reduce((s, l) => s + (effTotal(l) ?? 0), 0), [lines]);

  // ── CRÉATION ──
  const create = async () => {
    if (!supplier) { toast.error("Sélectionne un fournisseur"); return; }
    if (lines.length === 0) { toast.error("Ajoute au moins 1 ligne"); return; }
    if (!dueDate) { toast.error("Date de livraison prévue requise"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/sap/purchase-orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardCode: supplier.cardCode, dueDate, orderTime: orderTime || undefined,
          numAtCard: reference.trim() || undefined, comment: comment.trim() || undefined,
          lines: lines.map(linePayload),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { toast.error(j.error || "Erreur SAP"); return; }
      toast.success(`Commande fournisseur n°${j.docNum} créée`);
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSubmitting(false); }
  };

  // ── MODIFICATION (lignes) ──
  const save = async () => {
    if (!po) return;
    const payload = lines.filter((l) => l.packageQuantity > 0).map(linePayload);
    if (payload.length === 0) { toast.error("Garde au moins une ligne."); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/sap/purchase-orders/${po.docEntry}/modif`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: payload }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { toast.error(j.error || "Erreur SAP"); return; }
      toast.success(`Commande n°${po.docNum} modifiée`);
      setDirty(false);
      await onModified?.();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  // ── ANNULATION ──
  const cancelOrder = async () => {
    if (!po) return;
    setCancelling(true);
    try {
      const res = await fetch("/api/sap/purchase-orders/cancel", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docEntry: po.docEntry }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { toast.error(j.error || "Annulation impossible"); return; }
      toast.success(`Commande fournisseur n°${po.docNum} annulée`);
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setCancelling(false); }
  };

  // ── RÉCEPTION → ENTRÉE MARCHANDISE (agréage par article) ──
  type LineAgr = { rating: number | null; refused: boolean; reserveType: string; reserveNote: string };
  const [lineAgr, setLineAgr] = useState<Record<number, LineAgr>>({});
  const getLA = (i: number): LineAgr => lineAgr[i] ?? { rating: null, refused: false, reserveType: INCIDENT_TYPES[0] as string, reserveNote: "" };
  const setLA = (i: number, patch: Partial<LineAgr>) => setLineAgr((c) => ({ ...c, [i]: { ...getLA(i), ...patch } }));
  const openLineIdx = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.open);
  const refusedIdx = openLineIdx.filter(({ i }) => getLA(i).refused);
  const keptIdx = openLineIdx.filter(({ i }) => !getLA(i).refused);
  const reserveIncomplete = refusedIdx.some(({ i }) => !getLA(i).reserveNote.trim());
  const nothingKept = keptIdx.length === 0;

  const doReceive = async () => {
    if (!po) return;
    if (reserveIncomplete) { toast.error("Décris la réserve de chaque ligne refusée."); return; }
    if (nothingKept) { toast.error("Toutes les lignes sont refusées — rien à réceptionner."); return; }
    setProcessing(true);
    try {
      // a) un incident de réception par article refusé (réserve).
      for (const { l, i } of refusedIdx) {
        const la = getLA(i);
        const r = await fetch("/api/entrees/incidents", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docNum: po.docNum, cardCode: po.cardCode, cardName: po.cardName, itemCode: l.itemCode, type: la.reserveType, note: la.reserveNote.trim() }),
        });
        if (!r.ok) { const j = await r.json().catch(() => null); throw new Error(j?.error || `Incident non créé (${l.itemCode})`); }
      }
      // b) enregistre la commande = lignes RETENUES (applique aussi les modifs de
      //    prix/qté et retire les refusées) avant de réceptionner.
      const rm = await fetch(`/api/sap/purchase-orders/${po.docEntry}/modif`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: keptIdx.map(({ l }) => linePayload(l)) }),
      });
      const jm = await rm.json().catch(() => null);
      if (!rm.ok || !jm?.ok) throw new Error(jm?.error || "Enregistrement des lignes retenues impossible");
      if (refusedIdx.length > 0) notifyReceptionIncidentsChanged();

      // c) réception (crée l'entrée marchandise) avec la note qualité par article.
      const res = await fetch("/api/sap/purchase-orders/receive", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docEntry: po.docEntry,
          agreage: {
            status: "CONFORME",
            lines: keptIdx.map(({ l, i }) => ({ itemCode: l.itemCode, rating: getLA(i).rating })).filter((x): x is { itemCode: string; rating: number } => x.rating != null),
          },
        }),
      });
      const j = await res.json();
      if (!res.ok || j.ok === false) throw new Error(j.error || "Échec");
      toast.success(`Réception agréée — entrée marchandise n°${j.docNum} créée (lot ${j.lot})`, { duration: 9000 });
      onDone();
    } catch (e) {
      toast.error(`Échec de la réception : ${e instanceof Error ? e.message : ""}`, { duration: 10000 });
    } finally { setProcessing(false); }
  };

  // ── RENDU ──
  return (
    <div className="space-y-5">
      {/* ═══ EN-TÊTE (style « nouvelle commande ») ═══ */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className={LABEL}>Fournisseur</label>
          {readOnlyHeader ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-body font-semibold truncate">{supplier?.cardName}</p>
                <p className="text-caption text-muted-foreground font-mono">{supplier?.cardCode}</p>
              </div>
            </div>
          ) : (
            <SupplierPicker value={supplier} onChange={(s) => { setSupplier(s); setDirty(true); }} />
          )}
        </div>
        <div className="space-y-1.5">
          <label className={LABEL}>Livraison prévue</label>
          {readOnlyHeader ? (
            <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 text-[13px] font-semibold uppercase tracking-wide tnum">
              {po?.dueDate ? fmtJourDate(po.dueDate) : "—"}
            </div>
          ) : (
            <DateStepper value={dueDate} onChange={(v) => { setDueDate(v); setDirty(true); }} time={orderTime} onTimeChange={setOrderTime} timeLabel="Heure de prise de commande" />
          )}
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className={LABEL}>Référence Cde achat</label>
          {readOnlyHeader ? (
            <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 text-body">
              {reference || <span className="text-muted-foreground">—</span>}
            </div>
          ) : (
            <Input value={reference} onChange={(e) => { setReference(e.target.value); setDirty(true); }} placeholder="N° interne / réf. fournisseur" />
          )}
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className={LABEL}>Commentaire</label>
          {readOnlyHeader ? (
            <div className="min-h-10 flex items-center rounded-md border border-input bg-background px-3 py-2 text-body italic text-muted-foreground">
              {comment ? `« ${comment} »` : "—"}
            </div>
          ) : (
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Note libre — visible sur la commande SAP" />
          )}
        </div>
      </div>

      {/* Ajout d'article (création + modification) */}
      {editable && !receiveMode && (
        <div className="space-y-1.5">
          <label className={LABEL}>Ajouter un article</label>
          <ProductPicker onPick={addLine} />
        </div>
      )}

      {/* ═══ CORPS DU DOCUMENT (lignes) ═══ */}
      {lines.length > 0 ? (
        <PoLinesTable
          lines={lines}
          editable={editable && !receiveMode}
          restricted={restricted}
          totalHT={totalHT}
          onQty={(i, n) => updateLine(i, { packageQuantity: n })}
          onPrice={(i, n) => updateLine(i, { price: n == null ? "" : String(n) })}
          onWhs={(i, w) => updateLine(i, { warehouseCode: w })}
          onRemove={removeLine}
          effPU={effPU}
        />
      ) : (
        <p className="text-caption italic text-muted-foreground text-center py-6">
          Aucune ligne. Recherche un article ci-dessus pour commencer.
        </p>
      )}

      {/* ═══ RÉCEPTION — agréage par article ═══ */}
      {receiveMode && po && (
        <div className="rounded-xl border border-amber-400/50 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-2.5">
          <p className="text-[13px] text-foreground">
            Entrée marchandise <b>article par article</b> — note qualité (facultative) et « Refuser » par ligne.
            La commande sera clôturée et le stock incrémenté.
          </p>
          <div className="space-y-2">
            {openLineIdx.map(({ l, i }) => {
              const la = getLA(i);
              const dz = designationProduit({ itemName: l.itemName, uPays: l.pays, uMarque: l.marque, uCondi: l.condt, frgnName: l.variete });
              return (
                <div key={`agr-${l.itemCode}-${i}`} className={`rounded-lg border p-2.5 ${la.refused ? "border-rose-400/60 bg-rose-50/50 dark:bg-rose-950/20" : "border-border bg-card/40"}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <span className={`text-[13.5px] font-semibold ${la.refused ? "line-through text-muted-foreground" : "text-foreground"}`}>{dz.fruit}</span>
                      <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{l.itemCode}</span>
                      <span className="ml-1.5 text-[12px] tnum text-muted-foreground">{fmtColis(l.packageQuantity)} colis</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {!la.refused && <StarRating value={la.rating} onChange={(v) => setLA(i, { rating: v })} size="sm" ariaLabel={`Note qualité ${dz.fruit}`} />}
                      <button
                        type="button"
                        onClick={() => setLA(i, { refused: !la.refused })}
                        className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border text-[11.5px] font-semibold transition-colors ${la.refused ? "border-rose-500/60 bg-rose-500/15 text-rose-700 dark:text-rose-300" : "border-border text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"}`}
                      >
                        {la.refused ? "Rétablir" : <><Trash2 className="h-3.5 w-3.5" /> Refuser</>}
                      </button>
                    </div>
                  </div>
                  {la.refused && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex flex-wrap gap-1.5">
                        {INCIDENT_TYPES.map((t) => (
                          <button key={t} type="button" onClick={() => setLA(i, { reserveType: t })}
                            className={`h-7 px-2.5 rounded-lg border text-[11px] font-semibold transition-colors ${la.reserveType === t ? "border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300" : "border-border text-muted-foreground hover:text-foreground"}`}>
                            {t}
                          </button>
                        ))}
                      </div>
                      <textarea value={la.reserveNote} onChange={(e) => setLA(i, { reserveNote: e.target.value })} rows={2}
                        placeholder="Motif de la réserve (obligatoire) — ex. 12 colis abîmés, +9 °C…"
                        aria-label={`Réserve ${l.itemCode}`}
                        className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring/40" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Button size="lg" onClick={doReceive} disabled={processing || reserveIncomplete || nothingKept}
              title={reserveIncomplete ? "Décris la réserve des lignes refusées" : nothingKept ? "Toutes les lignes sont refusées" : undefined}>
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              {refusedIdx.length > 0 ? `Réceptionner ${keptIdx.length} article(s) · ${refusedIdx.length} refusé(s)` : "Confirmer la réception"}
            </Button>
            <Button variant="outline" size="lg" onClick={() => setReceiveMode(false)} disabled={processing}>Annuler</Button>
          </div>
        </div>
      )}

      {/* ═══ ACTIONS (après les lignes) ═══ */}
      {!receiveMode && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border">
          {isNew ? (
            <Button onClick={create} disabled={submitting || !supplier || lines.length === 0}>
              {submitting ? <Loader2 className="animate-spin" /> : <Plus />}
              {submitting ? "Création SAP…" : "Créer la commande"}
            </Button>
          ) : (
            <>
              {/* Annuler la commande (gestion) */}
              {editable && (
                !cancelConfirm ? (
                  <Button variant="outline" size="sm" onClick={() => setCancelConfirm(true)}
                    className="gap-1.5 text-rose-600 dark:text-rose-400 hover:text-rose-700 border-rose-300/60 dark:border-rose-500/30">
                    <Ban className="h-3.5 w-3.5" /> Annuler la commande
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <span className="text-[12.5px] text-foreground">Annuler la commande n° {po?.docNum} ?</span>
                    <Button variant="destructive" size="sm" onClick={cancelOrder} disabled={cancelling}>
                      {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Confirmer
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setCancelConfirm(false)} disabled={cancelling}>Non</Button>
                  </span>
                )
              )}
              {/* Enregistrer les modifications (si lignes changées) */}
              {editable && dirty && (
                <Button variant="outline" size="sm" onClick={save} disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Enregistrer
                </Button>
              )}
              {/* Réceptionner → entrée marchandise (réservé aux commandes ouvertes) */}
              {po?.open && !po?.cancelled && (
                <Button size="lg" onClick={() => setReceiveMode(true)} disabled={dirty}
                  title={dirty ? "Enregistre d'abord tes modifications" : undefined}>
                  <PackageCheck className="h-4 w-4" /> Réceptionner → Entrée marchandise
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Tableau des lignes — corps « document » : Qté colis (surgras) · Article (tags) ·
 *  Magasin · Prix unitaire (surgras). Total HT en pied uniquement. */
function PoLinesTable({
  lines, editable, restricted, totalHT, onQty, onPrice, onWhs, onRemove, effPU,
}: {
  lines: EditLine[];
  editable: boolean;
  restricted: boolean;
  totalHT: number;
  onQty: (i: number, n: number) => void;
  onPrice: (i: number, n: number | null) => void;
  onWhs: (i: number, w: WarehouseCode) => void;
  onRemove: (i: number) => void;
  effPU: (l: EditLine) => number | null;
}) {
  const showPrice = !restricted;
  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <table className="w-full text-body">
        <thead className="bg-secondary/60 text-caption uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2.5 font-semibold w-28">Qté colis</th>
            <th className="text-left px-3 py-2.5 font-semibold">Article</th>
            <th className="text-left px-3 py-2.5 font-semibold w-40">Magasin</th>
            {showPrice && <th className="text-right px-3 py-2.5 font-semibold w-32">Prix unitaire</th>}
            {editable && <th className="w-8" />}
          </tr>
        </thead>
        <tbody className="[&>tr:nth-child(even)]:bg-muted/40">
          {lines.map((l, i) => {
            const pieceQty = l.packageQuantity * l.ratio;
            const dz = designationProduit({ itemName: l.itemName, uPays: l.pays, uMarque: l.marque, uCondi: l.condt, frgnName: l.variete });
            return (
              <tr key={`${l.itemCode}-${i}`} className="border-t border-border align-top">
                {/* Qté colis — SURGRAS */}
                <td className="px-3 py-2.5 align-top">
                  {editable ? (
                    <NumberInput value={l.packageQuantity} onValueChange={(n) => onQty(i, n ?? 0)} min={0} step={1} className="text-right h-9 w-20 font-bold" />
                  ) : (
                    <span className="text-title3 font-bold tnum text-foreground">{fmtColis(l.packageQuantity)}</span>
                  )}
                  <div className="text-caption2 text-muted-foreground mt-0.5 text-right pr-1">{l.ratio > 1 ? `= ${pieceQty} pie` : "pièce"}</div>
                </td>
                {/* Article — Fruit + tags couleur (idem entrée marchandise) */}
                <td className="px-3 py-2.5 align-top">
                  <div className="font-semibold text-foreground">{dz.fruit}</div>
                  <div className="font-mono text-caption text-muted-foreground">{l.itemCode}</div>
                  <DesignationChips marque={dz.marque} condt={dz.condt} variete={dz.variete} pays={dz.pays} className="mt-1" />
                </td>
                {/* Magasin */}
                <td className="px-3 py-2.5 align-top">
                  {editable ? (
                    <select value={l.warehouseCode} onChange={(e) => onWhs(i, e.target.value as WarehouseCode)} tabIndex={-1}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-body">
                      {WAREHOUSES.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}
                    </select>
                  ) : (
                    <span className="tnum text-muted-foreground">{WAREHOUSES.find((w) => w.code === l.warehouseCode)?.label ?? l.warehouseCode}</span>
                  )}
                </td>
                {/* Prix unitaire — SURGRAS */}
                {showPrice && (
                  <td className="px-3 py-2.5 align-top text-right">
                    {editable ? (
                      <NumberInput value={effPU(l)} onValueChange={(n) => onPrice(i, n)} min={0} step={0.01} decimals={2} allowEmpty placeholder="PU /pie" className="text-right h-9 w-28 font-bold" />
                    ) : (
                      <span className="tnum font-bold text-foreground">{effPU(l) != null ? eur(effPU(l) as number) : "—"}</span>
                    )}
                  </td>
                )}
                {editable && (
                  <td className="px-2 py-2.5 text-right align-top">
                    <Button variant="ghost" size="icon-sm" tabIndex={-1} onClick={() => onRemove(i)} aria-label="Supprimer"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        {showPrice && (
          <tfoot>
            <tr className="border-t border-border bg-secondary/60">
              <td colSpan={editable ? 3 : 2} className="px-3 py-2.5 text-right text-caption uppercase tracking-wide font-semibold text-muted-foreground">Total HT</td>
              <td className="px-3 py-2.5 text-right tnum font-bold text-foreground whitespace-nowrap">{eur(totalHT)}</td>
              {editable && <td />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
