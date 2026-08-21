"use client";

/**
 * ONGLET « BONS DE COMMANDE » — affectation MANUELLE des lots.
 *
 * Les commandes créées en « bon de commande » (choix explicite, précommande, ou
 * export) partent SANS lot auto : chaque ligne est en EM_PENDING. Ici on choisit,
 * par article, le lot (arrivage EM) réellement en stock → PATCH U_NoLot sur la
 * commande SAP. Quand toutes les lignes ont un lot, la commande sort de l'onglet.
 *
 * Offres client (devis, à passer en commande) et bons de commande (lots à
 * affecter) vivent dans UNE seule liste, distingués par un champ « étape » :
 * mêmes cartes, un seul panneau plein écran de détail.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { floatingPortalTarget } from "@/lib/floatingPortal";
import { useRouter } from "next/navigation";
import {
  ChevronDown, ChevronRight, RefreshCw, Loader2, CheckCircle2, Sparkles,
  CalendarDays, AlertTriangle, Grape, FileText, PackageCheck, ArrowRightCircle,
  Clock, Trash2, Hash, Pencil, Star, Truck, Printer,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDeliveryDate } from "@/lib/livraison";
import { printOrderRecap, type PrintLine, type PrintDoc } from "@/components/livraisons/printRecap";
import { displayPersonName } from "@/lib/userNames";
import { broadcastActiveClient } from "@/lib/consoleSync";
import {
  DesignationStrong, DesignationMuted,
} from "@/components/livraisons/ArticleDesignation";
import { eur } from "@/lib/format";
import { FRUIT_FAMILIES } from "@/lib/familles";
import { familyLotSentinel, familyOfLot } from "@/lib/gervifrais-calc";
import { segmentBadgeClass } from "@/lib/segments";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { StatBlock } from "@/components/ui/stat-block";
import { Banner } from "@/components/ui/banner";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FullscreenPanel } from "@/components/ui/fullscreen-panel";
import { InfoHint } from "@/components/ui/info-hint";

const FAMILY_LABEL = new Map(FRUIT_FAMILIES.map((f) => [f.key, f.label]));

interface LotCandidate {
  lot: string; docNum: number; warehouse: string | null; affect: string;
  date?: string | null; supplier?: string | null; label?: string;
  qty?: number | null;   // stock physique TeleVent (article×entrepôt) — indicatif
}
interface FamilyTarget { key: string; label: string }
interface BonLine {
  itemCode: string; itemName: string; quantity: number; colis: number;
  warehouse: string | null; marque: string | null; condt: string | null; pays: string | null;
  variete: string | null; uvc: string | null; calibre: string | null;
  /** Prix unitaire HT et total HT de la ligne — null si indisponible. */
  price: number | null; lineTotal: number | null;
  lot: string; pending: boolean; candidates: LotCandidate[]; suggested: string | null;
  /** Tag « produit » à préciser plus tard (fruit) — rappel, pas d'auto-affectation. */
  familyTarget: FamilyTarget | null;
}
interface BonDoc {
  docEntry: number; docNum: number; cardCode: string; cardName: string;
  clientType: string | null; dueDate: string | null; docDate: string | null; open: boolean;
  markedBy: string | null; markedAt: string | null; pendingCount: number; lines: BonLine[];
}
/** OFFRE CLIENT (Quotation SAP) = précommande en attente d'être passée en commande.
 *  Ses lignes portent DÉJÀ un lot (ou EM_PENDING) : on peut les affecter ICI, avant
 *  de passer en commande — la commande créée héritera des lots. */
interface OffreDoc {
  docEntry: number; docNum: number; cardCode: string; cardName: string;
  clientType: string | null; dueDate: string | null; docDate: string | null;
  numAtCard: string | null;
  /** true = jour de départ atteint → à passer en commande maintenant. */
  due: boolean; lineCount: number; colis: number;
  /** Nb de lignes encore « en attente » d'un lot. */
  pendingCount: number; lines: BonLine[];
}

const AFFECT_LABEL: Record<string, string> = { TOUS: "Tous", EXPORT: "Export", GMS: "GMS", CHR: "CHR" };
const PENDING = "EM_PENDING";

/** Filtre de la liste, piloté par les deux KPI du pipeline. */
type Filter = "all" | "offres" | "bons";

/** Élément unifié de la liste : offre (à passer) ou bon (lots à affecter). */
type Entry = { kind: "offre"; o: OffreDoc } | { kind: "bon"; d: BonDoc };

/** Action de confirmation en attente (remplace window.confirm). */
interface PendingConfirm {
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel: React.ReactNode;
  tone?: "default" | "destructive";
  onConfirm: () => void | Promise<void>;
}

export function BonsCommandePanel() {
  const router = useRouter();
  const [docs, setDocs] = useState<BonDoc[] | null>(null);
  const [offres, setOffres] = useState<OffreDoc[] | null>(null);
  const [loading, setLoading] = useState(false);
  // Message d'échec du chargement (timeout SAP, erreur serveur) — affiché avec un
  // bouton de reprise, plutôt qu'un spinner qui tourne sans fin.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Filtre du pipeline : la case KPI cliquée restreint la liste.
  const [filter, setFilter] = useState<Filter>("all");
  // Détail = PLEIN ÉCRAN : une seule offre / un seul bon ouvert à la fois. L'état
  // porte l'étape + l'identifiant ; si le doc quitte la liste, le panneau se ferme
  // tout seul (le find renvoie null → open prop false).
  const [open, setOpen] = useState<{ kind: "offre" | "bon"; docEntry: number } | null>(null);
  const [busyLine, setBusyLine] = useState<string | null>(null); // `${docEntry}:${itemCode}` ou `offre:${docEntry}:${itemCode}`
  const [convertingId, setConvertingId] = useState<number | null>(null); // offre en cours de passage
  const [deletingId, setDeletingId] = useState<number | null>(null); // offre / bon en cours de suppression
  const [modifBusy, setModifBusy] = useState<number | null>(null); // docEntry en cours d'ouverture
  const [confirmState, setConfirmState] = useState<PendingConfirm | null>(null);

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
    setLoadError(null);
    try {
      // Garde-fou de temps : si SAP ne répond pas, la requête était capable de
      // pendre jusqu'à la mort de la fonction — l'écran restait alors bloqué sur
      // « Chargement… » sans jamais rien afficher. On coupe et on explique.
      const r = await fetch("/api/bons-commande", { cache: "no-store", signal: AbortSignal.timeout(45_000) });
      const j = await r.json().catch(() => null);
      if (!j?.ok) throw new Error(j?.error || `Réponse inattendue du serveur (${r.status})`);
      setDocs(j.docs ?? []);
      setOffres(j.offres ?? []);
    } catch (e) {
      const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
      setLoadError(timedOut
        ? "SAP met trop de temps à répondre. Réessaie dans un instant."
        : `Chargement impossible${e instanceof Error && e.message ? ` — ${e.message}` : ""}`);
      // Sort de l'état « chargement » (null) pour ne JAMAIS laisser un spinner
      // éternel ; les données déjà affichées sont conservées si on en avait.
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
        toast.success(`Commande n°${doc.docNum} — tous les lots affectés`);
      }
      return true;
    } catch {
      toast.error("SAP injoignable — lot non enregistré"); load(); return false;
    } finally {
      setBusyLine(null);
    }
  }, [load]);

  // Affecte un lot à toutes les lignes d'un article d'une OFFRE (PATCH Quotation) —
  // AVANT le passage en commande. L'offre reste listée (elle ne « sort » qu'au
  // passage en commande) ; on met juste à jour son état d'affectation.
  const assignLotOffre = useCallback(async (offre: OffreDoc, itemCode: string, lot: string): Promise<boolean> => {
    if (!lot) return false;
    const key = `offre:${offre.docEntry}:${itemCode}`;
    setBusyLine(key);
    const famKey = familyOfLot(lot);
    const famTarget = famKey && FAMILY_LABEL.has(famKey) ? { key: famKey, label: FAMILY_LABEL.get(famKey)! } : null;
    const nowPending = lot === PENDING || famTarget !== null;
    setOffres((prev) => prev?.map((o) => {
      if (o.docEntry !== offre.docEntry) return o;
      const lines = o.lines.map((l) => l.itemCode === itemCode
        ? { ...l, lot, pending: nowPending, familyTarget: famTarget }
        : l);
      return { ...o, lines, pendingCount: lines.filter((l) => l.pending).length };
    }) ?? prev);
    try {
      const r = await fetch("/api/bons-commande", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: offre.docEntry, itemCode, lot, target: "offre" }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Échec de l'affectation du lot"); load(); return false; }
      return true;
    } catch {
      toast.error("SAP injoignable — lot non enregistré"); load(); return false;
    } finally {
      setBusyLine(null);
    }
  }, [load]);

  // Idem « Valider les lots en stock », mais sur une OFFRE (avant passage).
  const suggestAllOffre = useCallback(async (offre: OffreDoc) => {
    const pend = offre.lines.filter((l) => l.pending && !l.familyTarget && l.suggested);
    for (const l of pend) {
      const ok = await assignLotOffre(offre, l.itemCode, l.suggested!);
      if (!ok) break;
    }
  }, [assignLotOffre]);

  // « Valider les lots en stock » : n'affecte QUE les lignes dont la suggestion a
  // un lot réellement en stock. Les lignes sans lot dispo restent « en attente »
  // (à découvert) — on valide certains articles, on garde les autres en attente,
  // sans écraser un choix ni réécrire inutilement EM_PENDING. On NE touche PAS aux
  // lignes taguées « produit » (fruit) : ce tag est un rappel manuel explicite.
  const suggestAll = useCallback(async (doc: BonDoc) => {
    const pend = doc.lines.filter((l) => l.pending && !l.familyTarget && l.suggested);
    for (const l of pend) {
      const ok = await assignLot(doc, l.itemCode, l.suggested!);
      if (!ok) break;
    }
  }, [assignLot]);

  // Impression du bon de commande POUR LA PRÉPARATION : feuille A4 sobre
  // (article, colis, lot à préparer, tags). Réutilise le bon de préparation BL.
  const printPrep = useCallback((doc: BonDoc) => {
    const lines: PrintLine[] = doc.lines.map((l) => ({
      itemCode: l.itemCode, itemName: l.itemName,
      quantity: l.quantity, unit: null, colis: l.colis, weightKg: 0,
      marque: l.marque, condt: l.condt, pays: l.pays,
      lot: l.pending ? PENDING : l.lot,
    }));
    const pdoc: PrintDoc = {
      docNum: doc.docNum, cardCode: doc.cardCode, cardName: doc.cardName,
      clientType: doc.clientType,
      colis: doc.lines.reduce((s, l) => s + l.colis, 0), weightKg: 0, lines,
    };
    const ok = printOrderRecap(pdoc, {
      dateLabel: doc.dueDate ? formatDeliveryDate(doc.dueDate) : doc.docDate ? formatDeliveryDate(doc.docDate) : "—",
    });
    if (!ok) toast.error("Fenêtre d'impression bloquée (autorise les pop-ups).");
  }, []);

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
      toast.success(`Offre n°${offre.docNum} passée en commande n°${j.docNum}`, { description: "Lots à affecter." });
      load();  // la nouvelle commande apparaît dans la file des lots
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

  // Supprime une offre (Quotation) dans SAP — le fetch pur (confirmation en amont).
  const doDeleteOffre = useCallback(async (offre: OffreDoc) => {
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

  const deleteOffre = useCallback((offre: OffreDoc) => {
    setConfirmState({
      title: `Supprimer l'offre n°${offre.docNum} ?`,
      description: `Offre de ${offre.cardName}. Cette action est définitive.`,
      confirmLabel: "Supprimer l'offre",
      tone: "destructive",
      onConfirm: () => doDeleteOffre(offre),
    });
  }, [doDeleteOffre]);

  // Retire une COMMANDE de la liste (lève le marqueur « bon de commande ») SANS
  // toucher SAP — pour les commandes déjà FACTURÉES / clôturées, qu'on ne peut
  // plus solder par l'affectation de lots (SAP refuse le PATCH) et qui restaient
  // donc épinglées à vie dans l'onglet.
  const doUnmarkBon = useCallback(async (doc: BonDoc) => {
    setDeletingId(doc.docEntry);
    try {
      const r = await fetch("/api/bons-commande", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unmark", docEntry: doc.docEntry }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { toast.error(j?.error || "Échec du retrait du bon de commande"); return; }
      setDocs((prev) => prev?.filter((d) => d.docEntry !== doc.docEntry) ?? prev);
      setOpen(null);
      toast.success(`Bon de commande n°${doc.docNum} retiré de la liste`);
    } catch {
      toast.error("Réseau injoignable — bon non retiré");
    } finally {
      setDeletingId(null);
    }
  }, []);

  const unmarkBon = useCallback((doc: BonDoc) => {
    setConfirmState({
      title: `Retirer le bon de commande n°${doc.docNum} ?`,
      description:
        `${doc.cardName} — la commande et sa facture dans SAP ne sont PAS supprimées. `
        + "On enlève seulement ce bon de la liste des lots à affecter (utile quand la commande est déjà facturée).",
      confirmLabel: "Retirer de la liste",
      tone: "destructive",
      onConfirm: () => doUnmarkBon(doc),
    });
  }, [doUnmarkBon]);

  // ── Dérivés ────────────────────────────────────────────────────────────
  const initialLoading = docs === null || offres === null;
  const offresCount = offres?.length ?? 0;
  const dueCount = (offres ?? []).filter((o) => o.due).length;
  const bonsCount = docs?.length ?? 0;
  const pendingLots = (docs ?? []).reduce((s, d) => s + d.pendingCount, 0);
  const totalItems = offresCount + bonsCount;

  const openOffre = open?.kind === "offre" ? (offres ?? []).find((o) => o.docEntry === open.docEntry) ?? null : null;
  const openBon = open?.kind === "bon" ? (docs ?? []).find((d) => d.docEntry === open.docEntry) ?? null : null;
  const panelOpen = !!openOffre || !!openBon;

  // Liste unifiée : offres (à passer) puis bons (lots à affecter), filtrée par KPI.
  const entries: Entry[] = [
    ...(filter === "bons" ? [] : (offres ?? []).map((o): Entry => ({ kind: "offre", o }))),
    ...(filter === "offres" ? [] : (docs ?? []).map((d): Entry => ({ kind: "bon", d }))),
  ];

  const toggleFilter = (f: Exclude<Filter, "all">) => setFilter((prev) => (prev === f ? "all" : f));

  return (
    <div className="space-y-4">
      {loadError && (
        <Banner
          tone="warning"
          action={
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin" : ""} /> Réessayer
            </Button>
          }
        >
          {loadError}
        </Banner>
      )}

      {/* ── PIPELINE : 2 KPI cliquables (cases d'INFO teintées) qui filtrent ── */}
      <div className="flex items-start gap-3">
        <div className="grid flex-1 grid-cols-2 gap-3 sm:max-w-xl">
          <KpiCard
            accent="violet"
            active={filter === "offres"}
            label="Offres à passer"
            value={initialLoading ? "—" : offresCount}
            tone="violet"
            hint={dueCount > 0 ? `${dueCount} au jour de départ` : "aucune au départ"}
            onClick={() => toggleFilter("offres")}
          />
          <KpiCard
            accent="amber"
            active={filter === "bons"}
            label="Lots à affecter"
            value={initialLoading ? "—" : pendingLots}
            tone="amber"
            hint={`${bonsCount} commande${bonsCount > 1 ? "s" : ""}`}
            onClick={() => toggleFilter("bons")}
          />
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="shrink-0">
          <RefreshCw className={loading ? "animate-spin" : ""} />
          <span className="max-sm:hidden">Actualiser</span>
        </Button>
      </div>

      {/* ── LISTE UNIFIÉE ───────────────────────────────────────────────── */}
      {initialLoading ? (
        <div className="space-y-2" role="status" aria-label="Chargement des bons de commande">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[68px] rounded-xl max-sm:rounded-none" />)}
        </div>
      ) : entries.length === 0 ? (
        filter !== "all" && totalItems > 0 ? (
          <EmptyState
            icon={filter === "offres" ? FileText : PackageCheck}
            title={filter === "offres" ? "Aucune offre à passer" : "Aucun lot à affecter"}
            description="Rien dans ce filtre pour l'instant."
            action={<Button variant="tinted" size="sm" onClick={() => setFilter("all")}>Voir tout</Button>}
          />
        ) : (
          <EmptyState
            icon={CheckCircle2}
            title="Tous les lots sont affectés"
            description="Les offres client (précommandes) et les bons de commande apparaissent ici tant qu'il reste une étape à traiter. Rien en attente pour l'instant."
          />
        )
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <EntryCard
              key={`${e.kind}:${e.kind === "offre" ? e.o.docEntry : e.d.docEntry}`}
              entry={e}
              onOpen={() => setOpen({
                kind: e.kind,
                docEntry: e.kind === "offre" ? e.o.docEntry : e.d.docEntry,
              })}
            />
          ))}
        </ul>
      )}

      {/* ══ PLEIN ÉCRAN — un seul panneau pour offre ET bon ══ */}
      <FullscreenPanel
        open={panelOpen}
        onOpenChange={(v) => { if (!v) setOpen(null); }}
        title={openOffre?.cardName ?? openBon?.cardName ?? ""}
        subtitle={
          openOffre ? (
            <span className="inline-flex items-center gap-2 flex-wrap">
              <span>Offre n°{openOffre.docNum}</span>
              <span className="tnum">· {openOffre.lineCount} ligne{openOffre.lineCount > 1 ? "s" : ""} · {openOffre.colis} colis</span>
              {openOffre.due && <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300"><Clock className="h-3.5 w-3.5" /> jour de départ</span>}
            </span>
          ) : openBon ? (
            <span className="inline-flex items-center gap-2 flex-wrap">
              <span>BL n°{openBon.docNum}</span>
              {openBon.dueDate && <span className="tnum">· Livraison {formatDeliveryDate(openBon.dueDate)}</span>}
              {openBon.markedBy && <span>· Créé par {displayPersonName(openBon.markedBy)}</span>}
            </span>
          ) : undefined
        }
        highlight={(() => {
          const pending = openOffre?.pendingCount ?? openBon?.pendingCount ?? 0;
          if (!panelOpen) return undefined;
          return pending === 0
            ? <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-[15px] sm:text-[17px]"><CheckCircle2 className="h-5 w-5" /> Lots complets</span>
            : <span className="text-amber-600 dark:text-amber-400 text-[15px] sm:text-[17px]">{pending} lot{pending > 1 ? "s" : ""} à affecter</span>;
        })()}
        actions={
          openOffre ? (
            <>
              <Button
                variant={openOffre.due ? "default" : "outline"}
                size="sm"
                onClick={() => convertOffre(openOffre)}
                disabled={convertingId === openOffre.docEntry || deletingId === openOffre.docEntry}
              >
                {convertingId === openOffre.docEntry ? <Loader2 className="animate-spin" /> : <ArrowRightCircle />}
                Passer en commande
              </Button>
              <Button
                variant="outline" size="icon"
                onClick={() => deleteOffre(openOffre)}
                disabled={convertingId === openOffre.docEntry || deletingId === openOffre.docEntry}
                title="Supprimer l'offre" aria-label={`Supprimer l'offre n°${openOffre.docNum}`}
                className="text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
              >
                {deletingId === openOffre.docEntry ? <Loader2 className="animate-spin" /> : <Trash2 />}
              </Button>
            </>
          ) : openBon ? (
            <>
              <Button
                variant="outline" size="sm"
                onClick={() => startModif(openBon)}
                disabled={modifBusy === openBon.docEntry}
                title="Modifier la commande dans la console (stock en direct) : changer les articles/quantités pour garantir les lots disponibles"
              >
                {modifBusy === openBon.docEntry ? <Loader2 className="animate-spin" /> : <Pencil />} Modifier
              </Button>
              <Button variant="outline" size="icon" onClick={() => printPrep(openBon)}
                title="Imprimer le bon de commande pour la préparation (articles, colis, lots)" aria-label="Imprimer">
                <Printer />
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => unmarkBon(openBon)}
                disabled={deletingId === openBon.docEntry}
                className="text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300"
                title="Retirer ce bon de la liste (commande déjà facturée / clôturée) — n'affecte PAS la commande ni la facture dans SAP"
              >
                {deletingId === openBon.docEntry ? <Loader2 className="animate-spin" /> : <Trash2 />} Retirer de la liste
              </Button>
            </>
          ) : undefined
        }
      >
        {openOffre && (
          <div className="space-y-4">
            {/* Date de livraison + n° de commande éditables */}
            <div className="flex items-center gap-3 flex-wrap">
              <label className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground" title="Date de livraison">
                <CalendarDays className="h-4 w-4 shrink-0" />
                <input
                  type="date"
                  defaultValue={openOffre.dueDate ?? ""}
                  onChange={(ev) => {
                    const v = ev.target.value;
                    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== openOffre.dueDate) saveOffre(openOffre, { dueDate: v });
                  }}
                  aria-label={`Date de livraison de l'offre n°${openOffre.docNum}`}
                  className="h-9 rounded-lg border border-border bg-card px-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                />
              </label>
              <label className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground" title="N° de commande client">
                <Hash className="h-4 w-4 shrink-0" />
                <input
                  type="text"
                  defaultValue={openOffre.numAtCard ?? ""}
                  placeholder="N° commande"
                  onBlur={(ev) => {
                    const v = ev.target.value.trim();
                    if (v !== (openOffre.numAtCard ?? "")) saveOffre(openOffre, { numAtCard: v });
                  }}
                  onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); }}
                  aria-label={`N° de commande de l'offre n°${openOffre.docNum}`}
                  className="h-9 w-[150px] rounded-lg border border-border bg-card px-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                />
              </label>
            </div>
            <LotAssignList
              lines={openOffre.lines}
              keyPrefix={`offre:${openOffre.docEntry}:`}
              busyLine={busyLine}
              onPick={(itemCode, v) => assignLotOffre(openOffre, itemCode, v)}
            />
            <Button
              variant="outline"
              onClick={() => suggestAllOffre(openOffre)}
              disabled={openOffre.pendingCount === 0 || busyLine !== null || !openOffre.lines.some((l) => l.pending && !l.familyTarget && l.suggested)}
              title="Valider le lot suggéré (arrivage en stock) sur les lignes qui en ont un ; les articles sans lot dispo restent en attente"
            >
              <Sparkles /> Valider les lots en stock
            </Button>
          </div>
        )}

        {openBon && (
          <div className="space-y-4">
            <LotAssignList
              lines={openBon.lines}
              keyPrefix={`${openBon.docEntry}:`}
              busyLine={busyLine}
              onPick={(itemCode, v) => assignLot(openBon, itemCode, v)}
            />
            <Button
              variant="outline"
              onClick={() => suggestAll(openBon)}
              disabled={openBon.pendingCount === 0 || busyLine !== null || !openBon.lines.some((l) => l.pending && !l.familyTarget && l.suggested)}
              title="Valider le lot suggéré (arrivage en stock du segment) sur les lignes qui en ont un ; les articles sans lot dispo restent en attente"
            >
              <Sparkles /> Valider les lots en stock
            </Button>
          </div>
        )}
      </FullscreenPanel>

      <ConfirmDialog
        open={confirmState !== null}
        onOpenChange={(o) => { if (!o) setConfirmState(null); }}
        title={confirmState?.title ?? ""}
        description={confirmState?.description}
        confirmLabel={confirmState?.confirmLabel ?? "Confirmer"}
        tone={confirmState?.tone}
        onConfirm={async () => { await confirmState?.onConfirm(); }}
      />
    </div>
  );
}

/* ── KPI du pipeline : case d'INFO teintée, cliquable (filtre la liste). ── */
function KpiCard({
  accent, active, label, value, tone, hint, onClick,
}: {
  accent: "violet" | "amber";
  active: boolean;
  label: string;
  value: React.ReactNode;
  tone: "violet" | "amber";
  hint: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className="cursor-pointer rounded-xl transition-transform duration-[var(--dur-fast)] ease-[var(--ease-apple)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <SurfaceCard
        tinted
        accent={accent}
        animate={false}
        className={cn("h-full p-3.5", active && (accent === "violet" ? "ring-2 ring-violet-500/50" : "ring-2 ring-amber-500/50"))}
      >
        <StatBlock label={label} value={value} tone={tone} size="lg" />
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      </SurfaceCard>
    </div>
  );
}

/* ── Carte unifiée (offre OU bon) : même gabarit, un champ « étape » distingue. ── */
function EntryCard({ entry, onOpen }: { entry: Entry; onOpen: () => void }) {
  const isOffre = entry.kind === "offre";
  const cardName = isOffre ? entry.o.cardName : entry.d.cardName;
  const clientType = isOffre ? entry.o.clientType : entry.d.clientType;
  const dueDate = isOffre ? entry.o.dueDate : entry.d.dueDate;
  const pending = isOffre ? entry.o.pendingCount : entry.d.pendingCount;
  const due = isOffre ? entry.o.due : false;

  return (
    <li
      className={cn(
        "rounded-xl border bg-card overflow-hidden max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0",
        due ? "border-amber-400/60" : "border-border",
      )}
    >
      <div
        role="button" tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
        className="flex items-center gap-3 px-3 sm:px-4 py-3 cursor-pointer select-none hover:bg-secondary/40 transition-colors"
      >
        <div className="min-w-0 flex-1">
          {/* Ligne 1 : étape + client + segment + détail */}
          <div className="flex items-center gap-2 flex-wrap">
            <EtapeBadge kind={entry.kind} />
            <span className="text-[15px] font-semibold text-foreground truncate">{cardName}</span>
            {clientType && (
              <span className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide",
                segmentBadgeClass(clientType),
              )}>
                {clientType}
              </span>
            )}
            <InfoHint label={isOffre ? "Détails de l'offre" : "Détails du bon"}>
              <span className="block space-y-0.5">
                {isOffre ? (
                  <>
                    <span className="block">Offre n°{entry.o.docNum}</span>
                    <span className="block">{entry.o.lineCount} ligne{entry.o.lineCount > 1 ? "s" : ""} · {entry.o.colis} colis</span>
                    {entry.o.numAtCard && <span className="block">N° commande client : {entry.o.numAtCard}</span>}
                  </>
                ) : (
                  <>
                    <span className="block">BL n°{entry.d.docNum}</span>
                    <span className="block">{entry.d.lines.length} ligne{entry.d.lines.length > 1 ? "s" : ""}</span>
                    {entry.d.markedBy && <span className="block">Créé par {displayPersonName(entry.d.markedBy)}</span>}
                  </>
                )}
              </span>
            </InfoHint>
          </div>
          {/* Ligne 2 : livraison + départ + statut des lots */}
          <div className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-[12px] text-muted-foreground">
            {dueDate && (
              <span className="inline-flex items-center gap-1 tnum">
                <CalendarDays className="h-3.5 w-3.5" /> Livraison {formatDeliveryDate(dueDate)}
              </span>
            )}
            {isOffre && (due
              ? <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300"><Clock className="h-3.5 w-3.5" /> jour de départ</span>
              : <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> en attente</span>)}
            <LotsStatus pending={pending} />
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
      </div>
    </li>
  );
}

/* ── Champ « étape » : Offre — à passer / Commande — lots à affecter. ── */
function EtapeBadge({ kind }: { kind: "offre" | "bon" }) {
  return kind === "offre" ? (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-violet-500/12 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/25">
      <FileText className="h-3 w-3" /> Offre — à passer
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-sky-500/12 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/25">
      <PackageCheck className="h-3 w-3" /> Commande — lots à affecter
    </span>
  );
}

/* ── Pastille d'état des lots (partagée carte / en-tête). ── */
function LotsStatus({ pending }: { pending: number }) {
  return pending === 0 ? (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/25">
      <CheckCircle2 className="h-3 w-3" /> Lots complets
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/25">
      {pending} lot{pending > 1 ? "s" : ""} à affecter
    </span>
  );
}

/* ── Liste d'affectation des lots (partagée offre / bon) — ZONE DE SAISIE :
      fond neutre, en-tête gris marqué, séparateurs nets, zébrage. Chaque ligne :
      quantité en gros + article (désignation), puis le sélecteur de lot seul. ── */
function LotAssignList({ lines, keyPrefix, busyLine, onPick }: {
  lines: BonLine[];
  keyPrefix: string;
  busyLine: string | null;
  onPick: (itemCode: string, v: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* En-tête gris marqué (repère de colonnes de la zone de travail). */}
      <div className="flex items-center gap-3 border-b border-border bg-secondary/60 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="flex-1">Article · quantité</span>
        <span className="sm:w-[320px]">Lot à affecter</span>
      </div>
      <ul className="divide-y divide-border [&>li:nth-child(even)]:bg-muted/40">
        {lines.map((l) => {
          const isBusy = busyLine === `${keyPrefix}${l.itemCode}`;
          // Valeur sélectionnée : tag famille (EM_FAM:…) prioritaire, sinon
          // vrai lot, sinon vide (à découvert générique).
          const current = l.familyTarget
            ? familyLotSentinel(l.familyTarget.key)
            : l.pending ? "" : l.lot;
          return (
            <li key={l.itemCode} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
              {/* GAUCHE — deux niveaux : quantité en gros + nom/désignation ; le
                  code article et le PU/total sont relégués sur une ligne discrète. */}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2.5">
                  <span className="shrink-0 text-[22px] font-bold leading-none tnum text-foreground">{l.colis}</span>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-[15px] font-semibold text-foreground">{l.itemName}</span>
                      <DesignationStrong l={l} className="text-[13px]" />
                    </div>
                    <DesignationMuted l={l} className="text-[12px] mt-0.5" />
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-muted-foreground">
                  <span className="font-mono">{l.itemCode}</span>
                  {l.warehouse && <span className="tnum">mag {l.warehouse}</span>}
                  <span className="tnum">PU {l.price != null ? eur(l.price) : "—"}</span>
                  <span className="tnum">Total {l.lineTotal != null ? eur(l.lineTotal) : "—"}</span>
                </div>
                {l.familyTarget && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                    <Grape className="h-3 w-3" /> {l.familyTarget.label} — à préciser
                  </span>
                )}
              </div>
              {/* DROITE — le sélecteur de lot, seul. */}
              <LotCell line={l} current={current} isBusy={isBusy} onPick={(v) => onPick(l.itemCode, v)} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── Cellule d'affectation d'un lot ──────────────────────────────────────────
   Menu déroulant PERSONNALISÉ (porté en portail → jamais rogné par la carte),
   scindé en GROUPES titrés : Lots en stock · Attendre un fruit · Autre. La saisie
   manuelle d'un n° d'EM a sa propre zone. En SURVOLANT une EM, le PIED du menu
   affiche le CODE ARTICLE + tout le détail et la réception de cette EM. ── */
function LotCell({ line, current, isBusy, onPick }: {
  line: BonLine; current: string; isBusy: boolean; onPick: (v: string) => void;
}) {
  const opts = line.candidates ?? [];
  const showRawCurrent = !line.familyTarget && !line.pending && !!current && !opts.some((c) => c.lot === current);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<LotCandidate | null>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const [manual, setManual] = useState("");   // saisie manuelle d'un n° d'EM (articles sans lot proposé)
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
  const closeMenu = () => { setOpen(false); setHovered(null); setManual(""); };
  const pick = (v: string) => { onPick(v); closeMenu(); };

  useEffect(() => {
    if (!open) return;
    // `composedPath()` (le trajet RÉEL de l'évènement) plutôt que `.contains()` sur
    // `e.target` : plus fiable pour un déclencheur + un popup portés en portail
    // séparé (insensible à un nœud déplacé/retiré entre la capture et le check).
    // `pointerdown` (pas `mousedown`) pour matcher exactement l'évènement écouté
    // par Radix (le Dialog/FullscreenPanel englobant) — mêmes garanties tactile
    // que souris, un seul type d'évènement à raisonner.
    const onDown = (e: PointerEvent) => {
      const path = e.composedPath();
      if (triggerRef.current && path.includes(triggerRef.current)) return;
      if (popRef.current && path.includes(popRef.current)) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    const reflow = () => place();
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    return () => {
      document.removeEventListener("pointerdown", onDown);
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
  const triggerLabel = line.familyTarget ? `${line.familyTarget.label} — à préciser`
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
          data-floating-root=""
          style={{ position: "fixed", left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
          // `pointer-events-auto` OBLIGATOIRE : ce menu s'ouvre AU-DESSUS d'un
          // FullscreenPanel (Radix Dialog modal), qui pose `pointer-events:none`
          // sur <body> — dont ce popup hérite (porté dans <body>). Sans ça les
          // clics TRAVERSENT le popup (il n'est pas cible d'évènement) : l'option
          // ne reçoit jamais son onClick, et le pointerdown atterrit sur le
          // panneau derrière → vu comme un « clic dehors » → le menu se referme
          // à chaque clic intérieur.
          className="pointer-events-auto z-[100] rounded-xl border border-border bg-card shadow-modal overflow-hidden flex flex-col max-h-[70vh] animate-fade-up"
        >
          <div className="overflow-y-auto py-1 min-h-0" onMouseLeave={() => setHovered(null)}>
            <button type="button" onMouseEnter={() => setHovered(null)} onClick={() => pick("")}
              className={`w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-secondary/60 ${current === "" ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
              Choisir le lot…
            </button>

            {/* GROUPE 1 — Lots en stock (arrivages EM, avec suggestion en tête) */}
            {emRows.length > 0 && (
              <>
                <MenuGroupLabel>Lots en stock</MenuGroupLabel>
                {emRows.map(({ c, sug }) => (
                  <button key={c.lot} type="button" onMouseEnter={() => setHovered(c)} onClick={() => pick(c.lot)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-1.5 text-[12.5px] hover:bg-secondary/60 ${current === c.lot ? "bg-brand-500/10 font-semibold" : "text-foreground"}`}>
                    {sug && <Star className="h-3 w-3 text-amber-500 fill-amber-400 shrink-0" />}
                    <span className="font-semibold text-foreground">{c.lot}</span>
                    {sug && <span className="text-[10px] text-amber-600 dark:text-amber-400">suggéré</span>}
                    <span className="text-[10px] px-1 py-px rounded bg-secondary text-muted-foreground">{AFFECT_LABEL[c.affect] ?? c.affect}</span>
                    {c.qty != null && c.qty > 0 && (
                      <span className="text-[10px] px-1 py-px rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 tnum">{Math.round(c.qty)} en stock</span>
                    )}
                    {c.warehouse && <span className="text-[10.5px] text-muted-foreground ml-auto">mag. {c.warehouse}</span>}
                  </button>
                ))}
              </>
            )}
            {showRawCurrent && (
              <>
                {emRows.length === 0 && <MenuGroupLabel>Lot en stock</MenuGroupLabel>}
                <button type="button" onMouseEnter={() => setHovered(null)} onClick={() => pick(current)}
                  className="w-full text-left px-3 py-2 text-[12.5px] bg-brand-500/10 font-semibold text-foreground">
                  {current}
                </button>
              </>
            )}

            {/* GROUPE 2 — Attendre un fruit (rappel, jamais auto-affecté) */}
            <MenuGroupLabel>Attendre un fruit</MenuGroupLabel>
            {FRUIT_FAMILIES.map((f) => {
              const v = familyLotSentinel(f.key);
              return (
                <button key={f.key} type="button" onMouseEnter={() => setHovered(null)} onClick={() => pick(v)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-1.5 text-[12.5px] hover:bg-secondary/60 ${current === v ? "bg-violet-500/10 font-semibold text-violet-700 dark:text-violet-300" : "text-foreground"}`}>
                  <Grape className="h-3.5 w-3.5 text-violet-500 shrink-0" /> {f.label} — à préciser
                </button>
              );
            })}

            {/* GROUPE 3 — Autre */}
            <MenuGroupLabel>Autre</MenuGroupLabel>
            <button type="button" onMouseEnter={() => setHovered(null)} onClick={() => pick(PENDING)}
              className={`w-full text-left px-3 py-2 flex items-center gap-1.5 text-[12.5px] hover:bg-secondary/60 ${current === PENDING ? "bg-amber-500/10 font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" /> À découvert — arrivage à venir
            </button>
          </div>

          {/* Saisie manuelle d'un n° d'entrée — sa propre zone. Pour un article
              SANS lot proposé (déco / fabrication maison, pas d'EM en base) : je
              tape les chiffres, ça affecte « EM<chiffres> » directement. */}
          <div className="shrink-0 border-t border-border/60 bg-secondary/30 px-3 py-2">
            <label className="block text-[9.5px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Ou saisir le n° d&apos;entrée
            </label>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center h-7 pl-2 pr-1 rounded-l-md border border-r-0 border-border bg-card text-[12px] font-semibold text-muted-foreground select-none">EM</span>
              <input
                type="text"
                inputMode="numeric"
                value={manual}
                onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter" && manual) { e.preventDefault(); pick(`EM${manual}`); } }}
                placeholder="23568"
                aria-label="Saisir un numéro d'entrée marchandise"
                className="h-7 flex-1 min-w-0 rounded-none border border-border bg-card px-2 text-[12.5px] tnum focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              />
              <button
                type="button"
                disabled={!manual}
                onClick={() => manual && pick(`EM${manual}`)}
                className="h-7 shrink-0 rounded-r-md border border-l-0 border-brand-500 bg-brand-500 px-2.5 text-[12px] font-semibold text-on-accent disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-600"
              >
                OK
              </button>
            </div>
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
        // Porté DANS le Dialog quand il y en a un : sinon le piège à focus du
        // Dialog rapatrie le focus et le champ « n° d'entrée » est inutilisable.
        floatingPortalTarget(triggerRef.current),
      )}
    </div>
  );
}

/* ── Titre de groupe du menu de lot (plus d'air entre les sections). ── */
function MenuGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-2.5 pb-1 text-[9.5px] uppercase tracking-wider text-muted-foreground font-semibold">
      {children}
    </p>
  );
}
