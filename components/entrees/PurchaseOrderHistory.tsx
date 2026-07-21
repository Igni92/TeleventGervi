"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, PackageCheck, Search, ChevronRight, X, Truck, AlertTriangle,
  Pencil, Plus, Save, Trash2, Ban,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { FullscreenPanel } from "@/components/ui/fullscreen-panel";
import { InfoHint } from "@/components/ui/info-hint";
import { StatBlock } from "@/components/ui/stat-block";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { designationProduit } from "@/lib/produit-designation";
import { fmtJourDate } from "@/lib/date-fr";
import { eur, eur0, fmtColis } from "@/lib/format";
import { DesignationChips } from "./DesignationChips";
import { INCIDENT_TYPES, notifyReceptionIncidentsChanged } from "./ReceptionIncidents";
import { ProductPicker, type ProductHit } from "./GoodsReceiptForm";
import { StarRating } from "@/components/ui/star-rating";

type PoLine = {
  itemCode: string; itemName?: string;
  pieceQuantity: number; packageQuantity: number | null;
  warehouse?: string;
  price: number | null; lineTotal: number | null; taxPercent: number | null;
  open: boolean;
  uPays: string | null; uMarque: string | null; uCondi: string | null; frgnName?: string | null;
};
type PurchaseOrder = {
  docEntry: number; docNum: number; docDate: string; dueDate: string | null;
  cardCode: string; cardName?: string; numAtCard: string;
  open: boolean;
  cancelled: boolean;
  total: number; totalTTC: number; totalHT: number; totalTVA: number;
  comments: string; lineCount: number; lines: PoLine[];
};

/** Agréage porté par la réception (cf. lib/agreage) : conforme, ou avec réserve.
 *  Les types de réserve = INCIDENT_TYPES (mêmes types que les incidents de réception). */
type ReceiveAgreage = { status: "CONFORME" | "RESERVE"; type?: string; note?: string; rating?: number | null };

/** Date « jour + date » unifiée des états SAP : « VEN 10.07.26 ». */
const fmtDate = fmtJourDate;

/** Heure « HHhMM » de prise de commande, extraite du commentaire SAP
 *  (« CF 2709 - JMG à 13h10 » ou l'ancien « … · Commande à 13h10 »). */
function heureFromComments(comments?: string | null): string | null {
  if (!comments) return null;
  const matches = comments.match(/\d{1,2}h\d{2}/g);
  return matches ? matches[matches.length - 1] : null;
}

function StatusBadge({ open, cancelled, large }: { open: boolean; cancelled?: boolean; large?: boolean }) {
  const tone = cancelled
    ? "bg-rose-500/15 border border-rose-500/50 text-rose-600 dark:text-rose-400"
    : open
      ? "bg-amber-500/15 border border-amber-500/50 text-amber-600 dark:text-amber-400"
      : "bg-emerald-500/15 border border-emerald-500/50 text-emerald-600 dark:text-emerald-400";
  const label = cancelled ? "Annulée" : open ? "Ouverte" : "Clôturée";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md font-semibold ${large ? "px-2.5 h-7 text-[12px]" : "px-2 h-6 text-[11px]"} ${tone}`}>
      {label}
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
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 h-6 text-[11px] font-semibold bg-amber-500/15 border border-amber-500/60 text-amber-600 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3 shrink-0" /> À réceptionner
    </span>
  );
}

/** Liste des COMMANDES FOURNISSEURS (SAP PurchaseOrders) — lecture seule.
 *  `restricted` = agréeur « pur » : ne voit AUCUN prix, ne peut ni modifier ni
 *  annuler la commande — seulement la consulter et la passer en entrée
 *  marchandise (« Réceptionner → EM »). */
export function PurchaseOrderHistory({ restricted = false }: { restricted?: boolean }) {
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
  // L'AGRÉAGE (conforme / avec réserve) accompagne le geste : posé sur l'EM créée ;
  // une réserve ouvre un incident de réception (suivi litige fournisseur).
  const receive = useCallback(async (docEntry: number, agreage: ReceiveAgreage) => {
    setReceiving(true);
    try {
      const res = await fetch("/api/sap/purchase-orders/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry, agreage }),
      });
      const j = await res.json();
      if (!res.ok || j.ok === false) throw new Error(j.error || "Échec");
      // « Une EM par ligne » : la réception peut créer PLUSIEURS EM SAP (une par
      // ligne de la commande) — regroupées sous le n° de la première.
      const emCount = Array.isArray(j.docNums) ? j.docNums.length : 1;
      const emLabel = emCount > 1
        ? `entrée marchandise #${j.docNum} créée (${emCount} EM SAP, une par ligne : #${(j.docNums as number[]).join(", #")})`
        : `entrée marchandise #${j.docNum} créée (lot ${j.lot})`;
      if (agreage.status === "RESERVE") {
        notifyReceptionIncidentsChanged();   // badge sidebar → apparaît tout de suite
        toast.warning(
          `Réception AVEC RÉSERVE (${agreage.type ?? "Qualité"}) — ${emLabel}, incident de réception ouvert`,
          { duration: 10000 },
        );
      } else {
        toast.success(`Réception agréée conforme — ${emLabel}`, { duration: 9000 });
      }
      // Échec PARTIEL : les lignes restées ouvertes sur la CF se réceptionnent
      // en relançant « Réceptionner » (seules les lignes ouvertes sont reprises).
      if (j.partialError) {
        toast.warning(`Réception incomplète : ${j.partialError}. Relance la réception pour les lignes restantes.`, { duration: 12000 });
      }
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
            Cde Fournisseur
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
            <StatBlock label="Commandes" value={<AnimatedNumber value={filtered.length} />} />
            {!restricted && (
              <StatBlock
                label="Engagé (HT)"
                tone="emerald"
                value={
                  <AnimatedNumber
                    value={filtered.reduce((s, d) => s + (d.totalHT ?? 0), 0)}
                    format={eur0}
                  />
                }
              />
            )}
            <StatBlock label="Ouvertes" value={<AnimatedNumber value={filtered.filter((d) => d.open).length} />} />
            {dueCount > 0 && <StatBlock label="À réceptionner" tone="amber" value={dueCount} />}
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
                  {/* Mobile : l'IMPORTANT seulement — fournisseur, statut, livraison,
                      montant. (n° CF, heure de prise, nb lignes → dans le détail.) */}
                  <div className="text-[16px] font-semibold text-foreground truncate">
                    {d.cardName || d.cardCode}
                  </div>
                  <div className="text-[13px] text-muted-foreground mt-0.5 tnum">
                    Livraison {fmtDate(d.dueDate)}
                  </div>
                  <div className="mt-1">
                    {isDue(d) ? <DueBadge /> : <StatusBadge open={d.open} cancelled={d.cancelled} />}
                  </div>
                </div>
                <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                  {!restricted && (
                    <div>
                      <span className="font-display text-[18px] font-bold tnum text-foreground leading-none">{eur(d.totalHT ?? 0)}</span>
                      <span className="ml-1 text-[11px] text-muted-foreground">HT</span>
                    </div>
                  )}
                  <ChevronRight className="h-5 w-5 text-muted-foreground/50" />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Desktop : tableau */}
        {filtered.length > 0 && (
          <div className="hidden md:block rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold w-24">N° Cde</th>
                  <th className="text-left px-3 py-2 font-semibold">Fournisseur</th>
                  <th className="text-left px-3 py-2 font-semibold w-28">Livraison</th>
                  <th className="text-left px-3 py-2 font-semibold w-36">Statut</th>
                  {!restricted && <th className="text-right px-3 py-2 font-semibold w-32">Total HT</th>}
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
                    <td className="px-3 py-2.5 font-mono font-semibold"># {d.docNum}</td>
                    <td className="px-3 py-2.5">
                      {/* Le NOM d'abord ; le technique (code SAP, date/heure de prise,
                          réf., nb lignes) derrière le « ? ». */}
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-foreground truncate text-[14px]">{d.cardName || d.cardCode}</span>
                        <InfoHint label="Détails commande" side="right">
                          <span className="block space-y-0.5">
                            <span className="block">Code SAP : <span className="font-mono">{d.cardCode}</span></span>
                            <span className="block">Commandée le {fmtDate(d.docDate)}{heureFromComments(d.comments) ? ` à ${heureFromComments(d.comments)}` : ""}</span>
                            {d.numAtCard && <span className="block">Réf. : <span className="tnum">{d.numAtCard}</span></span>}
                            <span className="block">{d.lineCount} ligne{d.lineCount > 1 ? "s" : ""}</span>
                          </span>
                        </InfoHint>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 tnum text-muted-foreground">{fmtDate(d.dueDate)}</td>
                    <td className="px-3 py-2.5">{isDue(d) ? <DueBadge /> : <StatusBadge open={d.open} cancelled={d.cancelled} />}</td>
                    {!restricted && <td className="px-3 py-2.5 text-right tnum font-display font-bold text-[15px]">{eur(d.totalHT ?? 0)}</td>}
                    <td className="px-2 py-2.5 text-right"><ChevronRight className="h-4 w-4 text-muted-foreground/50 inline" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      {/* ── Détail PLEIN ÉCRAN (on oublie le fond) ── */}
      <FullscreenPanel
        open={!!largeDoc}
        onOpenChange={(o) => { if (!o) setLargeEntry(null); }}
        title={largeDoc?.cardName || largeDoc?.cardCode || ""}
        subtitle={
          largeDoc ? (
            <span className="inline-flex items-center gap-2 flex-wrap">
              <span className="font-mono">CF # {largeDoc.docNum}</span>
              <span className="tnum">· Livraison {fmtDate(largeDoc.dueDate)}</span>
              {isDue(largeDoc) ? <DueBadge /> : <StatusBadge open={largeDoc.open} cancelled={largeDoc.cancelled} />}
            </span>
          ) : undefined
        }
        highlight={!restricted && largeDoc ? <>{eur(largeDoc.totalHT ?? 0)} <span className="text-[12px] font-sans font-medium text-muted-foreground">HT</span></> : undefined}
      >
        {largeDoc && <PoDetail po={largeDoc} onReceive={receive} receiving={receiving} onModified={load} restricted={restricted} />}
      </FullscreenPanel>
    </div>
  );
}

type EditLine = {
  itemCode: string; itemName: string; ratio: number;
  packageQuantity: number; price: string; lineTotal: string; forceTotal: boolean;
  warehouseCode: "000" | "01" | "R1";
  pays: string | null; marque: string | null; condt: string | null; variete: string | null;
};
const PO_WAREHOUSES: { code: "000" | "01" | "R1"; label: string }[] = [
  { code: "000", label: "000 · A/C-A/D" }, { code: "01", label: "01 · Stock" }, { code: "R1", label: "R1 · J+1" },
];
/** Total HT effectif d'une ligne : forcé si `forceTotal`, sinon PU × colis × ratio. */
const effLineTotal = (l: EditLine): number | null => {
  if (l.forceTotal) { const t = parseFloat(l.lineTotal); return Number.isFinite(t) ? t : null; }
  const p = l.price === "" ? null : parseFloat(l.price);
  return p != null && Number.isFinite(p) ? p * l.packageQuantity * l.ratio : null;
};
/** PU /pie effectif : déduit du total forcé si besoin. */
const effPU = (l: EditLine): number | null => {
  if (!l.forceTotal) { const p = l.price === "" ? null : parseFloat(l.price); return p != null && Number.isFinite(p) ? p : null; }
  const t = parseFloat(l.lineTotal); const denom = l.packageQuantity * l.ratio;
  return Number.isFinite(t) && denom > 0 ? Math.round((t / denom) * 10000) / 10000 : null;
};

function PoDetail({ po, onReceive, receiving, onModified, restricted = false }: {
  po: PurchaseOrder; onReceive: (docEntry: number, agreage: ReceiveAgreage) => void; receiving: boolean; onModified: () => void | Promise<void>;
  /** Agréeur « pur » : aucun prix visible, ni modif ni annulation de commande. */
  restricted?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  // Agréage de la réception (contrôle qualité) : conforme par défaut ; « avec
  // réserve » exige un type + une note (la réserve ouvre un incident).
  const [agreeStatus, setAgreeStatus] = useState<"CONFORME" | "RESERVE">("CONFORME");
  const [reserveType, setReserveType] = useState<string>(INCIDENT_TYPES[0]);
  const [reserveNote, setReserveNote] = useState("");
  // Note qualité (étoiles) de la marchandise reçue — posée par l'agréeur.
  const [qualityRating, setQualityRating] = useState<number | null>(null);
  const reserveIncomplete = agreeStatus === "RESERVE" && !reserveNote.trim();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [swapIdx, setSwapIdx] = useState<number | null>(null); // ligne dont on remplace l'article
  // Annulation de la commande fournisseur (tant qu'elle n'est pas réceptionnée).
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const cancelOrder = async () => {
    setCancelling(true);
    try {
      const res = await fetch("/api/sap/purchase-orders/cancel", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: po.docEntry }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { toast.error(j.error || "Annulation impossible"); return; }
      toast.success(`Commande fournisseur #${po.docNum} annulée`);
      setCancelConfirm(false);
      await onModified();
    } catch (e) { toast.error((e as Error).message); }
    finally { setCancelling(false); }
  };

  const beginEdit = () => {
    setEditLines(po.lines.map((l) => {
      const pkg = l.packageQuantity ?? l.pieceQuantity ?? 0;
      const ratio = pkg > 0 && l.pieceQuantity ? Math.max(1, Math.round((l.pieceQuantity / pkg) * 1000) / 1000) : 1;
      const whs = (["000", "01", "R1"] as const).find((w) => w === l.warehouse) ?? "01";
      // Prix unitaire absent mais total présent → la ligne avait un total forcé.
      const forceTotal = (l.price == null || l.price <= 0) && l.lineTotal != null && l.lineTotal > 0;
      return {
        itemCode: l.itemCode, itemName: l.itemName ?? l.itemCode, ratio,
        packageQuantity: pkg,
        price: l.price != null && l.price > 0 ? String(l.price) : "",
        lineTotal: l.lineTotal != null ? String(l.lineTotal) : "",
        forceTotal, warehouseCode: whs,
        pays: l.uPays, marque: l.uMarque, condt: l.uCondi, variete: l.frgnName ?? null,
      };
    }));
    setSwapIdx(null);
    setEditing(true);
  };
  const updateEditLine = (i: number, patch: Partial<EditLine>) => setEditLines((c) => c.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const removeEditLine = (i: number) => { setEditLines((c) => c.filter((_, k) => k !== i)); setSwapIdx(null); };
  // Sélection d'un article : remplace la ligne en cours (swapIdx) ou en ajoute une.
  const onPickProduct = (p: ProductHit) => {
    const ratio = p.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1 ? p.salesQtyPerPackUnit : 1;
    if (swapIdx != null) {
      const idx = swapIdx;
      setEditLines((c) => c.map((l, k) => (k === idx
        ? { ...l, itemCode: p.itemCode, itemName: p.itemName, ratio, pays: p.uPays, marque: p.uMarque, condt: p.uCondi, variete: p.frgnName }
        : l)));
      setSwapIdx(null);
      return;
    }
    setEditLines((cur) => {
      if (cur.some((l) => l.itemCode === p.itemCode)) { toast.info(`${p.itemCode} déjà présent`); return cur; }
      return [...cur, { itemCode: p.itemCode, itemName: p.itemName, ratio, packageQuantity: 1, price: "", lineTotal: "", forceTotal: false, warehouseCode: "01", pays: p.uPays, marque: p.uMarque, condt: p.uCondi, variete: p.frgnName }];
    });
  };
  const editTotalHT = editLines.reduce((s, l) => s + (effLineTotal(l) ?? 0), 0);

  const save = async () => {
    const payload = editLines
      .filter((l) => l.packageQuantity > 0)
      .map((l) => {
        const base = { itemCode: l.itemCode, packageQuantity: l.packageQuantity, warehouseCode: l.warehouseCode };
        if (l.forceTotal) { const t = parseFloat(l.lineTotal); return { ...base, lineTotal: Number.isFinite(t) ? t : undefined }; }
        return { ...base, price: l.price ? parseFloat(l.price) : undefined };
      });
    if (payload.length === 0) { toast.error("Garde au moins une ligne."); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/sap/purchase-orders/${po.docEntry}/modif`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: payload }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { toast.error(j.error || "Erreur SAP"); return; }
      toast.success(`Commande #${po.docNum} modifiée`);
      setEditing(false);
      await onModified();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  // ── Mode ÉDITION (commande pas encore réceptionnée) ──
  if (editing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14px] font-semibold text-foreground">Modifier la commande</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>Annuler</Button>
            <Button size="sm" onClick={save} disabled={saving || editLines.length === 0}>
              {saving ? <Loader2 className="animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
            {swapIdx != null ? `Remplacer l'article de la ligne ${swapIdx + 1}` : "Ajouter un article"}
            {swapIdx != null && (
              <button type="button" onClick={() => setSwapIdx(null)} className="normal-case text-[11px] font-medium text-muted-foreground underline hover:text-foreground">annuler</button>
            )}
          </label>
          <ProductPicker onPick={onPickProduct} />
        </div>

        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-secondary/40 text-[10.5px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-2 font-semibold w-24">Qté colis</th>
                <th className="text-left px-2 py-2 font-semibold">Article</th>
                <th className="text-left px-2 py-2 font-semibold w-32">Entrepôt</th>
                <th className="text-right px-2 py-2 font-semibold w-24">PU /pie HT</th>
                <th className="text-right px-2 py-2 font-semibold w-28">Total HT</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {editLines.map((l, i) => {
                const dz = designationProduit({ itemName: l.itemName, uPays: l.pays, uMarque: l.marque, uCondi: l.condt, frgnName: l.variete });
                return (
                  <tr key={`${l.itemCode}-${i}`} className={`border-t border-border align-top ${swapIdx === i ? "bg-violet-50 dark:bg-violet-500/10" : ""}`}>
                    <td className="px-2 py-2"><NumberInput value={l.packageQuantity} onValueChange={(n) => updateEditLine(i, { packageQuantity: n ?? 0 })} min={0} step={1} className="text-right h-9 w-20" /></td>
                    <td className="px-2 py-2">
                      <div className="font-semibold text-foreground">{dz.fruit}</div>
                      <button type="button" onClick={() => setSwapIdx(swapIdx === i ? null : i)} className="group inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-violet-600 dark:hover:text-violet-400" title="Changer l'article">
                        {l.itemCode} <Pencil className="h-3 w-3 opacity-50 group-hover:opacity-100" />
                      </button>
                      <DesignationChips marque={dz.marque} condt={dz.condt} variete={dz.variete} pays={dz.pays} className="mt-0.5" />
                    </td>
                    <td className="px-2 py-2">
                      <select value={l.warehouseCode} onChange={(e) => updateEditLine(i, { warehouseCode: e.target.value as EditLine["warehouseCode"] })} className="h-9 w-full rounded-md border border-input bg-background px-2 text-[12.5px]">
                        {PO_WAREHOUSES.map((w) => <option key={w.code} value={w.code}>{w.label}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2"><NumberInput value={effPU(l)} onValueChange={(n) => updateEditLine(i, { price: n == null ? "" : String(n), forceTotal: false, lineTotal: "" })} min={0} step={0.01} decimals={2} allowEmpty placeholder="—" className="text-right h-9 w-24" /></td>
                    <td className="px-2 py-2">
                      <NumberInput value={effLineTotal(l)} onValueChange={(n) => updateEditLine(i, { lineTotal: n == null ? "" : String(n), forceTotal: n != null })} min={0} step={0.01} decimals={2} allowEmpty placeholder="—" className={`text-right h-9 w-24 ${l.forceTotal ? "ring-1 ring-amber-400" : ""}`} />
                      {l.forceTotal && <div className="mt-0.5 text-right text-[9.5px] font-semibold uppercase text-amber-600 dark:text-amber-400">forcé</div>}
                    </td>
                    <td className="px-2 py-2 text-right"><Button variant="ghost" size="icon-sm" onClick={() => removeEditLine(i)} aria-label="Supprimer"><Trash2 className="h-3.5 w-3.5" /></Button></td>
                  </tr>
                );
              })}
              {editLines.length === 0 && (
                <tr><td colSpan={6} className="px-2 py-4 text-center text-[12px] italic text-muted-foreground">Ajoute au moins une ligne.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-secondary/30">
                <td colSpan={4} className="px-2 py-2 text-right text-[10.5px] uppercase tracking-wide font-semibold text-muted-foreground">Total HT</td>
                <td className="px-2 py-2 text-right tnum font-bold text-foreground whitespace-nowrap">{eur(editTotalHT)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Édite le <b>code</b> (clic sur le code → choisis le nouvel article), les <b>colis</b>, le <b>PU HT</b> ou
          force le <b>Total HT</b> (SAP recalcule le PU). Total document = somme des lignes. Les taxes sont
          recalculées par SAP à l&apos;enregistrement.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Modifier / annuler la commande (tant qu'elle n'est pas réceptionnée) —
          gestion réservée : masqué pour l'agréeur (il ne fait que réceptionner). */}
      {po.open && !restricted && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={beginEdit} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" /> Modifier la commande
          </Button>
          {!cancelConfirm ? (
            <Button variant="outline" size="sm" onClick={() => setCancelConfirm(true)}
              className="gap-1.5 text-rose-600 dark:text-rose-400 hover:text-rose-700 border-rose-300/60 dark:border-rose-500/30">
              <Ban className="h-3.5 w-3.5" /> Annuler la commande
            </Button>
          ) : (
            <div className="inline-flex items-center gap-2">
              <span className="text-[12.5px] text-foreground">Annuler la commande # {po.docNum} ?</span>
              <Button variant="destructive" size="sm" onClick={cancelOrder} disabled={cancelling}>
                {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Confirmer
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCancelConfirm(false)} disabled={cancelling}>
                Non
              </Button>
            </div>
          )}
        </div>
      )}
      {/* Action : valider la réception → crée l'entrée marchandise */}
      {po.open && (
        <div className="rounded-xl border border-amber-400/50 bg-amber-50/60 dark:bg-amber-950/20 p-3">
          {!confirm ? (
            <Button size="xl" className="w-full" onClick={() => setConfirm(true)}>
              <PackageCheck className="h-4 w-4" /> Réceptionner → entrée marchandise
            </Button>
          ) : (
            <div className="space-y-2.5">
              <p className="text-[13px] text-foreground">
                Créer l&apos;entrée marchandise pour cette commande&nbsp;? La commande sera clôturée
                et le stock incrémenté.
              </p>
              {/* ── Agréage de la marchandise reçue (contrôle qualité) ── */}
              <div className="space-y-2">
                <p className="text-[10.5px] uppercase tracking-wide font-semibold text-muted-foreground">Agréage de la marchandise</p>
                {/* Note qualité (étoiles) — posée par l'agréeur, appliquée aux articles reçus. */}
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-muted-foreground">Note qualité</span>
                  <StarRating value={qualityRating} onChange={setQualityRating} size="md" ariaLabel="Note qualité de la marchandise reçue" />
                </div>
                <div className="flex items-center gap-2 flex-wrap" role="radiogroup" aria-label="Agréage de la marchandise">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={agreeStatus === "CONFORME"}
                    onClick={() => setAgreeStatus("CONFORME")}
                    className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[12.5px] font-semibold transition-colors ${
                      agreeStatus === "CONFORME"
                        ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <PackageCheck className="h-3.5 w-3.5" /> Conforme
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={agreeStatus === "RESERVE"}
                    onClick={() => setAgreeStatus("RESERVE")}
                    className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[12.5px] font-semibold transition-colors ${
                      agreeStatus === "RESERVE"
                        ? "border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" /> Avec réserve
                  </button>
                </div>
                {agreeStatus === "RESERVE" && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      {INCIDENT_TYPES.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setReserveType(t)}
                          className={`h-8 px-2.5 rounded-lg border text-[11.5px] font-semibold transition-colors ${
                            reserveType === t
                              ? "border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                              : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={reserveNote}
                      onChange={(e) => setReserveNote(e.target.value)}
                      rows={2}
                      placeholder="Décris la réserve (obligatoire) — ex. 12 colis abîmés, température +9 °C…"
                      aria-label="Note de réserve"
                      className="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/40"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      La réserve est enregistrée sur l&apos;entrée marchandise et <b>ouvre un incident de réception</b> (litige fournisseur).
                    </p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="lg"
                  onClick={() => onReceive(po.docEntry, {
                    status: agreeStatus,
                    ...(agreeStatus === "RESERVE" ? { type: reserveType, note: reserveNote.trim() } : {}),
                    ...(qualityRating ? { rating: qualityRating } : {}),
                  })}
                  disabled={receiving || reserveIncomplete}
                  title={reserveIncomplete ? "Décris la réserve avant de confirmer" : undefined}
                >
                  {receiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                  {agreeStatus === "RESERVE" ? "Réceptionner avec réserve" : "Confirmer la réception"}
                </Button>
                <Button variant="outline" size="lg" onClick={() => setConfirm(false)} disabled={receiving}>
                  Annuler
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* En-tête : code SAP + prise de commande.
          (Nom, statut, livraison et total vivent dans l'en-tête plein écran.) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-[15px] text-foreground">
          <Truck className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono font-semibold">{po.cardCode}</span>
        </span>
        <span className="text-[14px] text-muted-foreground tnum">
          Commandée {fmtDate(po.docDate)}{heureFromComments(po.comments) ? ` à ${heureFromComments(po.comments)}` : ""}
        </span>
        {po.numAtCard && <span className="text-[14px] text-muted-foreground">{po.numAtCard}</span>}
      </div>
      {po.comments && <p className="italic text-muted-foreground text-[13px]">« {po.comments} »</p>}

      {/* Mobile : lignes empilées */}
      <div className="md:hidden space-y-2">
        {po.lines.map((l, i) => {
          const dz = designationProduit({ itemName: l.itemName, uPays: l.uPays, uMarque: l.uMarque, uCondi: l.uCondi, frgnName: l.frgnName });
          const lineHT = l.lineTotal ?? (l.price != null ? l.price * l.pieceQuantity : null);
          return (
            <div key={`m-${l.itemCode}-${i}`} className="rounded-lg border border-border bg-card/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-foreground leading-tight">{dz.fruit}</div>
                  <div className="text-[12px] font-mono text-muted-foreground mt-0.5">{l.itemCode}</div>
                  <DesignationChips marque={dz.marque} condt={dz.condt} variete={dz.variete} pays={dz.pays} className="mt-1.5" />
                </div>
                {!restricted && (
                  <div className="text-right shrink-0">
                    <div className="text-[15px] font-bold tnum text-foreground">{lineHT != null ? eur(lineHT) : "—"}</div>
                    <div className="text-[11px] text-muted-foreground">HT</div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2 text-[13px] text-muted-foreground tnum">
                <span className="text-foreground font-medium">{fmtColis(l.packageQuantity)} colis</span>
                {!restricted && <span>·</span>}
                {!restricted && <span>PU {l.price != null ? eur(l.price) : "—"}</span>}
                {po.cancelled
                  ? <span className="text-rose-600 dark:text-rose-400">· annulée</span>
                  : !l.open && <span className="text-emerald-600 dark:text-emerald-400">· reçue</span>}
              </div>
            </div>
          );
        })}
        {!restricted && (
          <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1.5">
            <div className="flex justify-between text-[14px]"><span className="text-muted-foreground">Total HT</span><span className="font-semibold tnum">{eur(po.totalHT ?? 0)}</span></div>
            <div className="flex justify-between text-[14px]"><span className="text-muted-foreground">TVA</span><span className="tnum text-muted-foreground">{eur(po.totalTVA ?? 0)}</span></div>
            <div className="flex justify-between text-[16px] border-t border-border pt-1.5"><span className="font-semibold text-foreground">Total TTC</span><span className="font-bold tnum text-foreground">{eur(po.totalTTC ?? po.total ?? 0)}</span></div>
          </div>
        )}
      </div>

      {/* Desktop : tableau */}
      <div className="hidden md:block rounded-lg border border-border overflow-x-auto bg-card/40">
        <table className="w-full text-[15px]">
          <thead className="bg-secondary/40 uppercase tracking-wide text-muted-foreground text-[11.5px]">
            <tr>
              <th className="text-left px-3 py-2.5 font-semibold w-20">Colis</th>
              <th className="text-left px-3 py-2.5 font-semibold">Article</th>
              <th className="text-left px-3 py-2.5 font-semibold">Désignation</th>
              {!restricted && <th className="text-right px-3 py-2.5 font-semibold">PU HT</th>}
              {!restricted && <th className="text-right px-3 py-2.5 font-semibold">Total HT</th>}
              <th className="text-left px-3 py-2.5 font-semibold">Statut</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l, i) => {
              const dz = designationProduit({ itemName: l.itemName, uPays: l.uPays, uMarque: l.uMarque, uCondi: l.uCondi, frgnName: l.frgnName });
              const lineHT = l.lineTotal ?? (l.price != null ? l.price * l.pieceQuantity : null);
              return (
                <tr key={`${l.itemCode}-${i}`} className="border-t border-border/60">
                  <td className="px-3 py-2.5 tnum font-semibold text-foreground whitespace-nowrap">{fmtColis(l.packageQuantity)}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-foreground">{dz.fruit}</div>
                    <div className="font-mono text-[12px] text-muted-foreground">{l.itemCode}</div>
                  </td>
                  <td className="px-3 py-2.5"><DesignationChips marque={dz.marque} condt={dz.condt} variete={dz.variete} pays={dz.pays} /></td>
                  {!restricted && <td className="px-3 py-2.5 text-right tnum">{l.price != null ? eur(l.price) : "—"}</td>}
                  {!restricted && <td className="px-3 py-2.5 text-right tnum font-semibold">{lineHT != null ? eur(lineHT) : "—"}</td>}
                  <td className="px-3 py-2.5">
                    <span className={
                      po.cancelled
                        ? "text-rose-600 dark:text-rose-400"
                        : l.open
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-emerald-600 dark:text-emerald-400"
                    }>
                      {po.cancelled ? "Annulée" : l.open ? "Ouverte" : "Reçue"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {!restricted && (
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
          )}
        </table>
      </div>
    </div>
  );
}
