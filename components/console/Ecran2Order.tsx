"use client";

import { useEffect, useState, useCallback, useMemo, useRef, Fragment, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, ChevronDown, ChevronRight, ChevronUp, Search, Plus, Trash2,
  ShoppingCart, Check, AlertTriangle, Star, Gift, Megaphone, Pencil, Lock, X,
  History, BadgeEuro, ArrowRightLeft, CopyPlus, Boxes, ListPlus, Truck, ShieldAlert,
  Eye, EyeOff,
} from "lucide-react";
import {
  evaluateLineSafeguards, evaluateOrderSafeguards, normalizeSafeguardsConfig, splitViolations,
  type SafeguardsConfig, type SafeguardViolation,
} from "@/lib/safeguards";
import { splitByWarehouse, totalAvailable, personalStock, unitInfo } from "@/lib/gervifrais-calc";
import { formatDateInput } from "@/lib/utils";
import { nextDeliveryDate, nextWorkingDeliveryDay, isPrecommande } from "@/lib/livraison";
import { familyOf } from "@/lib/familles";
import { priceForArticle, type TarifFruitRow } from "@/lib/tarifFruits";
import { TarifFruitsEditor } from "@/components/clients/TarifFruitsEditor";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { NumberInput } from "@/components/ui/number-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { BrandLogo } from "@/components/BrandLogo";
import { StarRating } from "@/components/ui/star-rating";
import { LotDetailsDialog } from "./LotDetailsDialog";
import { ConsoleLotPicker, type ConsoleLotCandidate } from "./ConsoleLotPicker";
import { useContextMenu, ContextMenu, ContextMenuItem, ContextMenuLabel } from "@/components/ui/context-menu";
import { useBrandLogos } from "@/lib/useBrandLogos";
import { useTourneeSelection } from "@/lib/useTourneeSelection";
import { transportPerKgForCarrier, isDirectCarrier, normCarrier, type TransportCostModel, type ClientCarrierPricing } from "@/lib/transportCost";
import { computePositionCost, resolveCarrierTariff, type CarrierTariffMap } from "@/lib/carrierTariff";
import { celebrateSale } from "@/components/settings/app-settings";

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
  id: string; itemCode: string; kind: "PERCENT" | "X_PLUS_Y" | "FREE" | "PRICE";
  value: number; buyQty: number; freeQty: number; label: string | null;
  /** Type de magasin ciblé (EXPORT | GMS | CHR) — null = tous. */
  storeType?: string | null;
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
  // Poids d'UN colis en kg (pour le coût transport estimé) — null si inconnu.
  colisWeightKg?: number | null;
  // Lot choisi À LA MAIN dans la console pour un BON DE COMMANDE (avant SAP).
  // null/absent = « à affecter » (EM_PENDING) — choix reporté à l'onglet Bons de
  // commande. Ignoré pour un BL normal (auto-lot serveur).
  lot?: string | null;
  // C2 — promo appliquée à la ligne (remise SAP envoyée à la création du bon)
  promo: Promo | null; discountPercent: number; freeUnits: number;
  // freeUnits saisi À LA MAIN (sélecteur « offert ») → ne pas recalculer depuis la
  // promo quand la quantité change. true dès que l'utilisateur touche le sélecteur.
  freeManual?: boolean;
  // Mode MODIFICATION : ligne déjà présente sur le BL. null/absent = nouvelle
  // ligne. Le BL est ré-enregistré en remplacement complet → une ligne retirée
  // du panier est supprimée du BL, l'ordre du panier = l'ordre des lignes.
  // `qty`/`price` = valeurs d'origine (détection de changement) ; `pieces` = la
  // quantité SAP brute d'origine (renvoyée telle quelle si la qté n'a pas bougé,
  // pour ne pas réintroduire d'arrondi colis↔pièces) ; `lot` = lot préservé ;
  // `closed` = ligne déjà livrée (verrouillée : ni édition ni suppression).
  originalLine?: {
    lineNum: number; warehouse: string | null; qty: number; price: number | null;
    pieces: number; lot: string | null; closed: boolean;
  } | null;
}
/** Cotation SPÉCIFIQUE client par code article (onglet « Tarif ») — le prix
 *  négocié est PRIORITAIRE sur le prix conseillé à l'ajout au panier. */
interface TarifItem { itemCode: string; price: number; note?: string | null }

/* ── C2 — Helpers promo (purs) ─────────────────────────────── */

/** Recalcule les COLIS OFFERTS d'une ligne promo (X_PLUS_Y ou FREE). Dans les
 *  deux cas, les offerts s'AJOUTENT à la quantité saisie (ligne à 0 € sur le bon).
 *  X_PLUS_Y (« 5 achetés + 1 offert ») : pour chaque buyQty commandés → freeQty
 *    offerts en plus → freeUnits = freeQty × floor(qty / buyQty). (Ex. 5 → +1, 10 → +2.)
 *  FREE (« 1 colis offert ») : freeQty offerts dès qu'on commande l'article (sans seuil).
 *  No-op pour les autres lignes — appelé à chaque changement de quantité. */
function applyPromoFree(line: CartLine): CartLine {
  if (line.freeManual) return line;   // « offert » saisi à la main → on n'écrase pas
  const pr = line.promo;
  const qty = line.quantity;
  if (pr?.kind === "X_PLUS_Y" && pr.buyQty > 0 && pr.freeQty > 0) {
    // « buyQty achetés + freeQty offert » : offert(s) EN PLUS, par tranche de buyQty.
    const freeUnits = qty > 0 ? pr.freeQty * Math.floor(qty / pr.buyQty) : 0;
    return { ...line, freeUnits, discountPercent: 0 };
  }
  if (pr?.kind === "FREE" && pr.freeQty > 0) {
    return { ...line, freeUnits: qty > 0 ? pr.freeQty : 0, discountPercent: 0 };
  }
  return line;
}

/** Libellé court du badge promo : « −10 % », « 2,80 € », « 5+1 » ou « +1 offert ». */
function promoBadge(pr: Promo): string {
  if (pr.kind === "PERCENT") return `−${String(Math.round(pr.value * 100) / 100)} %`;
  if (pr.kind === "PRICE") return `${pr.value.toFixed(2).replace(".", ",")} €`;
  if (pr.kind === "FREE") return `+${pr.freeQty} offert${pr.freeQty > 1 ? "s" : ""}`;
  return `${pr.buyQty}+${pr.freeQty}`;
}

/* ── Envoi du BL en ARRIÈRE-PLAN ────────────────────────────────────────────
   La création/modification ne bloque plus l'écran : dès le clic, le client
   quitte la vue (le poste enchaîne sur le suivant) et la réponse SAP arrive
   en toast — PORTANT LE NOM DU CLIENT, puisque l'écran est passé à autre
   chose. Vit au niveau MODULE : la requête survit au démontage de l'écran.
   Garde-fou encours (création) : le 409 needsConfirm revient en toast avec
   l'action « Créer quand même » (re-post confirmEncours) — la commande n'est
   PAS créée tant que l'action n'est pas cliquée. */
type BackgroundOrder =
  | { kind: "create"; clientName: string; body: Record<string, unknown>; margeNette?: number }
  | { kind: "modif"; clientName: string; docEntry: number; docNum: number; body: Record<string, unknown> };

function notifyOrderResult(
  job: BackgroundOrder,
  ok: boolean,
  json: {
    ok?: boolean; blocked?: boolean; error?: string; docNum?: number;
    totalTTC?: number | null; totalLines?: number; bonPrep?: boolean; offre?: boolean;
    sofruce?: { docNum: number; lot: string } | null;
  } | null,
) {
  const fmt = (n: number | null | undefined) => (n != null ? n.toFixed(2) : "—");
  if (!ok || !json?.ok) {
    toast.error(
      job.kind === "modif"
        ? `Modification refusée — BL #${job.docNum}`
        : json?.blocked
          ? `Client bloqué — ${job.clientName}`
          : `Commande non créée — ${job.clientName}`,
      { description: json?.error, duration: 15000 },
    );
    return;
  }
  if (job.kind === "modif") {
    toast.success(`BL #${json.docNum ?? job.docNum} enregistré`, {
      description: `${job.clientName} — ${json.totalLines ?? "?"} ligne(s) · ${fmt(json.totalTTC)} € TTC`,
      duration: 10000,
    });
  } else if (json.bonPrep) {
    toast.success(`Bon de préparation créé — ${job.clientName}`, {
      description: "Affecte les lots dans « Détail livraison » puis crée le BL.",
      duration: 10000,
    });
  } else if (json.offre) {
    // Précommande → OFFRE CLIENT (devis SAP), à passer en commande au jour de départ.
    toast.success(`Offre client #${json.docNum} créée — ${job.clientName}`, {
      description: `${fmt(json.totalTTC)} € TTC · à passer en commande au jour de départ.`,
      duration: 10000,
    });
  } else {
    toast.success(`Commande #${json.docNum} créée — ${job.clientName}`, {
      // Vente Sofruce : l'achat (EM) créé juste avant la vente est rappelé ici —
      // la preuve visible que la double saisie manuelle n'est plus nécessaire.
      description: `${fmt(json.totalTTC)} € TTC${json.sofruce ? ` · Achat Sofruce EM ${json.sofruce.docNum} créé` : ""}`,
      duration: 10000,
    });
    // Célébration « grosse marge » — no-op si désactivée ou marge < seuil.
    if (job.kind === "create" && typeof job.margeNette === "number") {
      celebrateSale(job.margeNette);
    }
  }
}

function sendOrderInBackground(job: BackgroundOrder) {
  const url = job.kind === "modif" ? `/api/sap/orders/${job.docEntry}/modif` : "/api/sap/orders";
  const post = (extra: { confirmEncours?: boolean; confirmSafeguards?: boolean }) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...job.body, ...extra }),
    });
  const offline = () =>
    toast.error(
      job.kind === "modif"
        ? `BL #${job.docNum} non enregistré — ${job.clientName}`
        : `Commande non créée — ${job.clientName}`,
      { description: "SAP injoignable — réessaie.", duration: 15000 },
    );
  // Boucle de confirmation : le serveur peut demander DEUX confirmations
  // successives (encours PUIS garde-fous) — chaque « Créer quand même »
  // re-poste avec le flag correspondant en PLUS des précédents.
  const attempt = (extra: { confirmEncours?: boolean; confirmSafeguards?: boolean }) => {
    post(extra)
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (job.kind === "create" && !res.ok && json?.needsConfirm === "encours") {
          // Confirmation en ligne : titre court, chiffres seuls — les boutons disent le reste.
          const enc = json?.encours as { balance?: number; creditLimit?: number } | undefined;
          const eur = (n: number) => `${n.toFixed(2)} €`;
          toast.warning(`Encours dépassé — ${job.clientName}`, {
            description:
              enc?.balance != null && enc?.creditLimit != null
                ? `Solde ${eur(enc.balance)} · limite ${eur(enc.creditLimit)}.`
                : (json?.error ?? "Limite de crédit atteinte."),
            duration: 30000,
            action: { label: "Créer quand même", onClick: () => attempt({ ...extra, confirmEncours: true }) },
            cancel: { label: "Abandonner", onClick: () => toast.info(`Commande abandonnée — ${job.clientName}`) },
          });
          return;
        }
        // Garde-fous serveur (Paramètres) en mode « Avertir » : confirmables.
        // (Les BLOQUANTS arrivent en erreur ferme via notifyOrderResult.)
        if (job.kind === "create" && !res.ok && json?.needsConfirm === "safeguards") {
          toast.warning(`Garde-fous — ${job.clientName}`, {
            description: json?.error ?? "Garde-fous déclenchés — la commande n'est pas créée.",
            duration: 30000,
            action: { label: "Créer quand même", onClick: () => attempt({ ...extra, confirmSafeguards: true }) },
            cancel: { label: "Abandonner", onClick: () => toast.info(`Commande abandonnée — ${job.clientName}`) },
          });
          return;
        }
        notifyOrderResult(job, res.ok, json);
      })
      .catch(offline);
  };
  attempt({});
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

/** Valeur de tag « propre » : ignore les placeholders vides ou « - » (tiret(s)
 *  seul(s)) → on ne fait PAS apparaître le tag dans ce cas. */
function cleanTag(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (!t || /^-+$/.test(t)) return null;
  return t;
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
const SHORTCUTS_KEY = "televente:cmd-raccourcis";

/**
 * Raccourcis produits personnalisables (remplacent l'ancien compteur « Promotions »).
 * Liste de codes mémorisée en localStorage (par poste) ; un clic ajoute le produit
 * au panier via onPick. Ajout/retrait inline.
 */
function OrderShortcuts({ onPick }: { onPick: (code: string) => void }) {
  const [shortcuts, setShortcuts] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  // Nombre maximum de raccourcis affichés/mémorisés.
  const MAX_SHORTCUTS = 4;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SHORTCUTS_KEY);
      if (raw) {
        const a = JSON.parse(raw);
        if (Array.isArray(a)) setShortcuts(a.filter((x) => typeof x === "string").slice(0, MAX_SHORTCUTS));
      }
    } catch { /* ignore */ }
  }, []);

  const persist = (next: string[]) => {
    setShortcuts(next);
    try { localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const add = (v: string) => {
    const t = v.trim().toUpperCase();
    if (!t || shortcuts.includes(t) || shortcuts.length >= MAX_SHORTCUTS) return;
    persist([...shortcuts, t]);
  };

  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      {shortcuts.map((s) => (
        <span key={s} className="group inline-flex items-center overflow-hidden rounded-md border border-border bg-secondary/50 text-[11.5px] font-semibold">
          <button type="button" onClick={() => onPick(s)} title={`Ajouter ${s} au panier`}
            className="px-1.5 py-0.5 text-foreground/90 hover:bg-secondary">{s}</button>
          <button type="button" onClick={() => persist(shortcuts.filter((x) => x !== s))}
            title="Retirer le raccourci" aria-label={`Retirer le raccourci ${s}`}
            className="px-1 py-0.5 text-muted-foreground/60 hover:bg-secondary hover:text-rose-500">×</button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { add(draft); setDraft(""); setAdding(false); }
            else if (e.key === "Escape") { setDraft(""); setAdding(false); }
          }}
          onBlur={() => { add(draft); setDraft(""); setAdding(false); }}
          placeholder="code…"
          aria-label="Nouveau raccourci"
          className="h-6 w-[76px] rounded-md border border-border bg-background px-1.5 text-[11.5px] uppercase focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      ) : shortcuts.length < MAX_SHORTCUTS ? (
        <button type="button" onClick={() => setAdding(true)} title="Ajouter un raccourci produit (4 max)"
          className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-border px-1.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground hover:border-brand-400/60 hover:text-foreground">
          <Plus className="h-3 w-3" /> Raccourci
        </button>
      ) : null}
    </div>
  );
}

/**
 * Interstice de dépôt entre deux lignes du BL (glisser-déposer) — rectangle en
 * pointillé qui apparaît pendant un glisser et « s'allume » au survol. Déposer
 * ICI = INSÉRER la ligne à cette position (déposer SUR une ligne = échange).
 */
function CartDropGap({
  show, highlighted, onOver, onDrop,
}: {
  show: boolean;
  highlighted: boolean;
  onOver: () => void;
  onDrop: () => void;
}) {
  if (!show) return null;
  return (
    <div
      aria-hidden
      onDragOver={(e) => { e.preventDefault(); onOver(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      className={`rounded-lg border border-dashed transition-all duration-150 ${
        highlighted ? "h-11 border-brand-500 bg-brand-500/10" : "h-1.5 border-border"
      }`}
    />
  );
}

export function Ecran2Order({ clientId, clientName, clientType = null, stockSharePct = 100, deliveryModeId = "", deliveryModes = [], onDeliveryModeChange, clientHeader = null, modifier: modifierProp = null, onExitModif, onSubmitted }: {
  clientId: string; clientName: string;
  /** Type du magasin actif (EXPORT | GMS | CHR) — filtre les promos ciblées. */
  clientType?: string | null;
  stockSharePct?: number;
  /** Mode de livraison / compte SAP du bon — choisi DANS le sélecteur
   *  transporteur du pied (une seule sélection) ; défaut = mode par défaut. */
  deliveryModeId?: string;
  /** Comptes de livraison du client (LPOI, SCACHAP…) — proposés dans le MÊME
   *  sélecteur que les transporteurs (« livré sur le compte X »). */
  deliveryModes?: { id: string; name: string; sapCardCode: string; isDefault: boolean }[];
  onDeliveryModeChange?: (id: string) => void;
  /** Bandeau client (nom + méta + recherche) REGROUPÉ avec le stock : posé en
   *  tête de la colonne stock pour ne former qu'un seul bloc à gauche. */
  clientHeader?: ReactNode;
  /** Cible de MODIFICATION (diffusée par « Détail livraison ») : on pré-remplit le
   *  panier avec les lignes du BL et on enregistre sur ce BL. */
  modifier?: { docEntry: number; docNum: number } | null;
  /** Quitter la modification → l'écran 2 reprend la synchro normale. */
  onExitModif?: () => void;
  /** BL envoyé (création OU modification, en arrière-plan) : le parent retire
   *  le client de la vue — le poste enchaîne pendant que SAP travaille. */
  onSubmitted?: () => void;
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
  // Note QUALITÉ (1..5 étoiles) par article, saisie à la réception — affichée en étoiles.
  const [notes, setNotes] = useState<Record<string, number>>({});
  // Logos de marques (réglés sur /parametres/marques) → affichés dans la liste
  // stock, entre le stock et la désignation. Hook partagé : 1 seul fetch pour
  // toute l'app + respect du réglage « Afficher les logos » (paramètres).
  const brandLogos = useBrandLogos("console");
  // C4 — densité d'affichage de la liste stock (réglée sur /parametres, lue ici)
  const [density, setDensity] = useState<Density>("normal");
  // Coût transport (modèle + prix position €/kg) — pour le coût transport estimé
  // de la commande en temps réel. On se base sur le TRANSPORTEUR sélectionné.
  const [transportModel, setTransportModel] = useState<TransportCostModel | null>(null);
  const [transportPerKg, setTransportPerKg] = useState(0);
  // Unité de l'indicateur de marge : par LIVRAISON (€ total de la commande) ou par KILO.
  const [marginUnit, setMarginUnit] = useState<"position" | "kg">("position");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/transport/model", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        if (j.model) setTransportModel(j.model as TransportCostModel);
        if (typeof j?.metrics?.prixPositionPerKg === "number") setTransportPerKg(j.metrics.prixPositionPerKg);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // ── GARDE-FOUS (Paramètres → « Garde-fous de vente », config GLOBALE serveur) ──
  // Config + habitudes du client (volumes moyens par article, panier moyen) :
  // les MÊMES évaluateurs que le filet serveur, ici pour alerter EN DIRECT.
  const [sgConfig, setSgConfig] = useState<SafeguardsConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/safeguards", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.config) setSgConfig(normalizeSafeguardsConfig(j.config)); })
      .catch(() => { /* pas de config → pas d'alerte console (le serveur reste le filet) */ });
    return () => { cancelled = true; };
  }, []);
  interface OrderStats {
    panierMoyen: { moyenneHT: number; nbCommandes: number } | null;
    parArticle: Record<string, { moyenne: number; nbCommandes: number }>;
  }
  const [orderStats, setOrderStats] = useState<OrderStats | null>(null);
  useEffect(() => {
    if (!clientId) { setOrderStats(null); return; }
    let cancelled = false;
    setOrderStats(null);
    fetch(`/api/sap/clients/${clientId}/order-stats`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.ok) setOrderStats({ panierMoyen: j.panierMoyen ?? null, parArticle: j.parArticle ?? {} }); })
      .catch(() => { /* habitudes indisponibles → règles « habitude » désarmées */ });
    return () => { cancelled = true; };
  }, [clientId]);
  // Tarifs transport : grilles PAR POSITION des transporteurs externes
  // (tranches de poids × département — lib/carrierTariff) + repli legacy €/kg
  // du client, + département de livraison (CP SAP).
  const [clientPricing, setClientPricing] = useState<ClientCarrierPricing>({});
  const [carrierTariffs, setCarrierTariffs] = useState<CarrierTariffMap>({});
  const [clientDept, setClientDept] = useState<string | null>(null);
  useEffect(() => {
    if (!clientId) { setClientPricing({}); setCarrierTariffs({}); setClientDept(null); return; }
    let cancelled = false;
    fetch(`/api/clients/${clientId}/transport-pricing`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        if (j.pricing) setClientPricing(j.pricing as ClientCarrierPricing);
        if (j.tariffs) setCarrierTariffs(j.tariffs as CarrierTariffMap);
        setClientDept(typeof j.departement === "string" ? j.departement : null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientId]);
  // Panier
  const [cart, setCart] = useState<CartLine[]>([]);
  // Vue PLEIN ÉCRAN de la colonne « Commande » (double-clic sur son en-tête) —
  // pour relire/valider la commande en grand. Échap ou re-double-clic pour sortir.
  const [orderFullscreen, setOrderFullscreen] = useState(false);
  useEffect(() => {
    if (!orderFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOrderFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [orderFullscreen]);
  const [deliveryDate, setDeliveryDate] = useState("");
  // « Bon de commande » : commande créée SANS auto-lot (lots affectés ensuite dans
  // l'onglet dédié). Coché à la main, ou FORCÉ quand la livraison est une précommande.
  const [bonCommandeManual, setBonCommandeManual] = useState(false);
  // « VENTE SOFRUCE » (marché) : la validation crée d'abord l'ENTRÉE MARCHANDISE
  // fournisseur Sofruce (mêmes articles/quantités), puis la vente sur son lot EM.
  // Une seule saisie au lieu de deux — supprime les doublons d'EM manuels.
  const [venteSofruce, setVenteSofruce] = useState(false);
  // Prix d'ACHAT unitaire par article (saisie libre, unité de stock = celle du
  // prix de vente). Vide → l'achat part au prix de vente (marge 0).
  const [sofrucePA, setSofrucePA] = useState<Record<string, string>>({});
  // Marge MASQUÉE (regard par-dessus l'épaule au marché / poste partagé) :
  // les montants de marge s'affichent en « ••• ». Persisté par poste.
  const [hideMargin, setHideMargin] = useState(false);
  useEffect(() => {
    try { setHideMargin(localStorage.getItem("tv:hide-margin") === "1"); } catch { /* stockage indisponible */ }
  }, []);
  const toggleHideMargin = () => setHideMargin((v) => {
    const next = !v;
    try { localStorage.setItem("tv:hide-margin", next ? "1" : "0"); } catch { /* best-effort */ }
    return next;
  });
  const precommande = isPrecommande(deliveryDate);
  // À DÉCOUVERT : au moins un article du panier dépasse le stock détenu. On force
  // alors le BON DE COMMANDE (offre/devis SAP) — il NE RÉSERVE PAS de stock, donc
  // ne creuse pas le magasin d'attente 000 ; il se validera en commande ferme
  // quand la marchandise arrivera (validation auto à la réception). Évite le
  // décalage magasin 000/01 à la source.
  const hasDecouvert = useMemo(
    () => cart.some((l) => (l.quantity + Math.max(0, Math.floor(l.freeUnits ?? 0))) > totalAvailable(l.availByWarehouse ?? {})),
    [cart],
  );
  // Vente Sofruce : le découvert ne force PAS le bon de commande — l'achat créé
  // au même moment couvre la quantité (le stock naît avec la vente).
  const isBonCommande = precommande || bonCommandeManual || (hasDecouvert && !venteSofruce);
  // Vente Sofruce = BL direct uniquement : décochée d'office si le bon passe en
  // commande/précommande ou en modification (le serveur refuse ces combinaisons).
  useEffect(() => {
    if (venteSofruce && (precommande || bonCommandeManual || modifierProp)) setVenteSofruce(false);
  }, [venteSofruce, precommande, bonCommandeManual, modifierProp]);
  // Lots candidats (EN STOCK TeleVent) par article — chargés pour choisir le lot
  // d'une ligne AVANT l'envoi, UNIQUEMENT sur un bon de commande.
  const [lotCands, setLotCands] = useState<Record<string, { candidates: ConsoleLotCandidate[]; suggested: string | null }>>({});
  const cartItemCodesKey = cart.map((l) => l.itemCode).join(",");
  useEffect(() => {
    if (!isBonCommande) { setLotCands({}); return; }
    const codes = [...new Set(cart.map((l) => l.itemCode).filter(Boolean))];
    if (codes.length === 0) { setLotCands({}); return; }
    let cancelled = false;
    fetch(`/api/lots/candidates?items=${encodeURIComponent(codes.join(","))}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.items) return;
        const out: Record<string, { candidates: ConsoleLotCandidate[]; suggested: string | null }> = {};
        for (const [code, v] of Object.entries(j.items as Record<string, { candidates: ConsoleLotCandidate[]; suggested: string | null }>)) {
          out[code] = { candidates: v.candidates ?? [], suggested: v.suggested ?? null };
        }
        setLotCands(out);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isBonCommande, cartItemCodesKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  // ── Onglet colonne gauche : Stock (catalogue) / Tarif (cotations client) ──
  const [stockTab, setStockTab] = useState<"stock" | "tarif">("stock");
  // Cotations SPÉCIFIQUES du client (par code article) — chargées par client,
  // sauvegarde AUTO débouncée. Prix prioritaire sur le conseillé au panier.
  const [tarifs, setTarifs] = useState<TarifItem[] | null>(null);
  const tarifsDirty = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setTarifs(null);
    tarifsDirty.current = false;
    fetch(`/api/clients/${clientId}/tarif`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setTarifs(j?.ok ? (j.items ?? []) : []); })
      .catch(() => { if (!cancelled) setTarifs([]); });
    return () => { cancelled = true; };
  }, [clientId]);
  useEffect(() => {
    if (!tarifsDirty.current || tarifs === null) return;
    const t = setTimeout(() => {
      tarifsDirty.current = false;
      fetch(`/api/clients/${clientId}/tarif`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: tarifs }),
      })
        .then(async (r) => {
          const j = await r.json().catch(() => null);
          if (!r.ok || !j?.ok) toast.error(j?.error || "Échec de l'enregistrement du tarif");
        })
        .catch(() => toast.error("Échec de l'enregistrement du tarif"));
    }, 700);
    return () => clearTimeout(t);
  }, [tarifs, clientId]);
  const mutateTarifs = useCallback((fn: (cur: TarifItem[]) => TarifItem[]) => {
    tarifsDirty.current = true;
    setTarifs((prev) => fn(prev ?? []));
  }, []);
  const tarifByCode = useMemo(
    () => new Map((tarifs ?? []).map((t) => [t.itemCode, t.price])),
    [tarifs],
  );
  // Tarif PAR FRUITS du client (famille · origine · calibre · variété) — lecture
  // seule ici (édité dans l'éditeur dédié / la fiche), appliqué au panier.
  const [tarifFruits, setTarifFruits] = useState<TarifFruitRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    setTarifFruits([]);
    fetch(`/api/clients/${clientId}/tarif-fruits`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j?.ok) setTarifFruits(j.rows ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientId]);
  const [numAtCard, setNumAtCard] = useState("");
  // Mode de livraison / compte SAP : géré par le parent (sélecteur dans le
  // bandeau client, à côté du nom) et reçu via `deliveryModeId`.
  // C11/B3 — transporteur + TOURNÉE (ORDR.U_TrspCode / U_TrspHeur), OBLIGATOIRES
  // sur le bon. Pré-remplis automatiquement avec le défaut du client (SERG_TRCL
  // → mémoire app → tournée unique) — l'utilisateur ne change que par exception.
  const {
    carriers, carrierSap, setCarrierSap,
    tournees, tourneeId, setTourneeId,
    validateTournee, tourneePayload,
  } = useTourneeSelection(clientId);
  // #12 — quantités déjà confirmées (par itemCode) : évite de re-demander une
  // confirmation à CHAQUE frappe une fois que l'utilisateur a validé le gros volume.
  const confirmedBigQty = useMemo(() => new Set<string>(), []);
  // Mode MODIFICATION (piloté par « Détail livraison » via l'URL) : on charge le
  // BL existant, on PRÉ-REMPLIT le panier avec ses lignes (éditables), et la
  // validation enregistre sur CE BL (jamais de 2ᵉ bon).
  const [modif, setModif] = useState(modifierProp);
  const [modifMeta, setModifMeta] = useState<{ dueDate?: string; editable?: boolean } | null>(null);
  const [prefilling, setPrefilling] = useState(false);
  // Note BL éditable (texte promo/divers) → commentaires du bon. Pré-remplie au chargement.
  const [comments, setComments] = useState("");

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
      setComments(j.noteText ?? "");
      setNumAtCard(j.numAtCard ?? "");
      type PrefillLine = {
        lineNum: number; warehouse: string | null; lot: string | null; closed: boolean;
        itemCode: string; itemName: string;
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
        originalLine: {
          lineNum: l.lineNum, warehouse: l.warehouse, qty: l.quantity, price: l.price,
          pieces: l.qtyPieces, lot: l.lot, closed: l.closed,
        },
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
    setCart([]); setNumAtCard(""); setComments(""); setBonCommandeManual(false);
    setVenteSofruce(false); setSofrucePA({});
  }, [clientId]);

  // ── Date de livraison PAR DÉFAUT — selon le type du client ──
  // GMS / CHR / EXPORT (tournées) : prochaine livraison possible = J+1 (samedi →
  // lundi), en sautant dimanches et fériés. TOUT AUTRE client (marché, comptoir,
  // perso…) : la marchandise part À LA VENTE → livraison le jour même (J), pas
  // J+1. Effet séparé du reset panier : `clientType` arrive parfois APRÈS le
  // montage (fetch de la fiche) — on ne veut réajuster QUE la date, jamais vider
  // un panier en cours de saisie. Jamais en modification (la date vit sur le BL).
  useEffect(() => {
    if (modifierProp) return;
    const seg = (clientType ?? "").trim().toUpperCase();
    const tournee = seg === "GMS" || seg === "CHR" || seg === "EXPORT";
    const day = tournee
      ? nextWorkingDeliveryDay(nextDeliveryDate())
      : new Date().toLocaleDateString("en-CA"); // J — date murale locale YYYY-MM-DD
    setDeliveryDate(formatDateInput(new Date(`${day}T09:00:00`)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, clientType]);

  // (B3 — transporteurs filtrés par client + tournée : déplacé dans
  //  useTourneeSelection, partagé avec BLDialog. Défaut client pré-sélectionné.)

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

  // ── C2 — Promos actives (Dialog récap + remise/tarif auto au panier) ──
  // On ne garde que les promos qui CIBLENT ce magasin : storeType null (toutes)
  // OU storeType == type du client actif. Ainsi un « tarif imposé GMS » ne
  // s'applique qu'aux magasins GMS.
  useEffect(() => {
    const ct = (clientType || "").trim().toUpperCase();
    fetch(`/api/promos?active=1`).then((r) => r.json())
      .then((d) => {
        const list = (d?.promos ?? []) as Promo[];
        const map: Record<string, Promo> = {};
        for (const pr of list) {
          if (!pr?.itemCode) continue;
          const st = (pr.storeType || "").trim().toUpperCase();
          if (st && st !== ct) continue;       // promo ciblée sur un autre type
          if (!map[pr.itemCode]) map[pr.itemCode] = pr;
        }
        setPromos(map);
      })
      .catch(() => { /* promos optionnelles */ });
  }, [clientType]);

  // ── Notes qualité (étoiles) par article — saisies à la réception ──
  useEffect(() => {
    fetch(`/api/marchandise-notes`).then((r) => r.json())
      .then((d) => setNotes(d?.notes ?? {}))
      .catch(() => { /* notes optionnelles */ });
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
  /** Construit une ligne panier depuis un produit du catalogue. `opts` permet de
   *  forcer quantité/prix (dupliquer la dernière commande, ajout depuis le tarif)
   *  — dans ce cas la promo n'est PAS appliquée (le prix vient de l'historique
   *  ou de la cotation, on ne le remise pas une 2ᵉ fois). */
  const buildLine = (p: Product, opts?: { quantity?: number; price?: number | null; noPromo?: boolean }): CartLine => {
    const { packDivisor, displayUnit, priceUnit } = unitInfo(p.salesUnit, p.salesQtyPerPackUnit);
    const avail: Record<string, number> = {};
    for (const w of ["000", "01", "R1"]) avail[w] = Math.max(0, Math.floor(((p.stockByWarehouse[w]?.available ?? 0) / packDivisor) * 10) / 10);
    // Incrément « un colis » : si l'article est vendu au kg, on avance du POIDS
    // d'un colis (ex. 4 kg → 4, 8, 12…) ; sinon d'un colis entier (1).
    // colisWeightKg n'est calculé par unitInfo qu'avec salesItemsPerUnit ; à
    // défaut (absent du /api/products) on le reconstruit : qty/colis × poids unité
    // (ex. FB4CA3B = 4 × 1 = 4 kg).
    let colisW = unitInfo(p.salesUnit, p.salesQtyPerPackUnit, p.salesItemsPerUnit ?? null, p.salesUnitWeight).colisWeightKg ?? null;
    // Repli quand /api/products ne renvoie pas salesItemsPerUnit : poids d'un colis
    // = (unités par colis) × (poids d'une unité, kg). Vaut AUSSI pour les articles
    // À LA PIÈCE (framboise, barquettes…) — sans ce repli leur poids restait 0 et
    // la marge /kg (Σ marge ÷ Σ kg) était surévaluée (dénominateur amputé).
    if (colisW == null || colisW <= 0) {
      const q = p.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1 ? p.salesQtyPerPackUnit : 1;
      // Au POIDS : l'unité de base pèse 1 kg (SAP UnitWgt=1). À la PIÈCE : il faut
      // le poids relevé d'une pièce — sinon on NE DEVINE PAS (poids inconnu → null,
      // la ligne sortira du ratio /kg au lieu de le fausser).
      const w = displayUnit === "kg"
        ? (p.salesUnitWeight && p.salesUnitWeight > 0 ? p.salesUnitWeight : 1)
        : (p.salesUnitWeight && p.salesUnitWeight > 0 ? p.salesUnitWeight : null);
      if (w != null) colisW = Math.round(q * w * 1000) / 1000;
    }
    const stepColis = displayUnit === "kg" ? (colisW && colisW > 0 ? Math.round(colisW * 100) / 100 : 1) : 1;
    // C2 — promo PERCENT : prix prérempli déjà remisé (prix conseillé × (1 − %)),
    // la remise est mémorisée pour être poussée sur la ligne SAP du bon.
    // Prix de départ : cotation SPÉCIFIQUE client (onglet Tarif) prioritaire,
    // sinon prix conseillé.
    const promo = opts?.noPromo ? null : (promos[p.itemCode] ?? null);
    // Prix : cotation SKU exacte > TARIF PAR FRUITS (désignation : famille ·
    // calibre · variété · origine) > prix conseillé. Le calibre vient des hints
    // (U_GER_CALIBRE, live SAP).
    const fruitPrice = tarifFruits.length
      ? priceForArticle(tarifFruits, {
          family: familyOf(p.itemName, p.groupName ?? null).key,
          pays: p.uPays ?? null,
          calibre: hints[p.itemCode]?.calibre ?? null,
          variete: p.frgnName ?? null,
        })
      : null;
    let price = opts?.price !== undefined
      ? opts.price
      : (tarifByCode.get(p.itemCode) ?? fruitPrice ?? hints[p.itemCode]?.prixConseille ?? null);
    let discountPercent = 0;
    if (promo?.kind === "PRICE" && promo.value > 0) {
      // Tarif imposé : le prix unitaire fixe REMPLACE le prix conseillé/négocié.
      price = promo.value;
    } else if (promo?.kind === "PERCENT" && promo.value > 0 && promo.value < 100) {
      discountPercent = promo.value;
      if (price != null) price = Math.round(price * (1 - promo.value / 100) * 100) / 100;
    }
    return applyPromoFree({
      itemCode: p.itemCode, itemName: p.itemName, unit: displayUnit, priceUnit, packDivisor,
      availByWarehouse: avail, quantity: opts?.quantity ?? stepColis, price,
      marque: p.uMarque ?? null, condi: p.uCondi ?? p.uUvc ?? null, pays: p.uPays ?? null,
      variete: p.frgnName ?? null,
      stepColis, colisWeightKg: colisW ?? null,
      promo, discountPercent, freeUnits: 0, freeManual: false,
      originalLine: null,   // ajoutée via le stock → nouvelle ligne du BL
    });
  };

  const addToCart = (p: Product, opts?: { quantity?: number; price?: number | null; noPromo?: boolean }) => {
    setCart((cur) => {
      if (cur.some((l) => l.itemCode === p.itemCode)) return cur;  // déjà au panier
      return [...cur, buildLine(p, opts)];
    });
  };

  // ── Dupliquer la DERNIÈRE commande du client (pré-remplit le panier) ──
  // Quantités et prix repris tels quels (sans ré-appliquer les promos) ; les
  // articles introuvables au catalogue chargé sont signalés.
  const [replaying, setReplaying] = useState(false);
  // Clic droit sur une ligne produit → menu (Détails lots · Tout mettre).
  const [lotDetail, setLotDetail] = useState<{ id: string; code: string; name: string; dispo: number; unit: string; packDivisor: number } | null>(null);
  const { menu: rowMenu, openAt: openRowMenu, close: closeRowMenu } = useContextMenu();
  const [menuTarget, setMenuTarget] = useState<{ p: Product; fullQty: number; dispo: number; unit: string; packDivisor: number } | null>(null);
  const replayLast = async () => {
    if (replaying || prefilling || modif) return;
    setReplaying(true);
    try {
      const res = await fetch(`/api/sap/orders/last?clientId=${encodeURIComponent(clientId)}`);
      const json = await res.json();
      if (!json.found || !json.lines?.length) { toast.info("Aucune commande précédente pour ce client."); return; }
      type LastLine = { itemCode: string; itemName?: string; quantity: number; price?: number | null };
      const all = Object.values(grouped).flat();
      let added = 0;
      const missing: string[] = [];
      setCart((cur) => {
        const next = [...cur];
        for (const ln of json.lines as LastLine[]) {
          if (next.some((l) => l.itemCode === ln.itemCode)) continue;
          const p = all.find((x) => x.itemCode === ln.itemCode);
          if (!p) { missing.push(ln.itemName ?? ln.itemCode); continue; }
          next.push(buildLine(p, { quantity: ln.quantity, price: ln.price ?? null, noPromo: true }));
          added++;
        }
        return next;
      });
      if (added > 0) {
        toast.success(`Dernière commande #${json.docNum} dupliquée — ${added} ligne(s) au panier`, {
          description: missing.length
            ? `${missing.length} article(s) hors catalogue chargé : ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""} (active « + Rupture » si besoin).`
            : "Ajuste les quantités et les prix si besoin.",
          duration: 8000,
        });
      } else {
        toast.info(missing.length
          ? "Articles de la dernière commande introuvables au catalogue chargé (active « + Rupture »)."
          : "Toutes les lignes de la dernière commande sont déjà au panier.");
      }
    } catch {
      toast.error("Échec de la duplication de la dernière commande");
    } finally {
      setReplaying(false);
    }
  };
  /** Raccourci : ajoute un produit au panier par code (catalogue chargé, repli API /products). */
  const addByShortcut = async (codeOrName: string) => {
    const q = codeOrName.trim();
    if (!q) return;
    const lc = q.toLowerCase();
    const all = Object.values(grouped).flat();
    let p: Product | undefined =
      all.find((x) => x.itemCode.toLowerCase() === lc)
      || all.find((x) => x.itemCode.toLowerCase().includes(lc) || x.itemName.toLowerCase().includes(lc));
    if (!p) {
      try {
        const res = await fetch(`/api/products?search=${encodeURIComponent(q)}&limit=1`);
        const json = await res.json();
        p = (json.products ?? [])[0] as Product | undefined;
      } catch { /* repli silencieux */ }
    }
    if (!p) { toast.error(`Aucun produit pour « ${q} »`); return; }
    if (cart.some((l) => l.itemCode === p!.itemCode)) { toast.info(`${p.itemName} déjà au panier`); return; }
    if (!hints[p.itemCode]) loadHints([p.itemCode]);
    addToCart(p);
    toast.success(`${p.itemName} ajouté`);
  };
  // applyPromoFree est no-op hors promo X_PLUS_Y/FREE → recalcul sûr à chaque changement de quantité.
  const updateLine = (i: number, patch: Partial<CartLine>) =>
    setCart((c) => c.map((l, k) => k === i ? applyPromoFree({ ...l, ...patch }) : l));
  const removeLine = (i: number) => setCart((c) => c.filter((_, k) => k !== i));
  /** Réordonne une ligne : échange avec la voisine. dir = -1 (monter) / +1 (descendre). */
  const moveLine = (i: number, dir: -1 | 1) =>
    setCart((c) => {
      const j = i + dir;
      if (j < 0 || j >= c.length) return c;
      const next = c.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  // Glisser-déposer des lignes du BL : échanger deux lignes (dépôt SUR une
  // ligne) ou insérer avant une ligne / en fin (dépôt dans un interstice).
  const swapLine = (a: number, b: number) =>
    setCart((c) => {
      if (a === b || a < 0 || b < 0 || a >= c.length || b >= c.length) return c;
      const next = c.slice();
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  const moveLineBefore = (from: number, before: number | null) =>
    setCart((c) => {
      if (from < 0 || from >= c.length || from === before) return c;
      const item = c[from];
      const out: CartLine[] = [];
      c.forEach((l, k) => {
        if (before !== null && k === before) out.push(item);
        if (k !== from) out.push(l);
      });
      if (before === null) out.push(item);
      return out;
    });
  // href/index tiré + interstice ou ligne survolé(e) (`gap:<i>` | `end` | `row:<i>`).
  const [dragLine, setDragLine] = useState<number | null>(null);
  const [overLine, setOverLine] = useState<string | null>(null);
  const endLineDrag = () => { setDragLine(null); setOverLine(null); };

  /** C2 — Bascule la promotion d'une ligne (jamais imposée) : applique la promo
   *  active de l'article si absente, la retire sinon. Marche aussi sur les
   *  lignes déjà au BL. PERCENT : ajuste le prix net affiché (et le restaure au
   *  retrait) ; X_PLUS_Y / FREE : (re)calcule les colis offerts via applyPromoFree. */
  const togglePromo = (i: number) =>
    setCart((cur) => cur.map((l, k) => {
      if (k !== i) return l;
      if (l.promo) {
        // Retrait : on restaure le prix plein si une remise % avait été appliquée.
        let price = l.price;
        if (l.promo.kind === "PERCENT" && l.discountPercent > 0 && l.discountPercent < 100 && price != null) {
          price = Math.round((price / (1 - l.discountPercent / 100)) * 100) / 100;
        }
        return { ...l, promo: null, discountPercent: 0, freeUnits: 0, freeManual: false, price };
      }
      const pr = promos[l.itemCode];
      if (!pr) return l;
      let price = l.price;
      let discountPercent = 0;
      if (pr.kind === "PRICE" && pr.value > 0) {
        price = pr.value;   // tarif imposé → prix unitaire fixe
      } else if (pr.kind === "PERCENT" && pr.value > 0 && pr.value < 100) {
        discountPercent = pr.value;
        if (price != null) price = Math.round(price * (1 - pr.value / 100) * 100) / 100;
      }
      // freeManual:false → la promo (re)calcule les colis offerts (X+Y / offert).
      return applyPromoFree({ ...l, promo: pr, discountPercent, price, freeManual: false });
    }));
  /** Retire un item du panier par son itemCode (utilisé par le toggle Add/Done). */
  const removeFromCartByCode = (itemCode: string) =>
    setCart((c) => c.filter((l) => l.itemCode !== itemCode));


  // Prix à la pièce × (colis × pièces/colis) = total ligne.
  // Les colis offerts (X_PLUS_Y / FREE) sont une LIGNE séparée à 0 € → ils ne
  // réduisent pas ce total. PERCENT : le prix affiché est DÉJÀ net → rien à déduire.
  const lineHT = (l: CartLine) => {
    if (!l.price) return 0;
    return l.price * l.quantity * l.packDivisor;
  };
  const totalHT = useMemo(() => cart.reduce((s, l) => s + lineHT(l), 0), [cart]);

  // Coût transport ESTIMÉ de la commande (temps réel) — selon le TRANSPORTEUR
  // sélectionné : livraison directe → prix position × kg ; sinon valeur manuelle.
  // Poids d'une ligne : quantité déjà en kg pour les articles au kg, sinon
  // quantité (colis) × poids d'un colis.
  const lineWeightKg = (l: CartLine): number => {
    const w = l.unit === "kg" ? l.quantity : l.quantity * (l.colisWeightKg ?? 0);
    return Number.isFinite(w) && w > 0 ? w : 0;
  };
  const totalKg = useMemo(() => cart.reduce((s, l) => s + lineWeightKg(l), 0), [cart]);
  const carrierIsDirect = isDirectCarrier(transportModel, carrierSap) || (transportModel?.directCarriers.length ?? 0) === 0;
  // Transporteur EXTERNE avec une GRILLE : coût de CETTE livraison = prix de la
  // tranche de poids du panier, pour le département du client, + majorations %
  // et frais fixes (coût PAR POSITION — cf. lib/carrierTariff). Repli si pas de
  // grille / département / tranche : legacy €/kg du client × poids.
  // resolveCarrierTariff : grille du code exact, sinon celle de sa FAMILLE
  // (tous les dépôts FT<n°> → DELANCHY) — un FT jamais importé reste tarifé.
  const carrierTariff = !carrierIsDirect ? resolveCarrierTariff(carrierTariffs, carrierSap) : null;
  const positionCost = carrierTariff ? computePositionCost(carrierTariff, clientDept, totalKg) : null;
  const transportPerKgClient = positionCost && totalKg > 0
    ? positionCost.total / totalKg
    : transportPerKgForCarrier(transportModel, transportPerKg, carrierSap, clientPricing);

  // Marge BRUTE de la commande (depuis le prix d'achat des hints) + marge/kg
  // MOYENNE PONDÉRÉE PAR LE POIDS : Σ marge ligne ÷ Σ kg (des lignes costées).
  const marginAgg = useMemo(() => {
    let margin = 0, ca = 0;          // € — TOUTES les lignes costées
    let marginKg = 0, kg = 0;        // /kg — SEULEMENT les lignes au poids connu (> 0)
    for (const l of cart) {
      const pa = hints[l.itemCode]?.prixAchat;
      if (l.price == null || pa == null) continue;         // prix d'achat inconnu → hors calcul
      const lineMargin = (l.price - pa) * l.quantity * l.packDivisor;
      margin += lineMargin;
      ca += l.price * l.quantity * l.packDivisor;
      // Marge /kg pondérée par le POIDS RÉEL : une ligne sans poids connu (pièce
      // sans poids relevé) est EXCLUE du ratio — marge ET kg — pour ne pas le gonfler.
      const w = l.unit === "kg" ? l.quantity : l.quantity * (l.colisWeightKg ?? 0);
      if (Number.isFinite(w) && w > 0) { marginKg += lineMargin; kg += w; }
    }
    return { margin, marginKg, kg, ca };
  }, [cart, hints]);
  const hasCostData = marginAgg.ca > 0;   // au moins une ligne costée (vue € par livraison)
  const hasKgData = marginAgg.kg > 0;     // au moins une ligne au poids connu (vue /kg)
  // ── Par KILO (moyenne pondérée par le poids) ──
  const margeBruteKg = hasKgData ? marginAgg.marginKg / marginAgg.kg : 0;
  // Coût transport /kg = la MOYENNE du modèle « Coût de transport » (prix
  // position, ou tarif du transporteur non direct) — JAMAIS recalculé sur la
  // commande. Marge nette /kg = marge brute/kg − ce coût /kg moyen.
  const margeNetteKg = margeBruteKg - transportPerKgClient;
  // ── Par LIVRAISON (position) ──
  //   • Transporteur externe AVEC GRILLE : coût RÉEL de cette position (tranche
  //     de poids du panier × département) — il varie donc avec le poids.
  //   • Sinon (direct / legacy) : coût MOYEN d'une livraison — coût /kg moyen ×
  //     poids MOYEN d'une livraison directe (kg/an ÷ nb livraisons/an). Pour un
  //     transporteur direct cela redonne exactement `costPerDelivery` de la
  //     page Coût de transport (annuel ÷ livraisons).
  const avgKgPerDelivery = (transportModel?.deliveriesPerYear ?? 0) > 0
    ? (transportModel!.kgPerYear || 0) / transportModel!.deliveriesPerYear
    : 0;
  const coutTransportTotal = positionCost ? positionCost.total : transportPerKgClient * avgKgPerDelivery; // € / position
  const margeBruteTotal = marginAgg.margin;                                  // € marge brute de CETTE commande
  const margeNetteTotal = margeBruteTotal - coutTransportTotal;              // € marge nette = marge brute − coût moyen livraison
  // Marge nette % (du CA des lignes costées) — pour le feu tricolore.
  const margeNettePct = marginAgg.ca > 0 ? (margeNetteTotal / marginAgg.ca) * 100 : 0;
  // Feu : rouge = marge nette négative (transport > marge brute) ; orange = nette
  // positive mais < 10 % ; vert = ≥ 10 %.
  const netTone = margeNetteTotal < 0 ? "rose" : margeNettePct < 10 ? "amber" : "emerald";

  // ── GARDE-FOUS : évaluation EN DIRECT du panier (mêmes règles que le serveur).
  // byLine = violations par index de ligne (badge sous la ligne) ; order =
  // violations globales ; all = tout (récap près du bouton Valider + dialogue).
  const safeguards = useMemo(() => {
    const empty = { byLine: new Map<number, SafeguardViolation[]>(), order: [] as SafeguardViolation[], all: [] as SafeguardViolation[] };
    if (!sgConfig || cart.length === 0) return empty;
    const byLine = new Map<number, SafeguardViolation[]>();
    const all: SafeguardViolation[] = [];
    cart.forEach((l, i) => {
      const h = hints[l.itemCode];
      const hab = orderStats?.parArticle?.[l.itemCode];
      const poids = lineWeightKg(l);
      const v = evaluateLineSafeguards(sgConfig, {
        itemCode: l.itemCode, itemName: l.itemName, unit: l.unit,
        // Volume TOTAL expédié = quantité saisie + colis offerts (promo).
        quantity: l.quantity + Math.max(0, Math.floor(l.freeUnits ?? 0)),
        price: l.price ?? null,
        prixAchat: h?.prixAchat ?? null,
        prixConseille: h?.prixConseille ?? null,
        stockDisponible: totalAvailable(l.availByWarehouse ?? {}),
        poidsKg: poids > 0 ? poids : null,
        habitude: hab && l.packDivisor > 0
          ? { moyenne: hab.moyenne / l.packDivisor, nbCommandes: hab.nbCommandes }
          : null,
      });
      if (v.length > 0) { byLine.set(i, v); all.push(...v); }
    });
    const order = evaluateOrderSafeguards(sgConfig, {
      totalHT,
      poidsKg: totalKg > 0 ? totalKg : null,
      marge: marginAgg.ca > 0 ? { margeEur: marginAgg.margin, caEur: marginAgg.ca } : null,
      panierMoyen: orderStats?.panierMoyen ?? null,
      deliveryDate: deliveryDate || null,
      // encours + doublon du jour : résolus côté serveur à la création.
    });
    all.push(...order);
    return { byLine, order, all };
  }, [sgConfig, cart, hints, orderStats, totalHT, totalKg, marginAgg, deliveryDate]);
  const sgSplit = useMemo(() => splitViolations(safeguards.all), [safeguards]);
  // Dialogue « Valider quand même ? » (violations en mode Avertir) — le panier
  // reste intact tant que le commercial n'a pas tranché.
  const [sgConfirmOpen, setSgConfirmOpen] = useState(false);

  // ── Création BL ──
  type ApiLine = {
    itemCode: string; quantity: number; displayQuantity: number;
    displayUnit: string; warehouseCode: string; price?: number;
    /** C2 — remise SAP par ligne (0–100), portée sur le bon. */
    discountPercent?: number;
    /** Ligne à découvert (sur-vente) : part sans lot EM — affectée à la réception. */
    decouvert?: boolean;
    /** Lot choisi à la main (bon de commande) — honoré côté serveur (U_NoLot). */
    lot?: string | null;
    /** Vente Sofruce : prix d'ACHAT unitaire (même unité que le prix de vente)
     *  porté sur l'entrée marchandise créée avant la vente. */
    purchasePrice?: number;
  };

  /** Vente Sofruce — prix d'achat saisi pour un article (null = non renseigné →
   *  l'achat partira au prix de VENTE, marge 0). Virgule acceptée. */
  const sofrucePAOf = (itemCode: string): number | null => {
    const raw = (sofrucePA[itemCode] ?? "").replace(",", ".").trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  /** C2 — En-tête du bon : mention des promos appliquées (uniquement si présentes).
   *  Ex. « PROMO : −10% Fraise Hoogstraten · 5+1 Framboise (1 colis offert) ». */
  const buildPromoComment = (): string | undefined => {
    const parts: string[] = [];
    for (const l of cart) {
      if (!l.promo) continue;
      const name = l.promo.label?.trim() || l.itemName;
      if (l.promo.kind === "PRICE" && l.promo.value > 0) {
        parts.push(`${name} — tarif ${l.promo.value.toFixed(2)} €`);
      } else if (l.promo.kind === "PERCENT" && l.discountPercent > 0) {
        parts.push(`−${String(Math.round(l.discountPercent * 100) / 100)}% ${name}`);
      } else if (l.promo.kind === "X_PLUS_Y" && l.freeUnits > 0) {
        parts.push(`${l.promo.buyQty}+${l.promo.freeQty} ${name} (${l.freeUnits} colis offert${l.freeUnits > 1 ? "s" : ""})`);
      } else if (l.promo.kind === "FREE" && l.freeUnits > 0) {
        parts.push(`${name} (${l.freeUnits} colis offert${l.freeUnits > 1 ? "s" : ""})`);
      }
    }
    return parts.length > 0 ? `PROMO : ${parts.join(" · ")}` : undefined;
  };

  /** Corps du POST /api/sap/orders — transporteur + tournée EXPLICITES
   *  (validés avant l'envoi), texte du BL = note saisie + mention promo. */
  const buildOrderBody = (apiLines: ApiLine[], safeguardsConfirmed = false): Record<string, unknown> => ({
    clientId, deliveryModeId: deliveryModeId || undefined,
    ...(tourneePayload() ?? {}),
    deliveryDate: new Date(deliveryDate).toISOString(),
    numAtCard: numAtCard.trim() || undefined, lines: apiLines,
    comments: [comments.trim(), buildPromoComment()].filter(Boolean).join(" · ") || undefined,
    // Bon de commande (aucun auto-lot) : coche manuelle ou précommande.
    docKind: isBonCommande ? "COMMANDE" : "BL",
    // Vente Sofruce : le serveur crée l'ENTRÉE MARCHANDISE Sofruce avant la vente.
    ...(venteSofruce && !isBonCommande ? { venteSofruce: true } : {}),
    // Garde-fous « Avertir » DÉJÀ confirmés dans le dialogue console → le filet
    // serveur ne redemande pas (les BLOQUANTS, eux, restent infranchissables).
    ...(safeguardsConfirmed ? { confirmSafeguards: true } : {}),
  });

  const buildApiLines = (lines: CartLine[] = cart): ApiLine[] =>
    lines.flatMap((l) => {
      const kind = l.promo?.kind;
      // Colis offerts (promo X+Y / offert OU saisis à la main) : EN PLUS de la qté
      // saisie, en ligne séparée à 0 €. La quantité saisie est entièrement payante.
      const freeUnits = Math.max(0, Math.floor(l.freeUnits ?? 0));
      const paidQty = l.quantity;
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
        // Vente Sofruce : prix d'achat saisi, reporté sur CHAQUE tronçon de la
        // ligne (le serveur agrège par article × entrepôt pour l'EM).
        const pa = venteSofruce ? sofrucePAOf(l.itemCode) : null;
        if (paidHere > 0) {
          out.push({
            itemCode: l.itemCode,
            quantity: paidHere * l.packDivisor,   // colis → pièces pour SAP
            displayQuantity: paidHere, displayUnit: l.unit,
            warehouseCode: c.warehouse,
            ...(price != null ? { price } : {}),
            ...(dPercent != null ? { discountPercent: dPercent } : {}),
            ...(c.decouvert ? { decouvert: true } : {}),
            ...(l.lot ? { lot: l.lot } : {}),
            ...(pa != null ? { purchasePrice: pa } : {}),
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
            ...(c.decouvert ? { decouvert: true } : {}),
            ...(l.lot ? { lot: l.lot } : {}),
            ...(pa != null ? { purchasePrice: pa } : {}),
          });
        }
      }
      return out;
    });

  /** Envoi NON BLOQUANT : valide, construit le payload, délègue à la tâche de
   *  fond (sendOrderInBackground) et LIBÈRE la vue immédiatement (onSubmitted
   *  → le client quitte l'écran, le poste enchaîne sur le suivant). Le
   *  résultat SAP arrive en toast, au nom du client. Anti-double-clic : le
   *  clic vide le panier et retire la vue → plus rien à re-cliquer. */
  const submit = (opts?: { safeguardsConfirmed?: boolean }) => {
    // ── GARDE-FOUS (Paramètres) : bloquants → refus ferme ; « Avertir » →
    // dialogue « Valider quand même ? ». Évalués AVANT tout envoi, création
    // comme modification — le serveur re-vérifie de toute façon à la création.
    if (cart.length > 0) {
      if (sgSplit.blocks.length > 0) {
        toast.error("Garde-fous bloquants — envoi refusé", {
          description: `${sgSplit.blocks.map((v) => v.message).join("\n")}\n(Seuils réglables dans Paramètres → Garde-fous.)`,
          duration: 15000,
        });
        return;
      }
      if (sgSplit.warns.length > 0 && !opts?.safeguardsConfirmed) {
        setSgConfirmOpen(true);
        return;
      }
    }

    // ── Mode MODIFICATION : ré-enregistre le BL en REMPLACEMENT COMPLET ──
    // (même BL/DocNum) — supprimer/modifier/réordonner/ajouter, comme un bon normal.
    if (modif) {
      if (modifMeta?.editable === false) { toast.error("BL clôturé — modification impossible."); return; }
      if (cart.length === 0) { toast.error("Le BL doit garder au moins une ligne."); return; }
      // Liste FINALE (ordre du panier = ordre des lignes du BL) :
      //  - ligne existante → conservée, lot préservé ; qté brute d'origine si
      //    inchangée (pas d'arrondi colis↔pièces), sinon reconvertie.
      //  - nouvelle ligne → découpée par entrepôt (buildApiLines) ; lot/TPF serveur.
      type FinalLine = {
        itemCode: string; quantity: number; warehouseCode?: string;
        price?: number; discountPercent?: number; keep?: boolean; lot?: string | null;
        decouvert?: boolean;
      };
      const lines: FinalLine[] = [];
      for (const l of cart) {
        const o = l.originalLine;
        const kind = l.promo?.kind;
        if (o) {
          // Ligne existante → CONSERVÉE (lot préservé). La qté saisie est payante ;
          // les colis offerts (promo OU saisis à la main) partent en ligne SÉPARÉE à 0 €.
          const freeColis = Math.max(0, Math.floor(l.freeUnits));
          const qtyChanged = Math.abs(l.quantity - o.qty) > 1e-6;
          const paidPieces = qtyChanged ? Math.round(l.quantity * l.packDivisor * 1000) / 1000 : o.pieces;
          // Remise % (PERCENT) portée sur la ligne : prix brut + DiscountPercent.
          let price = l.price;
          let discountPercent: number | undefined;
          if (kind === "PERCENT" && l.discountPercent > 0 && l.discountPercent < 100 && price != null) {
            discountPercent = Math.round(l.discountPercent * 100) / 100;
            price = Math.round((price / (1 - l.discountPercent / 100)) * 10000) / 10000; // net → brut
          }
          if (paidPieces > 0) {
            lines.push({
              itemCode: l.itemCode, quantity: paidPieces,
              ...(o.warehouse ? { warehouseCode: o.warehouse } : {}),
              ...(price != null && price > 0 ? { price } : {}),
              ...(discountPercent != null ? { discountPercent } : {}),
              keep: true, lot: o.lot,
            });
          }
          // Ligne(s) offerte(s) → nouvelle ligne à 0 € (même article/entrepôt, 100 % remise).
          if (freeColis > 0) {
            lines.push({
              itemCode: l.itemCode, quantity: Math.round(freeColis * l.packDivisor * 1000) / 1000,
              ...(o.warehouse ? { warehouseCode: o.warehouse } : {}),
              ...(l.price != null && l.price > 0 ? { price: l.price } : {}),
              discountPercent: 100,
              keep: false,
            });
          }
        } else {
          // Nouvelle ligne → buildApiLines (split entrepôt + promo + lot/TPF serveur).
          for (const a of buildApiLines([l])) {
            lines.push({
              itemCode: a.itemCode, quantity: a.quantity,
              ...(a.warehouseCode ? { warehouseCode: a.warehouseCode } : {}),
              ...(a.price != null ? { price: a.price } : {}),
              ...(a.discountPercent != null ? { discountPercent: a.discountPercent } : {}),
              ...(a.decouvert ? { decouvert: true } : {}),
              keep: false,
            });
          }
        }
      }
      if (lines.length === 0) { toast.error("Le BL doit garder au moins une ligne."); return; }
      sendOrderInBackground({
        kind: "modif", clientName, docEntry: modif.docEntry, docNum: modif.docNum,
        body: { lines, comments: comments.trim(), numAtCard: numAtCard.trim() },
      });
      toast.info(`BL #${modif.docNum} (${clientName}) — enregistrement en arrière-plan…`);
      setCart([]); setNumAtCard(""); setComments("");
      onSubmitted?.();
      return;
    }

    if (cart.length === 0) { toast.error("Panier vide"); return; }
    // Garde-fou TOURNÉE : un bon ne part jamais sans transporteur + tournée
    // (pré-remplis avec le défaut client — l'erreur ne sort que par exception).
    const tourneeError = validateTournee();
    if (tourneeError) { toast.error(tourneeError); return; }
    // Marge masquée → pas de célébration « grosse marge » (elle affiche le montant en grand).
    sendOrderInBackground({ kind: "create", clientName, body: buildOrderBody(buildApiLines(), opts?.safeguardsConfirmed === true), margeNette: hasCostData && !hideMargin ? margeNetteTotal : undefined });
    toast.info(`${clientName} — commande envoyée, création en arrière-plan…`);
    setCart([]); setNumAtCard(""); setComments("");
    onSubmitted?.();
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

  // ── Onglet TARIF : catalogue à plat + ajout d'une cotation ──
  const allProducts = useMemo(() => Object.values(grouped).flat(), [grouped]);
  const productByCode = useMemo(() => new Map(allProducts.map((p) => [p.itemCode, p])), [allProducts]);

  // ── MENU CONTEXTUEL d'une ligne du BL (clic droit) : ajouter une 2ᵉ ligne
  //    du MÊME article (valorisation différente) ou remplacer l'article. ──
  const [lineMenu, setLineMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  useEffect(() => {
    if (!lineMenu) return;
    const close = () => setLineMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [lineMenu]);

  /** Insère une 2ᵉ ligne du MÊME article sous la ligne source : mêmes tags et
   *  même prix (à ajuster — c'est le but : 2 valorisations), quantité repartie
   *  à UN colis, sans promo ni rattachement au BL (nouvelle ligne au POST). */
  const duplicateLine = (i: number) =>
    setCart((cur) => {
      const src = cur[i];
      if (!src) return cur;
      const copy: CartLine = {
        ...src,
        quantity: src.stepColis,
        promo: null, discountPercent: 0, freeUnits: 0, freeManual: false,
        originalLine: null,
      };
      const next = cur.slice();
      next.splice(i + 1, 0, copy);
      return next;
    });

  // ── TRANSLATION d'article (menu clic droit) : remplace l'article par un
  //    autre en CONSERVANT la quantité et le prix. ──
  const [swapFor, setSwapFor] = useState<number | null>(null);
  const [swapQuery, setSwapQuery] = useState("");
  const swapResults = useMemo(() => {
    const qq = swapQuery.trim().toLowerCase();
    const base = qq
      ? allProducts.filter((p) => (p.itemName + p.itemCode).toLowerCase().includes(qq))
      : allProducts;
    return base.slice(0, 15);
  }, [allProducts, swapQuery]);
  const doSwap = (p: Product) => {
    if (swapFor === null) return;
    const old = cart[swapFor];
    if (!old) { setSwapFor(null); return; }
    if (cart.some((l, k) => k !== swapFor && l.itemCode === p.itemCode)) {
      toast.info(`${p.itemName} est déjà au panier`);
      return;
    }
    setCart((cur) => {
      const cible = cur[swapFor];
      if (!cible) return cur;
      const next = cur.slice();
      // Quantité + prix CONSERVÉS ; promo non ré-appliquée. En modification,
      // l'ancienne ligne du BL est remplacée (nouvel article = nouvelle ligne).
      next[swapFor] = buildLine(p, { quantity: cible.quantity, price: cible.price, noPromo: true });
      return next;
    });
    toast.success(`${old.itemName} → ${p.itemName}`, { description: "Quantité et prix conservés." });
    setSwapFor(null);
    setSwapQuery("");
  };
  const [tarifQuery, setTarifQuery] = useState("");
  const [tarifAdding, setTarifAdding] = useState(false);
  const addTarif = async () => {
    const q = tarifQuery.trim();
    if (!q || tarifAdding) return;
    const lc = q.toLowerCase();
    let p: Product | undefined =
      allProducts.find((x) => x.itemCode.toLowerCase() === lc)
      || allProducts.find((x) => x.itemCode.toLowerCase().includes(lc) || x.itemName.toLowerCase().includes(lc));
    if (!p) {
      setTarifAdding(true);
      try {
        const res = await fetch(`/api/products?search=${encodeURIComponent(q)}&limit=1`);
        const json = await res.json();
        p = (json.products ?? [])[0] as Product | undefined;
      } catch { /* repli silencieux */ }
      finally { setTarifAdding(false); }
    }
    if (!p) { toast.error(`Aucun produit pour « ${q} »`); return; }
    const code = p.itemCode;
    if ((tarifs ?? []).some((t) => t.itemCode === code)) { toast.info(`${p.itemName} est déjà au tarif`); return; }
    // Prix de départ : le conseillé du client si connu, sinon 0 (à saisir).
    const start = hints[code]?.prixConseille ?? 0;
    mutateTarifs((cur) => [...cur, { itemCode: code, price: start }]);
    setTarifQuery("");
    toast.success(`${p.itemName} ajouté au tarif — saisis le prix négocié`);
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-1.5">
      {/* (Bandeau promotions déplacé tout en haut de l'écran — cf. page Écran 2.) */}
      {/* ── Bandeau MODIFICATION ultra-compact (une ligne) : contexte du BL en
             cours d'édition + Quitter. La réf. client et le texte du BL vivent
             dans la colonne COMMANDE (côte à côte, comme transporteur/tournée). ── */}
      {modif && (
        <div className="shrink-0 flex items-center gap-x-2 rounded-md border px-2 py-1 border-amber-300/70 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15">
          <span
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-amber-800 dark:text-amber-200 shrink-0"
          >
            <Pencil className="h-3 w-3" strokeWidth={2.2} />
            BL # {modif.docNum}
            {modifMeta?.dueDate && (
              <span className="font-normal text-amber-700/80 dark:text-amber-300/80 hidden xl:inline">
                · {new Date(modifMeta.dueDate).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
              </span>
            )}
            {prefilling && <Loader2 className="h-3 w-3 animate-spin" />}
          </span>
          <InfoHint label="Mode modification" size={14}>
            {`Modification du BL # ${modif.docNum} — modifie, supprime ou ajoute des lignes, enregistré sur ce même BL${
              modifMeta?.dueDate ? ` · livraison ${new Date(modifMeta.dueDate).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}` : ""}`}
          </InfoHint>
          {modifMeta?.editable === false && (
            <>
              <span className="text-[10.5px] font-medium text-rose-600 dark:text-rose-400 shrink-0">
                ⚠️ clôturée
              </span>
              <InfoHint label="Commande clôturée" size={14}>
                Commande clôturée — la modification sera refusée par SAP.
              </InfoHint>
            </>
          )}
          <span className="flex-1" />
          {onExitModif && (
            <button
              type="button"
              onClick={onExitModif}
              title="Quitter la modification et revenir à la saisie normale (synchro écran 1)"
              className="inline-flex shrink-0 items-center gap-1 h-[26px] px-2 rounded bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-semibold active:scale-[0.98] transition-colors"
            >
              <X className="h-3 w-3" /> Quitter
            </button>
          )}
        </div>
      )}

      {/* Deux colonnes UNIQUEMENT sur vrai desktop (≥ xl) : sur tablette, la
          colonne commande fixe (640px) écrasait le stock → on EMPILE (stock en
          haut, commande en bas, chacun scrolle en interne, zéro chevauchement). */}
      <div className="flex flex-col xl:flex-row gap-3 flex-1 min-h-0">
      {/* ── Colonne STOCK (cliquable) — grille alignée, dense ──
           Colonnes fixes pour que prix & stock s'alignent verticalement
           sur toutes les lignes (lisibilité maximale) :
             [+]  Nom — description           prix €/u    stock u
      */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col panel p-3">
        {/* Bandeau client REGROUPÉ ici : nom + méta + recherche « créer / modifier
            un bon », en tête de la colonne stock (un seul bloc à gauche). */}
        {clientHeader}
        {/* Réf. client + note du BL — CALÉES ici (dans le bloc gauche) plutôt qu'au
            pied de la commande, pour laisser plus de place aux lignes produit. */}
        <div className="shrink-0 mb-2 space-y-1">
          {modif && cart.some((l) => l.promo) && (
            <div className="flex justify-end">
              <button type="button"
                onClick={() => setComments((c) => {
                  const t = buildPromoComment();
                  if (!t) return c;
                  return c.trim() ? `${c.trim()} · ${t}` : t;
                })}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline">
                <Megaphone className="h-3 w-3" /> Insérer le texte promo
              </button>
            </div>
          )}
          <div className="flex gap-1.5">
            <input id="bl-numatcard" value={numAtCard} onChange={(e) => setNumAtCard(e.target.value)}
              placeholder="N° de commande (réf. client)" aria-label="N° de commande (réf. client)"
              className="min-w-0 flex-1 h-9 rounded-md border border-border bg-background text-[13.5px] px-2 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            <input id="bl-note" value={comments} onChange={(e) => setComments(e.target.value)} maxLength={254}
              placeholder={modif ? "Texte sur le BL (note/promo)" : "Texte sur le BL (note)"}
              aria-label="Texte sur le BL"
              className="min-w-0 flex-1 h-9 rounded-md border border-border bg-background text-[13px] px-2 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>
        </div>
        <div className="flex items-center gap-2 mb-2 shrink-0">
          {/* Onglets : Stock (catalogue) / Tarif (cotations spécifiques du client) */}
          <div className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5 shrink-0">
            <button
              type="button" onClick={() => setStockTab("stock")} aria-pressed={stockTab === "stock"}
              className={`inline-flex items-center h-8 px-3 rounded text-[12.5px] font-semibold transition-colors ${
                stockTab === "stock" ? "bg-brand-600 text-white" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Stock
            </button>
            <button
              type="button" onClick={() => setStockTab("tarif")} aria-pressed={stockTab === "tarif"}
              title="Cotations spécifiques du client (prix négociés par article)"
              className={`inline-flex items-center gap-1 h-8 px-3 rounded text-[12.5px] font-semibold transition-colors ${
                stockTab === "tarif" ? "bg-violet-600 text-white" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <BadgeEuro className="h-3.5 w-3.5" /> Tarif{tarifs && tarifs.length > 0 ? ` (${tarifs.length})` : ""}
            </button>
          </div>
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

        {stockTab === "stock" ? (<>
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
                      const marque  = cleanTag(p.uMarque ?? h?.marque);
                      const condi   = cleanTag(p.uCondi ?? p.uUvc);          // ex. 8×500g
                      const calibreRaw = cleanTag(h?.calibre);
                      const calibre = calibreRaw ? `cal. ${calibreRaw}` : null;
                      const variete = cleanTag(p.frgnName);                  // variété (FrgnName)
                      const pays    = cleanTag(p.uPays ?? h?.pays);
                      const isFav   = favorites.has(p.itemCode);          // C1
                      // C2 — plus de badge promo sur la liste stock : la remise
                      // auto au panier reste (cf. addToCart), le récap vit dans
                      // le Dialog « Promotions » et sur la ligne panier.
                      const kgC     = !isKg ? colisKg(p) : null;          // B4
                      // Chips dimensionnés par la densité (C4)
                      const chipCls = `inline-flex items-center px-2 rounded-[5px] font-semibold ${ui.chip}`;
                      // Seule une ligne déjà LIVRÉE (clôturée) ne peut pas être retirée.
                      const hasClosedLine = !!modif && cart.some((l) => l.itemCode === p.itemCode && l.originalLine?.closed);
                      const toggleCart = () => {
                        if (inCart) { if (hasClosedLine) return; removeFromCartByCode(p.itemCode); }
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
                            onContextMenu={(e) => {
                              const fullQty = dispo > 0 ? (packDivisor > 1 ? Math.floor(dispo) : Math.round(dispo * 10) / 10) : 0;
                              setMenuTarget({ p, fullQty, dispo: Math.round(dispo * 10) / 10, unit, packDivisor });
                              openRowMenu(e);
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
                            {/* Col 3 — Produit COMPACT (2 lignes) : nom, puis chips + code +
                                colis/kg sur UNE seule ligne (tronquée) — plus de produits
                                visibles sans scroller. */}
                            <span className="min-w-0 flex items-center gap-2">
                              <BrandLogo marque={marque} logos={brandLogos} size="xl" />
                              <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className={`${ui.name} font-semibold text-foreground truncate leading-tight`}>
                                  {p.itemName}
                                </span>
                                {/* Note qualité (étoiles) saisie à la réception. */}
                                {notes[p.itemCode] ? <StarRating value={notes[p.itemCode]} size="sm" className="shrink-0" /> : null}
                              </span>
                              {/* Tags espacés (gap-1.5) ; le CODE ARTICLE n'apparaît plus
                                  sur la ligne (clic droit « Détails » pour le lot/DLC). */}
                              <span className="mt-0.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap min-w-0">
                                {marque && <span className={`${chipCls} shrink-0 bg-violet-100 text-violet-800 dark:bg-violet-500/30 dark:text-violet-100 dark:ring-1 dark:ring-inset dark:ring-violet-400/50`}>{marque}</span>}
                                {condi && <span className={`${chipCls} shrink-0 bg-sky-100 text-sky-800 dark:bg-sky-500/30 dark:text-sky-100 dark:ring-1 dark:ring-inset dark:ring-sky-400/50`}>{condi}</span>}
                                {calibre && <span className={`${chipCls} shrink-0 bg-teal-100 text-teal-800 dark:bg-teal-500/30 dark:text-teal-100 dark:ring-1 dark:ring-inset dark:ring-teal-400/50`}>{calibre}</span>}
                                {variete && <span className={`${chipCls} shrink-0 bg-rose-100 text-rose-800 dark:bg-rose-500/30 dark:text-rose-100 dark:ring-1 dark:ring-inset dark:ring-rose-400/50`}>{variete}</span>}
                                {pays && <span className={`${chipCls} shrink-0 bg-amber-100 text-amber-800 dark:bg-amber-500/30 dark:text-amber-100 dark:ring-1 dark:ring-inset dark:ring-amber-400/50`}>{pays}</span>}
                                {/* B4 — poids du colis quand calculable (≈ poids unité × pièces/colis) */}
                                {kgC != null && (
                                  <span className={`${ui.code} text-muted-foreground/80 font-medium shrink-0`}>
                                    {fmtKg(kgC)} kg/colis
                                  </span>
                                )}
                              </span>
                              </span>
                            </span>
                            {/* Col 4 — Prix : cotation TARIF client prioritaire, sinon conseillé */}
                            <span className="text-right tnum">
                              {(() => {
                                const tarifP = tarifByCode.get(p.itemCode);
                                if (tarifP != null) {
                                  return (
                                    <>
                                      <span className={`block ${ui.price} font-bold leading-tight text-violet-600 dark:text-violet-400`}>
                                        {tarifP.toFixed(2)} €
                                      </span>
                                      <span className={`block ${ui.priceUnit} font-semibold text-violet-500/80 leading-tight`}>
                                        tarif /{priceUnit}
                                      </span>
                                    </>
                                  );
                                }
                                return h?.prixConseille != null ? (
                                  <>
                                    <span className={`block ${ui.price} font-bold leading-tight ${h.isDefault ? "text-foreground/70" : "text-brand-600 dark:text-brand-400"}`}>
                                      {h.prixConseille.toFixed(2)} €
                                    </span>
                                    <span className={`block ${ui.priceUnit} font-normal text-muted-foreground leading-tight`}>
                                      /{priceUnit}
                                    </span>
                                  </>
                                ) : <span className="block text-[13px] text-muted-foreground/40">—</span>;
                              })()}
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
        </>) : (
        /* ── Onglet TARIF — par fruits (désignation) + par article (cotation SKU) ── */
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Tarif PAR FRUITS (famille · origine · calibre · variété) — édité ici ET
              dans la fiche client ; appliqué en priorité sur le prix conseillé. */}
          <div className="shrink-0 mb-3 pb-3 border-b border-border max-h-[46%] overflow-y-auto pr-1">
            <p className="mb-2 text-[12px] font-semibold text-foreground">Tarif par fruits</p>
            <TarifFruitsEditor clientId={clientId} compact />
          </div>
          <p className="shrink-0 mb-2 text-[12px] font-semibold text-foreground">Tarif par article (SKU)</p>
          <div className="shrink-0 mb-2 flex items-center gap-1.5">
            <input
              value={tarifQuery}
              onChange={(e) => setTarifQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTarif(); } }}
              placeholder="Ajouter un article au tarif (code ou nom)…"
              className="flex-1 h-9 rounded-md border border-border bg-background text-[13.5px] px-2.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <button
              type="button" onClick={addTarif} disabled={tarifAdding || !tarifQuery.trim()}
              className="inline-flex items-center gap-1 h-9 px-3 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-[12.5px] font-semibold disabled:opacity-50"
            >
              {tarifAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Ajouter
            </button>
          </div>
          <p className="shrink-0 mb-2 text-[11px] text-muted-foreground">
            Cotations spécifiques de ce client : le prix négocié est <b>prioritaire</b> sur le prix
            conseillé à l&apos;ajout au panier (sauvegarde automatique).
          </p>
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            {tarifs === null ? (
              <p className="py-4 text-[13px] text-muted-foreground inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Chargement du tarif…
              </p>
            ) : tarifs.length === 0 ? (
              <p className="py-4 text-[13px] text-muted-foreground italic text-center">
                Aucune cotation pour ce client — ajoute un article ci-dessus.
              </p>
            ) : (
              <ul className="divide-y divide-border/40 border border-border rounded-lg overflow-hidden">
                {tarifs
                  .filter((t) => {
                    if (!q) return true;
                    const p = productByCode.get(t.itemCode);
                    return (t.itemCode + (p?.itemName ?? "")).toLowerCase().includes(q);
                  })
                  .map((t) => {
                    const p = productByCode.get(t.itemCode);
                    const inCart = cart.some((l) => l.itemCode === t.itemCode);
                    const { priceUnit } = unitInfo(p?.salesUnit ?? null, p?.salesQtyPerPackUnit ?? null);
                    return (
                      <li key={t.itemCode} className="flex items-center gap-2 px-2.5 py-1.5">
                        {/* Ajout direct au panier AU PRIX DU TARIF */}
                        <button
                          type="button"
                          disabled={!p || inCart}
                          onClick={() => { if (p) { addToCart(p, { price: t.price, noPromo: true }); toast.success(`${p.itemName} ajouté au panier — tarif ${t.price.toFixed(2)} €`); } }}
                          title={!p ? "Article hors catalogue chargé (active « + Rupture » sur l'onglet Stock)"
                            : inCart ? "Déjà au panier" : "Ajouter au panier au prix du tarif"}
                          className={`h-7 w-7 inline-flex items-center justify-center rounded-md shrink-0 disabled:opacity-40 ${
                            inCart ? "bg-emerald-500 text-white" : "bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20"
                          }`}
                        >
                          {inCart ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                        </button>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-semibold text-foreground truncate leading-tight">
                            {p?.itemName ?? t.itemCode}
                          </span>
                          <span className="block font-mono text-[10.5px] text-muted-foreground/60 truncate">{t.itemCode}</span>
                        </span>
                        <NumberInput
                          value={t.price}
                          onValueChange={(n) => mutateTarifs((cur) => cur.map((x) => x.itemCode === t.itemCode ? { ...x, price: n ?? 0 } : x))}
                          min={0} step={0.1} decimals={2}
                          aria-label={`Prix tarif ${p?.itemName ?? t.itemCode}`}
                          className="h-9 w-[88px] text-right text-[14.5px] font-semibold tnum rounded-md border border-violet-300/70 dark:border-violet-500/40 bg-background px-2 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-500"
                        />
                        <span className="text-[11px] text-muted-foreground w-8 shrink-0">€/{priceUnit}</span>
                        <button
                          type="button"
                          onClick={() => mutateTarifs((cur) => cur.filter((x) => x.itemCode !== t.itemCode))}
                          title="Retirer cet article du tarif"
                          className="shrink-0 text-muted-foreground/50 hover:text-rose-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        </div>
        )}
      </div>

      {/* ── Colonne PANIER — dominante et ÉLARGIE (Écran 2 = saisie commande au
             cœur). Empilée sous le stock en dessous de xl (tablette) : pleine
             largeur, plafonnée à ~55 % de la hauteur, liste scrollable. ── */}
      <div className="w-full xl:w-[640px] shrink-0 min-h-0 max-h-[55%] xl:max-h-none flex flex-col panel p-3">
        <div
          onDoubleClick={(e) => {
            // Double-clic sur l'EN-TÊTE (pas les boutons) → ouvre le RÉCAP en grand
            // (popup par-dessus tout). Fermeture : fond, croix ou Échap.
            if ((e.target as HTMLElement).closest("button, input, select, a")) return;
            if (cart.length > 0) setOrderFullscreen(true);
          }}
          title="Double-cliquez pour afficher le récapitulatif de la commande en grand"
          className="flex items-center justify-between gap-2 mb-2 shrink-0 cursor-pointer select-none"
        >
          <p className="kicker inline-flex items-center gap-1.5 min-w-0">
            {/* En modification : nom du client + n° de BL + date de livraison,
                à gauche du caddie — le BL s'identifie d'un coup d'œil. En saisie
                neuve (pas de BL encore), on garde « Commande ». */}
            <ShoppingCart className="h-3 w-3 shrink-0" />
            {modif ? (
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <span className="truncate max-w-[220px] text-foreground">{clientName}</span>
                <span className="text-muted-foreground/50" aria-hidden>·</span>
                <span className="shrink-0">BL&nbsp;#&nbsp;{modif.docNum}</span>
                {modifMeta?.dueDate && (
                  <span className="shrink-0 font-normal text-muted-foreground">
                    · {new Date(modifMeta.dueDate).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
                  </span>
                )}
              </span>
            ) : "Commande"}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* VENTE SOFRUCE (marché) — en haut à droite : un seul geste crée
                l'ACHAT Sofruce (EM) puis la VENTE sur son lot. Décochée/grisée en
                bon de commande, précommande ou modification. */}
            {!modif && (
              <label
                title={isBonCommande
                  ? "Vente Sofruce : uniquement en BL direct (pas de bon de commande ni de précommande)"
                  : "Vente Sofruce : à la validation, crée d'abord l'entrée marchandise fournisseur Sofruce (mêmes articles/quantités), puis la vente sur ce lot. Renseigne les prix d'achat dans le bandeau qui s'affiche."}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 h-8 text-[11.5px] select-none ${isBonCommande ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${
                  venteSofruce ? "border-violet-400/60 bg-violet-500/10 text-violet-700 dark:text-violet-300" : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <input type="checkbox" checked={venteSofruce} disabled={isBonCommande}
                  onChange={(e) => setVenteSofruce(e.target.checked)}
                  className="h-3.5 w-3.5 accent-violet-600" />
                <span className="font-semibold whitespace-nowrap">Vente Sofruce</span>
              </label>
            )}
            {/* Raccourcis produits personnalisables (ajout direct au panier) */}
            <OrderShortcuts onPick={addByShortcut} />
            {/* Dupliquer la DERNIÈRE commande — ICÔNE SEULE, à droite des raccourcis. */}
            {!modif && (
              <button
                type="button" onClick={replayLast} disabled={replaying || prefilling}
                aria-label="Dupliquer la dernière commande"
                title="Dupliquer la dernière commande du client dans le panier (quantités + prix)"
                className="inline-flex items-center justify-center h-8 w-8 shrink-0 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
              >
                {replaying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </div>
        {/* VENTE SOFRUCE — prix d'ACHAT par article (même unité que le prix de
            vente). Vide = l'achat part au prix de vente (marge 0). L'EM Sofruce
            est créée à la validation, juste avant la vente. */}
        {venteSofruce && !modif && cart.length > 0 && (
          <div className="mb-2 shrink-0 rounded-lg border border-violet-400/50 bg-violet-500/5 px-2.5 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              Achat Sofruce — prix d&apos;achat unitaire
            </p>
            <div className="mt-1.5 space-y-1">
              {cart.map((l) => (
                <div key={l.itemCode} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="min-w-0 truncate text-foreground">{l.itemName}</span>
                  <span className="inline-flex items-center gap-1 shrink-0">
                    <input
                      type="text" inputMode="decimal"
                      value={sofrucePA[l.itemCode] ?? ""}
                      onChange={(e) => setSofrucePA((prev) => ({ ...prev, [l.itemCode]: e.target.value }))}
                      placeholder={hints[l.itemCode]?.prixAchat != null ? hints[l.itemCode]!.prixAchat!.toFixed(2) : "= prix vente"}
                      aria-label={`Prix d'achat ${l.itemName}`}
                      className="h-7 w-24 rounded-md border border-border bg-background px-2 text-right tnum"
                    />
                    <span className="text-muted-foreground">€</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              Vide = prix de vente (marge 0). À la validation : EM Sofruce puis vente sur son lot.
            </p>
          </div>
        )}
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
            const locked = !!l.originalLine?.closed; // ligne déjà livrée → verrouillée
            // Saisie AU COLIS : le panier stocke `quantity` (en unité de base via
            // packDivisor — kg/pie) ; on SAISIT en colis et on AFFICHE la conversion
            // en unité de base. `baseUnitsPerColis` = stepColis × packDivisor (ex.
            // 4 kg, 12 pie). Article sans colis réel (=1) → saisie en unité de base.
            const baseUnitsPerColis = Math.round(l.stepColis * l.packDivisor * 1000) / 1000;
            const hasColis = baseUnitsPerColis > 1;
            const baseQty = Math.round(l.quantity * l.packDivisor * 100) / 100;
            const colisCount = hasColis ? Math.round((l.quantity / l.stepColis) * 100) / 100 : baseQty;
            const freeColis = hasColis
              ? Math.round((l.freeUnits / l.stepColis) * 100) / 100
              : Math.round(l.freeUnits * l.packDivisor * 100) / 100;
            // #12 — Plafond SOUPLE anti-saisie aberrante, exprimé dans l'unité
            // AFFICHÉE du champ (colis si hasColis, sinon unité de base). On
            // confirme au-delà de 200 colis OU de 50× le stock dispo connu (>0).
            // `max` est en unité de base / packDivisor ; on le convertit dans
            // l'unité du champ pour comparer des grandeurs homogènes.
            const SOFT_CAP_COLIS = 200;
            const availInField = hasColis
              ? (max * l.packDivisor) / l.stepColis   // base/packDiv → colis
              : max * l.packDivisor;                  // base/packDiv → unité de base
            const absoluteCap = hasColis ? SOFT_CAP_COLIS : SOFT_CAP_COLIS * baseUnitsPerColis;
            const relativeCap = availInField > 0 ? availInField * 50 : Infinity;
            const lineSoftMax = Math.min(absoluteCap, relativeCap);
            const fieldUnitLabel = hasColis ? "colis" : l.priceUnit;
            // Garde anti-aberration : confirme une grosse saisie (sans bloquer).
            const guardBigQty = (typed: number) => {
              if (confirmedBigQty.has(l.itemCode)) return;   // déjà confirmé pour cette ligne
              const rounded = Math.round(typed * 100) / 100;
              const cap = Math.round(lineSoftMax * 100) / 100;
              toast.warning(`Confirmer ${rounded} ${fieldUnitLabel} pour ${l.itemName} ?`, {
                description: "Quantité inhabituellement élevée — vérifie qu'il n'y a pas d'erreur de saisie.",
                duration: 12000,
                action: {
                  label: "Oui, c'est correct",
                  onClick: () => { confirmedBigQty.add(l.itemCode); },
                },
                cancel: {
                  label: "Corriger",
                  onClick: () => {
                    // Revient au plafond souple (dans l'unité de base stockée).
                    const backBase = hasColis ? cap * l.stepColis : cap / l.packDivisor;
                    updateLine(i, { quantity: Math.round(backBase * 1000) / 1000 });
                  },
                },
              });
            };
            return (
              <Fragment key={i}>
                {/* Interstice AVANT cette ligne — déposer ici = insérer à cette place. */}
                <CartDropGap
                  show={dragLine !== null && dragLine !== i}
                  highlighted={overLine === `gap:${i}`}
                  onOver={() => setOverLine(`gap:${i}`)}
                  onDrop={() => { if (dragLine !== null) moveLineBefore(dragLine, i); endLineDrag(); }}
                />
                <div
                  draggable={!locked}
                  onDragStart={(e) => {
                    // Toute la tuile est saisissable — SAUF les champs/boutons, qui
                    // gardent leur comportement natif (focus, sélection, clic).
                    const el = e.target as HTMLElement;
                    if (locked || el.closest("input, select, textarea, button, a")) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.effectAllowed = "move";
                    setDragLine(i);
                  }}
                  onDragEnd={endLineDrag}
                  onContextMenu={(e) => {
                    // Clic droit = MENU de ligne : 2ᵉ ligne du même article / remplacer.
                    const el = e.target as HTMLElement;
                    if (el.closest("input, select, textarea")) return;   // menu natif dans les champs
                    e.preventDefault();
                    if (locked) return;
                    setLineMenu({ x: e.clientX, y: e.clientY, index: i });
                  }}
                  onDragOver={(e) => { if (dragLine !== null && dragLine !== i) { e.preventDefault(); setOverLine(`row:${i}`); } }}
                  onDrop={(e) => { if (dragLine !== null && dragLine !== i) { e.preventDefault(); swapLine(dragLine, i); } endLineDrag(); }}
                  title="Glisser la tuile pour réordonner · clic droit : ajouter une ligne du même article, ou remplacer l'article"
                  className={`rounded-lg border p-2 transition-all duration-150 ${!locked ? "cursor-grab active:cursor-grabbing" : ""} ${
                    dragLine === i ? "opacity-40" : ""
                  } ${
                    overLine === `row:${i}` ? "ring-2 ring-brand-500 ring-offset-1 ring-offset-background" : ""
                  } ${sellShort ? "border-rose-400/60 bg-rose-50/40 dark:bg-rose-950/15" : "border-border"}`}
                >
                <div className="flex items-start justify-between gap-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-x-1.5 gap-y-1 flex-wrap">
                      <p className="text-[14px] font-medium text-foreground shrink-0">{l.itemName}</p>
                      {sellShort && (
                        <span className="inline-flex h-5 items-center px-1.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                          À DÉCOUVERT
                        </span>
                      )}
                      {/* C2 — promo PAR LIGNE, jamais imposée : appliquer/retirer en 1 clic
                          (badge actif = clic pour retirer ; sinon chip discret si une promo
                          existe pour l'article). Marche aussi sur les lignes déjà au BL. */}
                      {l.promo ? (
                        <button type="button" onClick={() => togglePromo(i)} title="Retirer la promotion"
                          className="inline-flex h-5 items-center gap-1 px-1.5 rounded text-[11px] font-bold bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-400/60 dark:bg-rose-500/30 dark:text-rose-100 dark:ring-rose-400/50 hover:bg-rose-200 dark:hover:bg-rose-500/40">
                          {promoBadge(l.promo)} <X className="h-2.5 w-2.5" />
                        </button>
                      ) : (promos[l.itemCode] && !locked) ? (
                        <button type="button" onClick={() => togglePromo(i)} title="Appliquer la promotion"
                          className="inline-flex h-5 items-center gap-1 px-1.5 rounded text-[11px] font-semibold border border-dashed border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-950/30">
                          <Megaphone className="h-2.5 w-2.5" /> {promoBadge(promos[l.itemCode])}
                        </button>
                      ) : null}
                      {/* Modification : ligne déjà LIVRÉE → verrouillée (ni édition ni retrait) */}
                      {locked && (
                        <>
                          <span
                            className="inline-flex h-5 items-center gap-1 px-1.5 rounded text-[11px] font-bold bg-muted text-muted-foreground">
                            <Lock className="h-3 w-3" /> livré
                          </span>
                          <InfoHint label="Ligne livrée" size={14}>
                            Ligne déjà livrée — verrouillée
                          </InfoHint>
                        </>
                      )}
                      {/* Tags désignation — inline à droite du libellé (lignes compactes, code masqué) */}
                      {(() => {
                        const calibreRaw = cleanTag(hints[l.itemCode]?.calibre);
                        const calibre = calibreRaw ? `cal. ${calibreRaw}` : null;
                        const marque = cleanTag(l.marque);
                        const condi = cleanTag(l.condi);
                        const variete = cleanTag(l.variete);
                        const pays = cleanTag(l.pays);
                        const chips = [
                          marque && ["bg-violet-100 text-violet-800 dark:bg-violet-500/30 dark:text-violet-100", marque],
                          condi && ["bg-sky-100 text-sky-800 dark:bg-sky-500/30 dark:text-sky-100", condi],
                          calibre && ["bg-teal-100 text-teal-800 dark:bg-teal-500/30 dark:text-teal-100", calibre],
                          variete && ["bg-rose-100 text-rose-800 dark:bg-rose-500/30 dark:text-rose-100", variete],
                          pays && ["bg-amber-100 text-amber-800 dark:bg-amber-500/30 dark:text-amber-100", pays],
                        ].filter(Boolean) as [string, string][];
                        return chips.map(([cls, txt], ci) => (
                          <span key={ci} className={`inline-flex items-center px-1.5 py-px rounded-[5px] text-[10.5px] font-semibold ${cls}`}>{txt}</span>
                        ));
                      })()}
                    </div>
                  </div>
                  {/* Actions de ligne : réordonner (flèches ; la tuile entière est
                      glissable) + supprimer (sauf ligne livrée). L'ordre du panier =
                      l'ordre des lignes du BL, à la création comme en modification. */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <div className="flex flex-col -my-0.5">
                      <button type="button" tabIndex={-1} onClick={() => moveLine(i, -1)} disabled={i === 0}
                        aria-label="Monter la ligne" title="Monter"
                        className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 leading-none">
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" tabIndex={-1} onClick={() => moveLine(i, 1)} disabled={i === cart.length - 1}
                        aria-label="Descendre la ligne" title="Descendre"
                        className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 leading-none">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {!locked && (
                      <button type="button" onClick={() => removeLine(i)} className="text-muted-foreground/50 hover:text-rose-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className={`flex items-center gap-1.5 mt-1.5 ${locked ? "opacity-60" : ""}`}>
                  {/* On SAISIT au colis (−/+ avancent d'un colis) et on AFFICHE la
                      conversion en unité de base : « 9 colis (36 kg) × 7.20 ».
                      Article sans colis réel → saisie directe en unité de base. */}
                  <div className="inline-flex items-center rounded-lg border border-border overflow-hidden shrink-0">
                    <button
                      type="button" tabIndex={-1} disabled={locked}
                      onClick={() => updateLine(i, { quantity: Math.max(0, Math.round((l.quantity - l.stepColis) * 1000) / 1000) })}
                      aria-label="Retirer un colis"
                      className="h-11 w-9 inline-flex items-center justify-center text-[18px] font-bold text-muted-foreground hover:bg-secondary/60 active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent"
                    >−</button>
                    <NumberInput value={hasColis ? colisCount : baseQty}
                      onValueChange={(n) => updateLine(i, { quantity: hasColis ? Math.round((n ?? 0) * l.stepColis * 1000) / 1000 : (n ?? 0) / l.packDivisor })}
                      min={0} step={hasColis ? 1 : baseUnitsPerColis} disabled={locked}
                      softMax={lineSoftMax} onSoftMaxExceeded={guardBigQty}
                      aria-label={`Quantité ${l.itemName} (en ${hasColis ? "colis" : l.priceUnit})`}
                      className={`h-11 w-[64px] text-center text-[17px] font-semibold tnum border-x border-border bg-background px-1 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 ${over ? "text-amber-600 dark:text-amber-400" : ""}`} />
                    <button
                      type="button" tabIndex={-1} disabled={locked}
                      onClick={() => updateLine(i, { quantity: Math.round((l.quantity + l.stepColis) * 1000) / 1000 })}
                      aria-label="Ajouter un colis"
                      className="h-11 w-9 inline-flex items-center justify-center text-[18px] font-bold text-brand-600 dark:text-brand-400 hover:bg-secondary/60 active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent"
                    >+</button>
                  </div>
                  {hasColis ? (
                    <span className="text-[12px] text-muted-foreground whitespace-nowrap">
                      colis <span className="text-[13.5px] font-semibold text-foreground tnum">({baseQty}&nbsp;{l.priceUnit})</span>
                    </span>
                  ) : (
                    <span className="text-[12px] text-muted-foreground w-9">{l.priceUnit}</span>
                  )}
                  <span className="text-muted-foreground">×</span>
                  <NumberInput value={l.price} onValueChange={(n) => updateLine(i, { price: n })}
                    min={0} step={0.1} decimals={2} allowEmpty placeholder="prix" disabled={locked}
                    aria-label={`Prix ${l.itemName}`}
                    className="h-11 w-[84px] text-right text-[17px] font-semibold tnum rounded-lg border border-border bg-background px-2 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500" />
                  <span className="text-[12px] text-muted-foreground">€/{l.priceUnit}</span>
                  <span className="ml-auto text-[15px] font-bold tnum">{l.price ? lineHT(l).toFixed(2) : "—"}</span>
                </div>
                {/* Colis OFFERTS — lecture seule : non modifiable directement (piloté par
                    les promotions ; X+Y / FREE l'ajoutent automatiquement). */}
                {l.freeUnits > 0 && (
                  <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-rose-600 dark:text-rose-400">
                    <Gift className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium">
                      {freeColis} {hasColis ? "colis" : l.priceUnit} offert{freeColis > 1 ? "s" : ""}
                    </span>
                    {hasColis && (
                      <span className="text-foreground/50 tnum">({Math.round(l.freeUnits * l.packDivisor * 100) / 100} {l.priceUnit})</span>
                    )}
                    <span className="text-muted-foreground">· promo</span>
                  </div>
                )}
                {sellShort ? (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">
                    ⚠️ Stock = 0. Lot affecté à la prochaine entrée marchandise.
                  </p>
                ) : partialShort ? (
                  <p className="text-[11px] text-amber-600 mt-1">⚠️ {max} dispo seulement (le surplus sera à découvert)</p>
                ) : null}
                {/* GARDE-FOUS — anomalies de CETTE ligne (prix / volume), en direct.
                    Ambre = « Avertir » (confirmable) · rouge = BLOQUANT. */}
                {(safeguards.byLine.get(i) ?? []).map((v, vi) => (
                  <p key={`sg-${vi}`} className={`flex items-start gap-1 text-[11px] mt-1 ${
                    v.severity === "block"
                      ? "text-rose-600 dark:text-rose-400 font-semibold"
                      : "text-amber-600 dark:text-amber-400"
                  }`}>
                    <ShieldAlert className="h-3 w-3 shrink-0 mt-0.5" />
                    <span>{v.message}{v.severity === "block" ? " — bloquant" : ""}</span>
                  </p>
                ))}
                {/* Bon de commande : CHOIX DU LOT avant l'envoi (« valider propre »).
                    Seuls les lots avec du stock physique TeleVent sont proposés ;
                    « à affecter » = EM_PENDING, réglé plus tard dans l'onglet dédié. */}
                {isBonCommande && !locked && (
                  <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-dashed border-border/60">
                    <span className="text-[11px] text-muted-foreground shrink-0">Lot :</span>
                    <ConsoleLotPicker
                      itemName={l.itemName}
                      current={l.lot ?? null}
                      candidates={lotCands[l.itemCode]?.candidates ?? []}
                      suggested={lotCands[l.itemCode]?.suggested ?? null}
                      onPick={(lot) => updateLine(i, { lot })}
                    />
                  </div>
                )}
                </div>
              </Fragment>
            );
          })}
          {/* Interstice de FIN — déposer ici = placer la ligne en dernier. */}
          {dragLine !== null && (
            <CartDropGap
              show
              highlighted={overLine === "end"}
              onOver={() => setOverLine("end")}
              onDrop={() => { moveLineBefore(dragLine, null); endLineDrag(); }}
            />
          )}
        </div>

        {/* Pied : date, mode, n° cmd, total, créer */}
        <div className="shrink-0 pt-2 mt-2 border-t border-border space-y-2">
          {/* En modification, le BL existe déjà : mode/transporteur/date/réf sont figés. */}
          {!modif && (
            <>
              {/* SÉLECTION UNIQUE : transporteur OU compte de livraison (LPOI,
                  SCACHAP…) dans le MÊME sélecteur — choisir un compte fait
                  partir le bon sur ce compte SAP ; choisir un transporteur
                  ramène le bon sur le compte par défaut du client. */}
              {(() => {
                const needsTournee = !!carrierSap && tournees !== undefined && tournees.some((t) => t.heure);
                const missingCarrier = !carrierSap;
                const missingTournee = needsTournee && !tourneeId;
                const warnCls = "border-amber-400/70 bg-amber-50/50 dark:bg-amber-950/20";
                const defaultMode = deliveryModes.find((m) => m.isDefault) ?? deliveryModes[0];
                const accountModes = deliveryModes.filter((m) => !m.isDefault);
                const activeAccount = accountModes.find((m) => m.id === deliveryModeId) ?? null;
                // Valeur combinée : compte non-défaut sélectionné → « m:<id> »,
                // sinon le transporteur courant → « c:<code> ».
                const combined = activeAccount ? `m:${activeAccount.id}` : (carrierSap ? `c:${carrierSap}` : "");
                const onCombined = (v: string) => {
                  if (v.startsWith("m:")) {
                    onDeliveryModeChange?.(v.slice(2));
                  } else if (v.startsWith("c:")) {
                    if (defaultMode) onDeliveryModeChange?.(defaultMode.id);
                    setCarrierSap(v.slice(2));
                  }
                };
                return (
                  <div className="flex gap-1.5">
                    <select value={combined} onChange={(e) => onCombined(e.target.value)}
                      aria-label="Transporteur ou compte de livraison"
                      title="Transporteur du bon (défaut du client pré-sélectionné) — ou compte sur lequel le bon doit partir (LPOI, SCACHAP…)"
                      className={`min-w-0 flex-1 h-9 rounded-md border bg-background text-[13.5px] px-2 ${
                        missingCarrier && !activeAccount ? warnCls : "border-border"}`}>
                      <option value="" disabled>🚚 Transporteur…</option>
                      {/* B3 — count présent quand la liste est filtrée par client (habitudes) */}
                      {carriers.map((c) => (
                        <option key={c.id} value={`c:${c.sapValue}`}>
                          🚚 {c.name}{c.count ? ` · ${c.count} cde${c.count > 1 ? "s" : ""}` : ""}
                        </option>
                      ))}
                      {accountModes.length > 0 && (
                        <optgroup label="Livré sur un autre compte">
                          {accountModes.map((m) => (
                            <option key={m.id} value={`m:${m.id}`}>
                              🏬 Compte {m.name} ({m.sapCardCode})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <select value={tourneeId} onChange={(e) => setTourneeId(e.target.value)}
                      disabled={!carrierSap || tournees === undefined || (tournees !== undefined && !needsTournee)}
                      aria-label="Tournée"
                      title={!carrierSap ? "Choisis d'abord le transporteur"
                        : tournees === undefined ? "Chargement des tournées…"
                        : needsTournee ? "Tournée du bon (fixe l'heure, mémorisée pour le client)"
                        : "Aucune tournée définie pour ce transporteur"}
                      className={`min-w-0 flex-1 h-9 rounded-md border bg-background text-[13.5px] px-2 disabled:opacity-60 ${
                        missingTournee ? warnCls : "border-border"}`}>
                      <option value="" disabled>
                        {!carrierSap ? "Tournée…"
                          : tournees === undefined ? "Chargement…"
                          : needsTournee ? "Tournée…" : "Aucune tournée définie"}
                      </option>
                      {(tournees ?? []).filter((t) => t.heure).map((t) => (
                        <option key={t.lineId} value={String(t.lineId)}>
                          {t.nom}{t.des ? ` (${t.des})` : ""} — {(t.heure as string).slice(0, 5)}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })()}
              {/* Date de livraison SANS heure (l'heure est portée par la TOURNÉE)
                  + bascule « Bon de commande » COMPACTE sur la même rangée. */}
              <div className="flex gap-1.5">
                <input type="date" value={deliveryDate.slice(0, 10)} onChange={(e) => setDeliveryDate(e.target.value)}
                  aria-label="Date de livraison"
                  className="min-w-0 flex-1 h-9 rounded-md border border-border bg-background text-[13px] px-2" />
                {/* Bon de commande (aucun auto-lot, lots affectés plus tard) — compact.
                    Forcé (coché + verrouillé) si précommande OU article à découvert. */}
                <label
                  title={hasDecouvert
                    ? "Article à découvert (stock insuffisant) → forcé en bon de commande : il ne réserve pas de stock et se validera automatiquement en commande à la réception"
                    : precommande
                    ? "Livraison au-delà du prochain jour livrable → précommande : créée en bon de commande (lots affectés plus tard)"
                    : "Créer en bon de commande : aucun lot automatique, tu affectes les lots ensuite dans l'onglet Bons de commande"}
                  className={`shrink-0 inline-flex items-center gap-1.5 rounded-md border px-2 h-9 text-[11.5px] select-none ${precommande || hasDecouvert ? "cursor-default" : "cursor-pointer"} ${
                    isBonCommande ? "border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <input type="checkbox" checked={isBonCommande} disabled={precommande || hasDecouvert}
                    onChange={(e) => setBonCommandeManual(e.target.checked)}
                    className="h-3.5 w-3.5 accent-amber-600" />
                  <span className="font-semibold whitespace-nowrap">Bon de commande</span>
                </label>
              </div>
            </>
          )}
          {/* Réf. client + note du BL : déplacées en tête du bloc gauche
              (cf. colonne stock) — plus au pied de la commande. */}
          {/* Total HT : porté sur le bouton d'action (plus de ligne dédiée). */}
          {/* Indicateur de marge — prix transport /kg en haut à droite + bascule
              /livraison ↔ /kg. MARGE NETTE en gros en bas (feu tricolore : rouge
              = à perte, orange < 10 % net, vert ≥ 10 %). */}
          {cart.length > 0 && (transportPerKg > 0 || hasCostData) && (() => {
            const TONE = {
              rose: "text-rose-600 dark:text-rose-400",
              amber: "text-amber-600 dark:text-amber-400",
              emerald: "text-emerald-600 dark:text-emerald-400",
            } as const;
            const RING = {
              rose: "border-rose-300/60 bg-rose-50/60 dark:border-rose-500/40 dark:bg-rose-950/20",
              amber: "border-amber-300/60 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-950/20",
              emerald: "border-emerald-300/60 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-950/20",
            } as const;
            const isPos = marginUnit === "position";
            const fmtE = (v: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v)} €`;
            const fmtK = (v: number) => `${v.toFixed(3)} €/kg`;
            // Vue /kg : « n.c. » si aucune ligne n'a de poids connu (sinon 0,000 €/kg trompeur).
            const kgTxt = (v: number) => (hasKgData ? fmtK(v) : "n.c.");
            // Marge MASQUÉE (épaule) : les montants de marge deviennent « ••• ».
            // Le feu tricolore reste (filet anti-vente à perte, sans chiffre).
            const m = (txt: string) => (hideMargin ? "•••" : txt);
            const transpTxt = transportPerKgClient > 0 || carrierIsDirect
              ? (isPos ? fmtE(coutTransportTotal) : fmtK(transportPerKgClient))
              : "externe n.c.";
            return (
            <div className={`mt-1 rounded-lg border px-2.5 py-2 ${hasCostData ? RING[netTone] : "border-border/60 bg-secondary/20"}`}>
              {/* Haut : libellé + bascule /livraison ↔ /kg + prix transport /kg à droite */}
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1">
                  <span className="uppercase tracking-wide font-semibold text-muted-foreground">Marge nette transport</span>
                  <InfoHint label="Feu tricolore" size={14}>
                    {"Feu : rouge = à perte, orange < 10 % de marge nette, vert ≥ 10 %."}
                  </InfoHint>
                </span>
                <div className="flex items-center gap-2">
                  {/* Masquer la marge (regard par-dessus l'épaule) — persistant par poste. */}
                  <button
                    type="button" onClick={toggleHideMargin}
                    aria-label={hideMargin ? "Afficher la marge" : "Masquer la marge"}
                    title={hideMargin ? "Afficher la marge" : "Masquer la marge (regard par-dessus l'épaule) — le feu tricolore reste"}
                    className="inline-flex items-center justify-center h-5 w-5 rounded border border-border/60 text-muted-foreground hover:text-foreground"
                  >
                    {hideMargin ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                  <div className="inline-flex rounded-md border border-border/60 overflow-hidden text-[10.5px] font-semibold">
                    <button type="button" onClick={() => setMarginUnit("position")} className={`px-1.5 h-5 ${isPos ? "bg-brand-500/20 text-brand-700 dark:text-brand-300" : "text-muted-foreground hover:text-foreground"}`}>/livr.</button>
                    <button type="button" onClick={() => setMarginUnit("kg")} className={`px-1.5 h-5 ${!isPos ? "bg-brand-500/20 text-brand-700 dark:text-brand-300" : "text-muted-foreground hover:text-foreground"}`}>/kg</button>
                  </div>
                  <span className="inline-flex items-center gap-1 text-muted-foreground whitespace-nowrap">
                    <Truck className="h-3 w-3" />
                    <b className="tnum text-foreground">
                      {positionCost
                        ? `${positionCost.total.toFixed(2)} €/pos. (${positionCost.bracket.minKg}–${positionCost.bracket.maxKg ?? "∞"} kg)`
                        : transportPerKgClient > 0 ? `${transportPerKgClient.toFixed(3)} €/kg` : (carrierIsDirect ? "0 €/kg" : "n.c.")}
                    </b>
                  </span>
                </div>
              </div>
              {hasCostData ? (
                <>
                  {/* Détail : coût transport + marge brute (unité choisie) */}
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
                    <span>Transport <b className="tnum text-foreground">{transpTxt}</b></span>
                    <span>Marge brute <b className="tnum text-foreground">{m(isPos ? fmtE(margeBruteTotal) : kgTxt(margeBruteKg))}</b></span>
                  </div>
                  {/* Bas : marge nette en GROS, colorée */}
                  <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-border/40 pt-1">
                    <span className="text-[11px] font-medium text-foreground">{isPos ? "Marge nette livraison" : "Marge nette /kg"}</span>
                    <span className="inline-flex items-baseline gap-1.5">
                      <span className={`tnum font-extrabold text-[21px] leading-none ${TONE[netTone]}`}>{m(isPos ? fmtE(margeNetteTotal) : kgTxt(margeNetteKg))}</span>
                      {(isPos || hasKgData) && !hideMargin && <span className={`tnum font-bold text-[13px] ${TONE[netTone]}`}>{margeNettePct.toFixed(1)} %</span>}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-[10.5px] text-muted-foreground/70 mt-1">
                  {isPos ? `Transport ${transpTxt}` : `Transport ${transpTxt}`} · marge indisponible (prix d&apos;achat manquant).
                </p>
              )}
            </div>
            );
          })()}
          {/* GARDE-FOUS — récap des anomalies (lignes + commande) avant validation.
              Ambre = « Avertir » (confirmable) · rouge = BLOQUANT (envoi refusé). */}
          {safeguards.all.length > 0 && (
            <div className={`mt-1 rounded-lg border px-2.5 py-2 ${
              sgSplit.blocks.length > 0
                ? "border-rose-300/60 bg-rose-50/60 dark:border-rose-500/40 dark:bg-rose-950/20"
                : "border-amber-300/60 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-950/20"
            }`}>
              <p className={`flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold ${
                sgSplit.blocks.length > 0 ? "text-rose-700 dark:text-rose-300" : "text-amber-700 dark:text-amber-300"
              }`}>
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                Garde-fous · {safeguards.all.length} alerte{safeguards.all.length > 1 ? "s" : ""}
                {sgSplit.blocks.length > 0 && <span className="font-bold">dont {sgSplit.blocks.length} bloquante{sgSplit.blocks.length > 1 ? "s" : ""}</span>}
              </p>
              <ul className="mt-1 space-y-0.5">
                {safeguards.all.map((v, vi) => (
                  <li key={vi} className={`text-[11.5px] leading-snug ${
                    v.severity === "block"
                      ? "text-rose-700 dark:text-rose-300 font-semibold"
                      : "text-amber-800/90 dark:text-amber-200/90"
                  }`}>
                    • {v.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Envoi en ARRIÈRE-PLAN : le clic libère la vue (client suivant),
              le résultat SAP arrive en toast au nom du client. */}
          <button type="button" onClick={() => submit()}
            disabled={prefilling || cart.length === 0 || (!!modif && modifMeta?.editable === false)}
            title={modif ? "Enregistrer en arrière-plan — l'écran passe au client suivant" : "Créer en arrière-plan — l'écran passe au client suivant"}
            className={`w-full h-11 rounded-xl disabled:opacity-50 text-white text-[15px] font-semibold inline-flex items-center justify-center gap-2 px-3 ${
              modif ? "bg-amber-600 hover:bg-amber-700" : "bg-emerald-600 hover:bg-emerald-700"
            }`}>
            <ShoppingCart className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {modif
                ? `Enregistrer le BL # ${modif.docNum}`
                : isBonCommande
                ? `Créer le bon de commande (${cart.length})`
                : `Créer la commande (${cart.length})`}
            </span>
            {/* Total HT estimé porté sur le bouton (remplace la ligne dédiée). */}
            {cart.length > 0 && (
              <span className="ml-auto pl-2 tnum font-bold whitespace-nowrap border-l border-white/25">
                {totalHT.toFixed(2)} € HT
              </span>
            )}
          </button>
        </div>
      </div>
      </div>{/* /flex deux colonnes */}


      {/* ── Menu contextuel d'une ligne du BL (clic droit) ── */}
      {lineMenu && cart[lineMenu.index] && (
        <div
          role="menu"
          aria-label={`Actions sur ${cart[lineMenu.index].itemName}`}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            left: Math.max(8, Math.min(lineMenu.x, window.innerWidth - 268)),
            top: Math.max(8, Math.min(lineMenu.y, window.innerHeight - 132)),
          }}
          className="fixed z-[95] w-[260px] rounded-xl border border-border bg-card shadow-modal p-1"
        >
          <p className="px-2.5 py-1.5 text-[11px] text-muted-foreground truncate border-b border-border/60 mb-1">
            {cart[lineMenu.index].itemName}
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={() => { duplicateLine(lineMenu.index); setLineMenu(null); }}
            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-secondary/60 transition-colors"
          >
            <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
              <CopyPlus className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400 shrink-0" />
              Ajouter une ligne du même article
            </span>
            <span className="block pl-[22px] text-[10.5px] text-muted-foreground">
              2 lignes du même produit — pour une valorisation différente
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setSwapQuery(""); setSwapFor(lineMenu.index); setLineMenu(null); }}
            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-secondary/60 transition-colors"
          >
            <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
              <ArrowRightLeft className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400 shrink-0" />
              Remplacer l&apos;article…
            </span>
            <span className="block pl-[22px] text-[10.5px] text-muted-foreground">
              Quantité et prix conservés
            </span>
          </button>
        </div>
      )}

      {/* ── Translation d'article (menu clic droit sur une ligne du BL) ── */}
      <Dialog open={swapFor !== null} onOpenChange={(o) => { if (!o) { setSwapFor(null); setSwapQuery(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[16px]">
              <ArrowRightLeft className="h-4 w-4 text-brand-600 dark:text-brand-400" /> Remplacer l&apos;article
            </DialogTitle>
            <DialogDescription className="text-[12.5px]">
              {swapFor !== null && cart[swapFor] ? (
                <>Remplace <b className="text-foreground">{cart[swapFor].itemName}</b> par un autre article —
                la quantité ({cart[swapFor].quantity} {cart[swapFor].unit}) et le prix
                {cart[swapFor].price != null ? ` (${cart[swapFor].price!.toFixed(2)} €/${cart[swapFor].priceUnit})` : ""} sont conservés.</>
              ) : "Choisis l'article de remplacement."}
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={swapQuery}
              onChange={(e) => setSwapQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && swapResults[0]) { e.preventDefault(); doSwap(swapResults[0]); } }}
              placeholder="Chercher l'article de remplacement…"
              className="w-full h-10 pl-9 pr-2 rounded-md border border-border bg-background text-[14px] focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <ul className="max-h-[320px] overflow-y-auto divide-y divide-border/40 rounded-lg border border-border">
            {swapResults.map((p) => {
              const { packDivisor, displayUnit } = unitInfo(p.salesUnit, p.salesQtyPerPackUnit);
              const total = ["R1", "01", "000"].reduce((s, w) => s + (p.stockByWarehouse[w]?.available ?? 0), 0) / packDivisor;
              const already = cart.some((l, k) => k !== swapFor && l.itemCode === p.itemCode);
              return (
                <li key={p.itemCode}>
                  <button
                    type="button"
                    disabled={already}
                    onClick={() => doSwap(p)}
                    className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-secondary/40 disabled:opacity-40 transition-colors"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium text-foreground truncate">{p.itemName}</span>
                      <span className="block font-mono text-[10.5px] text-muted-foreground/70">{p.itemCode}</span>
                    </span>
                    <span className={`shrink-0 text-[12px] font-semibold tnum ${total <= 0 ? "text-rose-500" : "text-muted-foreground"}`}>
                      {total <= 0 ? "à découvert" : `${Math.floor(total)} ${displayUnit}`}
                    </span>
                  </button>
                </li>
              );
            })}
            {swapResults.length === 0 && (
              <li><p className="px-3 py-2.5 text-[12.5px] text-muted-foreground italic">Aucun article ne correspond.</p></li>
            )}
          </ul>
        </DialogContent>
      </Dialog>

      {/* Menu clic droit d'une ligne produit : Détails (lots) · Tout mettre. */}
      <ContextMenu menu={rowMenu} onClose={closeRowMenu}
        header={menuTarget && <ContextMenuLabel>{menuTarget.p.itemName}</ContextMenuLabel>}>
        <ContextMenuItem icon={Boxes} onClick={() => {
          if (menuTarget) setLotDetail({ id: menuTarget.p.id, code: menuTarget.p.itemCode, name: menuTarget.p.itemName, dispo: menuTarget.dispo, unit: menuTarget.unit, packDivisor: menuTarget.packDivisor });
          closeRowMenu();
        }}>
          Détails (lots en stock)
        </ContextMenuItem>
        <ContextMenuItem icon={ListPlus} accent="success" onClick={() => {
          if (menuTarget) addToCart(menuTarget.p, { quantity: menuTarget.fullQty > 0 ? menuTarget.fullQty : undefined });
          closeRowMenu();
        }}>
          Tout mettre{menuTarget && menuTarget.fullQty > 0 ? ` (${menuTarget.fullQty})` : ""}
        </ContextMenuItem>
      </ContextMenu>

      {/* Détail des lots (clic droit → « Détails »). */}
      <LotDetailsDialog item={lotDetail} onClose={() => setLotDetail(null)} />

      {/* GARDE-FOUS — dialogue de confirmation (règles en mode « Avertir ») :
          liste des anomalies + « Valider quand même » (renvoie confirmSafeguards
          au serveur) ou « Corriger » (retour au panier, rien n'est envoyé). */}
      <Dialog open={sgConfirmOpen} onOpenChange={setSgConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[16px]">
              <ShieldAlert className="h-4.5 w-4.5 text-amber-500" />
              Garde-fous — vérifie avant d&apos;envoyer
            </DialogTitle>
            <DialogDescription className="text-[12.5px]">
              {sgSplit.warns.length} anomalie{sgSplit.warns.length > 1 ? "s" : ""} détectée{sgSplit.warns.length > 1 ? "s" : ""} sur
              cette commande ({clientName}). Tu peux corriger, ou valider en connaissance de cause.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-[45vh] overflow-y-auto space-y-1.5 rounded-lg border border-amber-300/60 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-950/20 px-3 py-2.5">
            {sgSplit.warns.map((v, vi) => (
              <li key={vi} className="flex items-start gap-1.5 text-[12.5px] leading-snug text-amber-900 dark:text-amber-100">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
                <span>{v.message}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setSgConfirmOpen(false)}>
              Corriger
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => { setSgConfirmOpen(false); submit({ safeguardsConfirmed: true }); }}
            >
              Valider quand même
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* RÉCAP EN GRAND — popup par-dessus TOUT (double-clic sur l'en-tête
          « Commande »). Lecture seule : article · quantité · prix · total, gros
          caractères pour relire la commande d'un coup d'œil. Fond, croix ou
          Échap pour fermer. */}
      {orderFullscreen && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6"
          role="dialog" aria-modal="true" aria-label="Récapitulatif de la commande"
          onClick={() => setOrderFullscreen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl border border-border bg-card shadow-modal overflow-hidden animate-fade-up"
          >
            <div className="flex items-start justify-between gap-3 px-5 sm:px-7 py-4 border-b border-border shrink-0">
              <div className="min-w-0">
                <p className="kicker inline-flex items-center gap-1.5"><ShoppingCart className="h-3 w-3" /> Récapitulatif commande</p>
                <h2 className="font-display text-[22px] sm:text-[26px] font-semibold text-foreground truncate">{clientName}</h2>
                {deliveryDate && (
                  <p className="text-[12.5px] text-muted-foreground mt-0.5">
                    Livraison du {new Date(deliveryDate).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                  </p>
                )}
              </div>
              <button
                type="button" onClick={() => setOrderFullscreen(false)} aria-label="Fermer le récapitulatif"
                className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-2 divide-y divide-border/60">
              {cart.map((l, i) => {
                const div = l.packDivisor > 0 ? l.packDivisor : 1;
                const baseUnitsPerColis = Math.round(l.stepColis * div * 1000) / 1000;
                const hasColis = baseUnitsPerColis > 1;
                const baseQty = Math.round(l.quantity * div * 100) / 100;
                const colisCount = hasColis ? Math.round((l.quantity / l.stepColis) * 100) / 100 : baseQty;
                const tags = [cleanTag(l.marque), cleanTag(l.condi), cleanTag(l.variete), cleanTag(l.pays)].filter(Boolean);
                const freeColis = l.freeUnits > 0
                  ? (hasColis ? Math.round((l.freeUnits / l.stepColis) * 100) / 100 : Math.round(l.freeUnits * div * 100) / 100)
                  : 0;
                return (
                  <div key={i} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] sm:text-[17px] font-semibold text-foreground leading-tight">{l.itemName}</p>
                      {tags.length > 0 && <p className="text-[12px] text-muted-foreground mt-0.5 truncate">{tags.join(" · ")}</p>}
                    </div>
                    <div className="shrink-0 text-right tnum">
                      <p className="text-[16px] sm:text-[17px] font-bold text-foreground">
                        {hasColis ? `${colisCount} colis` : `${baseQty} ${l.priceUnit}`}
                        {freeColis > 0 && <span className="text-rose-600 dark:text-rose-400"> +{freeColis} off.</span>}
                      </p>
                      <p className="text-[12px] text-muted-foreground">
                        {hasColis ? `${baseQty} ${l.priceUnit} · ` : ""}{l.price != null ? `${l.price.toFixed(2)} €/${l.priceUnit}` : "— €"}
                      </p>
                    </div>
                    <div className="shrink-0 w-[92px] text-right text-[17px] sm:text-[19px] font-bold tnum text-foreground">
                      {l.price ? `${lineHT(l).toFixed(2)} €` : "—"}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="shrink-0 border-t border-border px-5 sm:px-7 py-4 flex items-end justify-between gap-4">
              <div className="text-[12.5px] text-muted-foreground">
                {cart.length} article{cart.length > 1 ? "s" : ""} · {fmtKg(totalKg)}
                {hasCostData && (
                  <span className={`ml-2 font-semibold ${margeNetteTotal < 0 ? "text-rose-600 dark:text-rose-400" : margeNettePct < 10 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {/* Marge masquée (épaule) : montant remplacé par « ••• », couleur conservée. */}
                    · marge nette {hideMargin ? "•••" : `${margeNetteTotal.toFixed(2)} € (${Math.round(margeNettePct)} %)`}
                  </span>
                )}
              </div>
              <div className="text-right">
                <p className="kicker">{modif ? "Total HT du BL" : "Total HT"}</p>
                <p className="font-display text-[28px] sm:text-[34px] font-bold tnum text-foreground leading-none">{totalHT.toFixed(2)} €</p>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* (La confirmation d'encours dépassé vit désormais dans le TOAST de la
          tâche de fond — cf. sendOrderInBackground : action « Créer quand
          même » — l'écran est déjà passé au client suivant.) */}
    </div>
  );
}

/* (L'ancien bandeau « Modification » du panier a été remplacé par le bandeau
   discret en HAUT de l'écran — contexte + n° de commande + texte du BL.) */
