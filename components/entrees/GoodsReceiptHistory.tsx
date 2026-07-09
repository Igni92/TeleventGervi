"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, ClipboardList, Search, ChevronRight, ChevronDown,
  AlertTriangle, Truck, X, Maximize2, Ban, Undo2, PackageCheck,
} from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { designationProduit } from "@/lib/produit-designation";
import { DesignationChips, Chip } from "./DesignationChips";
import {
  OpenReceptionIncidents, InlineIncidentDeclare, IncidentTypeIcon, useReceptionIncidents,
} from "./ReceptionIncidents";

type ReceiptLine = {
  lineNum: number;
  itemCode: string; itemName?: string;
  pieceQuantity: number; packageQuantity: number | null;
  warehouse?: string;
  price: number | null; lineTotal: number | null; taxPercent: number | null;
  uPays: string | null; uMarque: string | null; uCondi: string | null; frgnName?: string | null;
};
type Receipt = {
  docEntry: number; docNum: number; lot: string; docDate: string;
  cardCode: string; cardName?: string; numAtCard: string;
  editable?: boolean;
  // Annulations (SAP) : ce doc EST une annulation, ou la réception A ÉTÉ annulée.
  isCancellation?: boolean; cancelsDocNum?: number | null;
  cancelled?: boolean; cancelledByDocNum?: number | null;
  total: number; totalTTC: number; totalHT: number; totalTVA: number;
  comments: string; lineCount: number; lines: ReceiptLine[];
};

/** Vrai si la ligne n'est pas une vraie réception « vivante » (annulée ou doc d'annulation). */
const isVoided = (d: Receipt): boolean => !!d.cancelled || !!d.isCancellation;

/** Pastille de statut d'annulation (sinon rien). */
function CancelBadge({ d, className = "" }: { d: Receipt; className?: string }) {
  if (d.isCancellation) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-slate-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600 dark:text-slate-300 ${className}`}>
        <Ban className="h-3 w-3" />
        Annulation{d.cancelsDocNum ? ` · # ${d.cancelsDocNum}` : ""}
      </span>
    );
  }
  if (d.cancelled) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-rose-600 dark:text-rose-300 ${className}`}>
        <Ban className="h-3 w-3" />
        Annulée{d.cancelledByDocNum ? ` · # ${d.cancelledByDocNum}` : ""}
      </span>
    );
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────────
   AGRÉAGE (contrôle qualité — lib/agreage). L'agréage ne se fait QUE lors de
   la réception d'une COMMANDE FOURNISSEUR (CF → EM, écran Commandes
   fournisseurs) : ici on ne fait qu'AFFICHER le résultat. Une EM saisie en
   direct (sans CF) n'est pas agréée → aucun badge.
   ───────────────────────────────────────────────────────────────── */
type AgreageInfo = { status: "CONFORME" | "RESERVE"; type: string | null; note: string | null; by: string; at: string };

function AgreageBadge({ a, className = "" }: { a: AgreageInfo | null | undefined; className?: string }) {
  if (!a) return null;
  if (a.status === "RESERVE") {
    return (
      <span
        title={`Agréée AVEC RÉSERVE par ${a.by}${a.note ? ` — ${a.note}` : ""}`}
        className={`inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300 ${className}`}
      >
        <AlertTriangle className="h-3 w-3" /> Réserve{a.type ? ` · ${a.type}` : ""}
      </span>
    );
  }
  return (
    <span
      title={`Agréée conforme par ${a.by}`}
      className={`inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300 ${className}`}
    >
      <PackageCheck className="h-3 w-3" /> Agréée
    </span>
  );
}

/** Édition du prix d'une ligne d'EM (prix unitaire OU total HT forcé). */
type PriceEdit = { lineNum: number; pieceQuantity: number; price: string; lineTotal: string; forceTotal: boolean };
const emEffPU = (e: PriceEdit): number | null => {
  if (e.forceTotal) { const t = parseFloat(e.lineTotal); return Number.isFinite(t) && e.pieceQuantity > 0 ? Math.round((t / e.pieceQuantity) * 10000) / 10000 : null; }
  const p = e.price === "" ? null : parseFloat(e.price); return p != null && Number.isFinite(p) ? p : null;
};
const emEffTotal = (e: PriceEdit): number | null => {
  if (e.forceTotal) { const t = parseFloat(e.lineTotal); return Number.isFinite(t) ? t : null; }
  const p = e.price === "" ? null : parseFloat(e.price); return p != null && Number.isFinite(p) ? p * e.pieceQuantity : null;
};
/** Signature d'une édition de ligne (pour ne sauver que si ça a réellement changé). */
const sigOf = (e: PriceEdit) => (e.forceTotal ? `T:${e.lineTotal}` : `P:${e.price}`);
/** État d'édition initial des prix, dérivé des lignes de l'EM. */
function toPriceEdits(lines: ReceiptLine[]): PriceEdit[] {
  return lines.map((l) => ({
    lineNum: l.lineNum, pieceQuantity: l.pieceQuantity,
    price: l.price != null && l.price > 0 ? String(l.price) : "",
    lineTotal: l.lineTotal != null ? String(l.lineTotal) : "",
    forceTotal: (l.price == null || l.price <= 0) && l.lineTotal != null && l.lineTotal > 0,
  }));
}

/** Date au format jj.mm.aa (points, année sur 2 chiffres). */
const fmtDate = (s?: string): string => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${p(d.getFullYear() % 100)}`;
};
/** Date + heure « JEU 08.07.26 · 6h45 » (jour court FR en majuscules + heure locale). */
const fmtDateHeure = (s?: string): string => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  const jour = d.toLocaleDateString("fr-FR", { weekday: "short" }).replace(/\.$/, "").toUpperCase();
  const heure = `${d.getHours()}h${String(d.getMinutes()).padStart(2, "0")}`;
  return `${jour} ${fmtDate(s)} · ${heure}`;
};
/** Vrai si la date tombe AUJOURD'HUI — l'annulation d'une EM n'est acceptée par
 *  SAP que le jour de sa création (contrairement à un BL de vente). */
const isToday = (s?: string): boolean => {
  if (!s) return false;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};
/** Montant € à 2 décimales (séparateur FR). */
const eur = (n: number): string =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
/** Nb de colis : entier si rond, sinon 1 décimale. */
const fmtColis = (n: number | null | undefined): string => {
  if (n == null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
};

/* ─────────────────────────────────────────────────────────────────
   Fraîcheur / DLC des lots — version CLIENT.
   ⚠️ `lib/lotDlc.ts` importe `@/lib/prisma` au niveau module : l'importer ici
   (composant client) embarquerait Prisma dans le bundle navigateur. On
   ré-implémente donc `freshnessLabel` à l'identique (mêmes seuils, mêmes
   libellés « DLC J-x / J+x », jour de Paris), purement côté client.
   ───────────────────────────────────────────────────────────────── */
type FreshnessTone = "green" | "amber" | "red" | "muted";

/** Début de journée (00:00 heure de Paris) → instant UTC, en ms. */
const parisDayMs = (ref: Date = new Date()): number => {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(ref).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Jours « pleins » (heure de Paris) entre aujourd'hui et la DLC. */
const daysUntil = (expiration: Date): number =>
  Math.round((parisDayMs(expiration) - parisDayMs()) / 86_400_000);

/** Étiquette + ton d'une DLC — miroir de `lib/lotDlc.freshnessLabel`. */
const freshnessLabel = (
  expiration: Date | null | undefined,
): { label: string; tone: FreshnessTone } => {
  if (!expiration) return { label: "DLC non saisie", tone: "muted" };
  const d = expiration instanceof Date ? expiration : new Date(expiration);
  if (Number.isNaN(d.getTime())) return { label: "DLC non saisie", tone: "muted" };
  const days = daysUntil(d);
  const rel = days > 0 ? `J-${days}` : `J+${Math.abs(days)}`;
  const tone: FreshnessTone = days > 3 ? "green" : days >= 1 ? "amber" : "red";
  return { label: `DLC ${rel}`, tone };
};

/** Classes Tailwind d'un badge fraîcheur selon le ton. */
const FRESHNESS_TONE: Record<FreshnessTone, string> = {
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  red: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  muted: "bg-muted/40 text-muted-foreground",
};

/** Petit badge fraîcheur (lecture seule). `dlc === undefined` → pas encore chargé. */
function FreshnessBadge({ dlc, className = "" }: { dlc: string | null | undefined; className?: string }) {
  if (dlc === undefined) return null; // DLC pas encore récupérée (ou endpoint HS) → rien
  const { label, tone } = freshnessLabel(dlc ? new Date(dlc) : null);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${FRESHNESS_TONE[tone]} ${className}`}>
      {label}
    </span>
  );
}

/**
 * Récupère en UN appel groupé les DLC d'une liste de lots (« EM<DocNum> »).
 * Défensif : endpoint HS / non-OK → Map vide (aucun badge, jamais d'erreur).
 * Renvoie batchNumber → ISO|null (clé absente si non encore connue).
 */
function useDlcMap(
  batchNumbers: string[],
): [Record<string, string | null>, (batchNumber: string, iso: string | null) => void] {
  const [dlc, setDlc] = useState<Record<string, string | null>>({});
  const key = useMemo(() => Array.from(new Set(batchNumbers.filter(Boolean))).sort().join(","), [batchNumbers]);
  useEffect(() => {
    if (!key) { setDlc({}); return; }
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/lots/dlc?batches=${encodeURIComponent(key)}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { dlc?: Record<string, string | null> };
        if (!cancel && json && typeof json.dlc === "object" && json.dlc) setDlc((c) => ({ ...c, ...json.dlc }));
      } catch {
        /* endpoint HS → on garde l'état courant, aucun badge n'apparaît */
      }
    })();
    return () => { cancel = true; };
  }, [key]);
  // Mise à jour optimiste après saisie d'une DLC dans le détail (évite un refetch).
  const merge = useCallback((batchNumber: string, iso: string | null) => {
    setDlc((c) => ({ ...c, [batchNumber]: iso }));
  }, []);
  return [dlc, merge];
}

/** Liste des entrées marchandises (SAP PurchaseDeliveryNotes) — recherche + détail.
 *  `restricted` = agréeur « pur » : aucun prix visible ni éditable, pas de retour
 *  fournisseur ni d'annulation — consultation seule (l'agréage se fait à la
 *  réception d'une commande fournisseur). */
export function GoodsReceiptHistory({ restricted = false }: { restricted?: boolean }) {
  const [docs, setDocs] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [largeEntry, setLargeEntry] = useState<number | null>(null);
  const { incidents, loading: incLoading, reload: reloadIncidents, byDoc } = useReceptionIncidents();
  // Agréages des EM listées (contrôle qualité) — un fetch groupé par chargement.
  // Clé = liste des docEntry (stable) : une édition LOCALE de docs (prix, n° BL,
  // DLC…) remappe le tableau sans changer les entrées → pas de re-fetch inutile.
  const [agreages, setAgreages] = useState<Record<number, AgreageInfo>>({});
  const agreageKey = useMemo(
    () => docs.filter((d) => !isVoided(d)).map((d) => d.docEntry).join(","),
    [docs],
  );
  useEffect(() => {
    if (!agreageKey) { setAgreages({}); return; }
    let cancelled = false;
    fetch(`/api/entrees/agreage?docEntries=${agreageKey}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok?: boolean; agreages?: Record<number, AgreageInfo> }) => {
        if (!cancelled && j?.ok) setAgreages(j.agreages ?? {});
      })
      .catch(() => { /* agréage best-effort */ });
    return () => { cancelled = true; };
  }, [agreageKey]);

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

  // DLC (fraîcheur) : un seul fetch groupé pour TOUS les lots chargés.
  const allBatches = useMemo(() => docs.map((d) => d.lot).filter(Boolean), [docs]);
  const [dlcMap, mergeDlc] = useDlcMap(allBatches);

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
  // Incident ouvert sur l'entrée agrandie → titre en rouge (alerte immédiate).
  const largeHasIncident = largeDoc ? (byDoc.get(largeDoc.docEntry) ?? []).some((i) => !i.resolved) : false;

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

        {filtered.length > 0 && (() => {
          // Les annulations (doc d'annulation + réception annulée) ne représentent
          // aucun stock entré net → exclues des cumuls (mais visibles, marquées).
          const live = filtered.filter((d) => !isVoided(d));
          const voided = filtered.length - live.length;
          return (
            <div className="flex flex-wrap gap-6 pb-1">
              <Stat label="Entrées" value={<AnimatedNumber value={live.length} />} />
              {!restricted && (
                <Stat
                  label="Valeur cumulée (HT)"
                  tone="emerald"
                  value={
                    <AnimatedNumber
                      value={live.reduce((s, d) => s + (d.totalHT ?? 0), 0)}
                      format={(n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n)}
                    />
                  }
                />
              )}
              <Stat label="Lignes" value={<AnimatedNumber value={live.reduce((s, d) => s + (d.lineCount ?? 0), 0)} />} />
              {voided > 0 && <Stat label="Annulées" value={<AnimatedNumber value={voided} />} />}
            </div>
          );
        })()}

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
                  className={`w-full rounded-2xl border border-border bg-card flex items-center gap-3 p-4 text-left active:bg-secondary/40 ${isVoided(d) ? "opacity-60" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                      <span className={`font-mono font-semibold text-[16px] ${isVoided(d) ? "line-through text-muted-foreground" : "text-foreground"}`}># {d.docNum}</span>
                      <CancelBadge d={d} />
                      {!isVoided(d) && <AgreageBadge a={agreages[d.docEntry]} />}
                    </span>
                    <div className="text-[14px] text-foreground/90 mt-0.5 truncate" title={d.cardName}>
                      {d.cardName || d.cardCode}
                    </div>
                    <div className="text-[13px] text-muted-foreground mt-0.5 tnum">
                      {fmtDate(d.docDate)} · {d.lineCount} ligne{d.lineCount > 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                    {!restricted && (
                      <div>
                        <span className="text-[17px] font-bold tnum text-foreground leading-none">{eur(d.totalHT ?? 0)}</span>
                        <span className="ml-1 text-[11px] text-muted-foreground">HT</span>
                      </div>
                    )}
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
                  {!restricted && <th className="text-right px-3 py-2 font-semibold w-28">Total HT</th>}
                  <th className="text-center px-3 py-2 font-semibold w-28">Agréage</th>
                  <th className="text-center px-3 py-2 font-semibold w-20">Incident</th>
                </tr>
              </thead>
              <tbody>
                {filtered.flatMap((d) => {
                  const isOpen = expanded === d.docEntry;
                  const rows = [
                    <tr
                      key={d.docEntry}
                      className={`border-t border-border cursor-pointer transition-colors ${isOpen ? "bg-secondary/40" : "hover:bg-secondary/30"} ${isVoided(d) ? "opacity-60" : ""}`}
                      onClick={() => toggle(d.docEntry)}
                    >
                      <td className="px-2 py-2 text-center text-muted-foreground">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5 inline" /> : <ChevronRight className="h-3.5 w-3.5 inline" />}
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">
                        <span className={isVoided(d) ? "line-through text-muted-foreground" : ""}># {d.docNum}</span>
                        <CancelBadge d={d} className="ml-1.5 align-middle" />
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">
                        {d.lot}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono font-medium truncate" title={d.cardName}>{d.cardCode}</div>
                        {d.numAtCard && <div className="text-[11px] text-muted-foreground tnum">{d.numAtCard}</div>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground tnum">{fmtDate(d.docDate)}</td>
                      <td className="px-3 py-2 text-right tnum">{d.lineCount}</td>
                      {!restricted && <td className="px-3 py-2 text-right tnum font-semibold">{eur(d.totalHT ?? 0)}</td>}
                      <td className="px-3 py-2 text-center">
                        {/* Agréage posé à la réception CF → EM ; EM directe = pas d'agréage. */}
                        {!isVoided(d) && agreages[d.docEntry]
                          ? <AgreageBadge a={agreages[d.docEntry]} />
                          : <span className="text-muted-foreground/30 text-[11px]">—</span>}
                      </td>
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
                        <td colSpan={restricted ? 8 : 9} className="bg-secondary/20 px-4 py-4 border-t border-border/60">
                          <ReceiptDetail
                            receipt={d}
                            dlc={dlcMap[d.lot]}
                            onDlcSaved={mergeDlc}
                            incidents={byDoc.get(d.docEntry) ?? []}
                            onIncidentChanged={reloadIncidents}
                            onNumAtCardChange={updateNumAtCard}
                            onModified={load}
                            onEnlarge={() => setLargeEntry(d.docEntry)}
                            agreage={agreages[d.docEntry] ?? null}
                            restricted={restricted}
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
              <ClipboardList className={`h-5 w-5 shrink-0 ${largeHasIncident ? "text-rose-600 dark:text-rose-400" : "text-sky-600 dark:text-sky-400"}`} />
              <span className={`truncate min-w-0 font-mono ${largeHasIncident ? "text-rose-600 dark:text-rose-400" : ""}`}>EM. {largeDoc?.docNum}</span>
              {/* Lot = « EM{docNum} » → redondant avec le N° ci-dessus : masqué sur mobile pour tenir sur UNE ligne. */}
              {largeDoc?.lot && <span className="hidden sm:inline text-[13px] font-normal font-mono text-muted-foreground shrink-0">· {largeDoc.lot}</span>}
              {largeDoc?.lot && <FreshnessBadge dlc={dlcMap[largeDoc.lot]} className="shrink-0" />}
            </DialogTitle>
            <DialogDescription className="sr-only">Détail de l&apos;entrée marchandise : lignes reçues, lot et fraîcheur.</DialogDescription>
          </DialogHeader>
          {largeDoc && (
            <ReceiptDetail
              large
              receipt={largeDoc}
              dlc={dlcMap[largeDoc.lot]}
              onDlcSaved={mergeDlc}
              incidents={byDoc.get(largeDoc.docEntry) ?? []}
              onIncidentChanged={reloadIncidents}
              onNumAtCardChange={updateNumAtCard}
              onModified={load}
              agreage={agreages[largeDoc.docEntry] ?? null}
              restricted={restricted}
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
  receipt, dlc, onDlcSaved, incidents, onIncidentChanged, onNumAtCardChange, onModified, large, onEnlarge,
  agreage, restricted = false,
}: {
  receipt: Receipt;
  /** DLC (ISO) du lot — `undefined` = pas encore chargée, `null` = non saisie. */
  dlc?: string | null;
  /** Remonte la DLC enregistrée pour mise à jour optimiste (batchNumber, ISO|null). */
  onDlcSaved?: (batchNumber: string, iso: string | null) => void;
  incidents: { id: string; type: string | null; note: string | null; resolved: boolean; createdAt: string; createdBy: string | null }[];
  onIncidentChanged: () => void;
  onNumAtCardChange: (docEntry: number, numAtCard: string) => void;
  /** Rafraîchit la liste après une annulation de réception. */
  onModified?: () => void | Promise<void>;
  /** Affichage agrandi (modale plein cadre) — textes et espacements plus grands. */
  large?: boolean;
  /** Ouvre l'affichage agrandi (visible seulement en mode normal). */
  onEnlarge?: () => void;
  /** Agréage posé à la réception CF → EM (null = EM directe, jamais agréée). */
  agreage?: AgreageInfo | null;
  /** Agréeur « pur » : aucun prix visible/éditable, ni retour ni annulation. */
  restricted?: boolean;
}) {
  const [declareOpen, setDeclareOpen] = useState(false);
  const [savingBl, setSavingBl] = useState(false);
  // Annulation de la réception (EM) — uniquement si non clôturée (pas facturée).
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Retour fournisseur (partiel/total) — colis à retourner par ligne.
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnQty, setReturnQty] = useState<Record<number, string>>({});
  const [returning, setReturning] = useState(false);
  const openReturn = () => {
    const init: Record<number, string> = {};
    receipt.lines.forEach((l) => { init[l.lineNum] = String(l.packageQuantity ?? l.pieceQuantity ?? 0); });
    setReturnQty(init);
    setReturnOpen(true);
  };
  const submitReturn = async () => {
    const lines = receipt.lines
      .map((l) => ({ lineNum: l.lineNum, packageQuantity: parseFloat(returnQty[l.lineNum] ?? "0") }))
      .filter((l) => Number.isFinite(l.packageQuantity) && l.packageQuantity > 0);
    if (lines.length === 0) { toast.error("Indique au moins une quantité à retourner."); return; }
    setReturning(true);
    try {
      const res = await fetch(`/api/sap/goods-receipts/${receipt.docEntry}/return`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { toast.error(j.error || "Retour impossible"); return; }
      toast.success(`Retour fournisseur #${j.docNum} créé depuis l'EM #${receipt.docNum}`);
      setReturnOpen(false);
      await onModified?.();
    } catch (e) { toast.error((e as Error).message); }
    finally { setReturning(false); }
  };
  const cancelReceipt = async () => {
    setCancelling(true);
    try {
      const res = await fetch("/api/sap/goods-receipts/cancel", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: receipt.docEntry }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { toast.error(j.error || "Annulation impossible"); return; }
      toast.success(`Entrée marchandise #${receipt.docNum} annulée — stock sorti`);
      setCancelConfirm(false);
      await onModified?.();
    } catch (e) { toast.error((e as Error).message); }
    finally { setCancelling(false); }
  };

  // Édition des PRIX (prix unitaire / total HT forcé) — la marchandise est entrée,
  // donc ni quantité ni article ne changent. ACTIVE PAR DÉFAUT, et chaque case
  // s'ENREGISTRE TOUTE SEULE quand on la quitte (blur) — pas de bouton.
  // L'agréeur « pur » ne voit ni ne modifie les prix (le serveur renvoie déjà
  // editable=false et des montants nuls — double garde ici).
  const canEditPrices = !restricted && receipt.editable !== false;
  const [priceEdits, setPriceEdits] = useState<PriceEdit[]>(() => toPriceEdits(receipt.lines));
  const [savingLines, setSavingLines] = useState<Set<number>>(new Set());
  const lastSaved = useRef<Map<number, string>>(new Map());
  useEffect(() => {
    const edits = toPriceEdits(receipt.lines);
    setPriceEdits(edits);
    lastSaved.current = new Map(edits.map((e) => [e.lineNum, sigOf(e)]));
  }, [receipt]);
  const updatePriceEdit = (i: number, patch: Partial<PriceEdit>) =>
    setPriceEdits((c) => c.map((e, k) => (k === i ? { ...e, ...patch } : e)));

  // Totaux LIVE (reflètent les saisies tant qu'on édite ; TVA estimée par ligne).
  const liveTotals = useMemo(() => {
    let ht = 0, tva = 0;
    receipt.lines.forEach((l, i) => {
      const e = priceEdits[i];
      const tot = (e ? emEffTotal(e) : (l.lineTotal ?? (l.price != null ? l.price * l.pieceQuantity : null))) ?? 0;
      ht += tot;
      tva += tot * ((l.taxPercent ?? 0) / 100);
    });
    return { ht: Math.round(ht * 100) / 100, tva: Math.round(tva * 100) / 100, ttc: Math.round((ht + tva) * 100) / 100 };
  }, [receipt.lines, priceEdits]);
  const totHT = canEditPrices ? liveTotals.ht : (receipt.totalHT ?? 0);
  const totTVA = canEditPrices ? liveTotals.tva : (receipt.totalTVA ?? 0);
  const totTTC = canEditPrices ? liveTotals.ttc : (receipt.totalTTC ?? receipt.total ?? 0);

  // Enregistre les prix quand on quitte une case.
  // ⚠️ SAP Service Layer : un PATCH DocumentLines partiel est appliqué de façon
  // POSITIONNELLE (la 1re ligne du tableau), pas par LineNum — envoyer une seule
  // ligne écrasait donc toujours la 1re ligne (bug « seul le 1er prix modifié »).
  // On transmet TOUT le jeu de lignes (ordre conservé + LineNum) : correct quelle
  // que soit l'interprétation (positionnelle OU par LineNum) du Service Layer.
  const saveLine = async (i: number) => {
    const e = priceEdits[i];
    if (!e || !canEditPrices) return;
    if (lastSaved.current.get(e.lineNum) === sigOf(e)) return;  // cette ligne inchangée → rien
    const allLines = priceEdits.map((pe) => pe.forceTotal
      ? { lineNum: pe.lineNum, lineTotal: pe.lineTotal === "" ? undefined : parseFloat(pe.lineTotal) }
      : { lineNum: pe.lineNum, price: pe.price === "" ? undefined : parseFloat(pe.price) });
    // Optimiste : marque TOUTES les lignes comme sauvées (le PATCH les couvre).
    const prevSigs = new Map(lastSaved.current);
    priceEdits.forEach((pe) => lastSaved.current.set(pe.lineNum, sigOf(pe)));
    setSavingLines((c) => new Set(c).add(e.lineNum));
    try {
      const res = await fetch(`/api/sap/goods-receipts/${receipt.docEntry}/modif`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: allLines }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { lastSaved.current = prevSigs; toast.error(j.error || "Erreur SAP"); return; }
    } catch (err) { lastSaved.current = prevSigs; toast.error((err as Error).message); }
    finally { setSavingLines((c) => { const n = new Set(c); n.delete(e.lineNum); return n; }); }
  };

  // ── DLC (fraîcheur) du lot — saisie/édition depuis le détail, sur la ligne ──
  // La DLC est unique par lot (« EM<docNum> ») : toutes les lignes du détail
  // pointent donc sur la même échéance. Saisie côté TeleVent (jamais SAP).
  const [dlcISO, setDlcISO] = useState<string | null | undefined>(dlc);
  const [savingDlc, setSavingDlc] = useState(false);
  const lastSavedDlc = useRef<string>(dlc ? dlc.slice(0, 10) : "");
  useEffect(() => {
    setDlcISO(dlc);
    lastSavedDlc.current = dlc ? dlc.slice(0, 10) : "";
  }, [dlc, receipt.docEntry]);
  const dlcInputValue = dlcISO ? dlcISO.slice(0, 10) : "";
  const saveDlc = async (value: string, itemCode: string) => {
    if (value === lastSavedDlc.current) return;                 // inchangé → rien
    setSavingDlc(true);
    try {
      const res = await fetch("/api/lots/dlc", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchNumber: receipt.lot, itemCode, expirationDate: value || null }),
      });
      const j = await res.json();
      if (!res.ok || j.ok === false) {
        // Échec (droits, réseau…) : on revient à la dernière valeur enregistrée.
        setDlcISO(lastSavedDlc.current ? new Date(lastSavedDlc.current).toISOString() : null);
        toast.error(j.error || "DLC non enregistrée");
        return;
      }
      const iso = value ? new Date(value).toISOString() : null;
      lastSavedDlc.current = value;
      setDlcISO(iso);
      onDlcSaved?.(receipt.lot, iso);
      toast.success(value ? `DLC du lot ${receipt.lot} enregistrée` : `DLC du lot ${receipt.lot} effacée`);
    } catch (e) {
      setDlcISO(lastSavedDlc.current ? new Date(lastSavedDlc.current).toISOString() : null);
      toast.error((e as Error).message);
    } finally { setSavingDlc(false); }
  };

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

      {/* Bandeau d'annulation — l'EM n'est plus un stock entré « vivant » */}
      {receipt.isCancellation && (
        <div className="flex items-start gap-2 rounded-lg border border-slate-400/40 bg-slate-500/10 px-3 py-2 text-[12.5px] text-slate-700 dark:text-slate-200">
          <Ban className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            <b>Document d&apos;annulation</b>
            {receipt.cancelsDocNum ? <> de la réception <span className="font-mono"># {receipt.cancelsDocNum}</span></> : null} —
            il inverse le stock entré. Ce n&apos;est pas une nouvelle entrée.
          </span>
        </div>
      )}
      {receipt.cancelled && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-200">
          <Ban className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            <b>Réception annulée</b>
            {receipt.cancelledByDocNum ? <> par l&apos;annulation <span className="font-mono"># {receipt.cancelledByDocNum}</span></> : null} —
            le stock entré a été ressorti.
          </span>
        </div>
      )}


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
                {!restricted && (
                  <div className="text-right shrink-0">
                    {canEditPrices && priceEdits[i] ? (
                      <NumberInput value={emEffTotal(priceEdits[i])} onValueChange={(n) => updatePriceEdit(i, { lineTotal: n == null ? "" : String(n), forceTotal: n != null })} onBlur={() => saveLine(i)} min={0} step={0.01} decimals={2} allowEmpty placeholder="Total HT" className={`h-9 w-28 text-right ${priceEdits[i].forceTotal ? "ring-1 ring-amber-400" : ""}`} />
                    ) : (
                      <>
                        <div className="text-[15px] font-bold tnum text-foreground">{lineHT != null ? eur(lineHT) : "—"}</div>
                        <div className="text-[11px] text-muted-foreground">HT</div>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2 text-[13px] text-muted-foreground tnum">
                <span className="text-foreground font-medium">{fmtColis(l.packageQuantity)} colis</span>
                {!restricted && <span>·</span>}
                {!restricted && (canEditPrices && priceEdits[i] ? (
                  <span className="inline-flex items-center gap-1">PU <NumberInput value={emEffPU(priceEdits[i])} onValueChange={(n) => updatePriceEdit(i, { price: n == null ? "" : String(n), forceTotal: false, lineTotal: "" })} onBlur={() => saveLine(i)} min={0} step={0.01} decimals={2} allowEmpty placeholder="—" className="h-8 w-20 text-right" /></span>
                ) : (
                  <span>PU {l.price != null ? eur(l.price) : "—"}</span>
                ))}
              </div>
              {/* DLC (fraîcheur) du lot — sur la ligne, éditable */}
              <div className="flex items-center gap-2 mt-2 text-[13px]">
                <span className="text-muted-foreground shrink-0">DLC</span>
                <input
                  type="date"
                  value={dlcInputValue}
                  onChange={(e) => setDlcISO(e.target.value ? new Date(e.target.value).toISOString() : null)}
                  onBlur={(e) => saveDlc(e.target.value, l.itemCode)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-[12px] tnum focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                />
                <FreshnessBadge dlc={dlcISO} />
                {savingDlc && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>
            </div>
          );
        })}
        {!restricted && (
          <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1.5">
            <div className="flex justify-between text-[14px]"><span className="text-muted-foreground">Total HT</span><span className="font-semibold tnum">{eur(totHT)}</span></div>
            <div className="flex justify-between text-[14px]"><span className="text-muted-foreground">TVA</span><span className="tnum text-muted-foreground">{eur(totTVA)}</span></div>
            <div className="flex justify-between text-[16px] border-t border-border pt-1.5"><span className="font-semibold text-foreground">Total TTC</span><span className="font-bold tnum text-foreground">{eur(totTTC)}</span></div>
          </div>
        )}
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
              <th className={`text-left font-semibold w-40 ${th}`}>DLC</th>
              {!restricted && <th className={`text-right font-semibold w-24 ${th}`}>PU HT</th>}
              {!restricted && <th className={`text-right font-semibold w-24 ${th}`}>Total HT</th>}
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
                  <td className={td}>
                    {/* DLC (fraîcheur) du lot — sur la ligne, éditable */}
                    <div className="flex items-center gap-1.5">
                      <input
                        type="date"
                        value={dlcInputValue}
                        onChange={(e) => setDlcISO(e.target.value ? new Date(e.target.value).toISOString() : null)}
                        onBlur={(e) => saveDlc(e.target.value, l.itemCode)}
                        className="h-8 rounded-md border border-input bg-background px-2 text-[12px] tnum focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                      />
                      {savingDlc
                        ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
                        : <FreshnessBadge dlc={dlcISO} className="shrink-0" />}
                    </div>
                  </td>
                  {!restricted && (
                    <td className={`text-right tnum ${td}`}>
                      {canEditPrices && priceEdits[i] ? (
                        <NumberInput value={emEffPU(priceEdits[i])} onValueChange={(n) => updatePriceEdit(i, { price: n == null ? "" : String(n), forceTotal: false, lineTotal: "" })} onBlur={() => saveLine(i)} min={0} step={0.01} decimals={2} allowEmpty placeholder="—" className="h-8 w-24 text-right" />
                      ) : (l.price != null ? eur(l.price) : "—")}
                    </td>
                  )}
                  {!restricted && (
                    <td className={`text-right tnum font-medium ${td}`}>
                      {canEditPrices && priceEdits[i] ? (
                        <span className="inline-flex items-center justify-end gap-1">
                          {savingLines.has(priceEdits[i].lineNum) && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                          <NumberInput value={emEffTotal(priceEdits[i])} onValueChange={(n) => updatePriceEdit(i, { lineTotal: n == null ? "" : String(n), forceTotal: n != null })} onBlur={() => saveLine(i)} min={0} step={0.01} decimals={2} allowEmpty placeholder="—" className={`h-8 w-24 text-right ${priceEdits[i].forceTotal ? "ring-1 ring-amber-400" : ""}`} />
                        </span>
                      ) : (lineHT != null ? eur(lineHT) : "—")}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {!restricted && (
            <tfoot>
              <tr className="border-t border-border bg-secondary/30">
                <td colSpan={8} className={`text-right uppercase tracking-wide font-semibold text-muted-foreground ${td} ${totLbl}`}>Total HT</td>
                <td colSpan={2} className={`text-right tnum font-semibold text-foreground ${td} ${totVal}`}>{eur(totHT)}</td>
              </tr>
              <tr className="bg-secondary/20">
                <td colSpan={8} className={`text-right uppercase tracking-wide font-semibold text-muted-foreground ${td} ${totLbl}`}>TVA</td>
                <td colSpan={2} className={`text-right tnum text-muted-foreground ${td}`}>{eur(totTVA)}</td>
              </tr>
              <tr className="bg-secondary/30 border-t border-border">
                <td colSpan={8} className={`text-right uppercase tracking-wide font-semibold text-muted-foreground ${td} ${totLbl}`}>Total TTC</td>
                <td colSpan={2} className={`text-right tnum font-bold text-foreground ${td} ${totVal}`}>{eur(totTTC)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Agréage (posé à la réception CF → EM — affichage seul ici) ── */}
      {!isVoided(receipt) && agreage && (
        <div className="rounded-xl border border-border bg-secondary/20 p-3 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <AgreageBadge a={agreage} />
            <span className={`${large ? "text-[12.5px]" : "text-[11px]"} text-muted-foreground`}>
              Par {agreage.by} · {fmtDateHeure(agreage.at)}
            </span>
          </div>
          {agreage.note && (
            <p className={`${large ? "text-[13px]" : "text-[12px]"} text-foreground`}>« {agreage.note} »</p>
          )}
        </div>
      )}

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

      {/* Actions : déclarer un incident · annuler la réception */}
      {declareOpen ? (
        <InlineIncidentDeclare
          receipt={{ docEntry: receipt.docEntry, docNum: receipt.docNum, lot: receipt.lot, cardCode: receipt.cardCode, cardName: receipt.cardName }}
          onCreated={() => { setDeclareOpen(false); onIncidentChanged(); }}
        />
      ) : (
        <div className="space-y-1.5">
          {/* Actions rapides : 3 icônes sur une seule ligne (sans libellé) —
              incident · retour fournisseur · annulation. Compact pour le mobile. */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="icon"
              title="Déclarer un incident" aria-label="Déclarer un incident"
              onClick={() => setDeclareOpen(true)}
            >
              <AlertTriangle className="text-amber-500" />
            </Button>
            {/* Retour fournisseur (partiel/total) — geste de gestion (sortie de stock,
                base d'avoir) : masqué pour l'agréeur, et pas sur une EM annulée. */}
            {!restricted && !isVoided(receipt) && (
              <Button
                variant="outline" size="icon"
                title="Retour fournisseur" aria-label="Retour fournisseur"
                onClick={openReturn}
              >
                <Undo2 className="text-sky-600 dark:text-sky-400" />
              </Button>
            )}
            {/* Annuler la réception (sort le stock entré) — uniquement le JOUR de la
                réception (limite SAP), si l'EM n'est pas clôturée (facturée) ni déjà
                annulée. Sinon, c'est le « Retour fournisseur » qui s'applique. */}
            {canEditPrices && !isVoided(receipt) && isToday(receipt.docDate) && (
              !cancelConfirm ? (
                <Button
                  variant="outline" size="icon"
                  title="Annuler la réception" aria-label="Annuler la réception"
                  onClick={() => setCancelConfirm(true)}
                  className="text-rose-600 dark:text-rose-400 hover:text-rose-700 border-rose-300/60 dark:border-rose-500/30"
                >
                  <Ban />
                </Button>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span className={`${big ? "text-[13.5px]" : "text-[12.5px]"} text-foreground`}>
                    Annuler l&apos;entrée # {receipt.docNum} ? Le stock entré sera sorti.
                  </span>
                  <button type="button" onClick={cancelReceipt} disabled={cancelling}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[12.5px] font-semibold disabled:opacity-60">
                    {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Confirmer
                  </button>
                  <button type="button" onClick={() => setCancelConfirm(false)} disabled={cancelling}
                    className="inline-flex items-center h-8 px-3 rounded-lg border border-border text-[12.5px] font-medium text-muted-foreground hover:text-foreground">
                    Non
                  </button>
                </span>
              )
            )}
          </div>
          {/* Hors jour de réception : l'annulation SAP n'est plus possible → on
              l'explique sous les icônes (le retour fournisseur prend le relais). */}
          {canEditPrices && !isVoided(receipt) && !isToday(receipt.docDate) && (
            <p className="text-[11px] text-muted-foreground/70 italic">
              Annulation possible le jour de la réception uniquement — sinon, utilise le retour fournisseur.
            </p>
          )}
        </div>
      )}

      {/* Panneau RETOUR FOURNISSEUR — colis à retourner par ligne (défaut = reçu) */}
      {returnOpen && (
        <div className="rounded-xl border border-sky-400/50 bg-sky-50/60 dark:bg-sky-950/20 p-3 space-y-2.5">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <Undo2 className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            Retour fournisseur — entrée # {receipt.docNum}
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            Choisis le nombre de colis à retourner par ligne (0 = ne pas retourner). SAP crée un
            retour qui <b>sort le stock</b> et sert de base à un avoir fournisseur.
          </p>
          <ul className="space-y-2.5">
            {receipt.lines.map((l) => {
              const maxQ = l.packageQuantity ?? l.pieceQuantity ?? 0;
              const unit = l.packageQuantity != null ? "colis" : "pièces";
              // Désignation décomposée (fruit + tags) — même lecture que le détail.
              const dz = designationProduit({ itemName: l.itemName, uPays: l.uPays, uMarque: l.uMarque, uCondi: l.uCondi, frgnName: l.frgnName });
              return (
                <li key={l.lineNum} className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-foreground leading-tight">{dz.fruit}</div>
                    <DesignationChips marque={dz.marque} condt={dz.condt} calibre={dz.variete} pays={dz.pays} className="mt-1" />
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <NumberInput
                      value={returnQty[l.lineNum] === "" || returnQty[l.lineNum] == null ? null : parseFloat(returnQty[l.lineNum])}
                      onValueChange={(n) => setReturnQty((c) => ({ ...c, [l.lineNum]: n == null ? "" : String(n) }))}
                      min={0} max={maxQ} step={1} decimals={2} allowEmpty placeholder="0"
                      className="h-9 w-20 text-right"
                    />
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">reçu {fmtColis(maxQ)} {unit}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-2 pt-0.5">
            <button type="button" onClick={submitReturn} disabled={returning}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[13px] font-semibold disabled:opacity-60">
              {returning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Créer le retour
            </button>
            <button type="button" onClick={() => setReturnOpen(false)} disabled={returning}
              className="inline-flex items-center h-9 px-4 rounded-lg border border-border text-[13px] font-medium text-muted-foreground hover:text-foreground">
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
