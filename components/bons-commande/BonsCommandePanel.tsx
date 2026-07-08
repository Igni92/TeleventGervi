"use client";

/**
 * ONGLET « BONS DE COMMANDE » — affectation MANUELLE des lots.
 *
 * Les commandes créées en « bon de commande » (choix explicite, précommande, ou
 * export) partent SANS lot auto : chaque ligne est en EM_PENDING. Ici on choisit,
 * par article, le lot (arrivage EM) réellement en stock → PATCH U_NoLot sur la
 * commande SAP. Quand toutes les lignes ont un lot, la commande sort de l'onglet.
 */
import { useCallback, useEffect, useState } from "react";
import {
  PackageCheck, ChevronDown, RefreshCw, Loader2, CheckCircle2, Sparkles,
  CalendarDays, AlertTriangle, Grape, FileText, ArrowRightCircle, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { formatDeliveryDate } from "@/lib/livraison";
import { displayPersonName } from "@/lib/userNames";
import { DesignationChips } from "@/components/entrees/DesignationChips";
import { FRUIT_FAMILIES } from "@/lib/familles";
import { familyLotSentinel, familyOfLot } from "@/lib/gervifrais-calc";

const FAMILY_LABEL = new Map(FRUIT_FAMILIES.map((f) => [f.key, f.label]));

interface LotCandidate { lot: string; docNum: number; warehouse: string | null; affect: string }
interface FamilyTarget { key: string; label: string }
interface BonLine {
  itemCode: string; itemName: string; quantity: number; colis: number;
  warehouse: string | null; marque: string | null; condt: string | null; pays: string | null;
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
  const [docs, setDocs] = useState<BonDoc[] | null>(null);
  const [offres, setOffres] = useState<OffreDoc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [busyLine, setBusyLine] = useState<string | null>(null); // `${docEntry}:${itemCode}`
  const [convertingId, setConvertingId] = useState<number | null>(null); // offre en cours de passage

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
              return (
                <li
                  key={o.docEntry}
                  className={`rounded-xl border px-3 sm:px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 ${
                    o.due ? "border-amber-400/60 bg-amber-50/40 dark:bg-amber-950/15" : "border-border bg-card"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13.5px] font-semibold text-foreground truncate">{o.cardName}</span>
                      {o.clientType && SEG_BADGE[o.clientType] && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide ${SEG_BADGE[o.clientType]}`}>
                          {o.clientType}
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">offre n°{o.docNum}</span>
                      {o.dueDate && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <CalendarDays className="h-3 w-3" /> {formatDeliveryDate(o.dueDate)}
                        </span>
                      )}
                    </div>
                    <p className="text-[11.5px] text-muted-foreground tnum mt-0.5">
                      {o.lineCount} ligne{o.lineCount > 1 ? "s" : ""} · {o.colis} colis
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2 self-end sm:self-auto">
                    {o.due
                      ? <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300"><Clock className="h-3.5 w-3.5" /> jour de départ</span>
                      : <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground"><Clock className="h-3.5 w-3.5" /> en attente du départ</span>}
                    <button
                      type="button"
                      onClick={() => convertOffre(o)}
                      disabled={converting || convertingId !== null}
                      title="Créer la commande client SAP à partir de cette offre (lots à affecter ensuite)"
                      className={`inline-flex items-center gap-1.5 h-10 sm:h-9 px-3.5 rounded-xl text-[12.5px] font-semibold transition-colors disabled:opacity-50 ${
                        o.due ? "bg-brand-600 hover:bg-brand-700 text-white" : "border border-border text-foreground hover:bg-secondary/60"
                      }`}
                    >
                      {converting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightCircle className="h-4 w-4" />}
                      Passer en commande
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
                    const opts = l.candidates ?? [];
                    // Ligne de repli pour un VRAI lot absent des candidats (jamais pour
                    // un tag famille : il vit dans son propre optgroup).
                    const showRawCurrent = !l.familyTarget && !l.pending && !!current && !opts.some((c) => c.lot === current);
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
                        <div className="shrink-0 sm:w-[320px] flex items-center gap-2">
                          {l.familyTarget
                            ? <Grape className="h-4 w-4 text-violet-500 shrink-0" />
                            : l.pending
                            ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                            : <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />}
                          <select
                            value={current}
                            disabled={isBusy}
                            onChange={(e) => assignLot(doc, l.itemCode, e.target.value)}
                            aria-label={`Lot de ${l.itemName}`}
                            className={`h-11 sm:h-9 w-full rounded-lg border bg-card px-2.5 text-[13px] sm:text-[12.5px] font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60 cursor-pointer ${
                              l.familyTarget ? "border-violet-400/60 text-violet-700 dark:text-violet-300"
                              : l.pending ? "border-amber-400/60 text-amber-700 dark:text-amber-300"
                              : "border-border text-foreground"
                            }`}
                          >
                            <option value="">Choisir le lot…</option>
                            {l.suggested && <option value={l.suggested}>★ {l.suggested} (suggéré)</option>}
                            {opts.filter((c) => c.lot !== l.suggested).map((c) => (
                              <option key={c.lot} value={c.lot}>
                                {c.lot} · {AFFECT_LABEL[c.affect] ?? c.affect}{c.warehouse ? ` · mag. ${c.warehouse}` : ""}
                              </option>
                            ))}
                            {showRawCurrent && <option value={current}>{current}</option>}
                            {/* Affecter un PRODUIT (fruit) à préciser plus tard — rappel,
                                pas d'affectation auto à la réception. */}
                            <optgroup label="Attendre un fruit (à préciser)">
                              {FRUIT_FAMILIES.map((f) => (
                                <option key={f.key} value={familyLotSentinel(f.key)}>🍓 {f.label} — à préciser</option>
                              ))}
                            </optgroup>
                            <option value={PENDING}>À découvert — arrivage à venir ({PENDING})</option>
                          </select>
                          {isBusy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
                        </div>
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
