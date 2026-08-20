/* ── Écran 2 (prise de commande) — types, formatters et helpers PURS ──
   Extrait de Ecran2Order.tsx lors du découpage : ce module ne contient QUE du
   code sans état React (types, constantes, fonctions pures et les envois SAP en
   arrière-plan qui vivent au niveau module). L'orchestrateur et les
   sous-composants (StockRow, CartLine, MarginPanel, TarifTab, footerBar) les
   importent tels quels — comportement identique. */
import { toast } from "sonner";
import { celebrateSale } from "@/components/settings/app-settings";

export interface StockEntry { available: number }
export interface Product {
  id: string; itemCode: string; itemName: string; groupName: string | null;
  salesUnit: string | null; salesQtyPerPackUnit: number | null;
  // B4 — poids colis (kg) : salesUnitWeight × salesQtyPerPackUnit × (salesItemsPerUnit ?? 1)
  salesUnitWeight?: number | null; salesItemsPerUnit?: number | null;
  // Détails métier (Gervifrais U_*) — sortis du grisé pour décision rapide en appel
  uMarque: string | null; uPays: string | null; uCondi: string | null; uUvc: string | null;
  frgnName?: string | null;                 // variété (SAP FrgnName)
  /** DDM la plus proche encore à venir sur cet article (ISO) — null si aucune. */
  dlc?: string | null;
  stockByWarehouse: Record<string, StockEntry>;
}
export interface Hint {
  prixConseille: number | null; coef: number; isDefault: boolean; prixAchat: number | null;
  marque: string | null; calibre: string | null; pays: string | null;
}
/** C2 — Promo active sur un article (cf. /api/promos?active=1). */
export interface Promo {
  id: string; itemCode: string; kind: "PERCENT" | "X_PLUS_Y" | "FREE" | "PRICE";
  value: number; buyQty: number; freeQty: number; label: string | null;
  /** Type de magasin ciblé (EXPORT | GMS | CHR) — null = tous. */
  storeType?: string | null;
  startsAt?: string | null; endsAt?: string | null;
}
export interface CartLine {
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
export interface TarifItem { itemCode: string; price: number; note?: string | null }

/** Ligne envoyée à /api/sap/orders — construite depuis le panier (buildApiLines). */
export type ApiLine = {
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

/** Cible du menu contextuel d'une ligne stock (clic droit). */
export interface RowMenuTarget { p: Product; fullQty: number; dispo: number; unit: string; packDivisor: number }
/** Cible du détail des lots (clic droit → « Détails »). */
export interface LotDetailTarget { id: string; code: string; name: string; dispo: number; unit: string; packDivisor: number }

/* ── C2 — Helpers promo (purs) ─────────────────────────────── */

/** Recalcule les COLIS OFFERTS d'une ligne promo (X_PLUS_Y ou FREE).
 *  X_PLUS_Y (« 5 achetés + 1 offert ») : l'offert s'AJOUTE à la quantité saisie
 *    (ligne à 0 € À CÔTÉ de la ligne payante) — pour chaque buyQty commandés →
 *    freeQty offerts en plus → freeUnits = freeQty × floor(qty / buyQty). (Ex. 5 → +1, 10 → +2.)
 *  FREE (« colis offert », sans seuil) : PAS d'ajout — le(s) colis déjà saisi(s)
 *    DEVIENNENT offerts (jusqu'à freeQty). 1 PETALE saisi + promo activée → cette
 *    unique ligne passe à 100 % de remise, un colis reste un colis sur le bon.
 *  No-op pour les autres lignes — appelé à chaque changement de quantité. */
export function applyPromoFree(line: CartLine): CartLine {
  if (line.freeManual) return line;   // « offert » saisi à la main → on n'écrase pas
  const pr = line.promo;
  const qty = line.quantity;
  if (pr?.kind === "X_PLUS_Y" && pr.buyQty > 0 && pr.freeQty > 0) {
    // « buyQty achetés + freeQty offert » : offert(s) EN PLUS, par tranche de buyQty.
    const freeUnits = qty > 0 ? pr.freeQty * Math.floor(qty / pr.buyQty) : 0;
    return { ...line, freeUnits, discountPercent: 0 };
  }
  if (pr?.kind === "FREE" && pr.freeQty > 0) {
    // Carvé DANS la quantité saisie — jamais plus que ce qui est réellement au panier.
    const freeUnits = qty > 0 ? Math.min(qty, pr.freeQty) : 0;
    return { ...line, freeUnits, discountPercent: 0 };
  }
  return line;
}

/** true si les colis offerts de la ligne s'AJOUTENT à la quantité saisie
 *  (X_PLUS_Y) plutôt que d'être pris SUR elle (FREE, cf. applyPromoFree). */
export function freeIsAdditive(l: Pick<CartLine, "promo">): boolean {
  return l.promo?.kind === "X_PLUS_Y";
}

/** Libellé court du badge promo : « −10 % », « 2,80 € », « 5+1 » ou « +1 offert ». */
export function promoBadge(pr: Promo): string {
  if (pr.kind === "PERCENT") return `−${String(Math.round(pr.value * 100) / 100)} %`;
  if (pr.kind === "PRICE") return `${pr.value.toFixed(2).replace(".", ",")} €`;
  if (pr.kind === "FREE") return `+${pr.freeQty} offert${pr.freeQty > 1 ? "s" : ""}`;
  return `${pr.buyQty}+${pr.freeQty}`;
}

/* ── Total d'une ligne / poids d'une ligne (purs) ──────────── */

// Prix à la pièce × (colis × pièces/colis) = total ligne.
// Les colis offerts (X_PLUS_Y / FREE) sont une LIGNE séparée à 0 € → ils ne
// réduisent pas ce total. PERCENT : le prix affiché est DÉJÀ net → rien à déduire.
export function lineHT(l: CartLine): number {
  if (!l.price) return 0;
  return l.price * l.quantity * l.packDivisor;
}

// Poids d'une ligne : quantité déjà en kg pour les articles au kg, sinon
// quantité (colis) × poids d'un colis.
export function lineWeightKg(l: CartLine): number {
  const w = l.unit === "kg" ? l.quantity : l.quantity * (l.colisWeightKg ?? 0);
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/* ── Envoi du BL en ARRIÈRE-PLAN ────────────────────────────────────────────
   La création/modification ne bloque plus l'écran : dès le clic, le client
   quitte la vue (le poste enchaîne sur le suivant) et la réponse SAP arrive
   en toast — PORTANT LE NOM DU CLIENT, puisque l'écran est passé à autre
   chose. Vit au niveau MODULE : la requête survit au démontage de l'écran.
   Garde-fou encours (création) : le 409 needsConfirm revient en toast avec
   l'action « Créer quand même » (re-post confirmEncours) — la commande n'est
   PAS créée tant que l'action n'est pas cliquée. */
export type BackgroundOrder =
  | { kind: "create"; clientName: string; body: Record<string, unknown>; margeNette?: number }
  | { kind: "modif"; clientName: string; docEntry: number; docNum: number; body: Record<string, unknown> };

export function notifyOrderResult(
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
        ? `Modification refusée — BL n°${job.docNum}`
        : json?.blocked
          ? `Client bloqué — ${job.clientName}`
          : `Commande non créée — ${job.clientName}`,
      { description: json?.error, duration: 15000 },
    );
    return;
  }
  if (job.kind === "modif") {
    toast.success(`BL n°${json.docNum ?? job.docNum} enregistré`, {
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
    toast.success(`Offre client n°${json.docNum} créée — ${job.clientName}`, {
      description: `${fmt(json.totalTTC)} € TTC · à passer en commande au jour de départ.`,
      duration: 10000,
    });
  } else {
    toast.success(`Commande n°${json.docNum} créée — ${job.clientName}`, {
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

export function sendOrderInBackground(job: BackgroundOrder) {
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
        ? `BL n°${job.docNum} non enregistré — ${job.clientName}`
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
export function colisKg(p: Product): number | null {
  const w = p.salesUnitWeight, perPack = p.salesQtyPerPackUnit;
  if (w == null || !(w > 0) || perPack == null || !(perPack > 0)) return null;
  const items = p.salesItemsPerUnit != null && p.salesItemsPerUnit > 0 ? p.salesItemsPerUnit : 1;
  const kg = w * perPack * items;
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return Math.round(kg * 100) / 100;
}
export function fmtKg(kg: number): string {
  return kg % 1 === 0 ? kg.toFixed(0) : String(kg);
}

/** Valeur de tag « propre » : ignore les placeholders vides ou « - » (tiret(s)
 *  seul(s)) → on ne fait PAS apparaître le tag dans ce cas. */
export function cleanTag(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (!t || /^-+$/.test(t)) return null;
  return t;
}

/* ── C4 — Densité d'affichage de la liste stock ────────────── */
export type Density = "compact" | "normal" | "aere";
export const DENSITY_KEY = "televente:ecran2Density";
/** Tailles UI d'un niveau de densité (classes Tailwind). */
export type DensityUiSpec = {
  rowPad: string; dispo: string; dispoUnit: string; dec: string;
  name: string; chip: string; code: string; price: string; priceUnit: string;
};
/** Tailles par niveau — « normal » = la référence actuelle (ne rien réduire par défaut). */
export const DENSITY_UI: Record<Density, DensityUiSpec> = {
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
export const FAV_GROUP = "⭐ Favoris";

/** Entrée de la liste stock : un groupe famille (éventuellement épinglé).
 *  `key` distinct de `name` pour les copies épinglées (clé React unique +
 *  état ouvert/fermé indépendant de l'original resté à sa place). */
export interface GroupEntry { key: string; name: string; prods: Product[]; pinned?: boolean }

export const SHORTCUTS_KEY = "televente:cmd-raccourcis";

/** Marge Sofruce PAR DÉFAUT (%) — sans prix d'achat saisi, l'EM part au prix
 *  de vente − cette marge (vente 1,00 €/kg → achat 0,80 € à 20 %). Modifiable
 *  dans la pastille à côté du bouton « Vente Sofruce » ; mémorisée par poste. */
export const SOFRUCE_MARGE_KEY = "tv:sofruce-marge";
export const SOFRUCE_MARGE_DEFAULT = 20;

/* ── C5 — Brouillon de commande NON VALIDÉE, conservé PAR CLIENT ────────────
   Sauvegardé en continu pendant la saisie (par poste, localStorage) ; restauré
   au montage quand on REVIENT sur le client. Supprimé : à l'envoi du bon, quand
   le panier est vidé à la main, ou passé le TTL (stock/prix trop périmés — le
   dispo des lignes restaurées est de toute façon rafraîchi sur le stock du
   jour dès que le catalogue est chargé). JAMAIS en mode MODIFICATION : l'état
   d'une modif vit sur le BL SAP, pas en brouillon. */
export const DRAFT_PREFIX = "televente:brouillon:";
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;   // 24 h — au-delà, prix/promos périmés
export const draftKey = (clientId: string) => `${DRAFT_PREFIX}${clientId}`;

export interface OrderDraft {
  v: 1; savedAt: number;
  cart: CartLine[]; numAtCard: string; comments: string; deliveryDate: string;
  bonCommandeManual: boolean; venteSofruce: boolean; sofrucePA: Record<string, string>;
}

export function readDraft(clientId: string): OrderDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(clientId));
    if (!raw) return null;
    const d = JSON.parse(raw) as OrderDraft;
    if (d?.v !== 1 || typeof d.savedAt !== "number" || Date.now() - d.savedAt > DRAFT_TTL_MS) return null;
    if (!Array.isArray(d.cart)) return null;
    d.cart = d.cart.filter((l) => l && typeof l.itemCode === "string" && typeof l.quantity === "number");
    return d.cart.length > 0 ? d : null;
  } catch { return null; }
}

export function clearDraft(clientId: string) {
  try { localStorage.removeItem(draftKey(clientId)); } catch { /* ignore */ }
}

/** Purge les brouillons expirés ou illisibles (une fois au montage de l'écran). */
export function pruneDrafts() {
  try {
    const now = Date.now();
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(DRAFT_PREFIX)) continue;
      try {
        const d = JSON.parse(localStorage.getItem(k) ?? "");
        if (typeof d?.savedAt !== "number" || now - d.savedAt > DRAFT_TTL_MS) stale.push(k);
      } catch { stale.push(k); }
    }
    stale.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
