"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, ChevronDown, ChevronRight, Search, Plus, Trash2,
  ShoppingCart, Check, RotateCcw, AlertTriangle, Star, Gift, Megaphone, Pencil,
} from "lucide-react";
import { splitByWarehouse, totalAvailable, personalStock, unitInfo } from "@/lib/gervifrais-calc";
import { formatDateInput } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PromoBanner } from "@/components/promos/PromoBanner";

interface StockEntry { available: number }
interface Product {
  id: string; itemCode: string; itemName: string; groupName: string | null;
  salesUnit: string | null; salesQtyPerPackUnit: number | null;
  // B4 — poids colis (kg) : salesUnitWeight × salesQtyPerPackUnit × (salesItemsPerUnit ?? 1)
  salesUnitWeight?: number | null; salesItemsPerUnit?: number | null;
  // Détails métier (Gervifrais U_*) — sortis du grisé pour décision rapide en appel
  uMarque: string | null; uPays: string | null; uCondi: string | null; uUvc: string | null;
  frgnName?: string | null;                 // variété (SAP FrgnName)
  stockByWarehouse: Record<string, StockEntry>;
}
interface Hint {
  prixConseille: number | null; coef: number; isDefault: boolean; prixAchat: number | null;
  marque: string | null; calibre: string | null; pays: string | null;
}
/** C2 — Promo active sur un article (cf. /api/promos?active=1). */
interface Promo {
  id: string; itemCode: string; kind: "PERCENT" | "X_PLUS_Y" | "FREE";
  value: number; buyQty: number; freeQty: number; label: string | null;
  startsAt?: string | null; endsAt?: string | null;
}
interface CartLine {
  itemCode: string; itemName: string; unit: string; priceUnit: string; packDivisor: number;
  availByWarehouse: Record<string, number>;
  quantity: number; price: number | null;
  // Tags produit (affichés sur la ligne panier) — capturés à l'ajout.
  marque: string | null; condi: string | null; pays: string | null; variete: string | null;
  // Incrément « un colis » dans l'unité d'affichage : kg/colis (ex. 4 pour un
  // colis de 4 kg vendu au kg ; 1 pour un article déjà compté en colis).
  stepColis: number;
  // C2 — promo appliquée à la ligne (remise SAP envoyée à la création du bon)
  promo: Promo | null; discountPercent: number; freeUnits: number;
  // Mode MODIFICATION : ligne déjà présente sur le BL (mapping 1:1 avec le
  // LineNum SAP). null/absent = nouvelle ligne (sera ajoutée au BL). Une ligne
  // existante se met à jour par LineNum, ne se supprime pas (jamais de 2ᵉ BL).
  // `qty`/`price` = valeurs d'origine (détection de changement) ; `pieces` = la
  // quantité SAP brute d'origine (renvoyée telle quelle si la qté n'a pas bougé,
  // pour ne pas réintroduire d'arrondi colis↔pièces sur une ligne intouchée).
  originalLine?: { lineNum: number; warehouse: string | null; qty: number; price: number | null; pieces: number } | null;
}
interface DeliveryMode { id: string; name: string; sapCardCode: string; isDefault: boolean }
// B3 — `count` présent quand la liste vient de /api/clients/[id]/carriers (nb de cdes)
interface Carrier { id: string; name: string; count?: number }

/* ── C2 — Helpers promo (purs) ─────────────────────────────── */

/** Recalcule les COLIS OFFERTS d'une ligne promo (X_PLUS_Y ou FREE).
 *  X_PLUS_Y (« 5 achetés + 1 offert ») : le(s) offert(s) sont DANS la quantité
 *    saisie → freeUnits = freeQty × floor(qty / (buyQty + freeQty)). discountPercent
 *    sert UNIQUEMENT à l'affichage panier (le bon SAP, lui, fait une ligne à 0).
 *  FREE (« 1 colis offert ») : freeQty colis offerts EN PLUS de la quantité saisie,
 *    sans seuil d'achat → freeUnits = freeQty (dès qu'on commande l'article).
 *  No-op pour les autres lignes — appelé à chaque changement de quantité. */
function applyPromoFree(line: CartLine): CartLine {
  const pr = line.promo;
  const qty = line.quantity;
  if (pr?.kind === "X_PLUS_Y" && pr.buyQty > 0 && pr.freeQty > 0) {
    const freeUnits = qty > 0 ? pr.freeQty * Math.floor(qty / (pr.buyQty + pr.freeQty)) : 0;
    const discountPercent = freeUnits > 0 ? Math.round((freeUnits / qty) * 100 * 100) / 100 : 0;
    return { ...line, freeUnits, discountPercent };
  }
  if (pr?.kind === "FREE" && pr.freeQty > 0) {
    return { ...line, freeUnits: qty > 0 ? pr.freeQty : 0, discountPercent: 0 };
  }
  return line;
}

/** Libellé court du badge promo : « −10 % », « 5+1 » ou « +1 offert ». */
function promoBadge(pr: Promo): string {
  if (pr.kind === "PERCENT") return `−${String(Math.round(pr.value * 100) / 100)} %`;
  if (pr.kind === "FREE") return `+${pr.freeQty} offert${pr.freeQty > 1 ? "s" : ""}`;
  return `${pr.buyQty}+${pr.freeQty}`;
}

/** Période lisible d'une promo : « 02/06 → 15/06 », « jusqu'au 15/06 », « permanente ». */
function promoPeriod(pr: Promo): string {
  const f = (s?: string | null) =>
    s ? new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : null;
  const a = f(pr.startsAt), b = f(pr.endsAt);
  if (a && b) return `${a} → ${b}`;
  if (a) return `dès le ${a}`;
  if (b) return `jusqu'au ${b}`;
  return "permanente";
}

/* ── B4 — Poids d'un colis (kg), null-safe ─────────────────── */
function colisKg(p: Product): number | null {
  const w = p.salesUnitWeight, perPack = p.salesQtyPerPackUnit;
  if (w == null || !(w > 0) || perPack == null || !(perPack > 0)) return null;
  const items = p.salesItemsPerUnit != null && p.salesItemsPerUnit > 0 ? p.salesItemsPerUnit : 1;
  const kg = w * perPack * items;
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return Math.round(kg * 100) / 100;
}
function fmtKg(kg: number): string {
  return kg % 1 === 0 ? kg.toFixed(0) : String(kg);
}

/* ── C4 — Densité d'affichage de la liste stock ────────────── */
type Density = "compact" | "normal" | "aere";
const DENSITY_KEY = "televente:ecran2Density";
/** Tailles par niveau — « normal » = la référence actuelle (ne rien réduire par défaut). */
const DENSITY_UI: Record<Density, {
  rowPad: string; dispo: string; dispoUnit: string; dec: string;
  name: string; chip: string; code: string; price: string; priceUnit: string;
}> = {
  compact: {
    rowPad: "py-1.5", dispo: "text-[18px]", dispoUnit: "text-[9.5px]", dec: "text-[13px]",
    name: "text-[14px]", chip: "h-[20px] text-[11px]", code: "text-[10px]",
    price: "text-[16px]", priceUnit: "text-[10.5px]",
  },
  normal: {
    rowPad: "py-2.5", dispo: "text-[22px]", dispoUnit: "text-[10px]", dec: "text-[15px]",
    name: "text-[16px]", chip: "h-[22px] text-[12px]", code: "text-[10.5px]",
    price: "text-[18px]", priceUnit: "text-[11px]",
  },
  aere: {
    rowPad: "py-3.5", dispo: "text-[24px]", dispoUnit: "text-[10.5px]", dec: "text-[16px]",
    name: "text-[17px]", chip: "h-[24px] text-[13px]", code: "text-[11px]",
    price: "text-[19px]", priceUnit: "text-[11.5px]",
  },
};
/* ── C1 — Groupe Favoris épinglé en tête de liste ──────────── */
const FAV_GROUP = "⭐ Favoris";

/** Entrée de la liste stock : un groupe famille (éventuellement épinglé).
 *  `key` distinct de `name` pour les copies épinglées (clé React unique +
 *  état ouvert/fermé indépendant de l'original resté à sa place). */
interface GroupEntry { key: string; name: string; prods: Product[]; pinned?: boolean }

/**
 * Écran 2 — Constructeur de commande piloté par le stock.
 * Le stock affiche le prix conseillé ; un clic ajoute la ligne au panier
 * (prix pré-rempli). Le panier crée le BL directement. Pas de bouton/modale.
 *
 * Ajouts console :
 *   C1 — favoris par commercial : étoile article (groupe « ⭐ Favoris » épinglé
 *        en tête) + étoile GROUPE famille (groupes favoris épinglés juste après)
 *   C2 — promos actives : remise auto au panier (PERCENT / X_PLUS_Y),
 *        discountPercent par ligne + mention PROMO en en-tête du bon.
 *        L'affichage : bouton « Promotions » (Dialog récap) + rappel discret
 *        sur la ligne panier — plus de badge sur la liste stock.
 *   B3 — transporteurs filtrés par client (fallback liste complète)
 *   B4 — « colis de X kg » sous le nom produit quand calculable
 *   C4 — densité d'affichage Compact / Normal / Aéré : RÉGLÉE sur /parametres
 *        (localStorage televente:ecran2Density), lue ici + listener storage
 */
export function Ecran2Order({ clientId, clientName, stockSharePct = 100, modifier: modifierProp = null }: {
  clientId: string; clientName: string; stockSharePct?: number;
  /** Cible de MODIFICATION (pilotée par « Détail livraison » via l'URL) : on
   *  pré-remplit le panier avec les lignes du BL et on enregistre sur ce BL. */
  modifier?: { docEntry: number; docNum: number } | null;
}) {
  const [grouped, setGrouped] = useState<Record<string, Product[]>>({});
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");
  // Catalogue complet (incl. stock 0) — toggle off par défaut pour ne pas polluer la vue.
  // Activé : on recharge sans le filtre inStock=true → les "à découvert" apparaissent.
  const [includeOutOfStock, setIncludeOutOfStock] = useState(false);
  const [hints, setHints] = useState<Record<string, Hint>>({});
  // C1 — favoris du commercial connecté (itemCodes + groupes famille)
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favGroups, setFavGroups] = useState<Set<string>>(new Set());
  // C2 — promos actives, indexées par itemCode (1 promo max appliquée par article)
  const [promos, setPromos] = useState<Record<string, Promo>>({});
  // C2 — liste complète des promos actives (Dialog « Promotions »)
  const [promoList, setPromoList] = useState<Promo[]>([]);
  const [promosOpen, setPromosOpen] = useState(false);
  // C4 — densité d'affichage de la liste stock (réglée sur /parametres, lue ici)
  const [density, setDensity] = useState<Density>("normal");
  // Panier
  const [cart, setCart] = useState<CartLine[]>([]);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [numAtCard, setNumAtCard] = useState("");
  const [modes, setModes] = useState<DeliveryMode[]>([]);
  const [modeId, setModeId] = useState("");
  // C11/B3 — transporteur (ORDR.U_TrspCode). Liste filtrée par client si dispo.
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [carrierId, setCarrierId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Modale de confirmation encours (remplace window.confirm natif)
  const [encoursPrompt, setEncoursPrompt] = useState<
    { lines: ApiLine[]; message: string; encours?: { balance: number; creditLimit: number } } | null
  >(null);
  // Mode MODIFICATION (piloté par « Détail livraison » via l'URL) : on charge le
  // BL existant, on PRÉ-REMPLIT le panier avec ses lignes (éditables), et la
  // validation enregistre sur CE BL (jamais de 2ᵉ bon).
  const [modif, setModif] = useState(modifierProp);
  const [modifMeta, setModifMeta] = useState<{ dueDate?: string; editable?: boolean } | null>(null);
  const [prefilling, setPrefilling] = useState(false);

  /** Charge (ou recharge) le BL ciblé et pré-remplit le panier avec ses lignes.
   *  Rappelé après un enregistrement pour refléter l'état SAP réel — et pour que
   *  les lignes fraîchement ajoutées portent leur LineNum (pas de ré-ajout). */
  const loadModif = useCallback(async (target: { docEntry: number; docNum: number }) => {
    setPrefilling(true);
    try {
      const r = await fetch(`/api/sap/orders/${target.docEntry}/modif`, { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) { toast.error("Chargement du BL impossible", { description: j?.error, duration: 8000 }); return; }
      setModifMeta({ dueDate: j.dueDate, editable: j.editable });
      type PrefillLine = {
        lineNum: number; warehouse: string | null; itemCode: string; itemName: string;
        unit: string; priceUnit: string; packDivisor: number; availByWarehouse: Record<string, number>;
        quantity: number; qtyPieces: number; price: number | null; marque: string | null; condi: string | null;
        pays: string | null; variete: string | null; stepColis: number;
      };
      setCart((j.cartLines ?? []).map((l: PrefillLine) => ({
        itemCode: l.itemCode, itemName: l.itemName, unit: l.unit, priceUnit: l.priceUnit,
        packDivisor: l.packDivisor, availByWarehouse: l.availByWarehouse,
        quantity: l.quantity, price: l.price,
        marque: l.marque, condi: l.condi, pays: l.pays, variete: l.variete,
        stepColis: l.stepColis && l.stepColis > 0 ? l.stepColis : 1,
        promo: null, discountPercent: 0, freeUnits: 0,
        originalLine: { lineNum: l.lineNum, warehouse: l.warehouse, qty: l.quantity, price: l.price, pieces: l.qtyPieces },
      })));
      if (j.editable === false) {
        toast.warning("Commande clôturée — la modification sera refusée par SAP.", { duration: 8000 });
      }
    } catch {
      toast.error("Chargement du BL impossible (SAP injoignable).");
    } finally {
      setPrefilling(false);
    }
  }, []);

  useEffect(() => {
    setModif(modifierProp);
    if (modifierProp) { loadModif(modifierProp); }
    else { setModifMeta(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modifierProp?.docEntry]);

  // ── Reset quand le client change ──
  useEffect(() => {
    setCart([]); setNumAtCard("");
    const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0);
    setDeliveryDate(formatDateInput(t));
    fetch(`/api/clients/${clientId}/delivery-modes`).then((r) => r.json()).then((d) => {
      const ms: DeliveryMode[] = d.modes ?? [];
      setModes(ms);
      const def = ms.find((m) => m.isDefault) ?? ms[0];
      setModeId(def?.id ?? "");
    }).catch(() => {});
  }, [clientId]);

  // ── B3 — Transporteurs filtrés par client ──
  // /api/clients/[id]/carriers renvoie les transporteurs réellement utilisés par
  // ce client (+ defaultId présélectionné). Liste vide ou erreur → fallback sur
  // la liste complète /api/carriers (comportement historique), sans présélection.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/clients/${clientId}/carriers`);
        if (r.ok) {
          const d = await r.json();
          const list: Carrier[] = d?.carriers ?? [];
          if (list.length > 0) {
            if (cancelled) return;
            setCarriers(list);
            const def = typeof d?.defaultId === "string" && list.some((c) => c.id === d.defaultId)
              ? d.defaultId : "";
            setCarrierId(def);
            return;
          }
        }
      } catch { /* fallback liste complète ci-dessous */ }
      try {
        const r = await fetch(`/api/carriers`);
        const d = await r.json();
        if (!cancelled) { setCarriers(d.carriers ?? []); setCarrierId(""); }
      } catch { if (!cancelled) setCarriers([]); }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  // ── C1 — Favoris (chargés une fois, propres à l'utilisateur connecté) ──
  useEffect(() => {
    fetch(`/api/favorites`).then((r) => r.json())
      .then((d) => {
        setFavorites(new Set<string>(d?.itemCodes ?? []));
        setFavGroups(new Set<string>(d?.groups ?? []));
      })
      .catch(() => { /* favoris optionnels */ });
  }, []);

  /** Toggle optimiste : l'étoile réagit immédiatement, rollback si l'API échoue. */
  const toggleFavorite = (itemCode: string) => {
    const wasFav = favorites.has(itemCode);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (wasFav) next.delete(itemCode); else next.add(itemCode);
      return next;
    });
    const req = wasFav
      ? fetch(`/api/favorites?itemCode=${encodeURIComponent(itemCode)}`, { method: "DELETE" })
      : fetch(`/api/favorites`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemCode }),
        });
    req.then((r) => { if (!r.ok) throw new Error(); }).catch(() => {
      setFavorites((prev) => {
        const next = new Set(prev);
        if (wasFav) next.add(itemCode); else next.delete(itemCode);
        return next;
      });
      toast.error("Favori non enregistré");
    });
  };

  /** C1 — Toggle optimiste d'un GROUPE famille favori (épinglé en tête de liste). */
  const toggleFavoriteGroup = (group: string) => {
    const wasFav = favGroups.has(group);
    setFavGroups((prev) => {
      const next = new Set(prev);
      if (wasFav) next.delete(group); else next.add(group);
      return next;
    });
    const req = wasFav
      ? fetch(`/api/favorites?group=${encodeURIComponent(group)}`, { method: "DELETE" })
      : fetch(`/api/favorites`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ group }),
        });
    req.then((r) => { if (!r.ok) throw new Error(); }).catch(() => {
      setFavGroups((prev) => {
        const next = new Set(prev);
        if (wasFav) next.add(group); else next.delete(group);
        return next;
      });
      toast.error("Groupe favori non enregistré");
    });
  };

  // ── C2 — Promos actives (Dialog récap + remise auto au panier) ──
  useEffect(() => {
    fetch(`/api/promos?active=1`).then((r) => r.json())
      .then((d) => {
        const list = (d?.promos ?? []) as Promo[];
        setPromoList(list);
        const map: Record<string, Promo> = {};
        for (const pr of list) {
          if (pr?.itemCode && !map[pr.itemCode]) map[pr.itemCode] = pr;
        }
        setPromos(map);
      })
      .catch(() => { /* promos optionnelles */ });
  }, []);

  // ── C4 — Densité : réglage déplacé sur /parametres. Ici on LIT seulement
  // localStorage (après hydratation, anti-mismatch SSR) + listener `storage`
  // pour réagir en direct si la valeur change depuis un autre onglet. ──
  useEffect(() => {
    const apply = (v: string | null) => {
      if (v === "compact" || v === "normal" || v === "aere") setDensity(v);
    };
    try { apply(localStorage.getItem(DENSITY_KEY)); } catch { /* ignore */ }
    const onStorage = (e: StorageEvent) => {
      if (e.key === DENSITY_KEY) apply(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ── Charge le stock ──
  // Par défaut : uniquement les articles en stock (vue propre pendant l'appel).
  // Toggle `includeOutOfStock` → recharge sans filtre pour permettre la vente
  // à découvert (le BL portera U_NoLot=EM_PENDING, repris à la prochaine entrée).
  const loadStock = useCallback(async () => {
    setLoading(true);
    try {
      // limit élevé : en « à découvert » on veut TOUT le catalogue (articles à 0
      // inclus). À 600 plafonné à 200 côté API, les articles 0-stock étaient coupés.
      const params = new URLSearchParams({ limit: "3000" });
      if (!includeOutOfStock) params.set("inStock", "true");
      const res = await fetch(`/api/products?${params}`);
      const json = await res.json();
      const byGroup: Record<string, Product[]> = {};
      for (const p of (json.products ?? []) as Product[]) {
        const g = p.groupName?.trim() || "Autres";
        (byGroup[g] ||= []).push(p);
      }
      Object.values(byGroup).forEach((a) => a.sort((x, y) => x.itemName.localeCompare(y.itemName)));
      setGrouped(byGroup);
      setOpenGroups(Object.fromEntries(Object.keys(byGroup).map((g) => [g, true])));
      // Charge les prix conseillés en arrière-plan (par lots de 40)
      const allCodes = (json.products ?? []).map((p: Product) => p.itemCode);
      loadHints(allCodes);
    } catch { setGrouped({}); }
    finally { setLoading(false); }
  }, [clientId, includeOutOfStock]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadHints = useCallback(async (codes: string[]) => {
    for (let i = 0; i < codes.length; i += 40) {
      const slice = codes.slice(i, i + 40);
      try {
        const params = new URLSearchParams({ clientId, items: slice.join(",") });
        const res = await fetch(`/api/sap/prices?${params}`);
        const json = await res.json();
        if (json.prices) setHints((cur) => ({ ...cur, ...json.prices }));
      } catch { /* prix optionnel */ }
    }
  }, [clientId]);

  useEffect(() => { loadStock(); }, [loadStock]);

  // Actualisation « en date du jour » : pull le stock SAP réel (PROD) puis recharge.
  const syncAndReload = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await fetch("/api/sap/sync/products", { method: "POST" });
      if (!r.ok) throw new Error();
      toast.success("Stock actualisé depuis SAP (PROD)");
    } catch {
      toast.error("Sync SAP échouée — dernier stock connu affiché");
    } finally {
      setSyncing(false);
      await loadStock();
    }
  }, [loadStock]);

  // ── Panier ──
  const addToCart = (p: Product) => {
    setCart((cur) => {
      if (cur.some((l) => l.itemCode === p.itemCode)) return cur;  // déjà au panier
      const { packDivisor, displayUnit, priceUnit } = unitInfo(p.salesUnit, p.salesQtyPerPackUnit);
      const avail: Record<string, number> = {};
      for (const w of ["000", "01", "R1"]) avail[w] = Math.max(0, Math.floor(((p.stockByWarehouse[w]?.available ?? 0) / packDivisor) * 10) / 10);
      // Incrément « un colis » : si l'article est vendu au kg, on avance du POIDS
      // d'un colis (ex. 4 kg → 4, 8, 12…) ; sinon d'un colis entier (1).
      // colisWeightKg n'est calculé par unitInfo qu'avec salesItemsPerUnit ; à
      // défaut (absent du /api/products) on le reconstruit : qty/colis × poids unité
      // (ex. FB4CA3B = 4 × 1 = 4 kg).
      let colisW = unitInfo(p.salesUnit, p.salesQtyPerPackUnit, p.salesItemsPerUnit ?? null, p.salesUnitWeight).colisWeightKg ?? null;
      if ((colisW == null || colisW <= 0) && displayUnit === "kg") {
        const q = p.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1 ? p.salesQtyPerPackUnit : 1;
        const w = p.salesUnitWeight && p.salesUnitWeight > 0 ? p.salesUnitWeight : 1;
        colisW = Math.round(q * w * 1000) / 1000;
      }
      const stepColis = displayUnit === "kg" ? (colisW && colisW > 0 ? Math.round(colisW * 100) / 100 : 1) : 1;
      // C2 — promo PERCENT : prix prérempli déjà remisé (prix conseillé × (1 − %)),
      // la remise est mémorisée pour être poussée sur la ligne SAP du bon.
      const promo = promos[p.itemCode] ?? null;
      let price = hints[p.itemCode]?.prixConseille ?? null;
      let discountPercent = 0;
      if (promo?.kind === "PERCENT" && promo.value > 0 && promo.value < 100) {
        discountPercent = promo.value;
        if (price != null) price = Math.round(price * (1 - promo.value / 100) * 100) / 100;
      }
      return [...cur, applyPromoFree({
        itemCode: p.itemCode, itemName: p.itemName, unit: displayUnit, priceUnit, packDivisor,
        availByWarehouse: avail, quantity: stepColis, price,
        marque: p.uMarque ?? null, condi: p.uCondi ?? p.uUvc ?? null, pays: p.uPays ?? null,
        variete: p.frgnName ?? null,
        stepColis,
        promo, discountPercent, freeUnits: 0,
        originalLine: null,   // ajoutée via le stock → nouvelle ligne du BL
      })];
    });
  };
  // applyPromoFree est no-op hors promo X_PLUS_Y/FREE → recalcul sûr à chaque changement de quantité.
  const updateLine = (i: number, patch: Partial<CartLine>) =>
    setCart((c) => c.map((l, k) => k === i ? applyPromoFree({ ...l, ...patch }) : l));
  const removeLine = (i: number) => setCart((c) => c.filter((_, k) => k !== i));
  /** Retire un item du panier par son itemCode (utilisé par le toggle Add/Done). */
  const removeFromCartByCode = (itemCode: string) =>
    setCart((c) => c.filter((l) => l.itemCode !== itemCode));

  // Rejouer la dernière commande → remplit le panier (1 clic)
  const [replaying, setReplaying] = useState(false);
  const replayLast = async () => {
    setReplaying(true);
    try {
      const res = await fetch(`/api/sap/orders/last?clientId=${encodeURIComponent(clientId)}`);
      const json = await res.json();
      if (!json.found || !json.lines?.length) { toast("Aucune commande précédente"); return; }
      // Lignes rejouées SANS promo : les prix historiques sont conservés tels quels.
      setCart(json.lines.map((l: { itemCode: string; itemName: string; displayUnit: string; priceUnit: string; packDivisor: number; availByWarehouse: Record<string, number>; quantity: number; price: number | null }) => ({
        itemCode: l.itemCode, itemName: l.itemName, unit: l.displayUnit, priceUnit: l.priceUnit,
        packDivisor: l.packDivisor, availByWarehouse: l.availByWarehouse, quantity: l.quantity, price: l.price,
        marque: null, condi: null, pays: null, variete: null, stepColis: 1,
        promo: null, discountPercent: 0, freeUnits: 0, originalLine: null,
      })));
      toast.success(`Dernière commande #${json.docNum} rejouée`);
    } catch { toast.error("Erreur rejeu"); }
    finally { setReplaying(false); }
  };

  // Prix à la pièce × (colis × pièces/colis) = total ligne.
  // C2 — X_PLUS_Y : le prix affiché reste PLEIN, la remise (= colis offerts)
  // s'applique sur le total. PERCENT : le prix affiché est DÉJÀ remisé → rien à déduire.
  const lineHT = (l: CartLine) => {
    if (!l.price) return 0;
    const brut = l.price * l.quantity * l.packDivisor;
    if (l.promo?.kind === "X_PLUS_Y" && l.discountPercent > 0) return brut * (1 - l.discountPercent / 100);
    return brut;
  };
  const totalHT = useMemo(() => cart.reduce((s, l) => s + lineHT(l), 0), [cart]);

  // ── Création BL ──
  type ApiLine = {
    itemCode: string; quantity: number; displayQuantity: number;
    displayUnit: string; warehouseCode: string; price?: number;
    /** C2 — remise SAP par ligne (0–100), portée sur le bon. */
    discountPercent?: number;
  };

  /** C2 — En-tête du bon : mention des promos appliquées (uniquement si présentes).
   *  Ex. « PROMO : −10% Fraise Hoogstraten · 5+1 Framboise (1 colis offert) ». */
  const buildPromoComment = (): string | undefined => {
    const parts: string[] = [];
    for (const l of cart) {
      if (!l.promo) continue;
      const name = l.promo.label?.trim() || l.itemName;
      if (l.promo.kind === "PERCENT" && l.discountPercent > 0) {
        parts.push(`−${String(Math.round(l.discountPercent * 100) / 100)}% ${name}`);
      } else if (l.promo.kind === "X_PLUS_Y" && l.freeUnits > 0) {
        parts.push(`${l.promo.buyQty}+${l.promo.freeQty} ${name} (${l.freeUnits} colis offert${l.freeUnits > 1 ? "s" : ""})`);
      } else if (l.promo.kind === "FREE" && l.freeUnits > 0) {
        parts.push(`${name} (${l.freeUnits} colis offert${l.freeUnits > 1 ? "s" : ""})`);
      }
    }
    return parts.length > 0 ? `PROMO : ${parts.join(" · ")}` : undefined;
  };

  const postOrder = (apiLines: ApiLine[], confirmEncours: boolean) =>
    fetch("/api/sap/orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId, deliveryModeId: modeId || undefined,
        carrierId: carrierId || undefined,
        deliveryDate: new Date(deliveryDate).toISOString(),
        numAtCard: numAtCard.trim() || undefined, confirmEncours, lines: apiLines,
        comments: buildPromoComment(),   // undefined → champ omis (pas de promo)
      }),
    });

  // Traite la réponse finale (succès / blocage / erreur). Renvoie true si succès.
  const finalizeOrder = (res: Response, json: { ok?: boolean; blocked?: boolean; error?: string; docNum?: number; totalTTC?: number | null }) => {
    if (!res.ok) {
      toast.error(json?.blocked ? "🚫 Client bloqué" : "❌ Échec création", { description: json.error, duration: 10000 });
      return false;
    }
    const fmt = (n: number | null | undefined) => n != null ? n.toFixed(2) : "—";
    toast.success(`✅ Commande #${json.docNum} créée — ${fmt(json.totalTTC)} € TTC`, { duration: 10000 });
    setCart([]); setNumAtCard("");
    return true;
  };

  const buildApiLines = (lines: CartLine[] = cart): ApiLine[] =>
    lines.flatMap((l) => {
      const kind = l.promo?.kind;
      const freeUnits = (kind === "X_PLUS_Y" || kind === "FREE") ? Math.max(0, Math.floor(l.freeUnits)) : 0;
      // Quantité TOTALE expédiée (colis) :
      //   X_PLUS_Y → les offerts sont DANS la qté saisie (le 6ᵉ d'un 5+1) ;
      //   FREE     → les offerts s'AJOUTENT par-dessus la qté saisie ;
      //   autres   → qté saisie.
      const paidQty = kind === "FREE" ? l.quantity : Math.max(0, l.quantity - freeUnits);
      const totalQty = paidQty + freeUnits;

      // C2 — PERCENT : le prix panier est NET (déjà remisé) → on renvoie le BRUT
      //   pour que le net SAP retombe sur le prix affiché. Sinon prix plein.
      const dPercent = kind === "PERCENT" && l.discountPercent > 0 && l.discountPercent < 100
        ? Math.round(l.discountPercent * 100) / 100 : undefined;
      let price = l.price != null && l.price > 0 ? l.price : undefined;
      if (price != null && dPercent != null) {
        price = Math.round((price / (1 - dPercent / 100)) * 10000) / 10000;
      }

      // Découpe multi-entrepôt sur la qté TOTALE, puis on carve les colis offerts
      // en tête (mêmes entrepôts) → ligne(s) « offert » à 100 % de remise = 0 €.
      // Résultat X_PLUS_Y / FREE : 2 lignes (payante + offerte à 0), comme demandé.
      const chunks = splitByWarehouse(totalQty, l.availByWarehouse);
      let remainingFree = freeUnits;
      const out: ApiLine[] = [];
      for (const c of chunks) {
        const freeHere = Math.min(remainingFree, c.qty);
        const paidHere = c.qty - freeHere;
        remainingFree -= freeHere;
        if (paidHere > 0) {
          out.push({
            itemCode: l.itemCode,
            quantity: paidHere * l.packDivisor,   // colis → pièces pour SAP
            displayQuantity: paidHere, displayUnit: l.unit,
            warehouseCode: c.warehouse,
            ...(price != null ? { price } : {}),
            ...(dPercent != null ? { discountPercent: dPercent } : {}),
          });
        }
        if (freeHere > 0) {
          out.push({
            itemCode: l.itemCode,
            quantity: freeHere * l.packDivisor,
            displayQuantity: freeHere, displayUnit: l.unit,
            warehouseCode: c.warehouse,
            // Colis offert : on garde le prix de référence + 100 % de remise → 0 €.
            ...(price != null ? { price } : {}),
            discountPercent: 100,
          });
        }
      }
      return out;
    });

  const submit = async () => {
    // ── Mode MODIFICATION : enregistre sur le BL existant (jamais de 2ᵉ bon) ──
    if (modif) {
      if (modifMeta?.editable === false) { toast.error("BL clôturé — modification impossible."); return; }
      // Lignes existantes : mise à jour par LineNum, UNIQUEMENT si réellement
      // modifiée (qté ou prix). Une ligne intouchée est omise → SAP la conserve
      // telle quelle (fusion par LineNum), sans réintroduire d'arrondi colis↔pièces.
      const updates: { lineNum: number; quantity: number; price?: number }[] = [];
      for (const l of cart) {
        const o = l.originalLine;
        if (!o) continue;
        const qtyChanged = Math.abs(l.quantity - o.qty) > 1e-6;
        const priceChanged = (l.price ?? null) !== (o.price ?? null);
        if (!qtyChanged && !priceChanged) continue;   // inchangée → laissée telle quelle
        // Qté changée → reconversion colis→pièces ; sinon on renvoie la pièce d'origine exacte.
        const pieces = qtyChanged ? Math.round(l.quantity * l.packDivisor * 1000) / 1000 : o.pieces;
        if (pieces <= 0) continue;   // une ligne existante ne tombe pas à 0 (garde-fou UI)
        updates.push({
          lineNum: o.lineNum,
          quantity: pieces,
          ...(l.price != null && l.price > 0 ? { price: l.price } : {}),
        });
      }
      // Nouvelles lignes : ajoutées au BL (lot/TPF/U_GER calculés côté serveur).
      const additions = buildApiLines(cart.filter((l) => !l.originalLine));
      if (updates.length === 0 && additions.length === 0) { toast.error("Rien à enregistrer."); return; }
      setSubmitting(true);
      try {
        const res = await fetch(`/api/sap/orders/${modif.docEntry}/modif`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates, additions }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          toast.error("❌ Modification refusée", { description: json?.error, duration: 10000 });
          return;
        }
        const fmt = (n: number | null | undefined) => n != null ? n.toFixed(2) : "—";
        const bits: string[] = [];
        if (json.updatedLines) bits.push(`${json.updatedLines} modifiée(s)`);
        if (json.addedLines) bits.push(`${json.addedLines} ajoutée(s)`);
        toast.success(
          `✅ BL #${json.docNum} enregistré${bits.length ? ` — ${bits.join(", ")}` : ""} · total ${fmt(json.totalTTC)} € TTC`,
          { duration: 10000 },
        );
        await loadModif(modif);   // recharge l'état SAP réel (les nouvelles lignes portent un LineNum)
      } catch (e) {
        toast.error(`❌ ${e instanceof Error ? e.message : "Erreur réseau"}`);
      } finally { setSubmitting(false); }
      return;
    }

    if (cart.length === 0) { toast.error("Panier vide"); return; }
    setSubmitting(true);
    try {
      const apiLines = buildApiLines();
      const res = await postOrder(apiLines, false);
      const json = await res.json();
      // Garde-fou encours : on ouvre une vraie modale (pas un window.confirm natif).
      if (!res.ok && json?.needsConfirm === "encours") {
        setEncoursPrompt({ lines: apiLines, message: json.error ?? "Encours dépassé.", encours: json.encours });
        return;
      }
      finalizeOrder(res, json);
    } catch (e) {
      toast.error(`❌ ${e instanceof Error ? e.message : "Erreur réseau"}`);
    } finally { setSubmitting(false); }
  };

  // Confirmation de l'encours via la modale → re-post forcé.
  const confirmEncours = async () => {
    if (!encoursPrompt) return;
    const lines = encoursPrompt.lines;
    setEncoursPrompt(null);
    setSubmitting(true);
    try {
      const res = await postOrder(lines, true);
      const json = await res.json();
      finalizeOrder(res, json);
    } catch (e) {
      toast.error(`❌ ${e instanceof Error ? e.message : "Erreur réseau"}`);
    } finally { setSubmitting(false); }
  };

  const q = filter.trim().toLowerCase();
  const ui = DENSITY_UI[density];

  // C1 — tête de liste : « ⭐ Favoris » (articles), puis les GROUPES favoris
  // épinglés en tête, puis les autres familles à leur place alphabétique.
  // Un groupe épinglé n'apparaît QU'UNE fois (en tête) — il est retiré de sa
  // place normale. Les articles favoris, eux, restent AUSSI dans leur famille.
  const groupEntries = useMemo<GroupEntry[]>(() => {
    const base = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
    // Les familles épinglées sortent de la liste normale (sinon doublon).
    const normal: GroupEntry[] = base
      .filter(([g]) => !favGroups.has(g))
      .map(([g, prods]) => ({ key: g, name: g, prods }));
    const head: GroupEntry[] = [];

    // 1. Articles favoris → pseudo-groupe « ⭐ Favoris »
    if (favorites.size > 0) {
      const seen = new Set<string>();
      const favs: Product[] = [];
      for (const [, prods] of base) {
        for (const p of prods) {
          if (favorites.has(p.itemCode) && !seen.has(p.itemCode)) { seen.add(p.itemCode); favs.push(p); }
        }
      }
      if (favs.length > 0) {
        favs.sort((a, b) => a.itemName.localeCompare(b.itemName));
        head.push({ key: FAV_GROUP, name: FAV_GROUP, prods: favs });
      }
    }

    // 2. Groupes famille favoris → copies épinglées (clé `pin:` distincte)
    for (const [g, prods] of base) {
      if (favGroups.has(g)) head.push({ key: `pin:${g}`, name: g, prods, pinned: true });
    }

    return head.concat(normal);
  }, [grouped, favorites, favGroups]);

  // C2 — nom d'article par code (Dialog Promotions : libellé lisible)
  const itemNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const prods of Object.values(grouped)) {
      for (const p of prods) if (!m.has(p.itemCode)) m.set(p.itemCode, p.itemName);
    }
    return m;
  }, [grouped]);

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      {/* ── C2 — Bandeau promotions (contenu/visibilité gérés par le composant) ── */}
      <PromoBanner context="commande" />

      <div className="flex gap-3 flex-1 min-h-0">
      {/* ── Colonne STOCK (cliquable) — grille alignée, dense ──
           Colonnes fixes pour que prix & stock s'alignent verticalement
           sur toutes les lignes (lisibilité maximale) :
             [+]  Nom — description           prix €/u    stock u
      */}
      <div className="flex-1 min-w-0 flex flex-col panel p-3">
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrer un produit…"
              className="w-full h-9 pl-9 pr-2 rounded-md border border-border bg-background text-[14px] focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>
          {/* Toggle "tout le catalogue" : par défaut seuls les articles en stock,
              actif → on charge aussi les articles à 0 (vente à découvert). */}
          <button
            type="button"
            aria-pressed={includeOutOfStock}
            onClick={() => setIncludeOutOfStock((v) => !v)}
            title={includeOutOfStock
              ? "Masquer les articles en rupture"
              : "Inclure les articles en rupture (vente à découvert)"}
            className={`inline-flex items-center h-9 px-3 rounded-md border text-[12.5px] font-semibold transition-colors ${
              includeOutOfStock
                ? "border-rose-400/60 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {includeOutOfStock ? "Rupture incluse ✓" : "+ Rupture"}
          </button>
          {/* C4 — densité : le réglage Compact/Normal/Aéré vit sur /parametres */}
          <button type="button" onClick={syncAndReload} disabled={loading || syncing}
            title="Actualiser le stock depuis SAP (en date du jour)"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[12.5px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60">
            {loading || syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {syncing ? "Sync…" : "Actualiser"}
          </button>
        </div>

        {/* Bandeau persistant : rappel que le mode rupture/découvert est actif */}
        {includeOutOfStock && (
          <div className="shrink-0 mb-1.5 flex items-center gap-1.5 rounded-md border border-rose-400/50 bg-rose-50/70 dark:bg-rose-950/20 px-2.5 py-1.5 text-[12px] font-medium text-rose-700 dark:text-rose-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Mode rupture actif — les articles à 0 sont vendables à découvert (lot affecté à réception).
          </div>
        )}

        {/* En-tête de colonnes — aligné aux mêmes largeurs que les lignes pour repère visuel */}
        <div
          className="shrink-0 grid items-center gap-3 px-2.5 pb-1.5 mb-1 text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70 border-b border-border/50"
          style={{ gridTemplateColumns: "28px 96px minmax(0,1fr) 118px 30px" }}
        >
          <span />
          <span>Dispo</span>
          <span>Produit</span>
          <span className="text-right">Prix conseillé</span>
          <span title="Favoris" className="text-center"><Star className="h-3 w-3 inline" /></span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
          {groupEntries.map(({ key: gKey, name: group, prods }) => {
            const visible = q ? prods.filter((p) => (p.itemName + p.itemCode).toLowerCase().includes(q)) : prods;
            if (visible.length === 0) return null;
            const isOpen = q ? true : (openGroups[gKey] ?? true);
            const isGroupFav = favGroups.has(group);
            const toggleOpen = () => setOpenGroups((o) => ({ ...o, [gKey]: !isOpen }));
            return (
              <div key={gKey} className="border border-border rounded-lg overflow-hidden">
                {/* En-tête = div role=button (et non <button>) : l'étoile groupe
                    favori est un vrai bouton imbriqué — interdit dans un <button>. */}
                <div
                  role="button" tabIndex={0}
                  onClick={toggleOpen}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOpen(); }
                  }}
                  className="w-full px-3 py-1.5 flex items-center justify-between bg-secondary/40 hover:bg-secondary/60 cursor-pointer select-none"
                >
                  <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-foreground">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    {/* C1 — étoile GROUPE favori, à côté du chevron (zone cliquable séparée) */}
                    {gKey !== FAV_GROUP && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleFavoriteGroup(group); }}
                        onKeyDown={(e) => e.stopPropagation()}
                        aria-pressed={isGroupFav}
                        title={isGroupFav ? "Retirer ce groupe des favoris" : "Épingler ce groupe en tête de liste"}
                        className={`h-6 w-6 inline-flex items-center justify-center rounded-md transition-colors ${
                          isGroupFav ? "text-amber-400 hover:text-amber-300"
                                     : "text-muted-foreground/40 hover:text-amber-400 hover:bg-secondary/60"
                        }`}
                      >
                        <Star className="h-3.5 w-3.5" fill={isGroupFav ? "currentColor" : "none"} />
                      </button>
                    )}
                    {group} <span className="text-[12px] font-normal text-muted-foreground">({visible.length})</span>
                  </span>
                </div>
                {isOpen && (
                  <ul className="divide-y divide-border/40">
                    {visible.map((p) => {
                      const { packDivisor, displayUnit: unit, priceUnit, isKg } = unitInfo(p.salesUnit, p.salesQtyPerPackUnit);
                      const total = ["R1", "01", "000"].reduce((s, w) => s + (p.stockByWarehouse[w]?.available ?? 0), 0) / packDivisor;
                      const perso = personalStock(total, stockSharePct);
                      const h = hints[p.itemCode];
                      const inCart = cart.some((l) => l.itemCode === p.itemCode);
                      const noStock = total <= 0;
                      const dispo = stockSharePct < 100 ? perso : total;
                      // Méta-chips visibles : marque · conditionnement · calibre · origine.
                      // Calibre = U_GER_CALIBRE (via Hint, chargé après) — distinct du condi.
                      const marque  = p.uMarque ?? h?.marque ?? null;
                      const condi   = p.uCondi ?? p.uUvc ?? null;          // ex. 8×500g
                      const calibre = h?.calibre ? `cal. ${h.calibre}` : null;
                      const variete = (p.frgnName ?? "").trim() || null;     // variété (FrgnName)
                      const pays    = p.uPays ?? h?.pays ?? null;
                      const isFav   = favorites.has(p.itemCode);          // C1
                      // C2 — plus de badge promo sur la liste stock : la remise
                      // auto au panier reste (cf. addToCart), le récap vit dans
                      // le Dialog « Promotions » et sur la ligne panier.
                      const kgC     = !isKg ? colisKg(p) : null;          // B4
                      // Chips dimensionnés par la densité (C4)
                      const chipCls = `inline-flex items-center px-2 rounded-[5px] font-semibold ${ui.chip}`;
                      // En modif, une ligne déjà sur le BL ne se retire pas via le stock.
                      const isExistingLine = !!modif && cart.some((l) => l.itemCode === p.itemCode && l.originalLine);
                      const toggleCart = () => {
                        if (inCart) { if (isExistingLine) return; removeFromCartByCode(p.itemCode); }
                        else addToCart(p);
                      };
                      return (
                        <li key={p.id}>
                          {/* Ligne = div role=button (et non <button>) : l'étoile favoris
                              est un vrai bouton imbriqué — interdit dans un <button>. */}
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={toggleCart}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCart(); }
                            }}
                            title={inCart ? "Retirer du panier"
                                          : noStock ? "À découvert — sera créé en EM_PENDING, lot affecté à réception"
                                          : "Ajouter au panier"}
                            className={`w-full grid items-center gap-3 px-2.5 ${ui.rowPad} text-left cursor-pointer select-none transition-colors ${
                              inCart ? "bg-emerald-50 dark:bg-emerald-950/30 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                : noStock ? "bg-rose-50/40 dark:bg-rose-950/15 hover:bg-rose-100/60 dark:hover:bg-rose-950/30"
                                : "hover:bg-secondary/40"}`}
                            style={{ gridTemplateColumns: "28px 96px minmax(0,1fr) 118px 30px" }}
                          >
                            {/* Col 1 — Add/Done */}
                            <span className={`h-7 w-7 inline-flex items-center justify-center rounded-md shrink-0 ${inCart ? "bg-emerald-500 text-white" : "bg-brand-500/10 text-brand-600 dark:text-brand-400"}`}>
                              {inCart ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                            </span>
                            {/* Col 2 — Dispo (quantité à gauche, bien lisible) */}
                            <span className="flex flex-col leading-none">
                              {noStock ? (
                                <>
                                  <span className={`${ui.dec} font-bold text-rose-600 dark:text-rose-400`}>À déc.</span>
                                  <span className="text-[10px] font-medium uppercase tracking-wide text-rose-500/80 mt-1">à récept.</span>
                                </>
                              ) : (
                                <>
                                  <span className={`${ui.dispo} font-bold tnum tracking-tight text-foreground`}>
                                    {packDivisor > 1 ? Math.floor(dispo) : dispo.toFixed(0)}
                                  </span>
                                  <span className={`${ui.dispoUnit} font-medium uppercase tracking-wide text-muted-foreground/70 mt-1`}>
                                    {unit}
                                  </span>
                                </>
                              )}
                            </span>
                            {/* Col 3 — Produit : nom + chips (promo · marque · condi · calibre · origine) + code + colis/kg */}
                            <span className="min-w-0">
                              <span className={`block ${ui.name} font-semibold text-foreground truncate leading-tight`}>
                                {p.itemName}
                              </span>
                              {(marque || condi || calibre || variete || pays) && (
                                <span className="mt-1.5 flex items-center gap-1 flex-wrap">
                                  {marque && <span className={`${chipCls} bg-violet-100 text-violet-800 dark:bg-violet-500/30 dark:text-violet-100 dark:ring-1 dark:ring-inset dark:ring-violet-400/50`}>{marque}</span>}
                                  {condi && <span className={`${chipCls} bg-sky-100 text-sky-800 dark:bg-sky-500/30 dark:text-sky-100 dark:ring-1 dark:ring-inset dark:ring-sky-400/50`}>{condi}</span>}
                                  {calibre && <span className={`${chipCls} bg-teal-100 text-teal-800 dark:bg-teal-500/30 dark:text-teal-100 dark:ring-1 dark:ring-inset dark:ring-teal-400/50`}>{calibre}</span>}
                                  {variete && <span className={`${chipCls} bg-rose-100 text-rose-800 dark:bg-rose-500/30 dark:text-rose-100 dark:ring-1 dark:ring-inset dark:ring-rose-400/50`}>{variete}</span>}
                                  {pays && <span className={`${chipCls} bg-amber-100 text-amber-800 dark:bg-amber-500/30 dark:text-amber-100 dark:ring-1 dark:ring-inset dark:ring-amber-400/50`}>{pays}</span>}
                                </span>
                              )}
                              <span className={`flex items-baseline gap-2 ${ui.code} leading-tight mt-1 min-w-0`}>
                                <span className="font-mono text-muted-foreground/60 truncate">{p.itemCode}</span>
                                {/* B4 — poids du colis quand calculable (≈ poids unité × pièces/colis) */}
                                {kgC != null && (
                                  <span className="text-muted-foreground/80 font-medium shrink-0">
                                    colis de {fmtKg(kgC)} kg
                                  </span>
                                )}
                              </span>
                            </span>
                            {/* Col 4 — Prix conseillé (aligné à droite) */}
                            <span className="text-right tnum">
                              {h?.prixConseille != null ? (
                                <>
                                  <span className={`block ${ui.price} font-bold leading-tight ${h.isDefault ? "text-foreground/70" : "text-brand-600 dark:text-brand-400"}`}>
                                    {h.prixConseille.toFixed(2)} €
                                  </span>
                                  <span className={`block ${ui.priceUnit} font-normal text-muted-foreground leading-tight`}>
                                    /{priceUnit}
                                  </span>
                                </>
                              ) : <span className="block text-[13px] text-muted-foreground/40">—</span>}
                            </span>
                            {/* Col 5 — C1 : étoile favoris (zone cliquable séparée, stopPropagation) */}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggleFavorite(p.itemCode); }}
                              onKeyDown={(e) => e.stopPropagation()}
                              aria-pressed={isFav}
                              title={isFav ? "Retirer des favoris" : "Ajouter aux favoris"}
                              className={`h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors ${
                                isFav ? "text-amber-400 hover:text-amber-300"
                                      : "text-muted-foreground/40 hover:text-amber-400 hover:bg-secondary/60"
                              }`}
                            >
                              <Star className="h-4 w-4" fill={isFav ? "currentColor" : "none"} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Colonne PANIER — dominante (Écran 2 = saisie commande au cœur) ── */}
      <div className="w-[560px] shrink-0 flex flex-col panel p-3">
        <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
          <p className="kicker inline-flex items-center gap-1.5">
            <ShoppingCart className="h-3 w-3" /> Commande
          </p>
          <div className="flex items-center gap-3">
            {/* C2 — récap des promos actives (l'affichage liste stock est supprimé) */}
            <button type="button" onClick={() => setPromosOpen(true)}
              title="Voir les promotions actives"
              className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-rose-600 dark:text-rose-400 hover:underline">
              <Megaphone className="h-3.5 w-3.5" />
              Promotions{promoList.length > 0 ? ` (${promoList.length})` : ""}
            </button>
            {!modif && (
              <button type="button" onClick={replayLast} disabled={replaying}
                className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-60">
                {replaying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Rejouer la dernière
              </button>
            )}
          </div>
        </div>
        {modif && <ModifBanner docNum={modif.docNum} meta={modifMeta} prefilling={prefilling} />}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
          {cart.length === 0 && (
            <p className="text-[14px] text-muted-foreground italic py-4 text-center inline-flex items-center justify-center gap-2 w-full">
              {prefilling
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Chargement du BL…</>
                : modif ? "BL vide — clique un produit à gauche pour l'ajouter."
                        : "Clique un produit à gauche pour l'ajouter."}
            </p>
          )}
          {cart.map((l, i) => {
            const max = totalAvailable(l.availByWarehouse);
            const over = l.quantity > max;
            const sellShort = max <= 0;             // entièrement à découvert
            const partialShort = over && !sellShort;
            return (
              <div key={i} className={`rounded-lg border p-2 ${sellShort ? "border-rose-400/60 bg-rose-50/40 dark:bg-rose-950/15" : "border-border"}`}>
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[14px] font-medium text-foreground truncate">{l.itemName}</p>
                      {sellShort && (
                        <span className="inline-flex h-5 items-center px-1.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                          À DÉCOUVERT
                        </span>
                      )}
                      {/* C2 — rappel promo sur la ligne panier : « −10 % » ou « 5+1 » */}
                      {l.promo && (
                        <span className="inline-flex h-5 items-center px-1.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-400/60 dark:bg-rose-500/30 dark:text-rose-100 dark:ring-rose-400/50">
                          {promoBadge(l.promo)}
                        </span>
                      )}
                      {/* Modification : ligne déjà présente sur le BL (vs nouvelle ligne) */}
                      {modif && l.originalLine && (
                        <span title="Ligne déjà sur le BL — quantité/prix modifiables"
                          className="inline-flex h-5 items-center px-1.5 rounded text-[11px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-500/25 dark:text-amber-200">
                          déjà au BL
                        </span>
                      )}
                      {modif && !l.originalLine && (
                        <span title="Nouvelle ligne — sera ajoutée au BL"
                          className="inline-flex h-5 items-center px-1.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-500/25 dark:text-emerald-200">
                          + ajout
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-mono text-muted-foreground/70">{l.itemCode}</p>
                    {/* Tags produit (mêmes couleurs que la liste stock) */}
                    {(() => {
                      const calibre = hints[l.itemCode]?.calibre ? `cal. ${hints[l.itemCode]!.calibre}` : null;
                      const chips = [
                        l.marque && ["bg-violet-100 text-violet-800 dark:bg-violet-500/30 dark:text-violet-100", l.marque],
                        l.condi && ["bg-sky-100 text-sky-800 dark:bg-sky-500/30 dark:text-sky-100", l.condi],
                        calibre && ["bg-teal-100 text-teal-800 dark:bg-teal-500/30 dark:text-teal-100", calibre],
                        l.variete && ["bg-rose-100 text-rose-800 dark:bg-rose-500/30 dark:text-rose-100", l.variete],
                        l.pays && ["bg-amber-100 text-amber-800 dark:bg-amber-500/30 dark:text-amber-100", l.pays],
                      ].filter(Boolean) as [string, string][];
                      if (chips.length === 0) return null;
                      return (
                        <span className="mt-1 flex items-center gap-1 flex-wrap">
                          {chips.map(([cls, txt], ci) => (
                            <span key={ci} className={`inline-flex items-center px-1.5 py-px rounded-[5px] text-[10.5px] font-semibold ${cls}`}>{txt}</span>
                          ))}
                        </span>
                      );
                    })()}
                  </div>
                  {/* En modification, une ligne déjà sur le BL ne se supprime pas
                      (SAP ne supprime pas une ligne par PATCH) — seules les
                      nouvelles lignes (et tout le panier hors modif) sont retirables. */}
                  {(!modif || !l.originalLine) && (
                    <button type="button" onClick={() => removeLine(i)} className="text-muted-foreground/50 hover:text-rose-500 shrink-0">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  {/* Stepper « un colis » : −/+ avancent du poids/nombre d'un colis */}
                  <div className="inline-flex items-center rounded-lg border border-border overflow-hidden shrink-0">
                    <button
                      type="button" tabIndex={-1}
                      onClick={() => updateLine(i, { quantity: Math.max(0, Math.round((l.quantity - l.stepColis) * 100) / 100) })}
                      aria-label="Retirer un colis"
                      className="h-11 w-9 inline-flex items-center justify-center text-[18px] font-bold text-muted-foreground hover:bg-secondary/60 active:scale-95"
                    >−</button>
                    <NumberInput value={l.quantity} onValueChange={(n) => updateLine(i, { quantity: n ?? 0 })}
                      min={0} step={l.stepColis}
                      aria-label={`Quantité ${l.itemName}`}
                      className={`h-11 w-16 text-center text-[17px] font-semibold tnum border-x border-border bg-background px-1 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 ${over ? "text-amber-600 dark:text-amber-400" : ""}`} />
                    <button
                      type="button" tabIndex={-1}
                      onClick={() => updateLine(i, { quantity: Math.round((l.quantity + l.stepColis) * 100) / 100 })}
                      aria-label="Ajouter un colis"
                      className="h-11 w-9 inline-flex items-center justify-center text-[18px] font-bold text-brand-600 dark:text-brand-400 hover:bg-secondary/60 active:scale-95"
                    >+</button>
                  </div>
                  <span className="text-[12px] text-muted-foreground w-9">{l.unit}</span>
                  <span className="text-muted-foreground">×</span>
                  <NumberInput value={l.price} onValueChange={(n) => updateLine(i, { price: n })}
                    min={0} step={0.1} decimals={2} allowEmpty placeholder="prix"
                    aria-label={`Prix ${l.itemName}`}
                    className="h-11 w-[84px] text-right text-[17px] font-semibold tnum rounded-lg border border-border bg-background px-2 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500" />
                  <span className="text-[12px] text-muted-foreground">€/{l.priceUnit}</span>
                  <span className="ml-auto text-[15px] font-bold tnum">{l.price ? lineHT(l).toFixed(2) : "—"}</span>
                </div>
                {l.packDivisor > 1 && l.price != null && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{l.quantity} colis × {l.packDivisor} {l.priceUnit} × {l.price}€</p>
                )}
                {/* C2 — colis offerts (X_PLUS_Y / FREE) : ligne séparée à 0 € sur le bon */}
                {(l.promo?.kind === "X_PLUS_Y" || l.promo?.kind === "FREE") && l.freeUnits > 0 && (
                  <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400 mt-1 inline-flex items-center gap-1">
                    <Gift className="h-3 w-3" />
                    {l.freeUnits} colis offert{l.freeUnits > 1 ? "s" : ""} — ligne à 0 € sur le bon
                  </p>
                )}
                {sellShort ? (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">
                    ⚠️ Stock = 0. Lot affecté à la prochaine entrée marchandise.
                  </p>
                ) : partialShort ? (
                  <p className="text-[11px] text-amber-600 mt-1">⚠️ {max} dispo seulement (le surplus sera à découvert)</p>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Pied : date, mode, n° cmd, total, créer */}
        <div className="shrink-0 pt-2 mt-2 border-t border-border space-y-2">
          {/* En modification, le BL existe déjà : mode/transporteur/date/réf sont figés. */}
          {!modif && (
            <>
              {modes.length > 0 && (
                <select value={modeId} onChange={(e) => setModeId(e.target.value)}
                  className="w-full h-9 rounded-md border border-border bg-background text-[13.5px] px-2">
                  {modes.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.sapCardCode})</option>)}
                </select>
              )}
              {carriers.length > 0 && (
                <select value={carrierId} onChange={(e) => setCarrierId(e.target.value)}
                  aria-label="Transporteur"
                  className="w-full h-9 rounded-md border border-border bg-background text-[13.5px] px-2">
                  <option value="">Transporteur — non précisé</option>
                  {/* B3 — count présent quand la liste est filtrée par client (habitudes) */}
                  {carriers.map((c) => (
                    <option key={c.id} value={c.id}>
                      🚚 {c.name}{c.count ? ` · ${c.count} cde${c.count > 1 ? "s" : ""}` : ""}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex gap-1.5">
                <input type="datetime-local" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)}
                  className="flex-1 h-9 rounded-md border border-border bg-background text-[13px] px-2" />
              </div>
              <input value={numAtCard} onChange={(e) => setNumAtCard(e.target.value)} placeholder="N° de commande (réf. client)"
                className="w-full h-9 rounded-md border border-border bg-background text-[13.5px] px-2" />
            </>
          )}
          <div className="flex items-center justify-between text-[14px]">
            <span className="text-muted-foreground">{modif ? "Total HT du BL" : "Total HT estimé"}</span>
            <span className="font-bold tnum text-foreground">{totalHT.toFixed(2)} €</span>
          </div>
          <button type="button" onClick={submit}
            disabled={submitting || prefilling || cart.length === 0 || (!!modif && modifMeta?.editable === false)}
            className={`w-full h-11 rounded-xl disabled:opacity-50 text-white text-[15px] font-semibold inline-flex items-center justify-center gap-2 ${
              modif ? "bg-amber-600 hover:bg-amber-700" : "bg-emerald-600 hover:bg-emerald-700"
            }`}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
            {modif ? `Enregistrer le BL #${modif.docNum}` : `Créer la commande (${cart.length})`}
          </button>
        </div>
      </div>
      </div>{/* /flex deux colonnes */}

      {/* ── C2 — Dialog « Promotions » : promos actives (libellé · article · type · période) ── */}
      <Dialog open={promosOpen} onOpenChange={setPromosOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-rose-500" /> Promotions actives
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[12.5px]">
            La remise est appliquée automatiquement au panier quand l&apos;article est ajouté.
          </DialogDescription>
          {promoList.length === 0 ? (
            <p className="text-[13.5px] text-muted-foreground italic py-3 text-center">
              Aucune promotion active en ce moment.
            </p>
          ) : (
            <ul className="max-h-[50vh] overflow-y-auto divide-y divide-border/50 -mx-1 px-1">
              {promoList.map((pr) => {
                const itemName = itemNameByCode.get(pr.itemCode) ?? pr.itemCode;
                return (
                  <li key={pr.id} className="py-2.5 flex items-start gap-2.5">
                    <span className="shrink-0 inline-flex h-6 items-center px-2 rounded-md text-[12px] font-bold bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-400/60 dark:bg-rose-500/30 dark:text-rose-100 dark:ring-rose-400/50">
                      {promoBadge(pr)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold text-foreground truncate">
                        {pr.label?.trim() || itemName}
                      </span>
                      <span className="block text-[12px] text-muted-foreground truncate">
                        {itemName} · <span className="font-mono text-[11px]">{pr.itemCode}</span>
                      </span>
                      <span className="block text-[11.5px] text-muted-foreground/80 mt-0.5">
                        {pr.kind === "PERCENT"
                          ? `Remise ${promoBadge(pr)} sur le prix conseillé`
                          : `${pr.buyQty} achetés + ${pr.freeQty} offert${pr.freeQty > 1 ? "s" : ""}`}
                        {" · "}{promoPeriod(pr)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex justify-between items-center pt-2 border-t border-border">
            <a href="/promos" className="text-[12.5px] font-semibold text-brand-600 dark:text-brand-400 hover:underline">
              Gérer les promotions →
            </a>
            <Button variant="ghost" onClick={() => setPromosOpen(false)}>Fermer</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Modale de confirmation encours (remplace window.confirm) ── */}
      <Dialog open={!!encoursPrompt} onOpenChange={(o) => { if (!o) setEncoursPrompt(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" /> Encours dépassé
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-[13px]">{encoursPrompt?.message}</DialogDescription>
          {encoursPrompt?.encours && (
            <div className="mt-1 grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-lg border border-border px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Solde</div>
                <div className="font-semibold tnum">{encoursPrompt.encours.balance.toFixed(2)} €</div>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Limite crédit</div>
                <div className="font-semibold tnum">{encoursPrompt.encours.creditLimit.toFixed(2)} €</div>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => {
              setEncoursPrompt(null);
              toast("Commande non envoyée", { description: "Encours non confirmé." });
            }}>
              Annuler
            </Button>
            <Button variant="warning" onClick={confirmEncours}>
              Forcer la commande
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Bandeau « Modification » — rappelle le BL en cours d'édition.
   Les lignes du BL sont pré-remplies dans le panier (éditables) :
   le bandeau ne fait que le rappel du contexte. Piloté par
   « Détail livraison » (URL → Écran 2).
═════════════════════════════════════════════════════════════ */
function ModifBanner({
  docNum, meta, prefilling,
}: {
  docNum: number;
  meta: { dueDate?: string; editable?: boolean } | null;
  prefilling: boolean;
}) {
  const dateLabel = meta?.dueDate
    ? new Date(meta.dueDate).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })
    : null;
  const closed = meta?.editable === false;

  return (
    <div className="mb-2 shrink-0 rounded-lg border border-amber-300/70 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-amber-500 text-white shrink-0">
          <Pencil className="h-3.5 w-3.5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-amber-800 dark:text-amber-200 leading-tight">
            Modification du BL #{docNum}
          </p>
          <p className="text-[10.5px] text-amber-700/80 dark:text-amber-300/80">
            Ajuste les quantités/prix des lignes existantes ou ajoute des articles — enregistré sur ce BL{dateLabel ? ` · livraison ${dateLabel}` : ""}.
          </p>
        </div>
        {prefilling && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600 dark:text-amber-300 shrink-0" />
        )}
      </div>
      {closed && (
        <p className="px-3 pb-2 text-[11px] font-medium text-rose-600 dark:text-rose-400">
          ⚠️ Commande clôturée — la modification sera refusée par SAP.
        </p>
      )}
    </div>
  );
}
