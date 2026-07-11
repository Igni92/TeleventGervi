"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Truck, Boxes, Scale, Users, FileText, Receipt,
  ChevronLeft, ChevronRight, ChevronDown, CalendarDays, AlertTriangle,
  RefreshCw, Loader2, PackageX, CheckCircle2, Clock, RotateCcw, Pencil,
  Maximize2, UserCheck, Undo2, ListChecks, UserCog, ArrowRight, Printer,
  Send, Phone, Plus, Trash2, Search, X, Store, BadgeEuro,
} from "lucide-react";
import { toast } from "sonner";
import { StarRating } from "@/components/ui/star-rating";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ClientLink } from "@/components/ClientLink";
import { DesignationChips } from "@/components/entrees/DesignationChips";
import { BrandLogo } from "@/components/BrandLogo";
import { useBrandLogos } from "@/lib/useBrandLogos";
import { displayPersonName } from "@/lib/userNames";
import { broadcastActiveClient } from "@/lib/consoleSync";
import {
  nextDeliveryDate, frenchHolidayLabel, nextWorkingDeliveryDay,
  formatDeliveryDate, addDaysISO,
} from "@/lib/livraison";
// Types (miroir de /api/livraisons) + logique de vue pure (testée à part).
import {
  docStatus, computeStatusCounts, computeView, docTourneeKeyLabel, STATUS_LABEL,
  filterBySegment, computeSegmentCounts, keepDeliverableClients, SEGMENT_LABEL,
  type StatusTab, type SegmentTab, type Tournee, type Doc, type Carrier, type Totals, type ApiResp,
} from "@/lib/livraisonView";
import { printOrderRecap } from "./printRecap";
import { renderBonTransport } from "@/lib/bonTransport";
import { BonsPreparationPanel } from "./BonsPreparationPanel";

interface CarrierOption { name: string; sapValue: string }

/* ─────────────────────────────────────────────────────────────
   Formatters — instances Intl créées UNE fois (module) : réinstancier un
   NumberFormat à chaque appel coûtait des milliers d'objets par rendu.
───────────────────────────────────────────────────────────── */
/** Fiche transporteur (coordonnées) — miroir de /api/transporteurs/fiche. */
interface CarrierFiche { email: string | null; phones: { label: string; value: string }[] }

const NF_INT = new Intl.NumberFormat("fr-FR");
const NF_NUM = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const NF_EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmtInt = (v: number) => NF_INT.format(Math.round(v));
const fmtNum = (v: number) => NF_NUM.format(v);
const fmtKg = (v: number) => `${fmtNum(v)} kg`;
const fmtEur = (v: number) => NF_EUR.format(v);
const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Normalisation pour la recherche : minuscules, sans accents. */
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Heure d'un clic d'état (« fait » / « départ ») — « 14:32 », préfixée du
 *  jour (« 01/07 14:32 ») si le clic date d'un autre jour. */
const fmtClock = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const now = new Date();
  const sameDay = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  return sameDay ? time : `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${time}`;
};

/** Onglets de la vue : « Ventes » (BL pas encore mis en préparation — réservé au
 *  dispatch) + les 3 états d'avancement (StatusTab, cf. lib/livraisonView).
 *  Les manquants ont leur propre état complet : /manquants. */
type ViewTab = "VENTES" | StatusTab;

/** Badge de ligne par segment client (CHR / EXPORT / GMS) — repère visuel du
 *  segment, en cohérence avec le filtre Tout / CHR / Export / GMS. */
const SEG_UI: Record<"CHR" | "EXPORT" | "GMS", { label: string; badge: string }> = {
  CHR:    { label: "CHR",    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" },
  EXPORT: { label: "Export", badge: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" },
  GMS:    { label: "GMS",    badge: "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300" },
};

/* ═════════════════════════════════════════════════════════════
   Composant principal
═════════════════════════════════════════════════════════════ */
export function LivraisonDetail({ canDispatch }: { canDispatch: boolean }) {
  const [date, setDate] = useState<string>(() => nextDeliveryDate());
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Génération des données : incrémentée à chaque (re)chargement RÉUSSI et
  // incluse dans la key des lignes → les OrderRow remontent avec l'état serveur
  // frais (leurs useState dupliquent doc.* au montage et deviendraient périmés
  // après « Actualiser » ou une modification faite par un autre utilisateur).
  // Les patchs optimistes (patchDoc) ne changent pas la génération.
  const [gen, setGen] = useState(0);
  const [carriers, setCarriers] = useState<CarrierOption[]>([]);
  // Tournées par transporteur (SERGTRS), chargées à la demande quand on ouvre le
  // sélecteur de tournée d'une commande. Cache mémoire + dédup des fetchs.
  const [tourneesByCode, setTourneesByCode] = useState<Record<string, Tournee[]>>({});
  const tourneesLoading = useRef<Set<string>>(new Set());
  // Miroir de tourneesByCode pour que loadTournees garde une identité STABLE
  // (sinon elle change à chaque tournée chargée → tous les effets abonnés se
  // re-déclenchent). On lit le cache via la ref, on dépend de rien.
  const tourneesByCodeRef = useRef(tourneesByCode);
  tourneesByCodeRef.current = tourneesByCode;

  // Catalogue des transporteurs (SERGTRS) pour le changement direct par commande.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/transporteurs")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.ok) return;
        // Libellé = le CODE transporteur (ce que l'utilisateur connaît : « ANTOINE »,
        // « DELANCHY FT86 ») et ce qui est stocké dans U_TrspCode — pas la raison
        // sociale SERGTRS (ex. « SOFRIPA » pour ANTOINE), qui prêtait à confusion.
        const opts: CarrierOption[] = (j.transporteurs ?? [])
          .filter((t: { code?: string | null }) => t.code)
          .map((t: { name: string; code: string }) => ({ name: t.code, sapValue: t.code }));
        setCarriers(opts);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Charge (une fois) les tournées d'un transporteur pour peupler le sélecteur.
  const loadTournees = useCallback(async (code: string) => {
    const key = code.trim().toUpperCase();
    if (!key || tourneesByCodeRef.current[key] || tourneesLoading.current.has(key)) return;
    tourneesLoading.current.add(key);
    try {
      const r = await fetch(`/api/transporteurs?code=${encodeURIComponent(code)}`);
      const j = await r.json().catch(() => null);
      if (j?.ok && j.transporteur) {
        setTourneesByCode((prev) => ({ ...prev, [key]: j.transporteur.tournees ?? [] }));
      }
    } catch { /* ignore */ } finally {
      tourneesLoading.current.delete(key);
    }
  }, []);

  // Recalculée à CHAQUE rendu (coût négligeable) : figée au montage, la
  // « prochaine livraison » devenait fausse si l'écran restait ouvert après
  // minuit (poste entrepôt) — badge « Prochaine » et bouton retour périmés.
  const auto = nextDeliveryDate();
  const holiday = frenchHolidayLabel(date);
  const isAuto = date === auto;

  // Garde d'obsolescence : chaque appel prend un numéro de séquence ; seule la
  // réponse de la DERNIÈRE requête est appliquée. Sans ça, un load() manuel
  // (Actualiser, changement transporteur/tournée/date) plus lent qu'un load()
  // suivant pouvait réécraser des données plus récentes — ou annuler des patchs
  // optimistes avec un instantané Prisma antérieur au POST.
  const loadSeq = useRef(0);
  const load = useCallback(
    (signal?: AbortSignal) => {
      const seq = ++loadSeq.current;
      const fresh = () => !signal?.aborted && seq === loadSeq.current;
      setLoading(true);
      setError(null);
      // carryover=1 : le Détail livraison REPORTE la file de préparation — une
      // commande mise en prépa mais pas encore faite reste dans la vue du jour
      // (en retard comme en avance), tant qu'elle n'est pas marquée « faite ».
      fetch(`/api/livraisons?date=${date}&carryover=1`, { cache: "no-store", signal })
        .then(async (r) => {
          const j: ApiResp = await r.json();
          if (!fresh()) return;
          if (!j.ok) {
            setError(j.error || "Erreur de chargement.");
            setData(null);
          } else {
            setData(j);
            setGen((g) => g + 1);
          }
        })
        .catch((e) => {
          if (fresh() && e?.name !== "AbortError") setError("SAP injoignable. Réessayez.");
        })
        .finally(() => {
          if (fresh()) setLoading(false);
        });
    },
    [date],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const shift = (days: number) => setDate((d) => addDaysISO(d, days));

  // Changement de transporteur d'une commande (écrit ORDR.U_TrspCode dans SAP),
  // puis rechargement pour re-grouper. "" = désaffecter.
  const changeCarrier = useCallback(
    async (docEntry: number, sapValue: string): Promise<boolean> => {
      try {
        // Changer de transporteur réinitialise la tournée (heure) : elle dépend du
        // transporteur. On envoie trspHeure:"" → le serveur vide U_TrspHeur et
        // re-résout U_Timbre pour le nouveau transporteur.
        const res = await fetch(`/api/sap/orders/${docEntry}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trspCode: sapValue, trspHeure: "" }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          toast.error(j?.error ? `Échec : ${j.error}` : "Échec du changement de transporteur");
          return false;
        }
        toast.success(sapValue ? "Transporteur mis à jour — choisis la tournée" : "Transporteur retiré");
        load();
        return true;
      } catch {
        toast.error("SAP injoignable — transporteur non modifié");
        return false;
      }
    },
    [load],
  );

  // Changement de TOURNÉE d'une commande → pose U_TrspHeur (heure de la tournée)
  // et re-confirme le transporteur (le serveur re-résout U_Timbre). "" = aucune.
  const changeTournee = useCallback(
    async (docEntry: number, trspCode: string, tournee: Tournee | null): Promise<boolean> => {
      try {
        const res = await fetch(`/api/sap/orders/${docEntry}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trspCode,
            trspHeure: tournee?.heure ?? "",
            // Détails mémorisés pour ce client (ré-appliqués aux prochains BL).
            tournee: tournee ? { nom: tournee.nom, des: tournee.des, lineId: tournee.lineId } : undefined,
          }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          toast.error(j?.error ? `Échec : ${j.error}` : "Échec du changement de tournée");
          return false;
        }
        toast.success(tournee?.heure
          ? `Tournée : ${tournee.nom || tournee.heure.slice(0, 5)} — mémorisée pour ce client`
          : "Tournée retirée");
        load();
        return true;
      } catch {
        toast.error("SAP injoignable — tournée non modifiée");
        return false;
      }
    },
    [load],
  );

  // Changement de DATE DE LIVRAISON d'une commande (écrit ORDR.DocDueDate), puis
  // rechargement (la commande quitte la vue si elle change de jour).
  const changeDate = useCallback(
    async (docEntry: number, dueDate: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/sap/orders/${docEntry}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dueDate }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          toast.error(j?.error ? `Échec : ${j.error}` : "Échec du changement de date");
          return false;
        }
        toast.success(`Livraison déplacée au ${formatDeliveryDate(dueDate)}`);
        load();
        return true;
      } catch {
        toast.error("SAP injoignable — date non modifiée");
        return false;
      }
    },
    [load],
  );

  // ── Onglet d'état : « Ventes » (dispatch uniquement) / « À préparer »
  //    (par défaut) / « Fait » / « Départ » ──
  const [statusTab, setStatusTab] = useState<ViewTab>("A_PREPARER");

  // ── Filtre par SEGMENT client : Tout / CHR / Export / GMS — recoupe TOUTES
  //    les données en amont des onglets d'état (compteurs, vue, manquants). ──
  const [segment, setSegment] = useState<SegmentTab>("TOUT");

  // Mise à jour optimiste d'UNE commande dans `data` (statut « faite », auteur,
  // « à reprendre »…) → la carte change d'onglet sans recharger toute la liste.
  const patchDoc = useCallback((docEntry: number, patch: Partial<Doc>) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            carriers: prev.carriers.map((c) => ({
              ...c,
              docs: c.docs.map((d) => (d.docEntry === docEntry ? { ...d, ...patch } : d)),
            })),
          }
        : prev,
    );
  }, []);

  // ── Action GROUPÉE par transporteur : bascule toutes les commandes du groupe
  //    (celles de l'onglet courant) vers un état. Optimiste + persistance par
  //    commande (mêmes routes que le bouton individuel). En cas d'échec partiel,
  //    on recharge pour resynchroniser. `source` = onglet courant (état commun). ──
  const bulkSetStatus = useCallback(
    async (docEntries: number[], target: StatusTab) => {
      const source = statusTab;
      if (docEntries.length === 0 || source === target) return;
      const patch: Partial<Doc> = {
        prepared: target !== "A_PREPARER",
        departed: target === "DEPART",
        // Marquer « fait » / « départ » lève le signalement « à reprendre » (règle serveur).
        ...(target !== "A_PREPARER" ? { incomplete: false } : {}),
        // Quitter un état efface son auteur (et son heure) ; ceux du nouvel état
        // arrivent avec la réponse.
        ...(target === "A_PREPARER" ? { preparedBy: null, preparedAt: null } : {}),
        ...(target !== "DEPART" ? { departedBy: null, departedAt: null } : {}),
      };
      docEntries.forEach((de) => patchDoc(de, patch));
      // POST + report de l'auteur ET de l'heure renvoyés par l'API (badges
      // « Fait par… · 14:32 » / « Parti · … » à jour sans recharger).
      const post = (url: string, body: Record<string, unknown>, onDone?: (by: string | null, at: string | null) => void) =>
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          .then(async (r) => {
            if (!r.ok) return false;
            const j = await r.json().catch(() => null);
            if (j?.ok === false) return false;
            onDone?.(j?.by ?? null, j?.at ?? null);
            return true;
          })
          .catch(() => false);
      try {
        const calls: Promise<boolean>[] = [];
        for (const de of docEntries) {
          // Quitter « Départ » : lever d'abord le drapeau départ.
          if (source === "DEPART" && target !== "DEPART") {
            calls.push(post("/api/livraisons/departed", { docEntry: de, departed: false }));
          }
          if (target === "DEPART") {
            calls.push(post("/api/livraisons/departed", { docEntry: de, departed: true }, (by, at) => patchDoc(de, { departedBy: by, departedAt: at })));
          } else {
            calls.push(post("/api/livraisons/prepared", { docEntry: de, prepared: target === "FAIT" },
              (by, at) => patchDoc(de, { preparedBy: by, preparedAt: target === "FAIT" ? at : null })));
          }
        }
        const oks = await Promise.all(calls);
        if (oks.some((ok) => !ok)) {
          toast.error("Certaines commandes n'ont pas pu être mises à jour — actualisation.");
          load();
          return;
        }
        toast.success(`${docEntries.length} commande${docEntries.length > 1 ? "s" : ""} → ${STATUS_LABEL[target]}`);
      } catch {
        toast.error("Échec de la mise à jour groupée — actualisation.");
        load();
      }
    },
    [statusTab, patchDoc, load],
  );

  // ── Repliage : on stocke les groupes DÉPLIÉS (défaut = tout replié). Clés =
  //    code transporteur, et sous-groupes tournée `<transporteur>::<tournée>`.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleKey = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // (Repliage par défaut : géré par l'état `expanded` — TOUT est replié par
  //  défaut, transporteurs comme tournées, pour tous les profils.)

  // ── Recherche d'un bon : n° de BL, client (nom / nom complet / code) ou
  //    réf. client — insensible à la casse et aux accents. La recherche
  //    s'applique AVANT les onglets (compteurs recalculés sur le résultat). ──
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  // ── Le détail livraison ne concerne QUE les clients livrés par tournée :
  //    GMS, CHR, EXPORT. Les clients sans segment (retrait comptoir, MIN,
  //    divers…) sont exclus D'ENTRÉE — jamais listés, comptés ni totalisés.
  //    `count` est recalculé pour que les gardes d'affichage collent. ──
  const deliverableData = useMemo(() => {
    if (!data) return null;
    const carriers = keepDeliverableClients(data.carriers);
    return { ...data, carriers, count: carriers.reduce((n, c) => n + c.docs.length, 0) };
  }, [data]);

  const filteredData = useMemo(() => {
    if (!deliverableData) return null;
    const q = normalize(query.trim());
    if (!q) return deliverableData;
    const match = (d: Doc) =>
      String(d.docNum).includes(q) ||
      normalize(d.cardCode).includes(q) ||
      normalize(d.cardName).includes(q) ||
      normalize(d.cardFullName ?? "").includes(q) ||
      normalize(d.numAtCard ?? "").includes(q);
    const carriers = deliverableData.carriers
      .map((c) => ({ ...c, docs: c.docs.filter(match) }))
      .filter((c) => c.docs.length > 0);
    return { ...deliverableData, carriers };
  }, [deliverableData, query]);

  // Commandes recoupées par le filtre SEGMENT (appliqué APRÈS la recherche) —
  // base de TOUT ce qui suit (compteurs d'état, vue, synthèse des manquants).
  const segCarriers = useMemo(
    () => filterBySegment(filteredData?.carriers ?? [], segment),
    [filteredData, segment],
  );
  // Comptes du filtre segment — sur le résultat de recherche NON recoupé par
  // segment (chaque pastille affiche son volume quel que soit le segment actif).
  const segCounts = useMemo(() => computeSegmentCounts(filteredData?.carriers ?? []), [filteredData]);

  // Comptes par onglet (sur recherche + segment actif) — logique pure dans
  // lib/livraisonView (« Ventes » = BL pas encore mis en préparation).
  const statusCounts = useMemo(() => computeStatusCounts(segCarriers), [segCarriers]);

  // Vue filtrée par recherche + segment + onglet (Ventes / À préparer / Fait /
  // Départ). Métriques recalculées (groupes + bandeau) — les BL « avoir /
  // exclu » restent listés mais sont déduits.
  const view = useMemo(
    () => (filteredData ? { ...filteredData, ...computeView({ carriers: segCarriers }, statusTab) } : null),
    [filteredData, segCarriers, statusTab],
  );

  // ── « Tout mettre en préparation » (onglet Ventes, dispatch) : lâche d'un
  //    coup tous les BL affichés (recherche + segment respectés). ──
  const [releasingAll, setReleasingAll] = useState(false);
  const releaseAllVentes = useCallback(async () => {
    const released = (view?.carriers ?? []).flatMap((c) => c.docs.filter((d) => !d.excluded));
    const entries = released.map((d) => d.docEntry);
    const names = released.map((d) => d.cardName).filter(Boolean);
    if (!entries.length || releasingAll) return;
    if (!window.confirm(`Mettre ${entries.length} magasin${entries.length > 1 ? "s" : ""} en préparation ? Ils deviendront visibles pour l'entrepôt.`)) return;
    setReleasingAll(true);
    try {
      const r = await fetch("/api/livraisons/mise-en-prep", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntries: entries, misEnPrep: true, names }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Échec de la mise en préparation groupée");
      entries.forEach((de) => patchDoc(de, { misEnPrep: true, misEnPrepBy: j?.by ?? null, misEnPrepAt: j?.at ?? null }));
      toast.success(`${entries.length} magasin${entries.length > 1 ? "s" : ""} mis en préparation`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la mise en préparation groupée");
    } finally {
      setReleasingAll(false);
    }
  }, [view, releasingAll, patchDoc]);

  // Toutes les clés dépliables : transporteurs + sous-groupes tournée.
  const allKeys = useMemo(() => {
    const keys: string[] = [];
    for (const c of view?.carriers ?? []) {
      const ck = c.code ?? "__none__";
      keys.push(ck);
      const trn = tourneesByCode[(c.code ?? "").toUpperCase()];
      const subs = new Set<string>();
      for (const d of c.docs) subs.add(docTourneeKeyLabel(d, trn).key);
      for (const s of subs) keys.push(`${ck}::${s}`);
    }
    return keys;
  }, [view, tourneesByCode]);
  const allCollapsed = allKeys.length > 0 && !allKeys.some((k) => expanded.has(k));
  const toggleAll = () => setExpanded(allCollapsed ? new Set(allKeys) : new Set());
  // Pendant une recherche, TOUT est déplié : on veut voir le bon trouvé
  // immédiatement, sans cliquer sur les groupes.
  const effectiveExpanded = useMemo(
    () => (searching ? new Set(allKeys) : expanded),
    [searching, allKeys, expanded],
  );

  return (
    <div className="space-y-5 animate-fade-up">
      {/* ── En-tête ── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker mb-1.5">Télévente · logistique</p>
          <h1 className="font-display text-[28px] sm:text-[34px] font-semibold text-foreground tracking-tight leading-none">
            Détail livraison
          </h1>
          <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
            Toutes les commandes à préparer pour la prochaine tournée
            (<b>J+1</b>, sauf le samedi → <b>J+2</b>). En cas de jour férié, ajustez la
            date de livraison ci-dessous.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60 shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      </header>

      {/* ── Sélecteur de jour de livraison (pièce maîtresse) ── */}
      <DatePanel
        date={date}
        isAuto={isAuto}
        holiday={holiday}
        onShift={shift}
        onPick={setDate}
        onReset={() => setDate(auto)}
        onReport={() => setDate(nextWorkingDeliveryDay(date))}
      />

      {/* ── Bons de préparation EXPORT (lots à affecter → créer le BL) ── */}
      <BonsPreparationPanel refreshKey={gen} onOrderCreated={() => load()} />

      {/* ── Filtre segment client : Tout / CHR / Export / GMS ── */}
      {deliverableData && deliverableData.count > 0 && (
        <SegmentTabs segment={segment} counts={segCounts} onPick={setSegment} />
      )}

      {/* ── Bandeau de synthèse (reflète le segment + l'onglet À préparer / Fait) ── */}
      {view?.totals && <SummaryRow totals={view.totals} loading={loading} showRevenue={canDispatch} />}

      {/* ── Onglets Ventes / À préparer / Fait / Départ + recherche + repliage ── */}
      {deliverableData && deliverableData.count > 0 && (
        <StatusTabs
          tab={statusTab}
          counts={statusCounts}
          onPick={setStatusTab}
          showVentes={canDispatch}
          query={query}
          onQuery={setQuery}
          allCollapsed={allCollapsed}
          onToggleAll={toggleAll}
        />
      )}

      {/* ── Onglet Ventes (dispatch) : lâcher d'un coup tous les BL affichés ── */}
      {canDispatch && statusTab === "VENTES" && (view?.count ?? 0) > 0 && (
        <button
          type="button"
          onClick={releaseAllVentes}
          disabled={releasingAll}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[12.5px] font-semibold disabled:opacity-50 active:scale-95 transition-all"
        >
          {releasingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Tout mettre en préparation ({statusCounts.ventes})
        </button>
      )}

      {/* ── Contenu ── */}
      {error ? (
        <div className="flex items-center gap-3 rounded-xl border border-rose-300/60 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-900/15 px-5 py-4">
          <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0" />
          <div>
            <p className="text-[13px] font-medium text-rose-700 dark:text-rose-300">{error}</p>
            <button onClick={() => load()} className="text-[12px] text-rose-600 dark:text-rose-400 hover:underline mt-0.5">
              Réessayer
            </button>
          </div>
        </div>
      ) : loading && !data ? (
        <LoadingState />
      ) : deliverableData && deliverableData.count === 0 ? (
        <EmptyState date={date} />
      ) : data && !searching && segment !== "TOUT" && segCarriers.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-border bg-card py-12 px-6">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground mb-3">
            <Users className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <p className="text-[14px] font-semibold text-foreground">Aucune commande {SEGMENT_LABEL[segment]}</p>
          <p className="text-[12.5px] text-muted-foreground mt-1">
            Aucun client {SEGMENT_LABEL[segment]} n&apos;est livré ce jour-là.
            <button onClick={() => setSegment("TOUT")} className="ml-1 text-brand-600 dark:text-brand-400 hover:underline">Voir toutes les commandes</button>
          </p>
        </div>
      ) : view && view.count === 0 ? (
        <div className="flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-border bg-card py-12 px-6">
          {searching ? (
            <>
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary/60 text-muted-foreground mb-3">
                <Search className="h-6 w-6" strokeWidth={1.8} />
              </span>
              <p className="text-[14px] font-semibold text-foreground">Aucun bon trouvé</p>
              <p className="text-[12.5px] text-muted-foreground mt-1">
                Rien ne correspond à « <b className="text-foreground">{query.trim()}</b> » dans cet onglet
                (n° de BL, client, code ou réf. client).
                <button onClick={() => setQuery("")} className="ml-1 text-brand-600 dark:text-brand-400 hover:underline">Effacer la recherche</button>
              </p>
            </>
          ) : statusTab === "A_PREPARER" ? (
            <>
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 mb-3">
                <CheckCircle2 className="h-6 w-6" strokeWidth={1.8} />
              </span>
              <p className="text-[14px] font-semibold text-foreground">Tout est préparé</p>
              <p className="text-[12.5px] text-muted-foreground mt-1">
                Aucune commande en attente de préparation.
                <button onClick={() => setStatusTab("FAIT")} className="ml-1 text-brand-600 dark:text-brand-400 hover:underline">Voir les commandes faites</button>
              </p>
            </>
          ) : statusTab === "FAIT" ? (
            <>
              <p className="text-[14px] font-semibold text-foreground">Aucune commande préparée</p>
              <p className="text-[12.5px] text-muted-foreground mt-1">
                Rien n&apos;a encore été marqué « fait ».
                <button onClick={() => setStatusTab("A_PREPARER")} className="ml-1 text-brand-600 dark:text-brand-400 hover:underline">Voir à préparer</button>
              </p>
            </>
          ) : statusTab === "VENTES" ? (
            <>
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 mb-3">
                <Store className="h-6 w-6" strokeWidth={1.8} />
              </span>
              <p className="text-[14px] font-semibold text-foreground">Aucune vente en attente</p>
              <p className="text-[12.5px] text-muted-foreground mt-1">
                Tous les magasins du jour ont été mis en préparation — l&apos;entrepôt voit tout.
                <button onClick={() => setStatusTab("A_PREPARER")} className="ml-1 text-brand-600 dark:text-brand-400 hover:underline">Voir à préparer</button>
              </p>
            </>
          ) : (
            <>
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-600 dark:text-sky-400 mb-3">
                <Truck className="h-6 w-6" strokeWidth={1.8} />
              </span>
              <p className="text-[14px] font-semibold text-foreground">Aucune commande partie</p>
              <p className="text-[12.5px] text-muted-foreground mt-1">
                Aucune livraison n&apos;a encore quitté l&apos;entrepôt.
                <button onClick={() => setStatusTab("FAIT")} className="ml-1 text-brand-600 dark:text-brand-400 hover:underline">Voir les commandes faites</button>
              </p>
            </>
          )}
        </div>
      ) : view ? (
        <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {view.carriers.map((c) => {
            const key = c.code ?? "__none__";
            // Commandes NON filtrées du transporteur (tous onglets) — le bon de
            // transport couvre toute la tournée, pas seulement l'onglet affiché.
            const fullDocs = deliverableData?.carriers.find((x) => (x.code ?? "__none__") === key)?.docs ?? c.docs;
            return (
              <CarrierGroup
                key={key} carrier={c} carrierKey={key} date={date} fullDocs={fullDocs} carriers={carriers} onCarrierChange={changeCarrier} onDateChange={changeDate}
                tourneesByCode={tourneesByCode} onLoadTournees={loadTournees} onTourneeChange={changeTournee}
                expanded={effectiveExpanded} onToggle={toggleKey}
                onPatchDoc={patchDoc} onReload={load} canDispatch={canDispatch}
                statusTab={statusTab} onBulkStatus={bulkSetStatus} gen={gen}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Sélecteur de date — grand, lisible, avec garde-fou jour férié
═════════════════════════════════════════════════════════════ */
function DatePanel({
  date, isAuto, holiday, onShift, onPick, onReset, onReport,
}: {
  date: string;
  isAuto: boolean;
  holiday: string | null;
  onShift: (days: number) => void;
  onPick: (iso: string) => void;
  onReset: () => void;
  onReport: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 sm:p-5">
        {/* Identité du jour livré */}
        <div className="flex items-center gap-3.5 min-w-0 flex-1">
          <span className="hidden sm:inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-500/5 text-brand-600 dark:text-brand-400">
            <Truck className="h-6 w-6" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                Livraison du
              </span>
              {isAuto ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/12 text-brand-600 dark:text-brand-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  <Clock className="h-3 w-3" /> Prochaine
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  Date choisie
                </span>
              )}
            </div>
            <p className="text-[20px] sm:text-[23px] font-semibold tracking-tight text-foreground leading-tight mt-0.5 truncate">
              {capitalize(formatDeliveryDate(date))}
            </p>
          </div>
        </div>

        {/* Contrôles — le champ date absorbe l'espace restant sur petit écran. */}
        <div className="flex items-center gap-1.5 shrink-0 w-full sm:w-auto">
          <button
            type="button" onClick={() => onShift(-1)} aria-label="Jour précédent"
            className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <label className="relative flex-1 min-w-0 sm:flex-none inline-flex items-center">
            <CalendarDays className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && onPick(e.target.value)}
              className="h-11 w-full sm:w-auto rounded-xl border border-border bg-background pl-9 pr-3 text-[13.5px] font-medium text-foreground tnum focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </label>
          <button
            type="button" onClick={() => onShift(1)} aria-label="Jour suivant"
            className="h-11 w-11 inline-flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          {!isAuto && (
            <button
              type="button" onClick={onReset} title="Revenir à la prochaine livraison"
              className="h-11 w-11 inline-flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-brand-600 dark:hover:text-brand-400 hover:bg-secondary/60 active:scale-95 transition-colors"
            >
              <RotateCcw className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </div>

      {/* Garde-fou jour férié */}
      {holiday && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-t border-amber-300/50 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-900/15 px-4 sm:px-5 py-3">
          <p className="inline-flex items-center gap-2 text-[12.5px] font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <b>{holiday}</b> — jour férié, pas de livraison. Choisissez le jour de livraison réel.
            </span>
          </p>
          <button
            type="button"
            onClick={onReport}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-amber-500 text-white text-[12px] font-semibold hover:bg-amber-600 active:scale-95 transition-colors shrink-0 self-start sm:self-auto"
          >
            <ChevronRight className="h-3.5 w-3.5" />
            Reporter au prochain jour ouvré
          </button>
        </div>
      )}
    </section>
  );
}

/* ═════════════════════════════════════════════════════════════
   Bandeau de synthèse — chiffres clés de la tournée
═════════════════════════════════════════════════════════════ */
function SummaryRow({ totals, loading, showRevenue }: { totals: Totals; loading: boolean; showRevenue: boolean }) {
  // `mobile` : présent dans la bande compacte téléphone. Nombre de CLIENTS et
  // total de COLIS retirés sur mobile (demande) — le préparateur n'en a pas
  // besoin en synthèse, les colis par commande restent sur chaque ligne.
  const stats = [
    { icon: FileText, label: "Commandes", short: "Cmd.", value: fmtInt(totals.orders), accent: "text-brand-600 dark:text-brand-400", mobile: true },
    { icon: Users, label: "Clients", short: "Clients", value: fmtInt(totals.clients), accent: "text-sky-600 dark:text-sky-400", mobile: false },
    { icon: Boxes, label: "Colis", short: "Colis", value: fmtNum(totals.colis), accent: "text-violet-600 dark:text-violet-400", hero: true, mobile: false },
    { icon: Scale, label: "Poids net", short: "Poids", value: fmtKg(totals.weightKg), accent: "text-emerald-600 dark:text-emerald-400", mobile: true },
    // Total HT — chiffre commercial : masqué pour préparateur / livreur.
    ...(showRevenue ? [{ icon: Receipt, label: "Total HT", short: "HT", value: fmtEur(totals.totalHT), accent: "text-amber-600 dark:text-amber-400", mobile: true }] : []),
  ];
  return (
    <>
      {/* MOBILE : une seule BANDE compacte (chiffres en ligne, libellés courts) —
          les 4-5 grosses cartes en 2×2 poussaient les transporteurs sous le pli
          sur iPhone zoomé. Le détail complet reste sur bureau (cartes ci-dessous). */}
      <div className={`sm:hidden rounded-xl border border-border bg-card px-3 py-2.5 flex items-center justify-around gap-2 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {stats.filter((s) => s.mobile).map((s) => (
          <div key={s.label} className="min-w-0 text-center">
            <p className="text-[15px] font-bold tnum leading-none text-foreground">{s.value}</p>
            <p className="text-[8.5px] uppercase tracking-[0.08em] font-semibold text-muted-foreground mt-1 truncate">{s.short}</p>
          </div>
        ))}
      </div>
      {/* ≥ sm : cartes détaillées comme avant. */}
      <div className={`hidden sm:grid grid-cols-2 sm:grid-cols-3 ${showRevenue ? "lg:grid-cols-5" : "lg:grid-cols-4"} gap-2.5 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className={`rounded-xl border border-border bg-card p-3.5 ${s.hero ? "ring-1 ring-violet-500/20" : ""}`}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <Icon className={`h-3.5 w-3.5 ${s.accent}`} strokeWidth={2} />
                <span className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
                  {s.label}
                </span>
              </div>
              <p className="text-[22px] font-bold tnum text-foreground leading-none">{s.value}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ═════════════════════════════════════════════════════════════
   Groupe transporteur — en-tête + cartes clients
═════════════════════════════════════════════════════════════ */
function CarrierGroup({
  carrier, carrierKey, date, fullDocs, carriers, onCarrierChange, onDateChange,
  tourneesByCode, onLoadTournees, onTourneeChange,
  expanded, onToggle, onPatchDoc, onReload, canDispatch,
  statusTab, onBulkStatus, gen,
}: {
  carrier: Carrier;
  carrierKey: string;
  date: string;
  fullDocs: Doc[];
  carriers: CarrierOption[];
  onCarrierChange: (docEntry: number, sapValue: string) => Promise<boolean>;
  onDateChange: (docEntry: number, dueDate: string) => Promise<boolean>;
  tourneesByCode: Record<string, Tournee[]>;
  onLoadTournees: (code: string) => void;
  onTourneeChange: (docEntry: number, trspCode: string, tournee: Tournee | null) => Promise<boolean>;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onPatchDoc: (docEntry: number, patch: Partial<Doc>) => void;
  onReload: () => void;
  canDispatch: boolean;
  statusTab: ViewTab;
  onBulkStatus: (docEntries: number[], target: StatusTab) => void;
  gen: number;
}) {
  const unassigned = !carrier.code;
  const collapsed = !expanded.has(carrierKey);
  const docEntries = carrier.docs.map((d) => d.docEntry);

  // ── Ré-attribution GROUPÉE du « Fait par » : toutes les commandes du groupe
  //    (onglet courant) déjà marquées « faites » — clic droit sur l'en-tête. ──
  const preparedEntries = carrier.docs.filter((d) => d.prepared || d.departed).map((d) => d.docEntry);
  const [bulkByOpen, setBulkByOpen] = useState(false);
  const [bulkBySaving, setBulkBySaving] = useState(false);
  async function bulkChangePreparedBy(person: string) {
    if (preparedEntries.length === 0) return;
    setBulkBySaving(true);
    try {
      // { docEntry, by } sans `prepared` = ré-attribution (heure du clic conservée).
      const oks = await Promise.all(preparedEntries.map((de) =>
        fetch("/api/livraisons/prepared", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docEntry: de, by: person }),
        })
          .then(async (r) => {
            const j = await r.json().catch(() => null);
            return r.ok && j?.ok !== false;
          })
          .catch(() => false),
      ));
      const failed = oks.filter((ok) => !ok).length;
      if (failed) toast.error(`${failed} commande(s) n'ont pas pu être ré-attribuées — actualisation.`);
      else toast.success(`${preparedEntries.length} commande(s) de ${carrier.name} — fait par ${displayPersonName(person)}`);
      setBulkByOpen(false);
      // Les OrderRow figent leur état au montage → rechargement (gen++) pour
      // rafraîchir les badges « Fait par … » de toutes les lignes du groupe.
      onReload();
    } finally {
      setBulkBySaving(false);
    }
  }

  // Sous-groupes par TOURNÉE nommée (IDF, IDF 2, NORD…) au sein du transporteur.
  // On résout le nom via le catalogue de tournées du transporteur (SERGTRS).
  const carrierTournees = tourneesByCode[(carrier.code ?? "").toUpperCase()];
  const tourneeGroups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; docs: Doc[] }>();
    for (const d of carrier.docs) {
      const { key, label } = docTourneeKeyLabel(d, carrierTournees);
      const g = map.get(key) ?? { key, label, docs: [] };
      g.docs.push(d);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.docs.length - a.docs.length || a.label.localeCompare(b.label, "fr"));
  }, [carrier.docs, carrierTournees]);

  // Dès que le transporteur est déplié, on charge son catalogue de tournées pour
  // nommer les sous-groupes (IDF, NORD…) sans attendre l'ouverture d'une commande.
  useEffect(() => {
    if (!collapsed && carrier.code) onLoadTournees(carrier.code);
  }, [collapsed, carrier.code, onLoadTournees]);

  // Bouton d'avancement groupé — CHANGE selon l'onglet : À préparer → Fait →
  // Départ. (Départ = état terminal ; « Ventes » = mise en préparation par BL
  // ou via le bouton global de l'onglet — pas d'avancement d'état ici.)
  const forward =
    statusTab === "A_PREPARER"
      ? { target: "FAIT" as StatusTab, short: "Fait", long: "Tout marquer fait", Icon: CheckCircle2, cls: "bg-emerald-500 hover:bg-emerald-600 text-white" }
      : statusTab === "FAIT"
      ? { target: "DEPART" as StatusTab, short: "Départ", long: "Tout marquer départ", Icon: Truck, cls: "bg-sky-500 hover:bg-sky-600 text-white" }
      : null;
  const allowBulk = statusTab !== "VENTES";

  // Menu clic droit (desktop) sur l'en-tête transporteur → change l'état de TOUT
  // le groupe (À préparer / Fait / Départ). Accès mobile = le bouton ci-dessus.
  // Pas d'action d'état groupée sur « Ventes » (BL pas encore lâchés) → désactivé.
  const { menu, openAt, close: closeMenu } = useContextMenu(224, 196);
  const onHeaderContextMenu = (e: ReactMouseEvent) => { if (allowBulk) openAt(e); };

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* En-tête transporteur — clic = replier/déplier ; clic droit = état groupé */}
      <div
        role="button" tabIndex={0}
        onClick={() => onToggle(carrierKey)}
        onContextMenu={onHeaderContextMenu}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(carrierKey); } }}
        aria-expanded={!collapsed}
        title={collapsed ? "Déplier ce transporteur (clic droit : changer l'état du groupe)" : "Replier ce transporteur (clic droit : changer l'état du groupe)"}
        className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-border bg-secondary/30 hover:bg-secondary/50 cursor-pointer select-none transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`} />
          {/* Icône + kicker masqués sur MOBILE : l'en-tête est chargé (boutons +
              métriques) et le NOM du transporteur se retrouvait écrasé. */}
          <span
            className={`hidden sm:inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              unassigned
                ? "bg-muted text-muted-foreground"
                : "bg-brand-500/12 text-brand-600 dark:text-brand-400"
            }`}
          >
            <Truck className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="hidden sm:block text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground leading-none">
              Transporteur
            </p>
            <p className={`text-[15px] font-semibold leading-tight sm:mt-0.5 truncate ${unassigned ? "text-muted-foreground italic" : "text-foreground"}`}>
              {carrier.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-8 shrink-0 text-right">
          {/* Bon de transport (récap palettes) — imprimer / envoyer / fiche */}
          <BonTransportActions carrier={carrier} date={date} canDispatch={canDispatch} docs={fullDocs} tournees={carrierTournees} />
          {/* Avancement GROUPÉ — bouton qui change selon l'onglet, tactile sur mobile */}
          {forward && docEntries.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onBulkStatus(docEntries, forward.target); }}
              title={`Passer les ${docEntries.length} commande(s) de ${carrier.name} à « ${STATUS_LABEL[forward.target]} »`}
              className={`inline-flex shrink-0 items-center gap-1.5 h-11 sm:h-9 px-2.5 sm:px-3 rounded-lg text-[11.5px] font-bold uppercase tracking-wide active:scale-95 transition-colors ${forward.cls}`}
            >
              {/* Icône masquée sur mobile : le libellé + la couleur suffisent, et
                  le nom du transporteur garde la place pour s'afficher en entier. */}
              <forward.Icon className="hidden sm:block h-4 w-4" />
              <span className="sm:hidden">{forward.short}</span>
              <span className="hidden sm:inline">{forward.long}</span>
            </button>
          )}
          {/* Mobile : seul « Colis » (repère métier) reste — « Cmd. » se lit en
              dépliant ; sans ça le NOM du transporteur était écrasé à une lettre. */}
          <Metric label="Cmd." value={fmtInt(carrier.orders)} className="hidden sm:block" />
          <Metric label="Colis" value={fmtNum(carrier.colis)} />
          <Metric label="kg" value={fmtNum(carrier.weightKg)} className="hidden sm:block" />
        </div>
      </div>

      {/* Sous-groupes TOURNÉE (masqués si le transporteur est replié) */}
      {!collapsed && tourneeGroups.map((tg) => {
        const subKey = `${carrierKey}::${tg.key}`;
        const subCollapsed = !expanded.has(subKey);
        return (
          <div key={subKey}>
            {/* Sous-en-tête tournée — cliquable */}
            <div
              role="button" tabIndex={0}
              onClick={() => onToggle(subKey)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(subKey); } }}
              aria-expanded={!subCollapsed}
              title={subCollapsed ? "Déplier cette tournée" : "Replier cette tournée"}
              className="flex items-center justify-between gap-3 pl-8 sm:pl-11 pr-4 sm:pr-5 py-2 border-b border-border/60 bg-secondary/15 hover:bg-secondary/30 cursor-pointer select-none transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${subCollapsed ? "-rotate-90" : ""}`} />
                <span className="text-[9px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">Tournée</span>
                <span className="text-[13px] font-semibold text-foreground truncate">{tg.label}</span>
              </div>
              <div className="flex items-center gap-4 sm:gap-6 shrink-0 text-right">
                {/* Même règle que l'en-tête transporteur : « Cmd. » masqué sur mobile. */}
                <Metric label="Cmd." value={fmtInt(tg.docs.length)} className="hidden sm:block" />
                <Metric label="Colis" value={fmtNum(tg.docs.reduce((s, d) => s + d.colis, 0))} />
                <Metric label="kg" value={fmtNum(tg.docs.reduce((s, d) => s + d.weightKg, 0))} className="hidden sm:block" />
              </div>
            </div>
            {/* Commandes de la tournée */}
            {!subCollapsed && (
              <ul className="divide-y divide-border/60">
                {tg.docs.map((d) => (
                  <OrderRow
                    key={`${d.docEntry}:${gen}`} doc={d} viewDate={date} carriers={carriers}
                    onCarrierChange={onCarrierChange} onDateChange={onDateChange}
                    tournees={d.trspCode ? tourneesByCode[d.trspCode.toUpperCase()] : undefined}
                    onLoadTournees={onLoadTournees} onTourneeChange={onTourneeChange}
                    onPatchDoc={onPatchDoc} onReload={onReload} canDispatch={canDispatch}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {/* Menu clic droit (desktop) — état groupé du transporteur */}
      <ContextMenu menu={menu} onClose={closeMenu} minWidth={214} header={
        <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground border-b border-border/60 truncate">
          {carrier.name} · {docEntries.length} cmd.
        </p>
      }>
        <MenuItem icon={Clock} accent="text-amber-600 dark:text-amber-400" active={statusTab === "A_PREPARER"}
          onClick={() => { closeMenu(); onBulkStatus(docEntries, "A_PREPARER"); }}>Tout : à préparer</MenuItem>
        <MenuItem icon={CheckCircle2} accent="text-emerald-600 dark:text-emerald-400" active={statusTab === "FAIT"}
          onClick={() => { closeMenu(); onBulkStatus(docEntries, "FAIT"); }}>Tout : fait</MenuItem>
        <MenuItem icon={Truck} accent="text-sky-600 dark:text-sky-400" active={statusTab === "DEPART"}
          onClick={() => { closeMenu(); onBulkStatus(docEntries, "DEPART"); }}>Tout : départ</MenuItem>
        {/* Ré-attribution GROUPÉE du « Fait par » — commandes déjà « faites » du groupe */}
        {preparedEntries.length > 0 && (
          <>
            <div className="my-1 h-px bg-border" />
            <MenuItem icon={UserCheck} accent="text-emerald-600 dark:text-emerald-400"
              onClick={() => { closeMenu(); setBulkByOpen(true); }}>
              Changer qui a fait… ({preparedEntries.length})
            </MenuItem>
          </>
        )}
      </ContextMenu>

      {/* Changer la PERSONNE créditée du « fait » sur TOUT le groupe */}
      <PreparedByDialog
        open={bulkByOpen}
        onOpenChange={setBulkByOpen}
        subtitle={<>
          {carrier.name} — les <b className="text-foreground">{preparedEntries.length} commande{preparedEntries.length > 1 ? "s" : ""}</b>{" "}
          déjà marquées « faites » de ce groupe seront créditées à la personne choisie
          (les heures des clics « fait » sont conservées).
        </>}
        currentBy={null}
        saving={bulkBySaving}
        onPick={bulkChangePreparedBy}
      />

    </section>
  );
}

/* ═════════════════════════════════════════════════════════════
   Bon de transport — imprimer (original + copie), envoyer par mail,
   fiche transporteur (email + téléphones ajoutables)
═════════════════════════════════════════════════════════════ */
function BonTransportActions({
  carrier, date, canDispatch, docs, tournees,
}: {
  carrier: Carrier;
  date: string;
  canDispatch: boolean;
  /** Commandes NON filtrées du transporteur (tous onglets confondus). */
  docs: Doc[];
  tournees: Tournee[] | undefined;
}) {
  // Lignes du bon (hors BL avoirés/exclus), groupées par tournée nommée.
  const rows = useMemo(
    () =>
      docs
        .filter((d) => !d.excluded)
        .map((d) => ({
          tournee: docTourneeKeyLabel(d, tournees).label,
          client: d.cardFullName ?? d.cardName,
          docNum: d.docNum,
          colis: d.colis,
          weightKg: d.weightKg,
        }))
        .sort((a, b) => a.tournee.localeCompare(b.tournee, "fr") || a.client.localeCompare(b.client, "fr")),
    [docs, tournees],
  );
  // ── Fiche transporteur (email + téléphones) ──
  const [ficheOpen, setFicheOpen] = useState(false);
  const [ficheLoading, setFicheLoading] = useState(false);
  const [ficheSaving, setFicheSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [phones, setPhones] = useState<{ label: string; value: string }[]>([]);

  const loadFiche = useCallback(async (): Promise<CarrierFiche | null> => {
    if (!carrier.code) return null;
    try {
      const r = await fetch(`/api/transporteurs/fiche?code=${encodeURIComponent(carrier.code)}`);
      const j = await r.json().catch(() => null);
      if (j?.ok) return j.fiche as CarrierFiche;
    } catch { /* best-effort */ }
    return null;
  }, [carrier.code]);

  async function openFiche() {
    setFicheOpen(true);
    setFicheLoading(true);
    const f = await loadFiche();
    if (f) { setEmail(f.email ?? ""); setPhones(f.phones ?? []); }
    setFicheLoading(false);
  }

  async function saveFiche() {
    if (!carrier.code) return;
    setFicheSaving(true);
    try {
      const res = await fetch("/api/transporteurs/fiche", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: carrier.code, email, phones }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { toast.error(j?.error || "Échec de l'enregistrement de la fiche"); return; }
      toast.success(`Fiche ${carrier.name} enregistrée`);
      setFicheOpen(false);
    } catch {
      toast.error("Échec de l'enregistrement de la fiche");
    } finally {
      setFicheSaving(false);
    }
  }

  // ── Impression : ORIGINAL + COPIE (fenêtre ouverte SYNCHRONE pour passer les
  //    bloqueurs de pop-ups, contenu écrit après chargement de la fiche). ──
  function printBon() {
    const w = window.open("", "_blank", "width=920,height=1050");
    if (!w) { toast.error("Impression bloquée — autorisez les pop-ups pour ce site."); return; }
    w.document.write("<p style=\"font-family:sans-serif;padding:16px\">Préparation du bon de transport…</p>");
    (async () => {
      const fiche = await loadFiche();
      const html = renderBonTransport(
        {
          carrierName: carrier.name,
          dateLabel: formatDeliveryDate(date),
          email: fiche?.email ?? null,
          phones: fiche?.phones ?? [],
          rows,
        },
        { copies: ["ORIGINAL", "COPIE"], autoPrint: true },
      );
      w.document.open();
      w.document.write(html);
      w.document.close();
    })();
  }

  // ── Envoi par mail (depuis commercial@gervifrais.com) — avec confirmation. ──
  const [mailOpen, setMailOpen] = useState(false);
  const [mailFiche, setMailFiche] = useState<CarrierFiche | null>(null);
  const [mailLoading, setMailLoading] = useState(false);
  const [sending, setSending] = useState(false);

  async function openMail() {
    setMailOpen(true);
    setMailLoading(true);
    setMailFiche(await loadFiche());
    setMailLoading(false);
  }

  async function sendMail() {
    if (!carrier.code) return;
    setSending(true);
    try {
      const res = await fetch("/api/livraisons/bon-transport", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, trspCode: carrier.code }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { toast.error(j?.error || "Échec de l'envoi du bon de transport"); return; }
      toast.success(`Bon de transport envoyé à ${j.to}`, { description: `Depuis ${j.from} — ${j.orders} commande(s).`, duration: 7000 });
      setMailOpen(false);
    } catch {
      toast.error("Échec de l'envoi du bon de transport");
    } finally {
      setSending(false);
    }
  }

  const orderCount = rows.length;

  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {/* Imprimer le bon de transport (original + copie) — tous profils.
          Masqué sur MOBILE : on n'imprime pas depuis le téléphone et le bouton
          écrasait le nom du transporteur dans l'en-tête. */}
      {orderCount > 0 && (
        <button
          type="button"
          onClick={printBon}
          title={`Imprimer le bon de transport de ${carrier.name} (original + copie)`}
          aria-label={`Imprimer le bon de transport de ${carrier.name}`}
          className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-all"
        >
          <Printer className="h-4 w-4" />
        </button>
      )}
      {/* Envoyer par mail + fiche — commerciaux / admins, transporteur affecté */}
      {canDispatch && carrier.code && (
        <>
          {orderCount > 0 && (
            <button
              type="button"
              onClick={openMail}
              title={`Envoyer le bon de transport à ${carrier.name} par mail (depuis commercial@gervifrais.com)`}
              aria-label={`Envoyer le bon de transport de ${carrier.name} par mail`}
              className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-brand-600 dark:hover:text-brand-400 hover:bg-secondary/60 active:scale-95 transition-all"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={openFiche}
            title={`Fiche transporteur ${carrier.name} — email et téléphones`}
            aria-label={`Fiche transporteur ${carrier.name}`}
            className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-all"
          >
            <Phone className="h-4 w-4" />
          </button>
        </>
      )}

      {/* ── Dialog fiche transporteur ── */}
      <Dialog open={ficheOpen} onOpenChange={(o) => { if (!ficheSaving) setFicheOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 pr-8 text-[16px]">
              <Phone className="h-5 w-5 text-brand-600 dark:text-brand-400 shrink-0" />
              Fiche transporteur — {carrier.name}
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              Coordonnées utilisées sur le bon de transport et pour son envoi par mail.
            </DialogDescription>
          </DialogHeader>
          {ficheLoading ? (
            <div className="flex items-center gap-2 py-4 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement de la fiche…
            </div>
          ) : (
            <>
              <div>
                <label className="text-[12px] font-medium text-foreground">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="contact@transporteur.fr"
                  disabled={ficheSaving}
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-[13.5px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-foreground">Téléphones</label>
                <div className="mt-1 space-y-2">
                  {phones.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={p.label}
                        onChange={(e) => setPhones((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                        placeholder="Libellé (ex. Exploitation)"
                        disabled={ficheSaving}
                        className="h-9 w-[42%] rounded-lg border border-border bg-background px-2.5 text-[12.5px] text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
                      />
                      <input
                        value={p.value}
                        onChange={(e) => setPhones((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                        placeholder="06 12 34 56 78"
                        disabled={ficheSaving}
                        className="h-9 flex-1 rounded-lg border border-border bg-background px-2.5 text-[12.5px] tnum text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
                      />
                      <button
                        type="button"
                        onClick={() => setPhones((prev) => prev.filter((_, j) => j !== i))}
                        disabled={ficheSaving}
                        title="Retirer ce numéro"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors disabled:opacity-60"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPhones((prev) => [...prev, { label: "", value: "" }])}
                    disabled={ficheSaving || phones.length >= 10}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-dashed border-border text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60"
                  >
                    <Plus className="h-3.5 w-3.5" /> Ajouter un téléphone
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setFicheOpen(false)}
                  disabled={ficheSaving}
                  className="inline-flex flex-1 items-center justify-center h-11 px-4 rounded-xl border border-border text-[14px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={saveFiche}
                  disabled={ficheSaving}
                  className="inline-flex flex-1 items-center justify-center gap-2 h-11 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-[14px] font-semibold disabled:opacity-60"
                >
                  {ficheSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Enregistrer
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Dialog confirmation d'envoi par mail ── */}
      <Dialog open={mailOpen} onOpenChange={(o) => { if (!sending) setMailOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 pr-8 text-[16px]">
              <Send className="h-5 w-5 text-brand-600 dark:text-brand-400 shrink-0" />
              Envoyer le bon de transport
            </DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            Récap des <b className="text-foreground">{orderCount} commande{orderCount > 1 ? "s" : ""}</b> de{" "}
            <b className="text-foreground">{carrier.name}</b> pour la livraison du{" "}
            <b className="text-foreground">{formatDeliveryDate(date)}</b>, envoyé depuis{" "}
            <b className="text-foreground">commercial@gervifrais.com</b>.
          </p>
          {mailLoading ? (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lecture de la fiche transporteur…
            </div>
          ) : mailFiche?.email ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-3.5 py-2.5 text-[13px]">
              <span className="text-[9.5px] uppercase tracking-wide text-muted-foreground shrink-0">Destinataire</span>
              <span className="font-semibold text-foreground truncate">{mailFiche.email}</span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 px-3.5 py-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber-800 dark:text-amber-300">
                Aucun email dans la fiche transporteur.
                <button
                  type="button"
                  onClick={() => { setMailOpen(false); openFiche(); }}
                  className="ml-1 font-semibold underline underline-offset-2"
                >
                  Renseigner la fiche
                </button>
              </p>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setMailOpen(false)}
              disabled={sending}
              className="inline-flex flex-1 items-center justify-center h-11 px-4 rounded-xl border border-border text-[14px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={sendMail}
              disabled={sending || mailLoading || !mailFiche?.email}
              className="inline-flex flex-1 items-center justify-center gap-2 h-11 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-[14px] font-semibold disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Envoyer
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Filtre segment client — Tout / CHR / Export / GMS
═════════════════════════════════════════════════════════════ */
function SegmentTabs({
  segment, counts, onPick,
}: {
  segment: SegmentTab;
  counts: Record<SegmentTab, number>;
  onPick: (s: SegmentTab) => void;
}) {
  // Couleurs actives alignées sur les badges de ligne (SEG_UI).
  const tabs: { key: SegmentTab; active: string }[] = [
    { key: "TOUT",   active: "bg-brand-600 text-white border-brand-600" },
    { key: "CHR",    active: "bg-amber-500 text-white border-amber-500" },
    { key: "EXPORT", active: "bg-violet-500 text-white border-violet-500" },
    { key: "GMS",    active: "bg-teal-500 text-white border-teal-500" },
  ];
  return (
    // Mobile : rail DÉFILANT (nowrap) — le wrap laissait un onglet orphelin sur
    // une 2ᵉ ligne à ~320px (iPhone zoomé). ≥ sm : wrap comme avant.
    <div className="flex w-full sm:w-auto sm:inline-flex items-center gap-1.5 rounded-xl border border-border bg-card p-1 flex-nowrap sm:flex-wrap overflow-x-auto sm:overflow-x-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <span className="hidden sm:inline-flex items-center gap-1 pl-2 pr-1 text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
        <Users className="h-3 w-3" /> Clients
      </span>
      {tabs.map((t) => {
        const isActive = segment === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onPick(t.key)}
            aria-pressed={isActive}
            className={`inline-flex shrink-0 items-center gap-1.5 h-11 sm:h-8 px-3.5 rounded-lg border text-[12.5px] font-semibold transition-colors ${
              isActive ? t.active : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            }`}
          >
            {SEGMENT_LABEL[t.key]}
            <span className={`tnum text-[11px] font-bold ${isActive ? "opacity-90" : "opacity-60"}`}>
              {counts[t.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Onglets d'état — À préparer / Fait + recherche + repliage global
═════════════════════════════════════════════════════════════ */
function StatusTabs({
  tab, counts, onPick, showVentes, query, onQuery, allCollapsed, onToggleAll,
}: {
  tab: ViewTab;
  counts: { ventes: number; aPreparer: number; fait: number; depart: number };
  onPick: (t: ViewTab) => void;
  /** Onglet « Ventes » (mise en préparation) — réservé au dispatch : les rôles
   *  restreints ne reçoivent jamais les BL pas encore lâchés (filtre serveur). */
  showVentes: boolean;
  query: string;
  onQuery: (q: string) => void;
  allCollapsed: boolean;
  onToggleAll: () => void;
}) {
  const tabs: { key: ViewTab; label: string; count: number; icon: typeof Clock; active: string }[] = [
    ...(showVentes
      ? [{ key: "VENTES" as ViewTab, label: "Ventes", count: counts.ventes, icon: Store, active: "bg-brand-600 text-white border-brand-600" }]
      : []),
    { key: "A_PREPARER", label: "À préparer", count: counts.aPreparer, icon: Clock,        active: "bg-amber-500 text-white border-amber-500" },
    { key: "FAIT",       label: "Fait",       count: counts.fait,      icon: CheckCircle2, active: "bg-emerald-500 text-white border-emerald-500" },
    { key: "DEPART",     label: "Départ",     count: counts.depart,    icon: Truck,        active: "bg-sky-500 text-white border-sky-500" },
  ];
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      {/* Mobile : rail DÉFILANT (nowrap) — même règle que SegmentTabs. */}
      <div className="flex w-full sm:w-auto sm:inline-flex items-center gap-1.5 rounded-xl border border-border bg-card p-1 flex-nowrap sm:flex-wrap overflow-x-auto sm:overflow-x-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onPick(t.key)}
              aria-pressed={isActive}
              className={`inline-flex shrink-0 items-center gap-1.5 h-11 sm:h-8 px-3.5 rounded-lg border text-[12.5px] font-semibold transition-colors ${
                isActive ? t.active : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
              {t.label}
              <span className={`tnum text-[11px] font-bold ${isActive ? "opacity-90" : "opacity-60"}`}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
        {/* Recherche d'un bon : n° BL, client, code, réf. client — pleine largeur mobile. */}
        <div className="relative flex-1 min-w-0 sm:flex-none">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onQuery(""); }}
            placeholder="Chercher un bon (client, n° BL…)"
            aria-label="Chercher un bon de livraison (client, n° de BL, code ou réf. client)"
            className="h-11 w-full sm:h-9 sm:w-[250px] rounded-lg border border-border bg-card pl-8 pr-8 text-[12.5px] font-medium text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-brand-500/40 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label="Effacer la recherche"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleAll}
          className="inline-flex items-center gap-1.5 h-11 sm:h-8 px-3 rounded-lg border border-border bg-card text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${allCollapsed ? "-rotate-90" : ""}`} />
          {allCollapsed ? "Tout déplier" : "Tout replier"}
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={`min-w-[42px] text-right ${className ?? ""}`}>
      <p className="text-[15px] font-bold tnum leading-none text-foreground">{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   « Fait par… » — équipe + dialog de choix de la personne.
   Partagés entre la ligne (OrderRow) et le groupe transporteur.
═════════════════════════════════════════════════════════════ */
/** Équipe de l'app (/api/users) — chargée à la PREMIÈRE activation, puis cachée. */
function useTeam(active: boolean) {
  const [team, setTeam] = useState<{ name: string | null; email: string | null }[] | null>(null);
  useEffect(() => {
    if (!active || team) return;
    let cancelled = false;
    fetch("/api/users")
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setTeam(j?.users ?? []); })
      .catch(() => { if (!cancelled) setTeam([]); });
    return () => { cancelled = true; };
  }, [active, team]);
  return team;
}

/** Dialog « Qui a fait cette commande ? » — liste l'équipe, un clic ré-attribue. */
function PreparedByDialog({
  open, onOpenChange, subtitle, currentBy, saving, onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subtitle: ReactNode;
  /** Personne actuellement créditée (surlignée) — null si mixte / inconnue. */
  currentBy: string | null;
  saving: boolean;
  onPick: (person: string) => void;
}) {
  const team = useTeam(open);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2 pr-8 text-[16px]">
            <UserCog className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            Qui a fait cette commande ?
          </DialogTitle>
          <DialogDescription className="text-[12px]">{subtitle}</DialogDescription>
        </DialogHeader>
        {team === null ? (
          <div className="flex items-center gap-2 py-3 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement de l&apos;équipe…
          </div>
        ) : team.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground py-2">Aucun utilisateur trouvé.</p>
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto divide-y divide-border/60 rounded-xl border border-border">
            {team.map((u) => {
              const value = (u.name?.trim() || u.email || "").trim();
              if (!value) return null;
              const current = value === (currentBy ?? "").trim();
              return (
                <li key={u.email ?? value}>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => onPick(value)}
                    className={`flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-[13.5px] font-medium transition-colors disabled:opacity-60 ${
                      current
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "text-foreground hover:bg-secondary/60"
                    }`}
                  >
                    <span className="truncate">
                      {displayPersonName(value)}
                      <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">{value}</span>
                    </span>
                    {current && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ═════════════════════════════════════════════════════════════
   Ligne commande — repliable vers le détail des lignes.
   Mémoïsée : patchDoc met à jour les docs de façon immuable → seules les lignes
   réellement modifiées re-rendent (le reste garde son identité de props).
═════════════════════════════════════════════════════════════ */
const OrderRow = memo(function OrderRow({
  doc, viewDate, carriers, onCarrierChange, onDateChange, tournees, onLoadTournees, onTourneeChange, onPatchDoc, onReload, canDispatch,
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
}) {
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

  // ── Articles MANQUANTS = stock SAP total négatif (détecté par l'API). ──
  const missingSet = useMemo(() => new Set(doc.missingItems ?? []), [doc.missingItems]);

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
      toast.success(val ? `N° de commande enregistré (#${doc.docNum})` : `N° de commande retiré (#${doc.docNum})`);
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
  const [bigOpen, setBigOpen] = useState(false);
  const [requeuing, setRequeuing] = useState(false);
  // Vérification avant de marquer « faite » (évite les validations par erreur).
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ── Modifier la PERSONNE qui a fait la commande (« Fait par … ») ──
  //    Dialog partagé (PreparedByDialog) — badge cliquable et menu clic droit.
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
    const prev = { prepared, incomplete };
    const rollback = () => {
      setPrepared(prev.prepared); setIncomplete(prev.incomplete);
      onPatchDoc(doc.docEntry, { prepared: prev.prepared, incomplete: prev.incomplete });
    };
    setPrepared(next);
    if (next) setIncomplete(false);
    // Optimiste : la carte change d'onglet (À préparer ↔ Fait) immédiatement.
    onPatchDoc(doc.docEntry, { prepared: next, ...(next ? { incomplete: false } : {}) });
    setSavingPrep(true);
    try {
      const res = await fetch("/api/livraisons/prepared", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, prepared: next }),
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
      onPatchDoc(doc.docEntry, { preparedBy: by, preparedAt: at });
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
    } catch {
      rollback();
      toast.error("Échec de l'enregistrement");
    }
    finally { setSavingDepart(false); }
  }

  // Transitions d'état déclenchées depuis le menu contextuel (clic droit).
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
          setPreparer(j.preparer ?? null); setIncomplete(false);
          onPatchDoc(doc.docEntry, { preparer: j.preparer ?? null, incomplete: false });
          if (!open) toast.success(`Commande #${doc.docNum} affectée — à vous`);
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
  async function requeue() {
    setRequeuing(true);
    try {
      const res = await fetch("/api/livraisons/preparer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docEntry: doc.docEntry, action: "requeue" }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { toast.error(j?.error || "Échec"); return; }
      setPreparer(null); setIncomplete(true); setPrepared(false); setPreparedBy(null); setPreparedAt(null); setDeparted(false); setDepartedAt(null);
      setBigOpen(false);
      onPatchDoc(doc.docEntry, { preparer: null, incomplete: true, prepared: false, preparedBy: null, preparedAt: null, departed: false, departedAt: null });
      toast.warning(`Commande #${doc.docNum} non terminée — remise sur la file`);
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
      toast.success(`Modification du BL #${doc.docNum} chargée sur l'Écran 2`, {
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
      else toast.success(`BL recréé pour ${preview.cardName} (#${j.newDocNum}) — ancien #${j.oldDocNum} annulé`, { duration: 7000 });
      setRebindOpen(false); setNewCode(""); setPreview({ state: "idle" });
      onReload();
    } catch {
      toast.error("SAP injoignable — client non modifié");
    } finally {
      setRebinding(false);
    }
  }

  // ── « Avoir / exclu » MANUEL (menu contextuel, dispatch uniquement) ──
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

  // ── Menu contextuel (clic droit sur la ligne) → actions d'état + dispatch ──
  const { menu, openAt, close: closeMenu } = useContextMenu(220, 236);
  function onRowContextMenu(e: ReactMouseEvent) {
    if (!doc.open) return;                                    // commande livrée/annulée : pas d'action
    const el = e.target as HTMLElement;
    if (el.closest("input, select, textarea")) return;        // garde le menu natif dans les champs (copier/coller)
    openAt(e);
  }

  const docStatusOf: StatusTab = departed ? "DEPART" : prepared ? "FAIT" : "A_PREPARER";

  // ── Récap imprimable (bon de préparation) — fenêtre dédiée + impression.
  //    Volontairement épuré : ni préparateur, ni commentaires (promos…) — le
  //    préparateur n'a besoin que du client, de la logistique et des lignes. ──
  function handlePrint() {
    const ok = printOrderRecap(
      {
        docNum: doc.docNum,
        cardCode: doc.cardCode,
        // Nom COMPLET du client (fiche télévente) sur le document imprimé.
        cardName: doc.cardFullName ?? doc.cardName,
        clientType: doc.clientType,
        colis: doc.colis,
        weightKg: doc.weightKg,
        lines: doc.lines,
      },
      {
        dateLabel: formatDeliveryDate(doc.dueDate),
        carrierName: doc.carrierName,
        tourneeLabel: docTourneeKeyLabel(doc, tournees).label,
        missingCodes: missingSet,
      },
    );
    if (!ok) toast.error("Impression bloquée — autorisez les pop-ups pour ce site.");
  }

  return (
    <li>
      {/* MOBILE (< sm) : la ligne passe sur DEUX rangées — identité client pleine
          largeur (le nom ne se fait plus écraser par les boutons), puis l'action
          d'état en GRANDE cible tactile + colis + agrandir. ≥ sm : une seule
          rangée comme avant (flex-nowrap). */}
      <div
        onContextMenu={onRowContextMenu}
        onClick={onRowClick}
        className={`flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-2 sm:gap-3 px-3 sm:px-5 py-3 hover:bg-secondary/25 transition-colors ${doc.excluded ? "opacity-50" : ""} ${claimableByTap ? "cursor-pointer" : ""}`}
      >
        {/* Bouton d'état — toujours en tête, verticalement centré (placement
            constant). BL pas encore lâché (onglet Ventes) → le bouton EST la
            mise en préparation ; sinon 3 états : À préparer → Fait → Parti. */}
        {canDispatch && !released ? (
          <button
            type="button"
            onClick={releaseToPrep}
            disabled={savingRelease}
            title="Mettre ce magasin en préparation — il devient visible pour l'entrepôt (À préparer)"
            className="inline-flex shrink-0 flex-1 sm:flex-none items-center justify-center gap-1.5 h-11 sm:h-9 px-3 rounded-lg text-[12px] font-bold uppercase tracking-wide transition-colors disabled:opacity-60 active:scale-95 bg-amber-600 hover:bg-amber-700 text-white"
          >
            {savingRelease ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {/* Libellé complet partout : sur mobile le bouton occupe sa propre
                rangée (flex-1), le nom du client ne se fait plus tronquer. */}
            Mettre en prép.
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
          className={`inline-flex shrink-0 flex-1 sm:flex-none items-center justify-center gap-1.5 h-11 sm:h-9 px-3 rounded-lg text-[12px] font-bold uppercase tracking-wide transition-colors disabled:opacity-60 active:scale-95 ${
            departed
              ? "bg-sky-500 text-white hover:bg-sky-600"
              : prepared
              ? "bg-emerald-500 text-white hover:bg-emerald-600"
              : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/50 hover:bg-amber-500/25"
          }`}
        >
          {(savingPrep || savingDepart)
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : departed ? <Truck className="h-4 w-4" /> : prepared ? <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
          {/* Libellé visible aussi sur mobile — bouton de préparation lisible et facile à toucher. */}
          <span>{departed ? "Parti" : prepared ? "Faite" : "À préparer"}</span>
        </button>
        )}

        {/* Identité client — première rangée pleine largeur sur mobile. */}
        <div className="order-first w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <ClientLink
              code={doc.cardCode}
              name={doc.cardName}
              className="text-[16px] sm:text-[14.5px] font-semibold text-foreground truncate text-left hover:underline decoration-brand-500/60 underline-offset-2 max-w-full"
            />
            {doc.clientType && (SEG_UI[doc.clientType as keyof typeof SEG_UI] ?? null) && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide ${SEG_UI[doc.clientType as keyof typeof SEG_UI].badge}`}>
                {SEG_UI[doc.clientType as keyof typeof SEG_UI].label}
              </span>
            )}
            {carriedOver && (
              <span
                title={
                  carriedOverdue
                    ? `Livraison prévue le ${capitalize(formatDeliveryDate(dueISO))} — pas encore faite, reportée dans la file du jour`
                    : `Livraison prévue le ${capitalize(formatDeliveryDate(dueISO))} — mise en préparation en avance, dans la file jusqu'à ce qu'elle soit faite`
                }
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  carriedOverdue
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300"
                }`}
              >
                <CalendarDays className="h-3 w-3 shrink-0" />
                {carriedOverdue ? "Reportée" : "Anticipée"} · Livr. {dueShort}
              </span>
            )}
            {prepared && !departed && (preparedBy ?? preparer) && (
              // Cliquable : changer la PERSONNE qui a fait la commande.
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setEditByOpen(true); }}
                title={`Préparée par ${displayPersonName(preparedBy ?? preparer)}${fmtClock(preparedAt) ? ` à ${fmtClock(preparedAt)}` : ""} — cliquer pour changer la personne`}
                className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-semibold hover:bg-emerald-500/25 transition-colors">
                <UserCheck className="h-3 w-3 shrink-0" /> <span className="truncate">Fait par {displayPersonName(preparedBy ?? preparer)}{fmtClock(preparedAt) ? ` · ${fmtClock(preparedAt)}` : ""}</span>
                <Pencil className="h-2.5 w-2.5 opacity-70 shrink-0" />
              </button>
            )}
            {departed && (
              <span title={departedBy ? `Parti — ${displayPersonName(departedBy)}${fmtClock(departedAt) ? ` à ${fmtClock(departedAt)}` : ""}` : "Partie en livraison"}
                className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                <Truck className="h-3 w-3 shrink-0" /> <span className="truncate">Parti{departedBy ? ` · ${displayPersonName(departedBy)}` : ""}{fmtClock(departedAt) ? ` · ${fmtClock(departedAt)}` : ""}</span>
              </span>
            )}
            {incomplete && (
              <span title="Pas entièrement préparée — remise sur la file"
                className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                <AlertTriangle className="h-3 w-3" /> À reprendre
              </span>
            )}
            {missingSet.size > 0 && (
              <span title="Articles en stock SAP négatif (tous entrepôts) sur cette commande — achat à prévoir"
                className="inline-flex items-center gap-1 rounded-full bg-rose-500 text-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                <PackageX className="h-3 w-3" /> {missingSet.size} manquant{missingSet.size > 1 ? "s" : ""}
              </span>
            )}
            {preparer && !prepared && (
              <span title={`En préparation par ${displayPersonName(preparer)}`}
                className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 px-2 py-0.5 text-[10px] font-semibold">
                <UserCheck className="h-3 w-3" /> {displayPersonName(preparer)}
              </span>
            )}
            {!doc.open && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide">
                <CheckCircle2 className="h-2.5 w-2.5" /> Livrée
              </span>
            )}
            {doc.excluded && (
              <span title="BL totalement avoiré (facturé puis avoir total / doublon) — déduit des totaux"
                className="inline-flex items-center gap-1 rounded-full bg-rose-500 text-white px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide">
                <RotateCcw className="h-2.5 w-2.5" /> Avoir — déduit
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
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
                className="h-7 max-w-[200px] rounded-md border border-border bg-card pl-2 pr-7 text-[11.5px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60 disabled:cursor-not-allowed appearance-none truncate cursor-pointer"
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
                  className="h-7 max-w-[220px] rounded-md border border-border bg-card pl-2 pr-7 text-[11.5px] font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60 disabled:cursor-not-allowed appearance-none truncate cursor-pointer"
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
                className="h-7 w-[140px] rounded-md border border-border bg-card pl-7 pr-6 text-[11.5px] font-medium text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
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
                className="h-7 rounded-md border border-border bg-card pl-7 pr-2 text-[11.5px] font-medium text-foreground tnum focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60 disabled:cursor-not-allowed"
              />
              {savingDate && <Loader2 className="pointer-events-none absolute right-1.5 h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
          </div>
        </div>

        {/* Colis / poids — repère logistique (poids masqué sur mobile) */}
        <div className="flex items-center gap-2.5 sm:gap-8 shrink-0">
          <div className="text-right min-w-[40px] sm:min-w-[44px]">
            <p className="text-[17px] sm:text-[15px] font-bold tnum text-foreground leading-none">{fmtNum(doc.colis)}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">colis</p>
          </div>
          <div className="text-right min-w-[44px] hidden sm:block">
            <p className="text-[15px] font-bold tnum text-foreground leading-none">{fmtNum(doc.weightKg)}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">kg</p>
          </div>
          {/* Ouvrir en grand (+ affecter au préparateur qui clique) — cible tactile
              agrandie sur mobile pour lancer la préparation d'un pouce. */}
          <button
            type="button"
            onClick={openBig}
            title="Ouvrir la commande en grand (et se l'affecter)"
            aria-label={`Ouvrir la commande ${doc.docNum} en grand`}
            className="inline-flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-brand-300/60 dark:border-brand-500/40 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/35 active:scale-95 transition-all"
          >
            <Maximize2 className="h-[18px] w-[18px] sm:h-4 sm:w-4" />
          </button>
          {/* Récap imprimable (bon de préparation) — desktop ; sur mobile, passer
              par la vue en grand qui porte le même bouton. */}
          <button
            type="button"
            onClick={handlePrint}
            title={`Imprimer le bon de préparation (BL n°${doc.docNum})`}
            aria-label={`Imprimer le récap de la commande ${doc.docNum}`}
            className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-all"
          >
            <Printer className="h-4 w-4" />
          </button>
          {canDispatch && doc.open && (
            <button
              type="button"
              onClick={startModif}
              disabled={modifBusy}
              title={`Modifier le BL # ${doc.docNum} (sur l'Écran 2) — quantités + ajout de lignes`}
              className="hidden lg:inline-flex items-center gap-1 h-9 px-2.5 rounded-lg border border-amber-300/70 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-900/20 text-[12px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/35 active:scale-95 transition-all disabled:opacity-60"
            >
              {modifBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" strokeWidth={2.2} />}
              <span className="hidden sm:inline">Modifier</span>
            </button>
          )}
          {/* Repli desktop uniquement : sur mobile le contenu est toujours affiché. */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Replier le détail" : "Voir le détail"}
            aria-expanded={open}
            className="hidden lg:inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-95 transition-all"
          >
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Contenu de la commande — TOUJOURS visible sur mobile (préparation),
          repliable sur desktop via le chevron. Chaque ligne porte ses tags
          (marque · conditionnement · origine). */}
      <div className={`px-4 sm:px-5 pb-3.5 pt-0.5 block ${open ? "lg:block" : "lg:hidden"}`}>
        <div className="rounded-xl border border-border/70 bg-secondary/20 overflow-hidden">
          {doc.comments && (
            <p className="px-3 py-2 text-[11.5px] text-muted-foreground border-b border-border/60 italic">
              {doc.comments}
            </p>
          )}
          <table className="w-full text-[13px] sm:text-[12px]">
            <thead className="text-[9px] uppercase tracking-wider text-muted-foreground bg-card/40">
              <tr>
                <th className="text-center font-semibold px-2 py-1.5 w-14 whitespace-nowrap">Colis</th>
                <th className="text-left font-semibold px-3 py-1.5">Article</th>
                <th className="text-right font-semibold px-3 py-1.5 whitespace-nowrap hidden sm:table-cell">Qté</th>
                <th className="text-right font-semibold px-3 py-1.5 whitespace-nowrap hidden sm:table-cell">kg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {doc.lines.map((l, i) => {
                const isMissing = missingSet.has(l.itemCode);
                return (
                <tr
                  key={`${l.itemCode}-${i}`}
                  onContextMenu={(e) => openSwap(e, l.itemCode, l.itemName)}
                  title={doc.open ? "Clic droit : changer le lot ou échanger l'article" : undefined}
                  className={`${isMissing ? "bg-rose-500/5" : ""} ${doc.open ? "cursor-context-menu" : ""}`}
                >
                  {/* Colisage en premier (gauche) — repère principal de préparation */}
                  <td className="px-2 py-1.5 text-center align-middle">
                    <span className="inline-flex min-w-[28px] items-center justify-center rounded-md bg-foreground/10 px-1.5 py-0.5 text-[14px] font-bold tnum text-foreground">
                      {fmtNum(l.colis)}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 min-w-0 align-middle">
                    <div className="flex items-center gap-2.5">
                      <BrandLogo marque={l.marque} logos={brandLogos} size="md" zoomable />
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className={`text-[14.5px] sm:text-[13px] font-semibold sm:font-medium ${isMissing ? "text-muted-foreground line-through decoration-rose-500/60" : "text-foreground/90"}`}>{l.itemName}</span>
                          <span className="font-mono text-[10px] text-muted-foreground/70 hidden sm:inline">{l.itemCode}</span>
                          {isMissing && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-300 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide">
                              Manquant
                            </span>
                          )}
                        </div>
                        <DesignationChips marque={l.marque} condt={l.condt} pays={l.pays} size="md" className="mt-1" />
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right tnum text-muted-foreground hidden sm:table-cell align-middle">{fmtNum(l.quantity)}</td>
                  <td className="px-3 py-1.5 text-right tnum text-muted-foreground hidden sm:table-cell align-middle">{fmtNum(l.weightKg)}</td>
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
          className="max-w-2xl max-h-[92vh] overflow-y-auto"
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
            <DialogTitle className="flex items-center gap-2 pr-8 text-[17px]">
              <Boxes className="h-5 w-5 text-brand-600 dark:text-brand-400 shrink-0" />
              <span className="truncate min-w-0">{doc.cardName}</span>
              <span className="text-[12px] font-normal text-muted-foreground shrink-0">· BL n°{doc.docNum}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">Détail de la livraison : lignes, colis et poids du bon de livraison.</DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-[26px] font-bold tnum text-foreground leading-none">
              {fmtNum(doc.colis)} <span className="text-[12px] font-medium uppercase text-muted-foreground">colis</span>
            </span>
            <span className="text-[15px] font-semibold tnum text-muted-foreground">{fmtNum(doc.weightKg)} kg</span>
            {/* Heure de PRISE de la commande dans le système (création SAP). */}
            {fmtClock(doc.takenAt) && (
              <span title={`Commande prise dans le système à ${fmtClock(doc.takenAt)}`}
                className="inline-flex items-center gap-1 rounded-full bg-secondary text-muted-foreground px-2.5 py-1 text-[12px] font-bold uppercase">
                <Clock className="h-3.5 w-3.5" /> Prise · {fmtClock(doc.takenAt)}
              </span>
            )}
            {(preparedBy ?? preparer) && (
              // Cliquable quand la commande est « faite » : changer la personne.
              <button
                type="button"
                onClick={() => { if (prepared) setEditByOpen(true); }}
                disabled={!prepared}
                title={prepared ? "Changer la personne qui a fait la commande" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 px-2.5 py-1 text-[12px] font-semibold ${prepared ? "hover:bg-sky-500/25 transition-colors" : "cursor-default"}`}
              >
                <UserCheck className="h-3.5 w-3.5" /> {prepared ? "Fait par" : "Préparée par"} {displayPersonName(preparedBy ?? preparer)}
                {prepared && <Pencil className="h-3 w-3 opacity-70" />}
              </button>
            )}
            {prepared && (
              <span title={fmtClock(preparedAt) ? `Marquée « faite » à ${fmtClock(preparedAt)}` : "Marquée « faite »"}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 text-[12px] font-bold uppercase">
                <CheckCircle2 className="h-3.5 w-3.5" /> Faite{fmtClock(preparedAt) ? ` · ${fmtClock(preparedAt)}` : ""}
              </span>
            )}
            {departed && (
              <span title={fmtClock(departedAt) ? `Partie en livraison à ${fmtClock(departedAt)}` : "Partie en livraison"}
                className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 px-2.5 py-1 text-[12px] font-bold uppercase">
                <Truck className="h-3.5 w-3.5" /> Parti{fmtClock(departedAt) ? ` · ${fmtClock(departedAt)}` : ""}
              </span>
            )}
          </div>
          {doc.comments && <p className="text-[12.5px] italic text-muted-foreground">« {doc.comments} »</p>}

          {/* Lignes en grand : colisage à gauche + tags + signalement manquant */}
          <ul className="divide-y divide-border/50 rounded-xl border border-border overflow-hidden">
            {doc.lines.map((l, i) => {
              const isMissing = missingSet.has(l.itemCode);
              return (
              <li
                key={`big-${l.itemCode}-${i}`}
                onContextMenu={(e) => openSwap(e, l.itemCode, l.itemName)}
                title={doc.open ? "Clic droit : échanger cet article contre un autre code" : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 ${isMissing ? "bg-rose-500/5" : ""} ${doc.open ? "cursor-context-menu" : ""}`}
              >
                <span className="inline-flex min-w-[44px] items-center justify-center rounded-lg bg-foreground/10 px-2 py-1 text-[18px] font-bold tnum text-foreground shrink-0">
                  {fmtNum(l.colis)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-[14px] font-semibold ${isMissing ? "text-muted-foreground line-through decoration-rose-500/60" : "text-foreground"}`}>
                    {l.itemName}
                    {isMissing && (
                      <span className="ml-2 inline-flex items-center rounded bg-rose-500/15 text-rose-600 dark:text-rose-300 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide no-underline align-middle">
                        Manquant
                      </span>
                    )}
                  </p>
                  <DesignationChips marque={l.marque} condt={l.condt} pays={l.pays} className="mt-1" />
                </div>
                <BrandLogo marque={l.marque} logos={brandLogos} size="lg" className="self-center" zoomable />
              </li>
              );
            })}
          </ul>

          {/* Actions de préparation — EMPILÉES pleine largeur sur mobile (grandes
              cibles, libellés jamais compressés) ; en ligne à partir de sm. */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:flex-wrap pt-1">
            <button
              type="button"
              onClick={() => { setPreparedTo(true); setBigOpen(false); }}
              disabled={savingPrep}
              className="inline-flex items-center justify-center gap-2 h-12 sm:h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[14px] font-semibold disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" /> Préparation terminée
            </button>
            <button
              type="button"
              onClick={requeue}
              disabled={requeuing}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl border border-rose-300/70 dark:border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-[14px] font-semibold disabled:opacity-60"
            >
              {requeuing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              Pas terminée — remettre sur la file
            </button>
            <button
              type="button"
              onClick={handlePrint}
              title={`Imprimer le bon de préparation (BL n°${doc.docNum})`}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl border border-border text-[14px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            >
              <Printer className="h-4 w-4" /> Imprimer
            </button>
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

      {/* Vérification avant de marquer « faite » (évite les validations par erreur) */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 pr-8 text-[16px]">
              <ListChecks className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              Confirmer la préparation
            </DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            Confirme que la commande de <b className="text-foreground">{doc.cardName}</b> (BL n°{doc.docNum})
            est <b className="text-foreground">entièrement préparée</b>.
          </p>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 px-3.5 py-2.5">
            <span className="text-[22px] font-bold tnum text-foreground leading-none">{fmtNum(doc.colis)}</span>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">colis</span>
            <span className="ml-auto text-[12.5px] font-semibold tnum text-muted-foreground">{fmtNum(doc.weightKg)} kg · {doc.lineCount} article(s)</span>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="inline-flex flex-1 items-center justify-center h-11 px-4 rounded-xl border border-border text-[14px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => { setConfirmOpen(false); setPreparedTo(true); }}
              disabled={savingPrep}
              className="inline-flex flex-1 items-center justify-center gap-2 h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[14px] font-semibold disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" /> Confirmer la préparation
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Changer le client du BL (re-coder) — garde-fou : annule + recrée */}
      <Dialog open={rebindOpen} onOpenChange={(o) => { if (!rebinding) { setRebindOpen(o); if (!o) { setNewCode(""); setPreview({ state: "idle" }); } } }}>
        <DialogContent className="max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 pr-8 text-[16px]">
              <UserCog className="h-5 w-5 text-brand-600 dark:text-brand-400 shrink-0" />
              Changer le client — BL n°{doc.docNum}
            </DialogTitle>
          </DialogHeader>

          {/* Client actuel → nouveau */}
          <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-3.5 py-2.5 text-[13px]">
            <div className="min-w-0">
              <p className="text-[9.5px] uppercase tracking-wide text-muted-foreground">Actuel</p>
              <p className="font-semibold text-foreground truncate">{doc.cardName}</p>
              <p className="font-mono text-[11px] text-muted-foreground">{doc.cardCode}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mx-1" />
            <div className="min-w-0 flex-1">
              <p className="text-[9.5px] uppercase tracking-wide text-muted-foreground">Nouveau</p>
              {preview.state === "ok" ? (
                <>
                  <p className="font-semibold text-emerald-700 dark:text-emerald-300 truncate">{preview.cardName}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{preview.cardCode}</p>
                </>
              ) : (
                <p className="text-[12px] text-muted-foreground italic">Saisis le code ci-dessous…</p>
              )}
            </div>
          </div>

          {/* Saisie du nouveau code client */}
          <div>
            <label className="text-[12px] font-medium text-foreground">Code du client cible</label>
            <div className="relative mt-1">
              <input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                placeholder="Ex. ACAL"
                autoFocus
                disabled={rebinding}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 pr-9 text-[14px] font-medium text-foreground tracking-wide focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60"
              />
              {preview.state === "loading" && <Loader2 className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
              {preview.state === "ok" && !preview.frozen && preview.valid && <CheckCircle2 className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500" />}
            </div>
            {preview.state === "error" && (
              <p className="mt-1 text-[11.5px] text-rose-600 dark:text-rose-400">{preview.message}</p>
            )}
            {preview.state === "ok" && (preview.frozen || !preview.valid) && (
              <p className="mt-1 text-[11.5px] text-rose-600 dark:text-rose-400">
                Client {preview.frozen ? "gelé" : "invalide"} dans SAP — commande impossible.
              </p>
            )}
          </div>

          {/* Garde-fou */}
          <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 px-3.5 py-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11.5px] text-amber-800 dark:text-amber-300 leading-relaxed">
              L&apos;ancien BL <b># {doc.docNum}</b> sera <b>annulé</b> et un <b>nouveau BL</b> recréé à l&apos;identique
              (mêmes articles, prix, date, transporteur) pour le client cible. Action <b>irréversible</b> côté SAP.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setRebindOpen(false); setNewCode(""); setPreview({ state: "idle" }); }}
              disabled={rebinding}
              className="inline-flex flex-1 items-center justify-center h-11 px-4 rounded-xl border border-border text-[14px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={confirmRebind}
              disabled={!canRebind || rebinding}
              className="inline-flex flex-1 items-center justify-center gap-2 h-11 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-[13.5px] font-semibold disabled:opacity-50"
            >
              {rebinding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCog className="h-4 w-4" />}
              Annuler & recréer
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Menu contextuel (clic droit sur la ligne) — porté dans <body> pour un
          positionnement fiable (échappe à tout ancêtre transformé). */}
      <ContextMenu menu={menu} onClose={closeMenu}>
        {/* Actions logistiques (commerciaux / admins) */}
        {canDispatch && (
          <>
            <MenuItem icon={Pencil} onClick={() => { closeMenu(); startModif(); }}>Modifier la commande</MenuItem>
            <MenuItem icon={UserCog} onClick={() => { closeMenu(); setRebindOpen(true); }}>Changer le client…</MenuItem>
            <MenuItem icon={RotateCcw} accent="text-rose-600 dark:text-rose-400" active={doc.excluded}
              onClick={() => { closeMenu(); toggleExcluded(); }}>
              {doc.excluded ? "Réintégrer dans les totaux" : "Avoir / exclure des totaux"}
            </MenuItem>
            <div className="my-1 h-px bg-border" />
          </>
        )}
        {/* Changement d'état — accessible aux préparateurs / livreurs */}
        <MenuItem icon={Clock} accent="text-amber-600 dark:text-amber-400" active={docStatusOf === "A_PREPARER"}
          onClick={() => { closeMenu(); markAPreparer(); }}>À préparer</MenuItem>
        <MenuItem icon={CheckCircle2} accent="text-emerald-600 dark:text-emerald-400" active={docStatusOf === "FAIT"}
          onClick={() => { closeMenu(); markFait(); }}>Fait</MenuItem>
        <MenuItem icon={Truck} accent="text-sky-600 dark:text-sky-400" active={docStatusOf === "DEPART"}
          onClick={() => { closeMenu(); markDepart(); }}>Départ</MenuItem>
        {/* Ré-attribution du « Fait par » — commande déjà marquée « faite » uniquement */}
        {prepared && (
          <>
            <div className="my-1 h-px bg-border" />
            <MenuItem icon={UserCheck} accent="text-emerald-600 dark:text-emerald-400"
              onClick={() => { closeMenu(); setEditByOpen(true); }}>Changer qui a fait…</MenuItem>
          </>
        )}
      </ContextMenu>

      {/* Clic droit sur une ligne produit : changer le lot OU échanger l'article
          — modif SAP directe (même endpoint que la console). */}
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

/* ═════════════════════════════════════════════════════════════
   Outil de ligne (clic droit sur une ligne produit) — deux actions, modif SAP
   DIRECTE via /api/sap/orders/[docEntry]/modif (même endpoint que la console,
   sans passer par elle → rapide) :
     • CHANGER LE LOT   : liste FIFO enrichie (fournisseur · prix · colis restant
       · étoiles) ; le lot choisi est posé sur la/les ligne(s) de l'article et le
       magasin est aligné sur celui du lot ;
     • ÉCHANGER L'ARTICLE : remplace le code par un autre (nouveau lot FIFO résolu
       côté serveur), quantité et prix conservés.
   On recharge le bon complet et on renvoie TOUTES les lignes (reconstruction).
═════════════════════════════════════════════════════════════ */
interface SwapProduct { itemCode: string; itemName: string }
interface SwapSrcLine {
  lineNum: number; itemCode: string; qtyPieces: number;
  price: number | null; warehouse: string | null; lot: string | null; closed: boolean;
}
interface LotCand {
  lot: string; docNum: number; warehouse: string | null; affect: string;
  qty?: number | null; colis?: number | null; fromLedger?: boolean;
  supplierName?: string | null; purchasePrice?: number | null; currency?: string | null;
  rating?: number | null;
}
const LOT_AFFECT_LABEL: Record<string, string> = { TOUS: "Tous", EXPORT: "Export", GMS: "GMS", CHR: "CHR" };
const fmtColisLot = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));

function LineToolMenu({ docEntry, docNum, pos, onClose, onDone }: {
  docEntry: number;
  docNum: number;
  pos: { x: number; y: number; oldCode: string; oldName: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"lot" | "article">("lot");
  // Mode LOT : candidats FIFO enrichis pour cet article.
  const [cands, setCands] = useState<LotCand[] | null>(null);
  const [lotBusy, setLotBusy] = useState<string | null>(null);
  const [manual, setManual] = useState("");   // saisie manuelle d'un n° d'EM
  // Mode ARTICLE : recherche produit (échange).
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SwapProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  // Candidats de lot (FIFO, fournisseur/prix/colis/étoiles) — chargés une fois.
  useEffect(() => {
    let cancelled = false;
    setCands(null);
    fetch(`/api/lots/candidates?items=${encodeURIComponent(pos.oldCode)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { items?: Record<string, { candidates?: LotCand[] }> }) => {
        if (!cancelled) setCands(j?.items?.[pos.oldCode]?.candidates ?? []);
      })
      .catch(() => { if (!cancelled) setCands([]); });
    return () => { cancelled = true; };
  }, [pos.oldCode]);

  // Recherche produit débouncée (≥ 2 car.) — uniquement en mode article.
  useEffect(() => {
    if (mode !== "article") return;
    const q = query.trim();
    if (q.length < 2) { setResults([]); setLoading(false); return; }
    const my = ++seq.current;
    setLoading(true);
    const h = setTimeout(() => {
      fetch(`/api/products?search=${encodeURIComponent(q)}&limit=12`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: { products?: SwapProduct[] }) => { if (my === seq.current) setResults(j.products ?? []); })
        .catch(() => { if (my === seq.current) setResults([]); })
        .finally(() => { if (my === seq.current) setLoading(false); });
    }, 220);
    return () => clearTimeout(h);
  }, [query, mode]);

  // Fermeture : clic hors zone / Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  // Charge les lignes du bon (via l'endpoint de modif) pour reconstruction.
  async function loadSrc(): Promise<SwapSrcLine[]> {
    const g = await fetch(`/api/sap/orders/${docEntry}/modif`, { cache: "no-store" }).then((r) => r.json());
    // L'endpoint renvoie `cartLines` (pas `lines`) — sinon changement de lot et
    // échange d'article échouaient toujours (« Chargement du bon impossible »).
    if (!g?.ok || !Array.isArray(g.cartLines)) throw new Error(g?.error || "Chargement du bon impossible");
    return g.cartLines as SwapSrcLine[];
  }

  // CHANGER LE LOT : pose le lot choisi sur la/les ligne(s) de l'article et aligne
  // le magasin sur celui du lot (les autres lignes conservées à l'identique).
  // `warehouse` null (saisie manuelle) → on garde le magasin de la ligne.
  async function runLotChange(lot: string, warehouse: string | null) {
    if (lotBusy || busy) return;
    setLotBusy(lot);
    try {
      const src = await loadSrc();
      const targets = src.filter((l) => l.itemCode === pos.oldCode);
      if (targets.length === 0) throw new Error("Article introuvable sur ce bon");
      if (targets.some((l) => l.closed)) throw new Error("Article déjà livré — lot verrouillé");
      const lines = src.map((l) => l.itemCode === pos.oldCode
        ? { itemCode: l.itemCode, quantity: l.qtyPieces, warehouseCode: (warehouse ?? l.warehouse) ?? undefined, price: l.price ?? undefined, keep: true, lot }
        : { itemCode: l.itemCode, quantity: l.qtyPieces, warehouseCode: l.warehouse ?? undefined, price: l.price ?? undefined, keep: true, lot: l.lot ?? undefined });
      const res = await fetch(`/api/sap/orders/${docEntry}/modif`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }),
      }).then((r) => r.json());
      if (!res?.ok) throw new Error(res?.error || "Échec du changement de lot");
      toast.success(`Lot → ${lot}`, { description: `BL n°${docNum} · ${pos.oldName}` });
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec du changement de lot");
    } finally {
      setLotBusy(null);
    }
  }

  // ÉCHANGER L'ARTICLE : l'ancien article → le nouveau (nouveau lot résolu,
  // keep:false) ; les autres lignes conservées telles quelles (lot d'origine).
  async function runSwap(p: SwapProduct) {
    if (busy || lotBusy) return;
    if (p.itemCode === pos.oldCode) { onClose(); return; }
    setBusy(p.itemCode);
    try {
      const src = await loadSrc();
      const targets = src.filter((l) => l.itemCode === pos.oldCode);
      if (targets.length === 0) throw new Error("Article introuvable sur ce bon");
      if (targets.some((l) => l.closed)) throw new Error("Article déjà livré — échange impossible");
      if (src.some((l) => l.itemCode === p.itemCode)) { toast.info(`${p.itemName} est déjà sur ce bon`); return; }
      const lines = src.map((l) => l.itemCode === pos.oldCode
        ? { itemCode: p.itemCode, quantity: l.qtyPieces, warehouseCode: l.warehouse ?? undefined, price: l.price ?? undefined, keep: false }
        : { itemCode: l.itemCode, quantity: l.qtyPieces, warehouseCode: l.warehouse ?? undefined, price: l.price ?? undefined, keep: true, lot: l.lot ?? undefined });
      const res = await fetch(`/api/sap/orders/${docEntry}/modif`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }),
      }).then((r) => r.json());
      if (!res?.ok) throw new Error(res?.error || "Échec de l'échange");
      toast.success(`${pos.oldName} → ${p.itemName}`, { description: `BL n°${docNum} · quantité et prix conservés.` });
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de l'échange");
    } finally {
      setBusy(null);
    }
  }

  const tabBtn = (m: "lot" | "article", label: string) => (
    <button type="button" onClick={() => setMode(m)}
      className={`flex-1 h-6 rounded-md text-[11px] font-semibold transition-colors ${
        mode === m ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
      }`}>
      {label}
    </button>
  );

  return createPortal(
    <div
      ref={boxRef}
      data-linetool=""
      style={{ position: "fixed", left: pos.x, top: pos.y, width: 300 }}
      onContextMenu={(e) => e.preventDefault()}
      // Le popup est rendu dans un portail MAIS reste enfant React de la carte :
      // sans ça, un clic dedans REMONTE (arbre React) jusqu'au onClick de la
      // carte, qui refermait la fenêtre. On coupe la propagation ici.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      // `pointer-events-auto` OBLIGATOIRE : quand ce menu est ouvert AU-DESSUS de
      // la modale de préparation (Radix Dialog), Radix pose `pointer-events:none`
      // sur <body> — dont ce popup hérite (porté dans <body>). Sans ça, les clics
      // gauche TRAVERSENT le popup jusqu'à l'overlay derrière, et son propre
      // détecteur de « clic dehors » le refermait à chaque clic intérieur.
      className="pointer-events-auto z-[130] rounded-xl border border-border bg-card shadow-modal overflow-hidden flex flex-col max-h-[360px] animate-fade-up"
    >
      <div className="shrink-0 px-3 py-2 border-b border-border bg-secondary/30">
        <p className="text-[11px] text-muted-foreground truncate">
          <span className="font-semibold text-foreground">{pos.oldName}</span> <span className="font-mono text-[10px]">{pos.oldCode}</span>
        </p>
        <div className="mt-1.5 flex items-center gap-0.5 rounded-lg border border-border bg-secondary/40 p-0.5">
          {tabBtn("lot", "Changer le lot")}
          {tabBtn("article", "Échanger l'article")}
        </div>
      </div>

      {mode === "lot" ? (
        <>
        <div className="overflow-y-auto py-1 min-h-0">
          <p className="px-3 pt-1 pb-0.5 text-[9.5px] uppercase tracking-wider text-muted-foreground font-semibold">Lots — ordre FIFO</p>
          {cands === null ? (
            <p className="px-3 py-2 text-[11.5px] text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement des lots…</p>
          ) : cands.length === 0 ? (
            <p className="px-3 py-2 text-[11.5px] italic text-muted-foreground">Aucun lot en stock pour cet article.</p>
          ) : cands.map((c) => (
            <button key={c.lot} type="button" disabled={lotBusy != null} onClick={() => runLotChange(c.lot, c.warehouse)}
              className="w-full text-left px-3 py-1.5 hover:bg-secondary/60 disabled:opacity-60 transition-colors">
              <div className="flex items-center gap-1.5 text-[12.5px]">
                <span className="font-semibold text-foreground">{c.lot}</span>
                <span className="text-[10px] px-1 py-px rounded bg-secondary text-muted-foreground">{LOT_AFFECT_LABEL[c.affect] ?? c.affect}</span>
                {c.rating ? <StarRating value={c.rating} size="sm" /> : null}
                <span className="ml-auto shrink-0">
                  {lotBusy === c.lot ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : c.fromLedger && c.colis != null && c.colis > 0 ? (
                    <span className="text-[10.5px] px-1.5 py-px rounded bg-brand-500/12 text-brand-700 dark:text-brand-300 font-bold tnum" title="Colis restants sur cette entrée">{fmtColisLot(c.colis)} colis</span>
                  ) : c.qty != null && c.qty > 0 ? (
                    <span className="text-[10px] px-1 py-px rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 tnum" title="Stock physique de l'article dans cet entrepôt">{Math.round(c.qty)} en stock</span>
                  ) : null}
                </span>
              </div>
              {(c.supplierName || (c.purchasePrice != null && c.purchasePrice > 0) || c.warehouse) && (
                <div className="mt-0.5 flex items-center gap-x-2.5 flex-wrap text-[10.5px] text-muted-foreground tnum">
                  {c.supplierName && <span className="inline-flex items-center gap-1 min-w-0"><Truck className="h-3 w-3 shrink-0" /> <span className="truncate">{c.supplierName}</span></span>}
                  {c.purchasePrice != null && c.purchasePrice > 0 && <span className="inline-flex items-center gap-1"><BadgeEuro className="h-3 w-3" /> {c.purchasePrice.toFixed(2)} €</span>}
                  {c.warehouse && <span className="ml-auto">mag. {c.warehouse}</span>}
                </div>
              )}
            </button>
          ))}
        </div>
        {/* Saisie manuelle : je tape les chiffres, ça pose « EM<chiffres> ». */}
        <div className="shrink-0 border-t border-border/60 bg-secondary/30 px-2.5 py-2">
          <label className="block text-[9.5px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Ou saisir le n° d&apos;entrée</label>
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center h-7 pl-2 pr-1 rounded-l-md border border-r-0 border-border bg-card text-[12px] font-semibold text-muted-foreground select-none">EM</span>
            <input
              type="text"
              inputMode="numeric"
              value={manual}
              onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && manual && lotBusy == null) { e.preventDefault(); runLotChange(`EM${manual}`, null); } }}
              placeholder="23568"
              className="h-7 flex-1 min-w-0 rounded-none border border-border bg-background px-2 text-[12.5px] tnum focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
            <button
              type="button"
              disabled={!manual || lotBusy != null}
              onClick={() => manual && runLotChange(`EM${manual}`, null)}
              className="h-7 shrink-0 rounded-r-md border border-l-0 border-brand-500 bg-brand-500 px-2.5 text-[12px] font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-600"
            >
              {lotBusy === `EM${manual}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "OK"}
            </button>
          </div>
        </div>
        </>
      ) : (
        <>
          <div className="shrink-0 relative px-2 pt-2">
            <Search className="pointer-events-none absolute left-4 top-[calc(50%+4px)] -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nouveau produit (nom ou code)…"
              aria-label="Rechercher l'article de remplacement"
              className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-8 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
            {loading && <Loader2 className="absolute right-4 top-[calc(50%+4px)] -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="overflow-y-auto py-1 min-h-0">
            {query.trim().length < 2 ? (
              <p className="px-3 py-2 text-[11.5px] italic text-muted-foreground">Tape au moins 2 caractères…</p>
            ) : results.length === 0 && !loading ? (
              <p className="px-3 py-2 text-[11.5px] italic text-muted-foreground">Aucun produit trouvé.</p>
            ) : results.map((p) => (
              <button
                key={p.itemCode}
                type="button"
                disabled={busy != null}
                onClick={() => runSwap(p)}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-secondary/60 disabled:opacity-60 transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-foreground truncate">{p.itemName}</span>
                  <span className="block text-[10px] font-mono text-muted-foreground">{p.itemCode}</span>
                </span>
                {busy === p.itemCode
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                  : <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

/* ═════════════════════════════════════════════════════════════
   Menu contextuel (clic droit) — scaffolding partagé transporteur / ligne :
   état de position, ouverture clampée à l'écran, fermeture (clic hors zone,
   Escape, scroll, resize) et rendu portalisé dans <body>.
═════════════════════════════════════════════════════════════ */
function useContextMenu(clampW = 220, clampH = 96) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const openAt = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    setMenu({ x: Math.min(e.clientX, window.innerWidth - clampW), y: Math.min(e.clientY, window.innerHeight - clampH) });
  }, [clampW, clampH]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu, close]);
  return { menu, openAt, close };
}

/** Conteneur portalisé du menu contextuel : backdrop de fermeture + panneau
 *  positionné. `header` optionnel (titre du groupe), `children` = les items. */
function ContextMenu({
  menu, onClose, minWidth = 210, header, children,
}: {
  menu: { x: number; y: number } | null;
  onClose: () => void;
  minWidth?: number;
  header?: ReactNode;
  children: ReactNode;
}) {
  if (!menu || typeof document === "undefined") return null;
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        role="menu"
        className="fixed z-50 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg animate-fade-up"
        style={{ top: menu.y, left: menu.x, minWidth }}
      >
        {header}
        {children}
      </div>
    </>,
    document.body,
  );
}

/** Élément de menu contextuel — icône + libellé, coche si état courant. */
function MenuItem({
  icon: Icon, children, onClick, accent, active,
}: {
  icon: typeof Clock;
  children: ReactNode;
  onClick: () => void;
  accent?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground hover:bg-secondary/60"
    >
      <Icon className={`h-4 w-4 shrink-0 ${accent ?? "text-brand-600 dark:text-brand-400"}`} />
      <span className="flex-1">{children}</span>
      {active && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-foreground/50" />}
    </button>
  );
}

/* ═════════════════════════════════════════════════════════════
   États vides / chargement
═════════════════════════════════════════════════════════════ */
function EmptyState({ date }: { date: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-border bg-card py-16 px-6">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/60 text-muted-foreground mb-3">
        <PackageX className="h-7 w-7" strokeWidth={1.7} />
      </span>
      <p className="text-[15px] font-semibold text-foreground">Aucune commande à livrer</p>
      <p className="text-[12.5px] text-muted-foreground mt-1 max-w-xs">
        Rien n&apos;est planifié pour le {formatDeliveryDate(date)}. Changez de date
        ou actualisez si une commande vient d&apos;être saisie.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground px-1">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement des commandes…
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="rounded-2xl border border-border bg-card overflow-hidden animate-pulse">
          <div className="h-14 border-b border-border bg-secondary/30" />
          <div className="divide-y divide-border/60">
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-16 px-5 flex items-center">
                <div className="h-4 w-40 rounded bg-secondary/60" />
                <div className="ml-auto h-6 w-10 rounded bg-secondary/60" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
