"use client";

/**
 * ONGLET « BONS DE COMMANDE » — affectation MANUELLE des lots.
 *
 * Les commandes créées en « bon de commande » (choix explicite, précommande, ou
 * export) partent SANS lot auto : chaque ligne est en EM_PENDING. Ici on choisit,
 * par article, le lot (arrivage EM) réellement en stock → PATCH U_NoLot sur la
 * commande SAP. Quand toutes les lignes ont un lot, la commande sort de l'onglet.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  PackageCheck, ChevronDown, RefreshCw, Loader2, CheckCircle2, Sparkles,
  CalendarDays, AlertTriangle, Grape, FileText, ArrowRightCircle, Clock, Trash2, Hash, Pencil, Star, Truck,
} from "lucide-react";
import { toast } from "sonner";
import { formatDeliveryDate } from "@/lib/livraison";
import { displayPersonName } from "@/lib/userNames";
import { broadcastActiveClient } from "@/lib/consoleSync";
import { DesignationChips } from "@/components/entrees/DesignationChips";
import { FRUIT_FAMILIES } from "@/lib/familles";
import { familyLotSentinel, familyOfLot } from "@/lib/gervifrais-calc";

const FAMILY_LABEL = new Map(FRUIT_FAMILIES.map((f) => [f.key, f.label]));

interface LotCandidate {
  lot: string; docNum: number; warehouse: string | null; affect: string;
  date?: string | null; supplier?: string | null; label?: string;
}
interface FamilyTarget { key: string; label: string }
interface BonLine {
  itemCode: string; itemName: string; quantity: number; colis: number;
  warehouse: string | null; marque: string | null; condt: string | null; pays: string | null;
  variete: string | null; uvc: string | null; calibre: string | null;
  lot: string; pending: boolean; candidates: LotCandidate[]; suggested: string | null;
  /** Tag « produit » à préciser plus tard (fruit) — rappel, pas d'auto-affectation. */
  familyTarget: FamilyTarget | null;
}
interface BonDoc {
  docEntry: number; docNum: number; cardCode: string; cardName: string;
  clientType: string | null; dueDate: string | null; docDate: string | null; open: boolean;
  markedBy: string | null; markedAt: string | null; pendingCount: number; lines: BonLine[];
}
interface OffreLine { itemCode: string; itemName: string; colis: number }
/** OFFRE CLIENT (Quotation SAP) = précommande en attente d'être passée en commande. */
interface OffreDoc {
  docEntry: number; docNum: number; cardCode: string; cardName: string;
  clientType: string | null; dueDate: string | null; docDate: string | null;
  numAtCard: string | null;
  /** true = jour de départ atteint → à passer en commande maintenant. */
  due: boolean; lineCount: number; colis: number; lines: OffreLine[];
}

const AFFECT_LABEL: Record<string, string> = { TOUS: "Tous", EXPORT: "Export", GMS: "GMS", CHR: "CHR" };
const PENDING = "EM_PENDING";
const SEG_BADGE: Record<string, string> = {
  CHR: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  GMS: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  EXPORT: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
};

export function BonsCommandePanel() {
  const router = useRouter();
  const [docs, setDocs] = useState<BonDoc[] | null>(null);
  const [offres, setOffres] = useState<OffreDoc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [busyLine, setBusyLine] = useState<string | null>(null); // `${docEntry}:${itemCode}`
  const [convertingId, setConvertingId] = useState<number | null>(null); // offre en cours de passage
  const [deletingId, setDeletingId] = useState<number | null>(null); // offre en cours de suppression
  const [modifBusy, setModifBusy] = useState<number | null>(null); // docEntry en cours d'ouverture

  // « Modifier la commande » : ouvre le bon dans la console (Écran 2), pilotée par
  // le STOCK — on peut y changer les articles/quantités pour garantir des lots
  // réellement disponibles, puis réenregistrer sur ce même bon. On résout le
  // client (CardCode → id télévente) puis on diffuse la cible de modif (miroir
  // localStorage, lu au chargement de l'Écran 2) avant de naviguer.
  const startModif = useCallback(async (doc: BonDoc) => {
    setModifBusy(doc.docEntry);
    try {
      const r = await fetch(`/api/clients/resolve?code=${encodeURIComponent(doc.cardCode)}`);
      const j = await r.json().catch(() => null);
      if (!j?.id) {
        toast.error("Client introuvable en télévente — modification impossible depuis ici.");
        return;
      }
      broadcastActiveClient({
        clientId: j.id, clientName: doc.cardName, stockSharePct: 100, client: null,
        modif: { docEntry: doc.docEntry, docNum: doc.docNum },
      });
      router.push("/console/ecran2");
    } catch {
      toast.error("Échec du chargement de la modification.");
    } finally {
      setModifBusy(null);
    }
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/bons-commande", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      setDocs(j?.ok ? (j.docs ?? []) : []);
      setOffres(j?.ok ? (j.offres ?? []) : []);
    } catch {
      setDocs((prev) => prev ?? []);
      setOffres((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Affecte un lot à toutes les lignes d'un article d'une commande (PATCH SAP).
  const assignLot = useCallback(async (doc: BonDoc, itemCode: string, lot: string): Promise<boolean> => {
    if (!lot) return false;
    const key = `${doc.docEntry}:${itemCode}`;
    setBusyLine(key);
    // Optimiste : la ligne prend le lot. « pending » si on repose EM_PENDING (à
    // découvert) OU un tag famille EM_FAM:<fruit> (produit à préciser plus tard).
    const famKey = familyOfLot(lot);
    const famTarget = famKey && FAMILY_LABEL.has(famKey) ? { key: famKey, label: FAMILY_LABEL.get(famKey)! } : null;
    const nowPending = lot === PENDING || famTarget !== null;
    setDocs((prev) => prev?.map((d) => {
      if (d.docEntry !== doc.docEntry) return d;
      const lines = d.lines.map((l) => l.itemCode === itemCode
        ? { ...l, lot, pending: nowPending, familyTarget: famTarget }
        : l);
      return { ...d, lines, pendingCount: lines.filter((l) => l.pending).length };
    }) ?? prev);
    try {
      const r = await fetch("/api/bons-commande", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, itemCode, lot }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Échec de l'affectation du lot"); load(); return false; }
      if (j.cleared) {
        // Toutes les lignes affectées → la commande quitte l'onglet.
        setDocs((prev) => prev?.filter((d) => d.docEntry !== doc.docEntry) ?? prev);
        toast.success(`✅ Commande #${doc.docNum} — tous les lots affectés`);
      }
      return true;
    } catch {
      toast.error("SAP injoignable — lot non enregistré"); load(); return false;
    } finally {
      setBusyLine(null);
    }
  }, [load]);

  // Remplit les lignes en attente avec la suggestion (EM du segment, sinon à
  // découvert). On NE touche PAS aux lignes taguées « produit » (fruit) : ce tag
  // est un rappel manuel explicite, à résoudre à la main.
  const suggestAll = useCallback(async (doc: BonDoc) => {
    const pend = doc.lines.filter((l) => l.pending && !l.familyTarget);
    for (const l of pend) {
      const ok = await assignLot(doc, l.itemCode, l.suggested ?? PENDING);
      if (!ok) break;
    }
  }, [assignLot]);

  // « Passer en commande » : convertit une OFFRE CLIENT (Quotation) en COMMANDE
  // (Order) SAP. La commande créée rejoint la file d'affectation des lots.
  const convertOffre = useCallback(async (offre: OffreDoc) => {
    setConvertingId(offre.docEntry);
    try {
      const r = await fetch("/api/bons-commande", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "convert", docEntry: offre.docEntry }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Échec du passage en commande"); return; }
      setOffres((prev) => prev?.filter((o) => o.docEntry !== offre.docEntry) ?? prev);
      toast.success(`✅ Offre #${offre.docNum} passée en commande #${j.docNum} — lots à affecter`);
      load();  // la nouvelle commande apparaît dans la file des lots ci-dessous
    } catch {
      toast.error("SAP injoignable — offre non convertie");
    } finally {
      setConvertingId(null);
    }
  }, [load]);

  // Modifie une offre (date de livraison et/ou n° de commande) côté SAP.
  const saveOffre = useCallback(async (offre: OffreDoc, patch: { dueDate?: string; numAtCard?: string }) => {
    // Optimiste : reflète le changement tout de suite.
    setOffres((prev) => prev?.map((o) => o.docEntry === offre.docEntry ? { ...o, ...patch } : o) ?? prev);
    try {
      const r = await fetch("/api/bons-commande", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", docEntry: offre.docEntry, ...patch }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Échec de la mise à jour de l'offre"); load(); return; }
      // Changer la date peut changer le « jour de départ » (pastille/tri) → recharge.
      if (patch.dueDate !== undefined) load();
    } catch {
      toast.error("SAP injoignable — offre non modifiée"); load();
    }
  }, [load]);

  // Supprime une offre (Quotation) dans SAP.
  const deleteOffre = useCallback(async (offre: OffreDoc) => {
    if (!window.confirm(`Supprimer l'offre n°${offre.docNum} de ${offre.cardName} ? Cette action est définitive.`)) return;
    setDeletingId(offre.docEntry);
    try {
      const r = await fetch("/api/bons-commande", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", docEntry: offre.docEntry }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Échec de la suppression de l'offre"); return; }
      setOffres((prev) => prev?.filter((o) => o.docEntry !== offre.docEntry) ?? prev);
      toast.success(`Offre n°${offre.docNum} supprimée`);
    } catch {
      toast.error("SAP injoignable — offre non supprimée");
    } finally {
      setDeletingId(null);
    }
  }, []);

  const count = docs?.length ?? 0;
  const dueCount = (offres ?? []).filter((o) => o.due).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted-foreground">
          {docs === null ? "Chargement…"
            : count === 0 ? "Aucune commande en attente de lot."
            : `${count} commande${count > 1 ? "s" : ""} à traiter : choisis, par article, le lot réellement en stock.`}
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60 shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      </div>

      {/* ── OFFRES CLIENT (précommandes) à passer en commande ────────── */}
      {offres !== null && offres.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="h-4 w-4 text-brand-500 shrink-0" />
            <h2 className="text-[13px] font-semibold text-foreground">Offres client — à passer en commande</h2>
            {dueCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-700 dark:text-amber-300">
                {dueCount} à passer
              </span>
            )}
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            Une précommande crée une <b>offre client</b> (devis SAP), pas une commande engagée. Au <b>jour de départ</b>,
            passe-la en commande : elle rejoint alors la file d&apos;affectation des lots ci-dessous.
          </p>
          <ul className="space-y-2">
            {offres.map((o) => {
              const converting = convertingId === o.docEntry;
              const deleting = deletingId === o.docEntry;
              const busy = converting || deleting;
              return (
                <li
                  key={o.docEntry}
                  className={`rounded-xl border px-3 sm:px-4 py-2.5 flex flex-col sm:flex-row sm:items-start gap-2 ${
                    o.due ? "border-amber-400/60 bg-amber-50/40 dark:bg-amber-950/15" : "border-border bg-card"
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13.5px] font-semibold text-foreground truncate">{o.cardName}</span>
                      {o.clientType && SEG_BADGE[o.clientType] && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide ${SEG_BADGE[o.clientType]}`}>
                          {o.clientType}
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">offre n°{o.docNum}</span>
                      <span className="text-[11px] text-muted-foreground tnum">· {o.lineCount} ligne{o.lineCount > 1 ? "s" : ""} · {o.colis} colis</span>
                    </div>
                    {/* Date de livraison + n° de commande éditables */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Date de livraison">
                        <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                        <input
                          type="date"
                          defaultValue={o.dueDate ?? ""}
                          disabled={busy}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== o.dueDate) saveOffre(o, { dueDate: v });
                          }}
                          aria-label={`Date de livraison de l'offre n°${o.docNum}`}
                          className="h-8 rounded-lg border border-border bg-card px-2 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
                        />
                      </label>
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" title="N° de commande client">
                        <Hash className="h-3.5 w-3.5 shrink-0" />
                        <input
                          type="text"
                          defaultValue={o.numAtCard ?? ""}
                          disabled={busy}
                          placeholder="N° commande"
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== (o.numAtCard ?? "")) saveOffre(o, { numAtCard: v });
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          aria-label={`N° de commande de l'offre n°${o.docNum}`}
                          className="h-8 w-[130px] rounded-lg border border-border bg-card px-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2 self-end sm:self-auto">
                    {o.due
                      ? <span className="hidden sm:inline-flex items-center gap-1 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300"><Clock className="h-3.5 w-3.5" /> jour de départ</span>
                      : <span className="hidden sm:inline-flex items-center gap-1 text-[10.5px] text-muted-foreground"><Clock className="h-3.5 w-3.5" /> en attente</span>}
                    <button
                      type="button"
                      onClick={() => convertOffre(o)}
                      disabled={busy}
                      title="Créer la commande client SAP à partir de cette offre (lots à affecter ensuite)"
                      className={`inline-flex items-center gap-1.5 h-10 sm:h-9 px-3.5 rounded-xl text-[12.5px] font-semibold transition-colors disabled:opacity-50 ${
                        o.due ? "bg-brand-600 hover:bg-brand-700 text-white" : "border border-border text-foreground hover:bg-secondary/60"
                      }`}
                    >
                      {converting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightCircle className="h-4 w-4" />}
                      Passer en commande
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteOffre(o)}
                      disabled={busy}
                      title="Supprimer l'offre"
                      aria-label={`Supprimer l'offre n°${o.docNum}`}
                      className="inline-flex h-10 sm:h-9 w-10 sm:w-9 items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors disabled:opacity-50"
                    >
                      {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {docs !== null && count === 0 && (offres?.length ?? 0) === 0 && (
        <div className="flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-border bg-card py-14 px-6">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 mb-3">
            <CheckCircle2 className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <p className="text-[14px] font-semibold text-foreground">Tous les lots sont affectés</p>
          <p className="text-[12.5px] text-muted-foreground mt-1 max-w-sm">
            Les bons de commande (précommandes, export, choix manuel) apparaissent ici tant qu&apos;il reste
            un lot à affecter. Rien en attente pour l&apos;instant.
          </p>
        </div>
      )}

      {(docs ?? []).map((doc) => {
        const isCollapsed = collapsed.has(doc.docEntry);
        const missing = doc.pendingCount;
        const ready = missing === 0;
        return (
          <section key={doc.docEntry} className="rounded-2xl border border-border bg-card overflow-hidden">
            <div
              role="button" tabIndex={0}
              onClick={() => setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(doc.docEntry)) next.delete(doc.docEntry); else next.add(doc.docEntry);
                return next;
              })}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
              className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 bg-secondary/20 hover:bg-secondary/40 cursor-pointer select-none transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                <span className="text-[14.5px] sm:text-[13.5px] font-semibold text-foreground truncate">{doc.cardName}</span>
                {doc.clientType && SEG_BADGE[doc.clientType] && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide ${SEG_BADGE[doc.clientType]}`}>
                    {doc.clientType}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">BL n°{doc.docNum}</span>
                {doc.dueDate && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <CalendarDays className="h-3 w-3" /> {formatDeliveryDate(doc.dueDate)}
                  </span>
                )}
              </div>
              <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                ready ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              }`}>
                {ready ? <><CheckCircle2 className="h-3 w-3" /> Lots complets</> : `${missing} lot${missing > 1 ? "s" : ""} à affecter`}
              </span>
            </div>

            {!isCollapsed && (
              <div className="px-4 sm:px-5 py-3 space-y-3">
                <ul className="divide-y divide-border/50 rounded-xl border border-border overflow-hidden">
                  {doc.lines.map((l) => {
                    const key = `${doc.docEntry}:${l.itemCode}`;
                    const isBusy = busyLine === key;
                    // Valeur sélectionnée : tag famille (EM_FAM:…) prioritaire, sinon
                    // vrai lot, sinon vide (à découvert générique).
                    const current = l.familyTarget
                      ? familyLotSentinel(l.familyTarget.key)
                      : l.pending ? "" : l.lot;
                    return (
                      <li key={l.itemCode} className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-[14px] sm:text-[13px] font-semibold sm:font-medium text-foreground truncate">{l.itemName}</span>
                            <span className="text-[11.5px] text-muted-foreground tnum shrink-0">
                              {l.colis} colis{l.warehouse ? ` · mag. ${l.warehouse}` : ""}
                            </span>
                            {l.familyTarget && (
                              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300 shrink-0">
                                <Grape className="h-3 w-3" /> {l.familyTarget.label} — à préciser
                              </span>
                            )}
                          </div>
                          <DesignationChips marque={l.marque} condt={l.condt} pays={l.pays} size="md" className="mt-1" />
                        </div>
                        <LotCell line={l} current={current} isBusy={isBusy} onPick={(v) => assignLot(doc, l.itemCode, v)} />
                      </li>
                    );
                  })}
                </ul>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => suggestAll(doc)}
                    disabled={ready || busyLine !== null}
                    title="Affecter la suggestion (arrivage du segment, sinon à découvert) à chaque ligne en attente"
                    className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-border text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" /> Suggérer les lots
                  </button>
                  {/* Ouvre le bon dans la console (pilotée par le stock) pour
                      changer les articles/quantités et garantir des lots dispo. */}
                  <button
                    type="button"
                    onClick={() => startModif(doc)}
                    disabled={modifBusy === doc.docEntry}
                    title="Modifier la commande dans la console (stock en direct) : changer les articles/quantités pour garantir les lots disponibles"
                    className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-brand-500/40 text-brand-600 dark:text-brand-400 text-[12.5px] font-semibold hover:bg-brand-500/10 transition-colors disabled:opacity-50"
                  >
                    {modifBusy === doc.docEntry ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />} Modifier la commande
                  </button>
                  {doc.markedBy && (
                    <span className="text-[11px] text-muted-foreground ml-auto">Créé par {displayPersonName(doc.markedBy)}</span>
                  )}
                </div>
              </div>
            )}
          </section>
        );
      })}

      {docs === null && (
        <div className="flex items-center gap-2 px-5 py-4 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement des bons de commande…
        </div>
      )}
    </div>
  );
}

/* ── Cellule d'affectation d'un lot ──────────────────────────────────────────
   Menu déroulant PERSONNALISÉ (porté en portail → jamais rogné par la carte). En
   SURVOLANT une EM dans la liste, le PIED du menu affiche le CODE ARTICLE + tout
   le détail (marque · conditionnement · calibre · variété · origine) et la
   réception de cette EM (date · fournisseur · magasin · affectation). Cliquer une
   entrée l'affecte. ──────────────────────────────────────────────────────── */
function LotCell({ line, current, isBusy, onPick }: {
  line: BonLine; current: string; isBusy: boolean; onPick: (v: string) => void;
}) {
  const opts = line.candidates ?? [];
  const showRawCurrent = !line.familyTarget && !line.pending && !!current && !opts.some((c) => c.lot === current);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<LotCandidate | null>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const el = triggerRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 288);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const above = (window.innerHeight - r.bottom) < 360 && r.top > 360;   // ouvre vers le haut si peu de place en bas
    setPos(above ? { left, width, bottom: window.innerHeight - r.top + 6 } : { left, width, top: r.bottom + 6 });
  };
  const openMenu = () => { if (isBusy) return; place(); setOpen(true); };
  const closeMenu = () => { setOpen(false); setHovered(null); };
  const pick = (v: string) => { onPick(v); closeMenu(); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    const reflow = () => place();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
    };
  }, [open]);

  const fmtDate = (d?: string | null) => {
    if (!d) return null;
    const [y, m, day] = d.split("-");
    return day && m && y ? `${day}/${m}/${y}` : null;
  };
  const chips = ([
    line.marque && ["bg-violet-100 text-violet-800 dark:bg-violet-500/30 dark:text-violet-100", line.marque],
    line.condt && ["bg-sky-100 text-sky-800 dark:bg-sky-500/30 dark:text-sky-100", line.condt],
    line.uvc && !line.condt && ["bg-sky-100 text-sky-800 dark:bg-sky-500/30 dark:text-sky-100", line.uvc],
    line.calibre && ["bg-teal-100 text-teal-800 dark:bg-teal-500/30 dark:text-teal-100", `cal. ${line.calibre}`],
    line.variete && ["bg-rose-100 text-rose-800 dark:bg-rose-500/30 dark:text-rose-100", line.variete],
    line.pays && ["bg-amber-100 text-amber-800 dark:bg-amber-500/30 dark:text-amber-100", line.pays],
  ].filter(Boolean)) as [string, string][];

  const curCand = opts.find((c) => c.lot === current);
  const triggerLabel = line.familyTarget ? `🍓 ${line.familyTarget.label} — à préciser`
    : current === PENDING ? "À découvert — arrivage à venir"
    : curCand ? `${curCand.lot} · ${AFFECT_LABEL[curCand.affect] ?? curCand.affect}`
    : showRawCurrent ? current
    : "Choisir le lot…";
  const borderCls = line.familyTarget ? "border-violet-400/60 text-violet-700 dark:text-violet-300"
    : line.pending ? "border-amber-400/60 text-amber-700 dark:text-amber-300"
    : "border-border text-foreground";

  const emRows = [
    ...(line.suggested ? [{ c: opts.find((x) => x.lot === line.suggested) ?? ({ lot: line.suggested, docNum: 0, warehouse: null, affect: "TOUS" } as LotCandidate), sug: true }] : []),
    ...opts.filter((c) => c.lot !== line.suggested).map((c) => ({ c, sug: false })),
  ];
  const hd = hovered ? fmtDate(hovered.date) : null;

  return (
    <div className="shrink-0 sm:w-[320px] flex items-center gap-2">
      {line.familyTarget
        ? <Grape className="h-4 w-4 text-violet-500 shrink-0" />
        : line.pending
        ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        : <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />}
      <button
        ref={triggerRef}
        type="button"
        disabled={isBusy}
        onClick={() => (open ? closeMenu() : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Lot de ${line.itemName}`}
        className={`h-11 sm:h-9 w-full rounded-lg border bg-card px-2.5 flex items-center justify-between gap-1.5 text-left text-[13px] sm:text-[12.5px] font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60 ${borderCls}`}
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {isBusy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}

      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
          className="z-[100] rounded-xl border border-border bg-card shadow-modal overflow-hidden flex flex-col max-h-[70vh] animate-fade-up"
        >
          <div className="overflow-y-auto py-1 min-h-0" onMouseLeave={() => setHovered(null)}>
            <button type="button" onMouseEnter={() => setHovered(null)} onClick={() => pick("")}
              className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-secondary/60 ${current === "" ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
              Choisir le lot…
            </button>
            {emRows.map(({ c, sug }) => (
              <button key={c.lot} type="button" onMouseEnter={() => setHovered(c)} onClick={() => pick(c.lot)}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-1.5 text-[12.5px] hover:bg-secondary/60 ${current === c.lot ? "bg-brand-500/10 font-semibold" : "text-foreground"}`}>
                {sug && <Star className="h-3 w-3 text-amber-500 fill-amber-400 shrink-0" />}
                <span className="font-semibold text-foreground">{c.lot}</span>
                {sug && <span className="text-[10px] text-amber-600 dark:text-amber-400">suggéré</span>}
                <span className="text-[10px] px-1 py-px rounded bg-secondary text-muted-foreground">{AFFECT_LABEL[c.affect] ?? c.affect}</span>
                {c.warehouse && <span className="text-[10.5px] text-muted-foreground ml-auto">mag. {c.warehouse}</span>}
              </button>
            ))}
            {showRawCurrent && (
              <button type="button" onMouseEnter={() => setHovered(null)} onClick={() => pick(current)}
                className="w-full text-left px-3 py-1.5 text-[12.5px] bg-brand-500/10 font-semibold text-foreground">
                {current}
              </button>
            )}
            <div className="my-1 border-t border-border/60" />
            <p className="px-3 pb-0.5 text-[9.5px] uppercase tracking-wider text-muted-foreground font-semibold">Attendre un fruit</p>
            {FRUIT_FAMILIES.map((f) => {
              const v = familyLotSentinel(f.key);
              return (
                <button key={f.key} type="button" onMouseEnter={() => setHovered(null)} onClick={() => pick(v)}
                  className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-secondary/60 ${current === v ? "bg-violet-500/10 font-semibold text-violet-700 dark:text-violet-300" : "text-foreground"}`}>
                  🍓 {f.label} — à préciser
                </button>
              );
            })}
            <div className="my-1 border-t border-border/60" />
            <button type="button" onMouseEnter={() => setHovered(null)} onClick={() => pick(PENDING)}
              className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-secondary/60 ${current === PENDING ? "bg-amber-500/10 font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
              À découvert — arrivage à venir
            </button>
          </div>

          {/* Pied : CODE ARTICLE + détail (mis à jour au SURVOL d'une EM) */}
          <div className="shrink-0 border-t border-border bg-secondary/25 px-3 py-2">
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="font-mono text-[11px] font-bold text-brand-700 dark:text-brand-300 shrink-0">{line.itemCode}</span>
              <span className="text-[11.5px] font-medium text-foreground truncate">{line.itemName}</span>
            </div>
            {chips.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {chips.map(([cls, txt], i) => (
                  <span key={i} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold ${cls}`}>{txt}</span>
                ))}
              </div>
            ) : (
              <p className="mt-0.5 text-[10.5px] text-muted-foreground italic">Pas de détail (variété / origine / calibre).</p>
            )}
            {hovered && (hd || hovered.supplier || hovered.warehouse) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-muted-foreground border-t border-border/50 pt-1.5">
                <span className="font-semibold text-foreground">{hovered.lot}</span>
                {hd && <span className="inline-flex items-center gap-0.5"><CalendarDays className="h-2.5 w-2.5" /> reçu le {hd}</span>}
                {hovered.supplier && <span className="inline-flex items-center gap-0.5"><Truck className="h-2.5 w-2.5" /> {hovered.supplier}</span>}
                {hovered.warehouse && <span>mag. {hovered.warehouse}</span>}
                <span>· {AFFECT_LABEL[hovered.affect] ?? hovered.affect}</span>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
