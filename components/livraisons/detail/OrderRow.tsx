"use client";

// Ligne commande du détail livraison (état déplié, vue en grand, dialogs de
// préparation / remise sur file / re-codage client, dispatch inline, saisie de
// lot). Restyle refonte : la seule action COLORÉE de la ligne est le bouton
// d'état (tokens --warning/--success/--info), badges max 2 + « +n », menu « ⋯ »
// visible reprenant tout le clic droit (tablettes d'entrepôt), articles en
// liste hairline avec désignation en texte muted — comportement métier inchangé.
import { memo, useCallback, useEffect, useMemo, useRef, useState, Fragment, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  Truck, Boxes, FileText, ChevronDown, CalendarDays, AlertTriangle, Loader2,
  PackageX, CheckCircle2, Clock, RotateCcw, Pencil, Maximize2, UserCheck, Undo2,
  ListChecks, UserCog, ArrowRight, Printer, Send, Check, MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { PALETTE_TYPES, EMPTY_PALETTES, totalPalettes, type PaletteCounts, type PaletteKind } from "@/lib/palettes";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ClientLink } from "@/components/ClientLink";
import { BrandLogo } from "@/components/BrandLogo";
import { useBrandLogos } from "@/lib/useBrandLogos";
import { displayPersonName } from "@/lib/userNames";
import { broadcastActiveClient } from "@/lib/consoleSync";
import { formatDeliveryDate } from "@/lib/livraison";
import { docTourneeKeyLabel, type StatusTab, type Tournee, type Doc } from "@/lib/livraisonView";
import { consolidateDeliveryLines } from "@/lib/livraisonLines";
import { printOrderRecap } from "../printRecap";
import { fmtNum, fmtEur, fmtClock, capitalize, SEG_UI, type CarrierOption } from "./shared";
import { PreparedByDialog } from "./dialogs";
import { useContextMenu, ContextMenu, MenuItem, LineToolMenu, normalizeLotInput, applyLotChange } from "./menus";
import { ArticleDesignation } from "@/components/livraisons/ArticleDesignation";

/* ─────────────────────────────────────────────────────────────
   Pilules d'état de la ligne — tokens sémantiques uniquement (couleur = état).
   Max 2 visibles, le reste replié dans « +n » (doctrine badges).
───────────────────────────────────────────────────────────── */
const PILL = "inline-flex max-w-full min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-caption2 font-semibold";
const PILL_TONE = {
  destructive: "bg-destructive/12 text-destructive ring-1 ring-destructive/25",
  warning:     "bg-warning/12 text-warning ring-1 ring-warning/25",
  success:     "bg-success/12 text-success ring-1 ring-success/25",
  info:        "bg-info/12 text-info ring-1 ring-info/25",
} as const;

/* ═════════════════════════════════════════════════════════════
   Ligne commande — repliable vers le détail des lignes.
   Mémoïsée : patchDoc met à jour les docs de façon immuable → seules les lignes
   réellement modifiées re-rendent (le reste garde son identité de props).
═════════════════════════════════════════════════════════════ */
export const OrderRow = memo(function OrderRow({
  doc, viewDate, carriers, onCarrierChange, onDateChange, tournees, onLoadTournees, onTourneeChange, onPatchDoc, onReload, canDispatch, autoOpenNonce,
}: {
  doc: Doc;
  viewDate: string;
  carriers: CarrierOption[];
  onCarrierChange: (docEntry: number, sapValue: string) => Promise<boolean>;
  onDateChange: (docEntry: number, dueDate: string) => Promise<boolean>;
  tournees: Tournee[] | undefined;
  onLoadTournees: (code: string) => void;
  onTourneeChange: (docEntry: number, trspCode: string, tournee: Tournee | null) => Promise<boolean>;
  onPatchDoc: (docEntry: number, patch: Partial<Doc>) => void;
  onReload: () => void;
  canDispatch: boolean;
  /** Deep-link : nonce non nul → ouvre cette commande en grand + défile jusqu'à
   *  elle (change à chaque clic pour rouvrir la même commande). */
  autoOpenNonce?: string | null;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  const [open, setOpen] = useState(false);
  const [savingCarrier, setSavingCarrier] = useState(false);
  const [savingTournee, setSavingTournee] = useState(false);
  const brandLogos = useBrandLogos("livraison");

  // ── ÉCHANGE D'ARTICLE (clic droit sur une ligne produit) : remplace l'article
  //    de CE bon par un autre code, en conservant quantité et prix — sans passer
  //    par la console (modif SAP directe, même endpoint que la console → rapide). ──
  const [swapTarget, setSwapTarget] = useState<{ x: number; y: number; oldCode: string; oldName: string } | null>(null);
  const openSwap = useCallback((e: ReactMouseEvent, itemCode: string, itemName: string) => {
    if (!doc.open) return;                        // BL livré / annulé → pas d'échange
    e.preventDefault(); e.stopPropagation();      // n'ouvre PAS le menu de la carte
    setSwapTarget({
      x: Math.min(e.clientX, window.innerWidth - 300),
      y: Math.min(e.clientY, window.innerHeight - 340),
      oldCode: itemCode, oldName: itemName,
    });
  }, [doc.open]);
  // Même outil depuis le « ⋯ » de la ligne produit (tablettes sans clic droit) :
  // ancré sous le bouton plutôt qu'au pointeur.
  const openSwapFromButton = useCallback((e: ReactMouseEvent, itemCode: string, itemName: string) => {
    if (!doc.open) return;
    e.preventDefault(); e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setSwapTarget({
      x: Math.min(r.left, window.innerWidth - 300),
      y: Math.min(r.bottom + 4, window.innerHeight - 340),
      oldCode: itemCode, oldName: itemName,
    });
  }, [doc.open]);

  // ── Articles MANQUANTS = stock SAP total négatif (détecté par l'API). ──
  const missingSet = useMemo(() => new Set(doc.missingItems ?? []), [doc.missingItems]);

  // ── Lignes d'AFFICHAGE : regroupe un article racheté après manquant (2ᵉ code,
  //    même désignation) en une seule ligne « colis complet » et écarte les
  //    lignes à quantité 0 — sinon un colis s'affichait éclaté en demi-colis
  //    (« 0 mûre » + « 0,5 » + « 0,5 ») alors que le total du BL dit « 1 colis ».
  //    Une ligne est manquante si l'UN de ses codes fusionnés l'est. ──
  const displayLines = useMemo(() => consolidateDeliveryLines(doc.lines), [doc.lines]);
  const isLineMissing = useCallback(
    (codes: string[]) => codes.some((c) => missingSet.has(c)),
    [missingSet],
  );

  // Charge les tournées du transporteur courant (une fois) pour le sélecteur.
  useEffect(() => {
    if (doc.open && doc.trspCode) onLoadTournees(doc.trspCode);
  }, [doc.open, doc.trspCode, onLoadTournees]);

  // Tournée pré-sélectionnée (par LineId, pour désambiguïser les heures égales) :
  // la tournée MÉMORISÉE du client d'abord, sinon la 1re qui correspond à l'heure
  // portée par le BL (U_TrspHeur).
  const selectedTourneeId = useMemo(() => {
    const list = tournees ?? [];
    const saved = doc.savedTournee;
    if (saved && saved.trspCode === doc.trspCode) {
      // par LineId (mémoire app), sinon par NOM de tournée (SERG_TRCL U_DistBy =
      // SERGTRS U_Nom), sinon par heure — dans cet ordre de fiabilité.
      if (saved.lineId != null && list.some((t) => t.lineId === saved.lineId)) return String(saved.lineId);
      if (saved.nom) {
        const byNom = list.find((t) => t.nom && t.nom.toUpperCase() === saved.nom!.toUpperCase());
        if (byNom) return String(byNom.lineId);
      }
      if (saved.heure) {
        const byH = list.find((t) => t.heure === saved.heure);
        if (byH) return String(byH.lineId);
      }
    }
    if (doc.trspHeure) {
      const m = list.find((t) => t.heure === doc.trspHeure);
      if (m) return String(m.lineId);
    }
    return "";
  }, [tournees, doc.savedTournee, doc.trspCode, doc.trspHeure]);

  async function handleTournee(lineIdStr: string) {
    if (!doc.trspCode || lineIdStr === selectedTourneeId) return;
    const t = (tournees ?? []).find((x) => String(x.lineId) === lineIdStr) ?? null;
    setSavingTournee(true);
    await onTourneeChange(doc.docEntry, doc.trspCode, t);
    setSavingTournee(false);
  }

  // Date de livraison (DocDueDate) — modifiable directement sur la ligne. Au
  // changement → PATCH + rechargement (la commande quitte la vue si elle bouge).
  const dueISO = (doc.dueDate ?? "").slice(0, 10);
  // « Reportée » dans la file : la commande est affichée dans la vue d'un AUTRE
  // jour que sa date de livraison (report des prépas non faites). En RETARD si
  // sa livraison était prévue AVANT le jour affiché, ANTICIPÉE si elle l'est APRÈS.
  const carriedOver = !!viewDate && dueISO.length === 10 && dueISO !== viewDate;
  const carriedOverdue = carriedOver && dueISO < viewDate;
  const dueShort = dueISO.length === 10 ? `${dueISO.slice(8, 10)}/${dueISO.slice(5, 7)}` : "";
  const [savingDate, setSavingDate] = useState(false);
  async function handleDate(value: string) {
    if (!value || value === dueISO) return;
    setSavingDate(true);
    await onDateChange(doc.docEntry, value);
    setSavingDate(false);
  }

  // N° de commande (réf. client) — éditable directement sur la ligne. Sauvé sur
  // blur/Entrée (PATCH NumAtCard) seulement si modifié. `savedRef` = dernière
  // valeur enregistrée (évite de muter la prop `doc` et les ré-enregistrements).
  const [refDraft, setRefDraft] = useState(doc.numAtCard ?? "");
  const [savedRef, setSavedRef] = useState(doc.numAtCard ?? "");
  const [savingRef, setSavingRef] = useState(false);
  async function saveRef() {
    const val = refDraft.trim();
    if (val === savedRef.trim()) return;   // inchangé
    setSavingRef(true);
    try {
      const res = await fetch(`/api/sap/orders/${doc.docEntry}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numAtCard: val }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || j?.ok === false) {
        toast.error(j?.error ? `Échec : ${j.error}` : "Échec de l'enregistrement du n° de commande");
        setRefDraft(savedRef);   // rollback affichage
        return;
      }
      setSavedRef(val);
      toast.success(val ? `N° de commande enregistré (n°${doc.docNum})` : `N° de commande retiré (n°${doc.docNum})`);
    } catch {
      toast.error("SAP injoignable — n° de commande non enregistré");
      setRefDraft(savedRef);
    } finally {
      setSavingRef(false);
    }
  }

  // Statut « faite » (préparée) — MANUEL, basculé directement ici. Optimiste +
  // persistance par DocEntry (aucune déduction auto depuis l'inventaire).
  const [prepared, setPrepared] = useState(doc.prepared);
  const [savingPrep, setSavingPrep] = useState(false);
  // Préparateur affecté + auteur du « fait » + signalement « à reprendre » + vue en grand.
  const [preparer, setPreparer] = useState<string | null>(doc.preparer ?? null);
  const [preparedBy, setPreparedBy] = useState<string | null>(doc.preparedBy ?? null);
  const [preparedAt, setPreparedAt] = useState<string | null>(doc.preparedAt ?? null);
  const [incomplete, setIncomplete] = useState<boolean>(!!doc.incomplete);
  // Articles SIGNALÉS manquants par le préparateur lors d'une remise sur la file.
  const [reportedMissing, setReportedMissing] = useState<string[]>(doc.reportedMissing ?? []);
  const reportedMissingSet = useMemo(() => new Set(reportedMissing), [reportedMissing]);
  const reportedMissingNames = useMemo(
    () => doc.lines.filter((l) => reportedMissingSet.has(l.itemCode)).map((l) => l.itemName).join(", "),
    [doc.lines, reportedMissingSet],
  );
  const [bigOpen, setBigOpen] = useState(false);
  const [requeuing, setRequeuing] = useState(false);

  // Deep-link (« rentrer dans la commande ») : ouvre la vue en grand — la console
  // de lot — et défile jusqu'à la ligne. Le nonce change à chaque clic depuis la
  // liste → rouvre la même commande (« si je rentre encore dedans, rouvrir »).
  useEffect(() => {
    if (!autoOpenNonce) return;
    setBigOpen(true);
    const h = setTimeout(() => rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    return () => clearTimeout(h);
  }, [autoOpenNonce]);
  // Remise sur la file : dialog de signalement des manquants + sélection en cours.
  const [requeueOpen, setRequeueOpen] = useState(false);
  const [requeuePicks, setRequeuePicks] = useState<Set<string>>(new Set());
  // Vérification avant de marquer « faite » (évite les validations par erreur).
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Palettes constatées à la préparation — saisies DANS la confirmation « fait »,
  // puis totalisées par transporteur sur le bon de transport. Repartir de la
  // saisie existante permet de corriger un comptage sans le ressaisir.
  const [palettes, setPalettes] = useState<PaletteCounts>(doc.palettes ?? EMPTY_PALETTES);
  const setPalette = (k: PaletteKind, v: number) =>
    setPalettes((cur) => ({ ...cur, [k]: Number.isFinite(v) && v > 0 ? Math.floor(v) : 0 }));

  // ── Modifier la PERSONNE qui a fait la commande (« Fait par … ») ──
  //    Dialog partagé (PreparedByDialog) — badge cliquable, menu « ⋯ » et clic droit.
  const [editByOpen, setEditByOpen] = useState(false);
  const [savingBy, setSavingBy] = useState(false);

  async function changePreparedBy(person: string) {
    const prev = preparedBy;
    setSavingBy(true);
    setPreparedBy(person);
    onPatchDoc(doc.docEntry, { preparedBy: person });
    try {
      // { docEntry, by } sans `prepared` = ré-attribution (heure du clic conservée).
      const res = await fetch("/api/livraisons/prepared", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, by: person }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || j?.ok === false) {
        setPreparedBy(prev);
        onPatchDoc(doc.docEntry, { preparedBy: prev });
        toast.error(j?.error ? `Échec : ${j.error}` : "Échec du changement de personne");
        return;
      }
      toast.success(`BL n°${doc.docNum} — fait par ${displayPersonName(person)}`);
      setEditByOpen(false);
    } catch {
      setPreparedBy(prev);
      onPatchDoc(doc.docEntry, { preparedBy: prev });
      toast.error("Échec du changement de personne");
    } finally {
      setSavingBy(false);
    }
  }

  async function setPreparedTo(next: boolean) {
    // État antérieur capturé pour un rollback FIDÈLE en cas d'échec (marquer
    // « faite » lève « à reprendre » — il faut le restaurer si le POST échoue,
    // sinon le badge « À reprendre » disparaîtrait définitivement).
    const prev = { prepared, incomplete, reportedMissing };
    const rollback = () => {
      setPrepared(prev.prepared); setIncomplete(prev.incomplete); setReportedMissing(prev.reportedMissing);
      onPatchDoc(doc.docEntry, { prepared: prev.prepared, incomplete: prev.incomplete, reportedMissing: prev.reportedMissing });
    };
    setPrepared(next);
    // Marquer « faite » lève « à reprendre » ET son signalement de manquants
    // (le serveur supprime le même enregistrement livincomplete).
    if (next) { setIncomplete(false); setReportedMissing([]); }
    // Optimiste : la carte change d'onglet (À préparer ↔ Fait) immédiatement.
    onPatchDoc(doc.docEntry, { prepared: next, ...(next ? { incomplete: false, reportedMissing: [] } : {}) });
    setSavingPrep(true);
    try {
      const res = await fetch("/api/livraisons/prepared", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // Le comptage n'accompagne QUE le passage en « fait » : annuler un
        // « fait » ne doit pas effacer les palettes déjà constatées.
        body: JSON.stringify({ docEntry: doc.docEntry, prepared: next, ...(next ? { palettes } : {}) }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || j?.ok === false) {
        rollback();
        toast.error(j?.error ? `Échec : ${j.error}` : "Échec de l'enregistrement");
        return;
      }
      // Auteur + heure du « fait » (« Fait par … · 14:32 ») renvoyés par l'API.
      const by = next ? (j?.by ?? null) : null;
      const at = next ? (j?.at ?? new Date().toISOString()) : null;
      setPreparedBy(by);
      setPreparedAt(at);
      onPatchDoc(doc.docEntry, { preparedBy: by, preparedAt: at, ...(next ? { palettes } : {}) });
    } catch {
      rollback();
      toast.error("Échec de l'enregistrement");
    }
    finally { setSavingPrep(false); }
  }
  // Marquer « faite » passe par une vérification ; annuler le « fait » est direct.
  const togglePrepared = () => {
    if (departed) return;                  // une commande partie ne se re-bascule pas ici
    if (prepared) setPreparedTo(false);
    else setConfirmOpen(true);
  };

  // Statut « départ » (partie en livraison) — 3ᵉ état. Optimiste + persistance.
  const [departed, setDeparted] = useState<boolean>(!!doc.departed);
  const [departedBy, setDepartedBy] = useState<string | null>(doc.departedBy ?? null);
  const [departedAt, setDepartedAt] = useState<string | null>(doc.departedAt ?? null);
  const [savingDepart, setSavingDepart] = useState(false);

  // ── « Mettre en préparation » (onglet Ventes, dispatch) : lâche le BL à
  //    l'entrepôt — il passe alors dans « À préparer ». Piloté par doc.misEnPrep
  //    (patchDoc parent) : le BL change d'onglet sans recharger. ──
  const released = doc.misEnPrep ?? false;
  const [savingRelease, setSavingRelease] = useState(false);
  async function releaseToPrep() {
    if (savingRelease) return;
    setSavingRelease(true);
    try {
      const res = await fetch("/api/livraisons/mise-en-prep", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, misEnPrep: true, names: [doc.cardName] }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || j?.ok === false) throw new Error(j?.error || "Échec de la mise en préparation");
      onPatchDoc(doc.docEntry, { misEnPrep: true, misEnPrepBy: j?.by ?? null, misEnPrepAt: j?.at ?? null });
      toast.success(`${doc.cardName} — mis en préparation (visible entrepôt)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la mise en préparation");
    } finally {
      setSavingRelease(false);
    }
  }

  async function setDepartedTo(next: boolean) {
    // État antérieur capturé : marquer « départ » force « faite » (partir implique
    // préparé) — en cas d'échec il faut restaurer le `prepared` d'origine, sinon
    // une commande « à préparer » atterrirait à tort dans l'onglet « Fait ».
    const prev = { departed, prepared };
    const rollback = () => {
      setDeparted(prev.departed); setPrepared(prev.prepared);
      onPatchDoc(doc.docEntry, { departed: prev.departed, prepared: prev.prepared });
    };
    setDeparted(next);
    if (next) setPrepared(true);           // partir implique « faite »
    onPatchDoc(doc.docEntry, { departed: next, ...(next ? { prepared: true } : {}) });
    setSavingDepart(true);
    try {
      const res = await fetch("/api/livraisons/departed", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, departed: next }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || j?.ok === false) {
        rollback();
        toast.error(j?.error ? `Échec : ${j.error}` : "Échec de l'enregistrement");
        return;
      }
      const by = next ? (j?.by ?? null) : null;
      const at = next ? (j?.at ?? new Date().toISOString()) : null;
      setDepartedBy(by);
      setDepartedAt(at);
      onPatchDoc(doc.docEntry, { departedBy: by, departedAt: at });
      // Alerte douce (lot présent mais périmé, ou lots non vérifiés) — le départ
      // est accepté, mais on prévient le préparateur.
      if (next && j?.warning) toast.warning(j.warning);
    } catch {
      rollback();
      toast.error("Échec de l'enregistrement");
    }
    finally { setSavingDepart(false); }
  }

  // Transitions d'état déclenchées depuis les menus (« ⋯ » et clic droit).
  function markAPreparer() { if (departed) setDepartedTo(false); if (prepared) setPreparedTo(false); }
  function markFait()      { if (departed) setDepartedTo(false); if (!prepared) setPreparedTo(true); }
  function markDepart()    { if (!departed) setDepartedTo(true); }

  // S'AFFECTER la commande (claim) : celui qui clique la prépare. `open`=true
  // ouvre en plus la vue en grand. Partagé par le bouton Agrandir et le tap
  // direct sur la ligne (préparateur). Concurrence gérée côté serveur.
  async function claim(open: boolean) {
    if (open) setBigOpen(true);
    try {
      const res = await fetch("/api/livraisons/preparer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, action: "claim" }),
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.ok) {
        if (j.alreadyClaimed) {
          // Un autre préparateur l'a déjà prise : on l'affiche (badge + toast)
          // mais on laisse consulter le BL — on n'écrase pas son affectation.
          setPreparer(j.preparer ?? null);
          onPatchDoc(doc.docEntry, { preparer: j.preparer ?? null });
          toast.info(`Déjà en préparation par ${displayPersonName(j.preparer)}`);
        } else {
          setPreparer(j.preparer ?? null); setIncomplete(false); setReportedMissing([]);
          onPatchDoc(doc.docEntry, { preparer: j.preparer ?? null, incomplete: false, reportedMissing: [] });
          if (!open) toast.success(`Commande n°${doc.docNum} affectée — à vous`);
        }
      }
    } catch { /* affectation non bloquante */ }
  }
  // Ouvrir la commande en grand → s'affecter comme préparateur (qui clique prépare).
  async function openBig() { await claim(true); }

  // Tap direct sur la ligne (préparateur) → s'affecte la commande. On ignore le
  // commercial (canDispatch), les commandes déjà faites/parties/déjà prises, et
  // les clics sur un contrôle (bouton, lien, champ) qui gardent leur action.
  const claimableByTap = !canDispatch && doc.open && !prepared && !departed && !preparer;
  function onRowClick(e: ReactMouseEvent) {
    if (!claimableByTap) return;
    const el = e.target as HTMLElement;
    if (el.closest("button, a, input, select, textarea")) return;
    void claim(false);
  }

  // Pas entièrement préparée → remise sur la file + signalement (notification).
  // `missing` = codes articles signalés manquants par le préparateur (facultatif).
  async function requeue(missing: string[] = []) {
    setRequeuing(true);
    try {
      const res = await fetch("/api/livraisons/preparer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, action: "requeue", missing }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { toast.error(j?.error || "Échec"); return; }
      const reported: string[] = Array.isArray(j.reportedMissing) ? j.reportedMissing : missing;
      setPreparer(null); setIncomplete(true); setPrepared(false); setPreparedBy(null); setPreparedAt(null); setDeparted(false); setDepartedAt(null);
      setReportedMissing(reported);
      setRequeueOpen(false);
      setBigOpen(false);
      onPatchDoc(doc.docEntry, { preparer: null, incomplete: true, prepared: false, preparedBy: null, preparedAt: null, departed: false, departedAt: null, reportedMissing: reported });
      toast.warning(reported.length
        ? `Commande n°${doc.docNum} remise sur la file — ${reported.length} manquant${reported.length > 1 ? "s" : ""} signalé${reported.length > 1 ? "s" : ""}`
        : `Commande n°${doc.docNum} non terminée — remise sur la file`);
    } catch { toast.error("Échec"); }
    finally { setRequeuing(false); }
  }

  // Le transporteur courant doit rester sélectionnable même s'il n'est pas dans
  // la table Carrier (code SAP brut) → on l'injecte en tête si besoin.
  const options: CarrierOption[] = useMemo(() => {
    const base = carriers.slice();
    if (doc.trspCode && !base.some((c) => c.sapValue === doc.trspCode)) {
      base.unshift({ name: doc.carrierName ?? doc.trspCode, sapValue: doc.trspCode });
    }
    return base;
  }, [carriers, doc.trspCode, doc.carrierName]);

  async function handleCarrier(value: string) {
    if (value === (doc.trspCode ?? "")) return;
    setSavingCarrier(true);
    await onCarrierChange(doc.docEntry, value);
    setSavingCarrier(false);
  }

  // Modification : on résout le client puis on DIFFUSE la cible à l'Écran 2 (même
  // fenêtre, aucun nouvel onglet). L'Écran 2 bascule en saisie sur ce BL (mode
  // collant) et pré-remplit le panier avec ses lignes, éditables.
  const [modifBusy, setModifBusy] = useState(false);
  async function startModif() {
    setModifBusy(true);
    try {
      const r = await fetch(`/api/clients/resolve?code=${encodeURIComponent(doc.cardCode)}`);
      const j = await r.json().catch(() => null);
      if (!j?.id) {
        toast.error("Client introuvable en télévente — modification impossible depuis ici.");
        return;
      }
      broadcastActiveClient({
        clientId: j.id,
        clientName: doc.cardName,
        stockSharePct: 100,
        client: null,
        modif: { docEntry: doc.docEntry, docNum: doc.docNum },
      });
      toast.success(`Modification du BL n°${doc.docNum} chargée sur l'Écran 2`, {
        description: "La saisie s'ouvre sur l'Écran 2 (même fenêtre).",
        duration: 6000,
      });
    } catch {
      toast.error("Échec du chargement de la modification.");
    } finally {
      setModifBusy(false);
    }
  }

  // ── Changer le CLIENT du BL (« re-coder ») : annule la commande et la recrée à
  //    l'identique sous un autre CardCode. Cas d'usage : mauvais client validé.
  //    Garde-fou : dialog de confirmation + aperçu du client cible avant exécution.
  const [rebindOpen, setRebindOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [preview, setPreview] = useState<
    | { state: "idle" }
    | { state: "loading" }
    | { state: "error"; message: string }
    | { state: "ok"; cardCode: string; cardName: string; frozen: boolean; valid: boolean }
  >({ state: "idle" });
  const [rebinding, setRebinding] = useState(false);

  // Aperçu (débounce) : valide le CardCode saisi et affiche le nom du client cible.
  useEffect(() => {
    const code = newCode.trim();
    if (!rebindOpen || code.length < 2) { setPreview({ state: "idle" }); return; }
    if (code.toUpperCase() === doc.cardCode.toUpperCase()) {
      setPreview({ state: "error", message: "C'est déjà le client de cette commande." });
      return;
    }
    let cancelled = false;
    setPreview({ state: "loading" });
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/sap/orders/rebind?cardCode=${encodeURIComponent(code)}`);
        const j = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok || !j?.ok) { setPreview({ state: "error", message: j?.error || "Client introuvable." }); return; }
        setPreview({ state: "ok", cardCode: j.cardCode, cardName: j.cardName, frozen: j.frozen, valid: j.valid });
      } catch {
        if (!cancelled) setPreview({ state: "error", message: "SAP injoignable." });
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [newCode, rebindOpen, doc.cardCode]);

  const canRebind = preview.state === "ok" && !preview.frozen && preview.valid;

  async function confirmRebind() {
    if (preview.state !== "ok" || !canRebind) return;
    setRebinding(true);
    try {
      const res = await fetch("/api/sap/orders/rebind", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, newCardCode: preview.cardCode }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { toast.error(j?.error || "Échec du changement de client"); return; }
      if (j.warning) toast.warning(j.warning, { duration: 10000 });
      else toast.success(`BL recréé pour ${preview.cardName} (n°${j.newDocNum}) — ancien n°${j.oldDocNum} annulé`, { duration: 7000 });
      setRebindOpen(false); setNewCode(""); setPreview({ state: "idle" });
      onReload();
    } catch {
      toast.error("SAP injoignable — client non modifié");
    } finally {
      setRebinding(false);
    }
  }

  // ── « Avoir / exclu » MANUEL (menus, dispatch uniquement) ──
  //    Surcharge PRIORITAIRE sur la détection automatique des avoirs : le BL est
  //    déduit à 100 % des totaux mais reste listé (grisé). Optimiste + rollback.
  const [togglingExcluded, setTogglingExcluded] = useState(false);
  async function toggleExcluded() {
    if (togglingExcluded) return;
    const next = !doc.excluded;
    setTogglingExcluded(true);
    onPatchDoc(doc.docEntry, { excluded: next });
    try {
      const res = await fetch("/api/livraisons/excluded", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, excluded: next }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || j?.ok === false) {
        onPatchDoc(doc.docEntry, { excluded: !next });
        toast.error(j?.error ? `Échec : ${j.error}` : "Échec de l'enregistrement");
        return;
      }
      toast.success(next
        ? `BL n°${doc.docNum} marqué « avoir / exclu » — déduit des totaux`
        : `BL n°${doc.docNum} réintégré dans les totaux`);
    } catch {
      onPatchDoc(doc.docEntry, { excluded: !next });
      toast.error("Échec de l'enregistrement");
    } finally {
      setTogglingExcluded(false);
    }
  }

  // ── Menu contextuel (clic droit sur la ligne) — raccourci power-user : les
  //    mêmes actions vivent dans le menu « ⋯ » visible de la ligne. ──
  const { menu, openAt, close: closeMenu } = useContextMenu(220, 236);
  function onRowContextMenu(e: ReactMouseEvent) {
    if (!doc.open) return;                                    // commande livrée/annulée : pas d'action
    const el = e.target as HTMLElement;
    if (el.closest("input, select, textarea")) return;        // garde le menu natif dans les champs (copier/coller)
    openAt(e);
  }

  const docStatusOf: StatusTab = departed ? "DEPART" : prepared ? "FAIT" : "A_PREPARER";

  // ── Récap imprimable (bon de préparation) — fenêtre dédiée + impression.
  //    En-tête logistique complet : transporteur, tournée, HEURE D'ENLÈVEMENT et
  //    PRÉPARATEUR (demande direction) ; le corps reste épuré (pas de promos). ──
  function handlePrint() {
    const preparerName = preparedBy ?? preparer;
    const ok = printOrderRecap(
      {
        docNum: doc.docNum,
        cardCode: doc.cardCode,
        // Nom COMPLET du client (fiche télévente) sur le document imprimé.
        cardName: doc.cardFullName ?? doc.cardName,
        clientType: doc.clientType,
        colis: doc.colis,
        weightKg: doc.weightKg,
        // Reprend le comptage saisi au « fait » ; absent → cases vides à remplir.
        palettes: doc.palettes ?? null,
        // Mêmes lignes consolidées qu'à l'écran (colis complets, sans ligne à 0).
        lines: displayLines,
      },
      {
        dateLabel: formatDeliveryDate(doc.dueDate),
        carrierName: doc.carrierName,
        tourneeLabel: docTourneeKeyLabel(doc, tournees).label,
        // Heure d'enlèvement : celle de la tournée mémorisée, sinon l'heure du BL.
        pickupTime: doc.savedTournee?.heure ?? doc.trspHeure,
        preparedBy: preparerName ? displayPersonName(preparerName) : null,
        missingCodes: missingSet,
      },
    );
    if (!ok) toast.error("Impression bloquée — autorisez les pop-ups pour ce site.");
  }

  // ── Badges d'état de la ligne — par ordre de priorité (bloquant → info),
  //    2 visibles maximum, le reste replié dans « +n » (le détail complet reste
  //    lisible dans la vue en grand et au survol du « +n »). ──
  const statusBadges: { key: string; label: string; node: ReactNode }[] = [];
  if (incomplete) statusBadges.push({
    key: "incomplete", label: "À reprendre",
    node: (
      <span title="Pas entièrement préparée — remise sur la file" className={`${PILL} ${PILL_TONE.destructive}`}>
        <AlertTriangle className="h-3 w-3 shrink-0" /> À reprendre
      </span>
    ),
  });
  if (missingSet.size > 0) statusBadges.push({
    key: "missing", label: `${missingSet.size} manquant${missingSet.size > 1 ? "s" : ""}`,
    node: (
      <span title="Articles en stock SAP négatif (tous entrepôts) sur cette commande — achat à prévoir"
        className={`${PILL} ${PILL_TONE.destructive}`}>
        <PackageX className="h-3 w-3 shrink-0" /> {missingSet.size} manquant{missingSet.size > 1 ? "s" : ""}
      </span>
    ),
  });
  if (reportedMissing.length > 0) statusBadges.push({
    key: "reported", label: `${reportedMissing.length} signalé${reportedMissing.length > 1 ? "s" : ""}`,
    node: (
      <span title={`Signalé(s) manquant(s) par le préparateur : ${reportedMissingNames}`}
        className={`${PILL} ${PILL_TONE.warning}`}>
        <PackageX className="h-3 w-3 shrink-0" /> {reportedMissing.length} signalé{reportedMissing.length > 1 ? "s" : ""}
      </span>
    ),
  });
  if (carriedOver) statusBadges.push({
    key: "carried", label: `${carriedOverdue ? "Reportée" : "Anticipée"} · Livr. ${dueShort}`,
    node: (
      <span
        title={
          carriedOverdue
            ? `Livraison prévue le ${capitalize(formatDeliveryDate(dueISO))} — pas encore faite, reportée dans la file du jour`
            : `Livraison prévue le ${capitalize(formatDeliveryDate(dueISO))} — mise en préparation en avance, dans la file jusqu'à ce qu'elle soit faite`
        }
        className={`${PILL} ${carriedOverdue ? PILL_TONE.warning : PILL_TONE.info}`}
      >
        <CalendarDays className="h-3 w-3 shrink-0" />
        {carriedOverdue ? "Reportée" : "Anticipée"} · Livr. {dueShort}
      </span>
    ),
  });
  if (preparer && !prepared) statusBadges.push({
    key: "claimed", label: `En préparation par ${displayPersonName(preparer)}`,
    node: (
      <span title={`En préparation par ${displayPersonName(preparer)}`} className={`${PILL} ${PILL_TONE.info}`}>
        <UserCheck className="h-3 w-3 shrink-0" /> <span className="truncate">{displayPersonName(preparer)}</span>
      </span>
    ),
  });
  if (prepared && !departed && (preparedBy ?? preparer)) statusBadges.push({
    key: "doneBy", label: `Fait par ${displayPersonName(preparedBy ?? preparer)}`,
    node: (
      // Cliquable : changer la PERSONNE qui a fait la commande.
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setEditByOpen(true); }}
        title={`Préparée par ${displayPersonName(preparedBy ?? preparer)}${fmtClock(preparedAt) ? ` à ${fmtClock(preparedAt)}` : ""} — cliquer pour changer la personne`}
        className={`${PILL} ${PILL_TONE.success} hover:bg-success/20 transition-colors`}>
        <UserCheck className="h-3 w-3 shrink-0" /> <span className="truncate">Fait par {displayPersonName(preparedBy ?? preparer)}{fmtClock(preparedAt) ? ` · ${fmtClock(preparedAt)}` : ""}</span>
        <Pencil className="h-2.5 w-2.5 opacity-70 shrink-0" />
      </button>
    ),
  });
  if (departed) statusBadges.push({
    key: "departed", label: `Parti${departedBy ? ` · ${displayPersonName(departedBy)}` : ""}`,
    node: (
      <span title={departedBy ? `Parti — ${displayPersonName(departedBy)}${fmtClock(departedAt) ? ` à ${fmtClock(departedAt)}` : ""}` : "Partie en livraison"}
        className={`${PILL} ${PILL_TONE.info}`}>
        <Truck className="h-3 w-3 shrink-0" /> <span className="truncate">Parti{departedBy ? ` · ${displayPersonName(departedBy)}` : ""}{fmtClock(departedAt) ? ` · ${fmtClock(departedAt)}` : ""}</span>
      </span>
    ),
  });
  if (!doc.open) statusBadges.push({
    key: "delivered", label: "Livrée",
    node: (
      <span className={`${PILL} ${PILL_TONE.success}`}>
        <CheckCircle2 className="h-3 w-3 shrink-0" /> Livrée
      </span>
    ),
  });
  if (doc.excluded) statusBadges.push({
    key: "excluded", label: "Avoir — déduit",
    node: (
      <span title="BL totalement avoiré (facturé puis avoir total / doublon) — déduit des totaux"
        className={`${PILL} ${PILL_TONE.destructive}`}>
        <RotateCcw className="h-3 w-3 shrink-0" /> Avoir — déduit
      </span>
    ),
  });
  const hiddenBadges = statusBadges.slice(2);

  return (
    <li ref={rowRef}>
      {/* MOBILE (< sm) : la ligne passe sur DEUX rangées — identité client pleine
          largeur (le nom ne se fait plus écraser par les boutons), puis l'action
          d'état en GRANDE cible tactile + colis + menu. ≥ sm : une seule rangée
          (flex-nowrap). */}
      <div
        onContextMenu={onRowContextMenu}
        onClick={onRowClick}
        className={`flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-secondary/25 transition-colors ${doc.excluded ? "opacity-50" : ""} ${claimableByTap ? "cursor-pointer" : ""}`}
      >
        {/* Bouton d'état — SEULE action colorée de la ligne, toujours en tête
            (placement constant). BL pas encore lâché (onglet Ventes) → le bouton
            EST la mise en préparation ; sinon 3 états : À préparer → Fait → Départ. */}
        {canDispatch && !released ? (
          <button
            type="button"
            onClick={releaseToPrep}
            disabled={savingRelease}
            title="Mettre ce magasin en préparation — il devient visible pour l'entrepôt (À préparer)"
            className="inline-flex shrink-0 flex-1 sm:flex-none items-center justify-center gap-1.5 h-11 sm:h-9 px-3 rounded-lg text-body font-semibold whitespace-nowrap transition-[background-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-apple)] disabled:opacity-60 active:scale-[0.97] bg-warning text-white hover:bg-[color-mix(in_srgb,hsl(var(--warning))_92%,black)]"
          >
            {savingRelease ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {/* Libellé complet partout : sur mobile le bouton occupe sa propre
                rangée (flex-1), le nom du client ne se fait plus tronquer. */}
            Mettre en prépa
          </button>
        ) : (
        <button
          type="button"
          onClick={departed ? () => setDepartedTo(false) : togglePrepared}
          disabled={savingPrep || savingDepart}
          title={departed
            ? "Commande partie en livraison — cliquer pour la ramener à « fait »"
            : prepared ? "Commande préparée (faite) — cliquer pour annuler" : "Marquer la commande comme préparée (faite)"}
          aria-pressed={prepared || departed}
          className={`inline-flex shrink-0 flex-1 sm:flex-none items-center justify-center gap-1.5 h-11 sm:h-9 px-3 rounded-lg text-body font-semibold whitespace-nowrap transition-[background-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-apple)] disabled:opacity-60 active:scale-[0.97] ${
            departed
              ? "bg-info text-white hover:bg-[color-mix(in_srgb,hsl(var(--info))_92%,black)]"
              : prepared
              ? "bg-success text-white hover:bg-[color-mix(in_srgb,hsl(var(--success))_92%,black)]"
              : "bg-warning/15 text-foreground ring-1 ring-warning/25 hover:bg-warning/25"
          }`}
        >
          {(savingPrep || savingDepart)
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : departed ? <Truck className="h-4 w-4" /> : prepared ? <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
          {/* Libellé visible aussi sur mobile — bouton de préparation lisible et facile à toucher. */}
          <span>{departed ? "Départ" : prepared ? "Fait" : "À préparer"}</span>
        </button>
        )}

        {/* Identité client — première rangée pleine largeur sur mobile. */}
        <div className="order-first w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <ClientLink
              code={doc.cardCode}
              name={doc.cardName}
              className="text-callout sm:text-body font-semibold text-foreground truncate text-left hover:underline decoration-primary/60 underline-offset-2 max-w-full"
            />
            {doc.clientType && (SEG_UI[doc.clientType as keyof typeof SEG_UI] ?? null) && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-caption2 font-semibold ${SEG_UI[doc.clientType as keyof typeof SEG_UI].badge}`}>
                {SEG_UI[doc.clientType as keyof typeof SEG_UI].label}
              </span>
            )}
            {/* Badges d'état : 2 max + « +n » (le survol liste le reste). */}
            {statusBadges.slice(0, 2).map((b) => <Fragment key={b.key}>{b.node}</Fragment>)}
            {hiddenBadges.length > 0 && (
              <span
                title={hiddenBadges.map((b) => b.label).join(" · ")}
                className={`${PILL} bg-secondary text-muted-foreground ring-1 ring-border tnum`}
              >
                +{hiddenBadges.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-caption2 text-muted-foreground flex-wrap">
            <span className="font-mono text-foreground/60 hidden sm:inline">{doc.cardCode}</span>
            <span><span className="hidden sm:inline">· </span>BL n°{doc.docNum}</span>
            {/* Heure de PRISE de la commande dans le système (création SAP). */}
            {fmtClock(doc.takenAt) && (
              <span title={`Commande prise dans le système à ${fmtClock(doc.takenAt)}`}>· Prise {fmtClock(doc.takenAt)}</span>
            )}
            {/* Total HT — chiffre commercial : masqué pour préparateur / livreur. */}
            {canDispatch && <span className="hidden sm:inline">· {fmtEur(doc.totalHT)} HT</span>}
          </div>
          {/* Changement de transporteur / tournée / réf / date — dispatch (desktop
              uniquement + réservé aux commerciaux/admins ; masqué aux préparateurs
              qui n'ont qu'à préparer, pas à dispatcher). */}
          <div className={`mt-1.5 ${canDispatch ? "hidden lg:flex" : "hidden"} flex-wrap items-center gap-1.5`}>
            <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div className="relative">
              <select
                value={doc.trspCode ?? ""}
                disabled={savingCarrier || !doc.open}
                onChange={(e) => handleCarrier(e.target.value)}
                aria-label={`Transporteur de la commande ${doc.docNum}`}
                title={doc.open ? "Changer le transporteur" : "Commande livrée — transporteur figé"}
                className="h-7 max-w-[200px] rounded-md border border-border bg-card pl-2 pr-7 text-caption font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 disabled:cursor-not-allowed appearance-none truncate cursor-pointer"
              >
                <option value="">Non affecté</option>
                {options.map((c) => (
                  <option key={c.sapValue} value={c.sapValue}>{c.name}</option>
                ))}
              </select>
              {savingCarrier ? (
                <Loader2 className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
              ) : (
                <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              )}
            </div>
            {/* Tournée du transporteur → fixe l'heure (U_TrspHeur). Visible dès qu'un
                transporteur est affecté et la commande ouverte. */}
            {doc.open && doc.trspCode && (
              <div className="relative">
                <select
                  value={selectedTourneeId}
                  disabled={savingTournee || !tournees}
                  onChange={(e) => handleTournee(e.target.value)}
                  aria-label={`Tournée de la commande ${doc.docNum}`}
                  title={tournees ? "Choisir la tournée (fixe l'heure, mémorisée pour le client)" : "Chargement des tournées…"}
                  className="h-7 max-w-[220px] rounded-md border border-border bg-card pl-2 pr-7 text-caption font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 disabled:cursor-not-allowed appearance-none truncate cursor-pointer"
                >
                  <option value="">
                    {!tournees ? "Chargement…" : (selectedTourneeId === "" && doc.trspHeure ? `${doc.trspHeure.slice(0, 5)} (à confirmer)` : "Tournée…")}
                  </option>
                  {(tournees ?? []).filter((t) => t.heure).map((t) => (
                    <option key={t.lineId} value={String(t.lineId)}>
                      {t.nom}{t.des ? ` (${t.des})` : ""} — {(t.heure as string).slice(0, 5)}
                    </option>
                  ))}
                </select>
                {savingTournee ? (
                  <Loader2 className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
                ) : (
                  <Clock className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                )}
              </div>
            )}
            {/* N° de commande (réf. client) — éditable directement ici */}
            <div className="relative inline-flex items-center">
              <FileText className="pointer-events-none absolute left-2 h-3 w-3 text-muted-foreground" />
              <input
                value={refDraft}
                onChange={(e) => setRefDraft(e.target.value)}
                onBlur={saveRef}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                disabled={savingRef}
                placeholder="N° commande"
                title="N° de commande (réf. client) — Entrée ou clic ailleurs pour enregistrer"
                aria-label={`N° de commande de la livraison ${doc.docNum}`}
                className="h-7 w-[140px] rounded-md border border-border bg-card pl-7 pr-6 text-caption font-medium text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
              {savingRef && <Loader2 className="pointer-events-none absolute right-1.5 h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            {/* Date de livraison — modifiable directement ici */}
            <div className="relative inline-flex items-center">
              <CalendarDays className="pointer-events-none absolute left-2 h-3 w-3 text-muted-foreground" />
              <input
                type="date"
                value={dueISO}
                disabled={savingDate || !doc.open}
                onChange={(e) => e.target.value && handleDate(e.target.value)}
                title={doc.open ? "Changer la date de livraison du BL" : "Commande livrée — date figée"}
                aria-label={`Date de livraison de la commande ${doc.docNum}`}
                className="h-7 rounded-md border border-border bg-card pl-7 pr-2 text-caption font-medium text-foreground tnum focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 disabled:cursor-not-allowed"
              />
              {savingDate && <Loader2 className="pointer-events-none absolute right-1.5 h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
          </div>
        </div>

        {/* Colis (chiffre fort) / poids — repères logistiques, sans kicker */}
        <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
          <p className="text-right min-w-[52px] whitespace-nowrap">
            <span className="text-title3 font-bold tnum text-foreground">{fmtNum(doc.colis)}</span>{" "}
            <span className="text-caption2 text-muted-foreground">colis</span>
          </p>
          <p className="hidden sm:block text-right min-w-[52px] whitespace-nowrap text-caption tnum text-muted-foreground">
            {fmtNum(doc.weightKg)} kg
          </p>
          {/* Ouvrir en grand (+ affecter au préparateur qui clique) — cible tactile
              agrandie sur mobile pour lancer la préparation d'un pouce. */}
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={openBig}
            title="Ouvrir la commande en grand (et se l'affecter)"
            aria-label={`Ouvrir la commande ${doc.docNum} en grand`}
            className="h-11 w-11 sm:h-9 sm:w-9"
          >
            <Maximize2 className="h-[18px] w-[18px] sm:h-4 sm:w-4" />
          </Button>
          {/* Menu « ⋯ » — reprend TOUT le clic droit (tablettes d'entrepôt) ;
              le clic droit reste le raccourci power-user. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Actions de la commande"
                aria-label={`Actions de la commande ${doc.docNum}`}
                className="h-11 w-11 sm:h-9 sm:w-9 text-muted-foreground"
              >
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {/* setTimeout : laisse le menu rendre le focus avant d'ouvrir un
                  dialog (sinon Radix referme le dialog en restituant le focus). */}
              <DropdownMenuItem onSelect={() => setTimeout(() => { void openBig(); }, 0)}>
                <Maximize2 className="mr-2 h-4 w-4 text-muted-foreground" /> Ouvrir en grand
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handlePrint}>
                <Printer className="mr-2 h-4 w-4 text-muted-foreground" /> Imprimer le bon de préparation
              </DropdownMenuItem>
              {canDispatch && doc.open && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={startModif} disabled={modifBusy}>
                    <Pencil className="mr-2 h-4 w-4 text-muted-foreground" /> Modifier la commande
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setTimeout(() => setRebindOpen(true), 0)}>
                    <UserCog className="mr-2 h-4 w-4 text-muted-foreground" /> Changer le client…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={toggleExcluded} disabled={togglingExcluded}>
                    <RotateCcw className="mr-2 h-4 w-4 text-destructive" />
                    {doc.excluded ? "Réintégrer dans les totaux" : "Avoir / exclure des totaux"}
                  </DropdownMenuItem>
                </>
              )}
              {doc.open && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={markAPreparer}>
                    <Clock className="mr-2 h-4 w-4 text-warning" /> À préparer
                    {docStatusOf === "A_PREPARER" && <Check className="ml-auto h-3.5 w-3.5 text-foreground/50" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={markFait}>
                    <CheckCircle2 className="mr-2 h-4 w-4 text-success" /> Fait
                    {docStatusOf === "FAIT" && <Check className="ml-auto h-3.5 w-3.5 text-foreground/50" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={markDepart}>
                    <Truck className="mr-2 h-4 w-4 text-info" /> Départ
                    {docStatusOf === "DEPART" && <Check className="ml-auto h-3.5 w-3.5 text-foreground/50" />}
                  </DropdownMenuItem>
                </>
              )}
              {prepared && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setTimeout(() => setEditByOpen(true), 0)}>
                    <UserCheck className="mr-2 h-4 w-4 text-success" /> Changer qui a fait…
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Repli desktop uniquement : sur mobile le contenu est toujours affiché. */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Replier le détail" : "Voir le détail"}
            aria-expanded={open}
            className="hidden lg:inline-flex text-muted-foreground"
          >
            <ChevronDown className={`h-4 w-4 transition-transform duration-[var(--dur-base)] ease-[var(--ease-apple)] ${open ? "rotate-180" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Contenu de la commande — TOUJOURS visible sur mobile (préparation),
          repliable sur desktop via le chevron. Lignes d'articles en liste à
          séparateurs hairline : désignation en texte muted, seule l'ALERTE
          (manquant / signalé) reste colorée. */}
      <div className={`px-3 sm:px-4 pb-3.5 pt-0.5 block ${open ? "lg:block" : "lg:hidden"}`}>
        <div className="rounded-lg ring-1 ring-border bg-card overflow-hidden">
          {doc.comments && (
            <p className="px-3 py-2 text-caption text-muted-foreground border-b border-border italic">
              {doc.comments}
            </p>
          )}
          <table className="w-full text-body">
            <thead className="text-caption2 text-muted-foreground border-b border-border">
              <tr>
                <th className="text-center font-medium px-2 py-1.5 w-14 whitespace-nowrap">Colis</th>
                <th className="text-left font-medium px-3 py-1.5">Article</th>
                {/* Lot saisissable en direct : le n° d'entrée (EM) se corrige ici,
                    sans passer par le menu de ligne. */}
                <th className="text-left font-medium px-3 py-1.5 w-[120px] whitespace-nowrap">Lot</th>
                <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap hidden sm:table-cell">Qté</th>
                <th className="text-right font-medium px-3 py-1.5 whitespace-nowrap hidden sm:table-cell">kg</th>
                {/* Colonne « ⋯ » : outil de ligne (lot / échange) sans clic droit. */}
                <th className="w-10 px-2 py-1.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayLines.map((l, i) => {
                const isMissing = isLineMissing(l.mergedCodes);
                const isReported = l.mergedCodes.some((c) => reportedMissingSet.has(c));
                return (
                <tr
                  key={`${l.itemCode}-${i}`}
                  onContextMenu={(e) => openSwap(e, l.itemCode, l.itemName)}
                  title={doc.open ? "Clic droit : changer le lot ou échanger l'article" : undefined}
                  className={`${isMissing ? "bg-destructive/5" : isReported ? "bg-warning/5" : ""} ${doc.open ? "cursor-context-menu" : ""}`}
                >

                  {/* Colisage en premier (gauche) — repère principal du préparateur,
                      chiffre volontairement gros pour se lire d'un coup d'œil. */}
                  <td className="px-2 py-2.5 text-center align-middle">
                    <span className="text-title3 font-bold tnum text-foreground">{fmtNum(l.colis)}</span>
                  </td>
                  <td className="px-3 py-2.5 min-w-0 align-middle">
                    <div className="flex items-center gap-2.5">
                      <BrandLogo marque={l.marque} logos={brandLogos} size="md" zoomable />
                      <div className="min-w-0 flex-1">
                        {/* Nom + désignation : sur TABLETTE une seule ligne (troncature) ;
                            sur petit téléphone la désignation passe dessous, en corps
                            plus grand et plus contrasté pour rester lisible. */}
                        <div className="flex items-baseline gap-x-2 gap-y-0 min-w-0 max-sm:flex-wrap">
                          <span className={`text-callout font-semibold truncate min-w-0 ${isMissing ? "text-muted-foreground line-through decoration-destructive/60" : "text-foreground"}`}>{l.itemName}</span>
                          {/* Marque + calibre en blanc (repères préparateur), reste muted. */}
                          <ArticleDesignation l={l} className="text-caption max-sm:basis-full max-sm:text-body" />
                          <span className="font-mono text-caption2 text-muted-foreground/60 hidden lg:inline shrink-0">{l.itemCode}</span>
                        </div>
                        {(isMissing || isReported) && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {isMissing && <span className={`${PILL} ${PILL_TONE.destructive}`}>Manquant</span>}
                            {isReported && !isMissing && <span className={`${PILL} ${PILL_TONE.warning}`}>Signalé manquant</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <LotCellInput
                      docEntry={doc.docEntry}
                      docNum={doc.docNum}
                      itemCode={l.itemCode}
                      itemName={l.itemName}
                      lot={l.lot}
                      disabled={!doc.open}
                      onDone={onReload}
                    />
                  </td>
                  <td className="px-3 py-2 text-right text-caption tnum text-muted-foreground hidden sm:table-cell align-middle">{fmtNum(l.quantity)}</td>
                  <td className="px-3 py-2 text-right text-caption tnum text-muted-foreground hidden sm:table-cell align-middle">{fmtNum(l.weightKg)}</td>
                  <td className="px-2 py-2 text-right align-middle">
                    {doc.open && (
                      <button
                        type="button"
                        onClick={(e) => openSwapFromButton(e, l.itemCode, l.itemName)}
                        title="Changer le lot ou échanger l'article"
                        aria-label={`Changer le lot ou échanger ${l.itemName}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Vue en GRAND — préparation focalisée + affectation au préparateur */}
      <Dialog open={bigOpen} onOpenChange={setBigOpen}>
        <DialogContent
          size="lg"
          className="max-h-[92vh] overflow-y-auto"
          // Le menu de ligne « Changer le lot / Échanger l'article » est porté
          // dans <body> (hors de la modale). Sans ça, l'ouverture de l'onglet
          // « Échanger l'article » (focus sur le champ de recherche = focus HORS
          // modale) déclenchait la fermeture Radix. On ignore donc les
          // interactions/focus issus de ce menu.
          onInteractOutside={(e) => {
            const t = e.detail.originalEvent.target as HTMLElement | null;
            if (t?.closest("[data-linetool]")) e.preventDefault();
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 pr-8">
              <Boxes className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="truncate min-w-0">{doc.cardName}</span>
              <span className="text-caption font-normal text-muted-foreground shrink-0">· BL n°{doc.docNum}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">Détail de la livraison : lignes, colis et poids du bon de livraison.</DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-title1 font-bold tnum text-foreground leading-none">
              {fmtNum(doc.colis)} <span className="text-caption font-medium text-muted-foreground">colis</span>
            </span>
            <span className="text-callout font-semibold tnum text-muted-foreground">{fmtNum(doc.weightKg)} kg</span>
            {/* Heure de PRISE de la commande dans le système (création SAP). */}
            {fmtClock(doc.takenAt) && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-secondary text-muted-foreground ring-1 ring-border px-2.5 py-1 text-caption font-semibold">
                <Clock className="h-3.5 w-3.5" /> Prise · {fmtClock(doc.takenAt)}
                <InfoHint label="Heure de prise" size={14}>Commande prise dans le système à {fmtClock(doc.takenAt)}</InfoHint>
              </span>
            )}
            {(preparedBy ?? preparer) && (
              // Cliquable quand la commande est « faite » : changer la personne.
              <button
                type="button"
                onClick={() => { if (prepared) setEditByOpen(true); }}
                disabled={!prepared}
                title={prepared ? "Changer la personne qui a fait la commande" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full ${PILL_TONE.info} px-2.5 py-1 text-caption font-semibold ${prepared ? "hover:bg-info/20 transition-colors" : "cursor-default"}`}
              >
                <UserCheck className="h-3.5 w-3.5" /> {prepared ? "Fait par" : "Préparée par"} {displayPersonName(preparedBy ?? preparer)}
                {prepared && <Pencil className="h-3 w-3 opacity-70" />}
              </button>
            )}
            {prepared && (
              <span title={fmtClock(preparedAt) ? `Marquée « faite » à ${fmtClock(preparedAt)}` : "Marquée « faite »"}
                className={`inline-flex items-center gap-1 rounded-full ${PILL_TONE.success} px-2.5 py-1 text-caption font-semibold`}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Fait{fmtClock(preparedAt) ? ` · ${fmtClock(preparedAt)}` : ""}
              </span>
            )}
            {departed && (
              <span title={fmtClock(departedAt) ? `Partie en livraison à ${fmtClock(departedAt)}` : "Partie en livraison"}
                className={`inline-flex items-center gap-1 rounded-full ${PILL_TONE.info} px-2.5 py-1 text-caption font-semibold`}>
                <Truck className="h-3.5 w-3.5" /> Départ{fmtClock(departedAt) ? ` · ${fmtClock(departedAt)}` : ""}
              </span>
            )}
          </div>
          {doc.comments && <p className="text-caption italic text-muted-foreground">« {doc.comments} »</p>}

          {/* Astuce : sur BL ouvert, toucher une ligne ouvre la console de lot. */}
          {doc.open && (
            <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <Pencil className="h-3.5 w-3.5 shrink-0" />
              Touchez un article pour <b className="text-foreground font-semibold">changer son lot</b> ou l&apos;échanger.
            </p>
          )}

          {/* Lignes en grand : colisage à gauche + désignation muted + alerte */}
          <ul className="divide-y divide-border rounded-lg ring-1 ring-border overflow-hidden">
            {displayLines.map((l, i) => {
              const isMissing = isLineMissing(l.mergedCodes);
              const isReported = l.mergedCodes.some((c) => reportedMissingSet.has(c));
              return (
              <li
                key={`big-${l.itemCode}-${i}`}
                onClick={(e) => openSwap(e, l.itemCode, l.itemName)}
                onContextMenu={(e) => openSwap(e, l.itemCode, l.itemName)}
                title={doc.open ? "Toucher pour changer le lot ou échanger l'article" : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 ${isMissing ? "bg-destructive/5" : isReported ? "bg-warning/5" : ""} ${doc.open ? "cursor-pointer" : ""}`}
              >

                <span className="inline-flex min-w-[44px] items-center justify-center rounded-md bg-secondary px-2 py-1 text-title3 font-bold tnum text-foreground shrink-0">
                  {fmtNum(l.colis)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-body font-semibold ${isMissing ? "text-muted-foreground line-through decoration-destructive/60" : "text-foreground"}`}>
                    {l.itemName}
                    {isMissing && (
                      <span className={`ml-2 ${PILL} ${PILL_TONE.destructive} no-underline align-middle`}>Manquant</span>
                    )}
                    {isReported && !isMissing && (
                      <span className={`ml-2 ${PILL} ${PILL_TONE.warning} align-middle`}>Signalé manquant</span>
                    )}
                  </p>
                  {/* Marque + calibre en blanc (repères préparateur), reste muted. */}
                  <ArticleDesignation l={l} className="mt-0.5 block text-caption" />
                </div>
                <BrandLogo marque={l.marque} logos={brandLogos} size="lg" className="self-center" zoomable />
              </li>
              );
            })}
          </ul>

          {/* Actions de préparation — EMPILÉES pleine largeur sur mobile (grandes
              cibles, libellés jamais compressés) ; en ligne à partir de sm. */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:flex-wrap pt-1">
            <Button
              type="button"
              variant="success"
              size="xl"
              onClick={() => { setPreparedTo(true); setBigOpen(false); }}
              disabled={savingPrep}
              className="h-12 sm:h-11"
            >
              <CheckCircle2 className="h-4 w-4" /> Préparation terminée
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xl"
              onClick={() => { setRequeuePicks(new Set(reportedMissing)); setRequeueOpen(true); }}
              disabled={requeuing}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {requeuing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              Pas terminée — remettre sur la file
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xl"
              onClick={handlePrint}
              title={`Imprimer le bon de préparation (BL n°${doc.docNum})`}
            >
              <Printer className="h-4 w-4" /> Imprimer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remise sur la file — signalement des articles manquants (facultatif).
          Optimisé mobile / tablette : lignes en grandes cibles tactiles, boutons
          empilés pleine largeur sur petit écran. */}
      <Dialog open={requeueOpen} onOpenChange={(o) => { if (!requeuing) setRequeueOpen(o); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 pr-8">
              <Undo2 className="h-5 w-5 text-destructive shrink-0" />
              <span className="truncate min-w-0">Remettre sur la file</span>
              <span className="text-caption font-normal text-muted-foreground shrink-0">· BL n°{doc.docNum}</span>
            </DialogTitle>
            <DialogDescription className="text-caption text-muted-foreground">
              Touchez le ou les articles <b className="text-foreground">manquants</b> (facultatif) — ils
              seront signalés à l&apos;équipe. La commande repart <b className="text-foreground">« à préparer »</b>.
            </DialogDescription>
          </DialogHeader>

          <ul className="divide-y divide-border rounded-lg ring-1 ring-border overflow-hidden">
            {doc.lines.map((l, i) => {
              const picked = requeuePicks.has(l.itemCode);
              return (
                <li key={`rq-${l.itemCode}-${i}`}>
                  <button
                    type="button"
                    onClick={() => setRequeuePicks((prev) => {
                      const next = new Set(prev);
                      if (next.has(l.itemCode)) next.delete(l.itemCode); else next.add(l.itemCode);
                      return next;
                    })}
                    aria-pressed={picked}
                    className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors ${picked ? "bg-warning/10" : "hover:bg-secondary/40"}`}
                  >
                    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${picked ? "bg-warning text-white" : "ring-1 ring-border text-transparent"}`}>
                      <Check className="h-4 w-4" strokeWidth={3} />
                    </span>
                    <span className="inline-flex min-w-[40px] shrink-0 items-center justify-center rounded-md bg-secondary px-1.5 py-0.5 text-body font-bold tnum text-foreground">
                      {fmtNum(l.colis)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-body font-semibold truncate ${picked ? "text-warning" : "text-foreground"}`}>{l.itemName}</span>
                      <span className="block text-caption2 text-muted-foreground">{fmtNum(l.quantity)} · {fmtNum(l.weightKg)} kg</span>
                    </span>
                    {picked && (
                      <span className={`shrink-0 ${PILL} ${PILL_TONE.warning}`}>
                        <PackageX className="h-3 w-3" /> Manquant
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="xl"
              onClick={() => setRequeueOpen(false)}
              disabled={requeuing}
              className="order-last sm:order-first"
            >
              Annuler
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="xl"
              onClick={() => requeue([...requeuePicks])}
              disabled={requeuing}
            >
              {requeuing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              {requeuePicks.size > 0
                ? `Remettre — ${requeuePicks.size} manquant${requeuePicks.size > 1 ? "s" : ""}`
                : "Remettre sur la file"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Changer la PERSONNE qui a fait la commande (« Fait par … ») */}
      <PreparedByDialog
        open={editByOpen}
        onOpenChange={setEditByOpen}
        subtitle={<>
          BL n°{doc.docNum} — {doc.cardName}. La personne choisie remplace{" "}
          <b className="text-foreground">{displayPersonName(preparedBy ?? preparer)}</b> (l&apos;heure du « fait » est conservée).
        </>}
        currentBy={preparedBy}
        saving={savingBy}
        onPick={changePreparedBy}
      />

      {/* Vérification avant de marquer « faite » (évite les validations par erreur)
          — GARDE la saisie des palettes, reprise sur le bon de transport. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent size="sm">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 pr-8">
              <ListChecks className="h-5 w-5 text-success shrink-0" />
              Confirmer la préparation
            </DialogTitle>
          </DialogHeader>
          <p className="text-body text-muted-foreground">
            Confirme que la commande de <b className="text-foreground">{doc.cardName}</b> (BL n°{doc.docNum})
            est <b className="text-foreground">entièrement préparée</b>.
          </p>
          <div className="flex items-center gap-3 rounded-lg ring-1 ring-border bg-secondary/30 px-3.5 py-2.5">
            <span className="text-title2 font-bold tnum text-foreground leading-none">{fmtNum(doc.colis)}</span>
            <span className="text-caption text-muted-foreground">colis</span>
            <span className="ml-auto text-caption font-semibold tnum text-muted-foreground">{fmtNum(doc.weightKg)} kg · {doc.lineCount} article(s)</span>
          </div>
          {/* Palettes constatées — le total remonte sur le bon de transport du
              transporteur. Laisser tout à 0 = « pas compté » : la case reste
              vide sur le bon, à remplir à la main au chargement. */}
          <div className="rounded-lg ring-1 ring-border bg-secondary/20 px-3 py-2.5">
            <p className="text-caption font-medium text-muted-foreground mb-2">
              Nombre de palette(s)
            </p>
            <div className="grid grid-cols-4 gap-2">
              {PALETTE_TYPES.map((t) => (
                <div key={t.key} className="flex flex-col items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={palettes[t.key] || 0}
                    onChange={(e) => setPalette(t.key, Number(e.target.value))}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label={`${t.label} (${t.size})`}
                    className="h-11 w-full rounded-lg border border-border bg-card text-center text-title3 font-bold tnum text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <span className="text-caption2 text-muted-foreground leading-tight text-center">{t.size}</span>
                  <span className="text-caption2 font-semibold text-foreground leading-tight text-center">{t.label}</span>
                </div>
              ))}
            </div>
            {totalPalettes(palettes) === 0 && (
              <p className="mt-2 text-caption2 text-muted-foreground">
                Rien de compté — la case restera vide sur le bon de transport.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="xl"
              onClick={() => setConfirmOpen(false)}
            >
              Annuler
            </Button>
            <Button
              type="button"
              variant="success"
              size="xl"
              onClick={() => { setConfirmOpen(false); setPreparedTo(true); }}
              disabled={savingPrep}
            >
              <CheckCircle2 className="h-4 w-4" /> Confirmer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Changer le client du BL (re-coder) — garde-fou : annule + recrée */}
      <Dialog open={rebindOpen} onOpenChange={(o) => { if (!rebinding) { setRebindOpen(o); if (!o) { setNewCode(""); setPreview({ state: "idle" }); } } }}>
        <DialogContent size="sm">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 pr-8">
              <UserCog className="h-5 w-5 text-muted-foreground shrink-0" />
              Changer le client — BL n°{doc.docNum}
            </DialogTitle>
          </DialogHeader>

          {/* Client actuel → nouveau */}
          <div className="flex items-center gap-2 rounded-lg ring-1 ring-border bg-secondary/30 px-3.5 py-2.5 text-body">
            <div className="min-w-0">
              <p className="text-caption2 text-muted-foreground">Actuel</p>
              <p className="font-semibold text-foreground truncate">{doc.cardName}</p>
              <p className="font-mono text-caption2 text-muted-foreground">{doc.cardCode}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mx-1" />
            <div className="min-w-0 flex-1">
              <p className="text-caption2 text-muted-foreground">Nouveau</p>
              {preview.state === "ok" ? (
                <>
                  <p className="font-semibold text-success truncate">{preview.cardName}</p>
                  <p className="font-mono text-caption2 text-muted-foreground">{preview.cardCode}</p>
                </>
              ) : (
                <p className="text-caption text-muted-foreground italic">Saisis le code ci-dessous…</p>
              )}
            </div>
          </div>

          {/* Saisie du nouveau code client */}
          <div>
            <label className="text-caption font-medium text-foreground">Code du client cible</label>
            <div className="relative mt-1">
              <input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                placeholder="Ex. ACAL"
                autoFocus
                disabled={rebinding}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 pr-9 text-body font-medium text-foreground tracking-wide focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
              {preview.state === "loading" && <Loader2 className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
              {preview.state === "ok" && !preview.frozen && preview.valid && <CheckCircle2 className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-success" />}
            </div>
            {preview.state === "error" && (
              <p className="mt-1 text-caption text-destructive">{preview.message}</p>
            )}
            {preview.state === "ok" && (preview.frozen || !preview.valid) && (
              <p className="mt-1 text-caption text-destructive">
                Client {preview.frozen ? "gelé" : "invalide"} dans SAP — commande impossible.
              </p>
            )}
          </div>

          {/* Garde-fou */}
          <div className="flex items-start gap-2 rounded-lg ring-1 ring-warning/25 bg-warning/10 px-3.5 py-2.5">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <p className="text-caption text-foreground leading-relaxed">
              L&apos;ancien BL <b>n° {doc.docNum}</b> sera <b>annulé</b> et un <b>nouveau BL</b> recréé à l&apos;identique
              (mêmes articles, prix, date, transporteur) pour le client cible. Action <b>irréversible</b> côté SAP.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="xl"
              onClick={() => { setRebindOpen(false); setNewCode(""); setPreview({ state: "idle" }); }}
              disabled={rebinding}
            >
              Annuler
            </Button>
            <Button
              type="button"
              size="xl"
              onClick={confirmRebind}
              disabled={!canRebind || rebinding}
            >
              {rebinding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCog className="h-4 w-4" />}
              Annuler &amp; recréer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Menu contextuel (clic droit sur la ligne) — raccourci power-user, porté
          dans <body> pour un positionnement fiable (échappe à tout ancêtre
          transformé). Le menu « ⋯ » visible reprend les mêmes actions. */}
      <ContextMenu menu={menu} onClose={closeMenu}>
        {/* Actions logistiques (commerciaux / admins) */}
        {canDispatch && (
          <>
            <MenuItem icon={Pencil} onClick={() => { closeMenu(); startModif(); }}>Modifier la commande</MenuItem>
            <MenuItem icon={UserCog} onClick={() => { closeMenu(); setRebindOpen(true); }}>Changer le client…</MenuItem>
            <MenuItem icon={RotateCcw} accent="text-destructive" active={doc.excluded}
              onClick={() => { closeMenu(); toggleExcluded(); }}>
              {doc.excluded ? "Réintégrer dans les totaux" : "Avoir / exclure des totaux"}
            </MenuItem>
            <div className="my-1 h-px bg-border" />
          </>
        )}
        {/* Changement d'état — accessible aux préparateurs / livreurs */}
        <MenuItem icon={Clock} accent="text-warning" active={docStatusOf === "A_PREPARER"}
          onClick={() => { closeMenu(); markAPreparer(); }}>À préparer</MenuItem>
        <MenuItem icon={CheckCircle2} accent="text-success" active={docStatusOf === "FAIT"}
          onClick={() => { closeMenu(); markFait(); }}>Fait</MenuItem>
        <MenuItem icon={Truck} accent="text-info" active={docStatusOf === "DEPART"}
          onClick={() => { closeMenu(); markDepart(); }}>Départ</MenuItem>
        {/* Ré-attribution du « Fait par » — commande déjà marquée « faite » uniquement */}
        {prepared && (
          <>
            <div className="my-1 h-px bg-border" />
            <MenuItem icon={UserCheck} accent="text-success"
              onClick={() => { closeMenu(); setEditByOpen(true); }}>Changer qui a fait…</MenuItem>
          </>
        )}
      </ContextMenu>

      {/* Outil de ligne (clic droit ou « ⋯ » d'une ligne produit) : changer le
          lot OU échanger l'article — modif SAP directe (même endpoint que la console). */}
      {swapTarget && (
        <LineToolMenu
          docEntry={doc.docEntry}
          docNum={doc.docNum}
          pos={swapTarget}
          onClose={() => setSwapTarget(null)}
          onDone={onReload}
        />
      )}
    </li>
  );
});

/** Champ « Lot » éditable d'une ligne du tableau — saisie directe du n° d'entrée
 *  (EM), sans passer par le menu. Enregistre à la validation (Entrée / sortie du
 *  champ) et seulement si la valeur a changé. */
function LotCellInput({ docEntry, docNum, itemCode, itemName, lot, disabled, onDone }: {
  docEntry: number; docNum: number; itemCode: string; itemName: string;
  lot: string | null | undefined; disabled: boolean; onDone: () => void;
}) {
  const [value, setValue] = useState(lot ?? "");
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(lot ?? "");
  // Le bon est rechargé après enregistrement : on resynchronise sur la valeur
  // serveur (et on ne piétine pas une saisie en cours).
  useEffect(() => {
    if (saving) return;
    savedRef.current = lot ?? "";
    setValue(lot ?? "");
  }, [lot, saving]);

  const commit = async () => {
    const next = normalizeLotInput(value);
    if (next === savedRef.current) { setValue(savedRef.current); return; }
    if (!next) { setValue(savedRef.current); return; }   // vider ne supprime pas un lot
    setSaving(true);
    try {
      await applyLotChange(docEntry, itemCode, next, null);
      savedRef.current = next;
      setValue(next);
      toast.success(`Lot → ${next}`, { description: `BL n°${docNum} · ${itemName}` });
      onDone();
    } catch (e) {
      setValue(savedRef.current);   // échec → on remet la valeur d'origine
      toast.error(e instanceof Error ? e.message : "Échec du changement de lot");
    } finally {
      setSaving(false);
    }
  };

  const shownLot = (value ?? "").trim();
  return (
    <span className="inline-flex items-center gap-1">
      {/* DESKTOP : saisie directe du n° d'entrée (EM) — geste de dispatch. */}
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setValue(savedRef.current); (e.target as HTMLInputElement).blur(); }
        }}
        // Le tableau est sous un menu contextuel (clic droit = menu de ligne) :
        // sans ça, un clic droit dans le champ ouvrirait le menu au lieu de la
        // correction de texte native.
        onContextMenu={(e) => e.stopPropagation()}
        disabled={disabled || saving}
        placeholder="n° EM"
        aria-label={`Lot de ${itemName}`}
        title={disabled ? "Bon clôturé — lot non modifiable" : "Saisir le n° d'entrée (EM) puis Entrée"}
        className="touch:hidden h-7 w-[104px] rounded-md border border-border bg-card px-1.5 text-caption font-mono tnum text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      />
      {/* TACTILE (tablette / téléphone d'entrepôt) : le lot est en LECTURE SEULE.
          Un préparateur ne modifie pas les lots — c'est un geste de dispatch,
          réservé au poste desktop. */}
      <span
        aria-label={`Lot de ${itemName}`}
        className="hidden touch:inline-flex h-7 min-w-[64px] items-center rounded-md bg-secondary px-2 text-caption font-mono tnum text-foreground"
      >
        {shownLot ? shownLot : <span className="text-muted-foreground/50">—</span>}
      </span>
      {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
    </span>
  );
}
