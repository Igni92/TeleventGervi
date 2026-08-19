"use client";

// ORCHESTRATEUR du détail livraison : état global, fetch, handlers et
// composition. Les composants de présentation vivent dans ./detail/ (DatePanel,
// panels, CarrierGroup, OrderRow, dialogs, menus).
//
// Structure refondue en 2 étages : (a) en-tête fusionné — le titre EST la date
// (« Livraison du mardi 19 août ») avec stepper compact et garde-fou férié en
// Banner ; (b) une seule barre d'outils (état + segment + recherche + repliage)
// précédée d'une StatLine de synthèse. Les bons export vivent SOUS les
// commandes, repliés. Rafraîchissement AUTOMATIQUE : polling 45 s quand
// l'onglet est visible + revalidation au focus — silencieux (pas de gen++, pas
// de voile), en préservant l'état déplié et les mises à jour optimistes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Truck, Users, Loader2, CheckCircle2, Search, Send, Store,
} from "lucide-react";
import { toast } from "sonner";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  nextDeliveryDate, frenchHolidayLabel, nextWorkingDeliveryDay,
  formatDeliveryDate,
} from "@/lib/livraison";
// Types (miroir de /api/livraisons) + logique de vue pure (testée à part).
import {
  computeStatusCounts, computeView, docTourneeKeyLabel, STATUS_LABEL,
  filterBySegment, computeSegmentCounts, keepDeliverableClients, SEGMENT_LABEL,
  type StatusTab, type SegmentTab, type Tournee, type Doc, type ApiResp,
} from "@/lib/livraisonView";
import { BonsPreparationPanel } from "./BonsPreparationPanel";
import { normalize, type ViewTab, type CarrierOption } from "./detail/shared";
import { DeliveryHeader } from "./detail/DatePanel";
import { SummaryStats, Toolbar, DayEmptyState, LoadingState } from "./detail/panels";
import { CarrierGroup } from "./detail/CarrierGroup";

// Ré-export de compatibilité : normalizeLotInput était historiquement exporté
// depuis ce fichier (il vit désormais dans ./detail/menus).
export { normalizeLotInput } from "./detail/menus";

/** Période du polling silencieux (onglet visible uniquement). */
const POLL_MS = 45_000;
/** Fraîcheur minimale : pas de re-fetch si un chargement/une mutation date de
 *  moins de ce délai (retours de focus répétés, action optimiste en vol). */
const FRESH_MS = 10_000;

/* ═════════════════════════════════════════════════════════════
   Composant principal
═════════════════════════════════════════════════════════════ */
export function LivraisonDetail({ canDispatch }: { canDispatch: boolean }) {
  // Deep-link depuis « Préparations à faire » (et ailleurs) : ?date=…&open=<docEntry>&t=<nonce>
  //  · date  → jour de livraison affiché
  //  · open  → commande à OUVRIR directement (vue en grand → console de lot)
  //  · t     → nonce (change à chaque clic) pour ROUVRIR la même commande.
  const searchParams = useSearchParams();
  const [date, setDate] = useState<string>(() => searchParams.get("date") || nextDeliveryDate());
  const [autoOpen, setAutoOpen] = useState<{ docEntry: number; nonce: string } | null>(() => {
    const o = searchParams.get("open");
    return o ? { docEntry: Number(o), nonce: searchParams.get("t") || o } : null;
  });
  useEffect(() => {
    const d = searchParams.get("date");
    const o = searchParams.get("open");
    if (d) setDate(d);
    if (o) setAutoOpen({ docEntry: Number(o), nonce: searchParams.get("t") || o });
  }, [searchParams]);
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  // Rafraîchissement SILENCIEUX en cours (polling / focus) — indicateur discret
  // dans l'en-tête, jamais de voile sur la liste.
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Génération des données : incrémentée à chaque (re)chargement COMPLET réussi
  // et incluse dans la key des lignes → les OrderRow remontent avec l'état
  // serveur frais (leurs useState dupliquent doc.* au montage). Les patchs
  // optimistes (patchDoc) ET les rafraîchissements silencieux ne changent PAS
  // la génération : rafraîchir ≠ remonter en haut ni perdre l'état des lignes.
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
  // minuit (poste entrepôt) — mention et bouton retour périmés.
  const auto = nextDeliveryDate();
  const holiday = frenchHolidayLabel(date);
  const isAuto = date === auto;

  // Garde d'obsolescence : chaque appel prend un numéro de séquence ; seule la
  // réponse de la DERNIÈRE requête est appliquée. Sans ça, un load() manuel
  // (Actualiser, changement transporteur/tournée/date) plus lent qu'un load()
  // suivant pouvait réécraser des données plus récentes — ou annuler des patchs
  // optimistes avec un instantané Prisma antérieur au POST.
  const loadSeq = useRef(0);
  // Horodatages : dernière mutation optimiste (patchDoc) et dernier chargement
  // réussi — le polling silencieux s'y réfère pour ne JAMAIS écraser une mise à
  // jour optimiste en vol ni re-fetcher des données toutes fraîches.
  const lastPatchRef = useRef(0);
  const lastLoadRef = useRef(0);
  const loadingRef = useRef(false);
  loadingRef.current = loading;

  const fetchDay = useCallback(
    (opts: { silent: boolean; signal?: AbortSignal }) => {
      const { silent, signal } = opts;
      const seq = ++loadSeq.current;
      const startedAt = Date.now();
      const fresh = () => !signal?.aborted && seq === loadSeq.current;
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
        setError(null);
      }
      // carryover=1 : le Détail livraison REPORTE la file de préparation — une
      // commande mise en prépa mais pas encore faite reste dans la vue du jour
      // (en retard comme en avance), tant qu'elle n'est pas marquée « faite ».
      fetch(`/api/livraisons?date=${date}&carryover=1`, { cache: "no-store", signal })
        .then(async (r) => {
          const j: ApiResp = await r.json();
          if (!fresh()) return;
          if (!j.ok) {
            // Échec silencieux : on ignore (le cycle suivant réessaiera) — pas
            // d'erreur plein écran pendant que l'entrepôt travaille.
            if (!silent) {
              setError(j.error || "Erreur de chargement.");
              setData(null);
            }
            return;
          }
          if (silent) {
            // Une mutation optimiste est survenue PENDANT ce fetch : la réponse
            // est un instantané antérieur — on la jette (prochain cycle : 45 s).
            if (lastPatchRef.current > startedAt) return;
            setData(j);
            setError(null); // SAP revenu en ligne pendant le polling
          } else {
            setData(j);
            setGen((g) => g + 1);
          }
          lastLoadRef.current = Date.now();
        })
        .catch((e) => {
          if (!silent && fresh() && e?.name !== "AbortError") setError("SAP injoignable. Réessayez.");
        })
        .finally(() => {
          if (silent) setRefreshing(false);
          else if (fresh()) setLoading(false);
        });
    },
    [date],
  );

  // Chargement COMPLET (gen++) — premier affichage, « Actualiser » et actions
  // qui exigent un remontage des lignes (changement de transporteur/date…).
  const load = useCallback((signal?: AbortSignal) => fetchDay({ silent: false, signal }), [fetchDay]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // ── Rafraîchissement AUTOMATIQUE : polling 45 s onglet VISIBLE + revalidation
  //    au focus fenêtre / retour d'onglet. Silencieux : un simple patch de
  //    `data` suffit (état déplié, dialogs et saisies des lignes préservés). ──
  const refreshSilent = useCallback(() => {
    if (typeof document === "undefined" || document.visibilityState !== "visible") return;
    if (loadingRef.current) return;                              // chargement complet en vol
    if (Date.now() - lastPatchRef.current < FRESH_MS) return;    // action optimiste récente
    if (Date.now() - lastLoadRef.current < FRESH_MS) return;     // données déjà fraîches
    fetchDay({ silent: true });
  }, [fetchDay]);
  useEffect(() => {
    const id = window.setInterval(refreshSilent, POLL_MS);
    const onWake = () => refreshSilent();
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [refreshSilent]);

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
  // Horodatée : le polling silencieux s'écarte tant qu'une mutation est récente.
  const patchDoc = useCallback((docEntry: number, patch: Partial<Doc>) => {
    lastPatchRef.current = Date.now();
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
  //    coup tous les BL affichés (recherche + segment respectés). Confirmation
  //    via ConfirmDialog (window.confirm interdit). ──
  const [releaseAllOpen, setReleaseAllOpen] = useState(false);
  const [releasingAll, setReleasingAll] = useState(false);
  const releaseCount = statusCounts.ventes;
  const releaseAllVentes = useCallback(async () => {
    const released = (view?.carriers ?? []).flatMap((c) => c.docs.filter((d) => !d.excluded));
    const entries = released.map((d) => d.docEntry);
    const names = released.map((d) => d.cardName).filter(Boolean);
    if (!entries.length || releasingAll) return;
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
  // immédiatement, sans cliquer sur les groupes. En deep-link (?open=…), on force
  // l'ouverture du transporteur ET du sous-groupe tournée qui portent la commande
  // cible — sinon elle resterait masquée (tout est replié par défaut) et
  // l'ouverture directe ne trouverait pas la ligne.
  const effectiveExpanded = useMemo(() => {
    if (searching) return new Set(allKeys);
    if (!autoOpen) return expanded;
    const extra: string[] = [];
    for (const c of view?.carriers ?? []) {
      const target = c.docs.find((d) => d.docEntry === autoOpen.docEntry);
      if (!target) continue;
      const ck = c.code ?? "__none__";
      extra.push(ck);
      const trn = tourneesByCode[(c.code ?? "").toUpperCase()];
      extra.push(`${ck}::${docTourneeKeyLabel(target, trn).key}`);
      break;
    }
    return extra.length ? new Set([...expanded, ...extra]) : expanded;
  }, [searching, allKeys, expanded, autoOpen, view, tourneesByCode]);

  return (
    <div className="space-y-5 animate-fade-up">
      {/* ── Étage 1 : EN-TÊTE FUSIONNÉ — le titre est la date, stepper compact,
             garde-fou férié en Banner (report intégré). ── */}
      <DeliveryHeader
        date={date}
        isAuto={isAuto}
        holiday={holiday}
        loading={loading}
        refreshing={refreshing}
        onPick={setDate}
        onReset={() => setDate(auto)}
        onReport={() => setDate(nextWorkingDeliveryDay(date))}
        onRefresh={() => load()}
      />

      {/* ── Synthèse inline (reflète le segment + l'onglet actif) ── */}
      {view?.totals && <SummaryStats totals={view.totals} />}

      {/* ── Étage 2 : BARRE D'OUTILS UNIQUE — état · segment · recherche ·
             repliage. ── */}
      {deliverableData && deliverableData.count > 0 && (
        <Toolbar
          tab={statusTab}
          counts={statusCounts}
          onPick={setStatusTab}
          showVentes={canDispatch}
          segment={segment}
          segCounts={segCounts}
          onSegment={setSegment}
          query={query}
          onQuery={setQuery}
          allCollapsed={allCollapsed}
          onToggleAll={toggleAll}
        />
      )}

      {/* ── Onglet Ventes (dispatch) : lâcher d'un coup tous les BL affichés ── */}
      {canDispatch && statusTab === "VENTES" && (view?.count ?? 0) > 0 && (
        <>
          <Button
            type="button"
            variant="warning"
            size="sm"
            onClick={() => setReleaseAllOpen(true)}
            disabled={releasingAll}
          >
            {releasingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Tout mettre en préparation ({releaseCount})
          </Button>
          <ConfirmDialog
            open={releaseAllOpen}
            onOpenChange={setReleaseAllOpen}
            title="Tout mettre en préparation ?"
            description={
              releaseCount > 1
                ? `${releaseCount} magasins deviendront visibles pour l'entrepôt.`
                : "Ce magasin deviendra visible pour l'entrepôt."
            }
            confirmLabel="Mettre en préparation"
            onConfirm={releaseAllVentes}
            loading={releasingAll}
          />
        </>
      )}

      {/* ── Contenu ── */}
      {error ? (
        <Banner
          tone="danger"
          title={error}
          action={
            <Button type="button" size="sm" variant="outline" onClick={() => load()}>
              Réessayer
            </Button>
          }
        />
      ) : loading && !data ? (
        <LoadingState />
      ) : deliverableData && deliverableData.count === 0 ? (
        <DayEmptyState date={date} />
      ) : data && !searching && segment !== "TOUT" && segCarriers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card">
          <EmptyState
            icon={Users}
            title={`Aucune commande ${SEGMENT_LABEL[segment]}`}
            description={<>Aucun client {SEGMENT_LABEL[segment]} n&apos;est livré ce jour-là.</>}
            action={
              <Button type="button" variant="tinted" size="sm" onClick={() => setSegment("TOUT")}>
                Voir toutes les commandes
              </Button>
            }
          />
        </div>
      ) : view && view.count === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card">
          {searching ? (
            <EmptyState
              icon={Search}
              title="Aucun bon trouvé"
              description={
                <>
                  Rien ne correspond à « <b className="text-foreground">{query.trim()}</b> » dans
                  cet onglet (n° de BL, client, code ou réf. client).
                </>
              }
              action={
                <Button type="button" variant="tinted" size="sm" onClick={() => setQuery("")}>
                  Effacer la recherche
                </Button>
              }
            />
          ) : statusTab === "A_PREPARER" ? (
            <EmptyState
              icon={CheckCircle2}
              title="Tout est préparé"
              description="Aucune commande en attente de préparation."
              action={
                <Button type="button" variant="tinted" size="sm" onClick={() => setStatusTab("FAIT")}>
                  Voir les commandes faites
                </Button>
              }
            />
          ) : statusTab === "FAIT" ? (
            <EmptyState
              title="Aucune commande préparée"
              description={<>Rien n&apos;a encore été marqué « fait ».</>}
              action={
                <Button type="button" variant="tinted" size="sm" onClick={() => setStatusTab("A_PREPARER")}>
                  Voir à préparer
                </Button>
              }
            />
          ) : statusTab === "VENTES" ? (
            <EmptyState
              icon={Store}
              title="Aucune vente en attente"
              description={<>Tous les magasins du jour ont été mis en préparation — l&apos;entrepôt voit tout.</>}
              action={
                <Button type="button" variant="tinted" size="sm" onClick={() => setStatusTab("A_PREPARER")}>
                  Voir à préparer
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Truck}
              title="Aucune commande partie"
              description={<>Aucune livraison n&apos;a encore quitté l&apos;entrepôt.</>}
              action={
                <Button type="button" variant="tinted" size="sm" onClick={() => setStatusTab("FAIT")}>
                  Voir les commandes faites
                </Button>
              }
            />
          )}
        </div>
      ) : view ? (
        // Pas de voile opacity pendant les rechargements : l'indicateur discret
        // vit dans l'en-tête, la liste reste pleinement lisible et cliquable.
        <div className="space-y-4">
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
                autoOpen={autoOpen}
              />
            );
          })}
        </div>
      ) : null}

      {/* ── Bons de préparation EXPORT (lots à affecter → créer le BL) — ligne
             repliée discrète SOUS les commandes, dépliable à la demande. ── */}
      <BonsPreparationPanel refreshKey={gen} onOrderCreated={() => load()} />
    </div>
  );
}
