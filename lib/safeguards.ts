/**
 * GARDE-FOUS DE VENTE — règles configurables (Paramètres → « Garde-fous »).
 *
 * Chaque règle a un MODE :
 *   • "off"   → désactivée ;
 *   • "warn"  → AVERTIR : l'anomalie est signalée, la vente reste possible
 *               après confirmation explicite (« Valider quand même ») ;
 *   • "block" → BLOQUER : la vente est refusée tant que l'anomalie persiste
 *               (aucun override commercial — seuil à changer dans Paramètres).
 * … et des SEUILS numériques réglables (ex. marge min %, multiple du volume
 * habituel du client, plafond € de commande).
 *
 * La config vit côté serveur (AppSetting `safeguards_config`, cf.
 * lib/safeguardsStore.ts) → mêmes règles pour TOUS les postes. Ce module est
 * volontairement PUR (aucun import serveur) : les MÊMES évaluateurs tournent
 *   • dans la console (alertes en direct sur le panier + confirmation) ;
 *   • dans POST /api/sap/orders (filet serveur : warn → 409 confirmable,
 *     block → 400 ferme) ;
 *   • dans le scan des Ventes du jour (badges d'anomalie par BL).
 */

export type SafeguardMode = "off" | "warn" | "block";

export type SafeguardCategory = "prix" | "volume" | "commande" | "client";

/** Paramètre numérique d'une règle (seuil réglable dans Paramètres). */
export interface SafeguardParamDef {
  key: string;
  label: string;
  /** Suffixe d'unité affiché après l'input (€, %, ×, kg, colis, j…). */
  unit: string;
  default: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface SafeguardRuleDef {
  id: SafeguardRuleId;
  category: SafeguardCategory;
  label: string;
  /** Description côté Paramètres — formulée pour la Direction. */
  description: string;
  defaultMode: SafeguardMode;
  params: SafeguardParamDef[];
}

export type SafeguardRuleId =
  // ── Prix (par ligne) ──
  | "prixSousAchat"          // vente à perte / marge ligne insuffisante
  | "prixLoinSousConseille"  // prix très en-dessous du prix conseillé
  | "prixLoinSurConseille"   // prix très au-dessus du prix conseillé (faute de frappe)
  | "prixMax"                // prix unitaire aberrant
  | "prixManquant"           // ligne sans prix saisi (partira au tarif SAP)
  // ── Volume (par ligne) ──
  | "volumeVsHabitude"       // qté > N × la moyenne du client sur cet article
  | "volumeMaxLigne"         // qté > plafond absolu (colis)
  | "poidsMaxLigne"          // poids ligne > plafond kg
  | "surVenteStock"          // qté > stock disponible (vente à découvert)
  // ── Commande (globale) ──
  | "totalMax"               // total HT > plafond €
  | "totalMin"               // total HT < minimum de commande €
  | "totalVsPanierMoyen"     // total > N × panier moyen du client
  | "poidsMaxCommande"       // poids total > plafond kg
  | "margeCommandeFaible"    // marge brute de la commande < seuil %
  // ── Client / livraison ──
  | "encoursDepasse"         // solde ≥ % de la limite de crédit SAP
  | "livraisonLointaine"     // date de livraison > N jours
  | "doublonJour";           // le client a déjà une commande saisie aujourd'hui

/** Ordre d'affichage des catégories (Paramètres + récaps). */
export const SAFEGUARD_CATEGORIES: { id: SafeguardCategory; label: string }[] = [
  { id: "prix", label: "Prix" },
  { id: "volume", label: "Volumes & stock" },
  { id: "commande", label: "Commande" },
  { id: "client", label: "Client & livraison" },
];

export const SAFEGUARD_DEFS: SafeguardRuleDef[] = [
  // ────────────────────────── PRIX ──────────────────────────
  {
    id: "prixSousAchat",
    category: "prix",
    label: "Vente à perte (prix < prix d'achat)",
    description:
      "Alerte quand le prix saisi ne couvre pas le prix d'achat + la marge minimale. À 0 %, seule la vente STRICTEMENT à perte est signalée.",
    defaultMode: "warn",
    params: [{ key: "margeMinPct", label: "Marge minimale", unit: "%", default: 0, min: 0, max: 100, step: 1 }],
  },
  {
    id: "prixLoinSousConseille",
    category: "prix",
    label: "Prix très inférieur au prix conseillé",
    description:
      "Alerte quand le prix saisi est plus bas que le prix conseillé Gervifrais de plus de l'écart toléré (remise anormale, erreur de saisie).",
    defaultMode: "warn",
    params: [{ key: "ecartPct", label: "Écart toléré", unit: "%", default: 25, min: 1, max: 95, step: 1 }],
  },
  {
    id: "prixLoinSurConseille",
    category: "prix",
    label: "Prix très supérieur au prix conseillé",
    description:
      "Alerte quand le prix saisi dépasse le prix conseillé de plus de l'écart toléré — typiquement une virgule oubliée (45 € au lieu de 4,5 €).",
    defaultMode: "warn",
    params: [{ key: "ecartPct", label: "Écart toléré", unit: "%", default: 100, min: 10, max: 1000, step: 5 }],
  },
  {
    id: "prixMax",
    category: "prix",
    label: "Prix unitaire aberrant",
    description: "Plafond absolu du prix unitaire saisi, toutes marchandises confondues (filet anti-faute de frappe).",
    defaultMode: "warn",
    params: [{ key: "prixMaxEur", label: "Prix unitaire max", unit: "€", default: 100, min: 1, step: 1 }],
  },
  {
    id: "prixManquant",
    category: "prix",
    label: "Ligne sans prix saisi",
    description:
      "Alerte quand une ligne part sans prix (elle prendra le tarif SAP). Utile si la consigne est de toujours valoriser à la saisie.",
    defaultMode: "off",
    params: [],
  },
  // ─────────────────────── VOLUMES & STOCK ───────────────────────
  {
    id: "volumeVsHabitude",
    category: "volume",
    label: "Volume inhabituel pour ce client",
    description:
      "Alerte quand la quantité dépasse N × la moyenne des quantités commandées PAR CE CLIENT sur cet article (historique SAP). Ne joue qu'à partir du nombre minimal de commandes.",
    defaultMode: "warn",
    params: [
      { key: "multiple", label: "Multiple de la moyenne", unit: "×", default: 2, min: 1, max: 20, step: 0.5 },
      { key: "minCommandes", label: "Historique minimal", unit: "cdes", default: 3, min: 1, max: 20, step: 1 },
    ],
  },
  {
    id: "volumeMaxLigne",
    category: "volume",
    label: "Quantité maximale par ligne",
    description: "Plafond absolu de colis sur une ligne (filet anti-faute de frappe : 200 colis au lieu de 20).",
    defaultMode: "warn",
    params: [{ key: "maxColis", label: "Plafond", unit: "colis", default: 200, min: 1, step: 10 }],
  },
  {
    id: "poidsMaxLigne",
    category: "volume",
    label: "Poids maximal par ligne",
    description: "Plafond de poids (kg) d'une seule ligne, quand le poids colis de l'article est connu.",
    defaultMode: "off",
    params: [{ key: "maxKg", label: "Plafond", unit: "kg", default: 1000, min: 10, step: 50 }],
  },
  {
    id: "surVenteStock",
    category: "volume",
    label: "Vente à découvert (quantité > stock)",
    description:
      "Alerte quand la quantité dépasse le stock disponible. La commande part alors en bon de commande (aucun stock réservé) — ce garde-fou rend le dépassement explicite.",
    defaultMode: "off",
    params: [],
  },
  // ───────────────────────── COMMANDE ─────────────────────────
  {
    id: "totalMax",
    category: "commande",
    label: "Total de commande anormalement élevé",
    description: "Alerte au-delà d'un plafond de total HT par commande.",
    defaultMode: "warn",
    params: [{ key: "maxEur", label: "Plafond", unit: "€ HT", default: 8000, min: 100, step: 100 }],
  },
  {
    id: "totalMin",
    category: "commande",
    label: "Minimum de commande",
    description: "Alerte en-dessous d'un total HT minimal (petites commandes non rentables à livrer).",
    defaultMode: "off",
    params: [{ key: "minEur", label: "Minimum", unit: "€ HT", default: 100, min: 1, step: 10 }],
  },
  {
    id: "totalVsPanierMoyen",
    category: "commande",
    label: "Commande très supérieure au panier moyen",
    description:
      "Alerte quand le total dépasse N × le panier moyen du client (historique SAP). Ne joue qu'à partir du nombre minimal de commandes.",
    defaultMode: "warn",
    params: [
      { key: "multiple", label: "Multiple du panier moyen", unit: "×", default: 3, min: 1, max: 20, step: 0.5 },
      { key: "minCommandes", label: "Historique minimal", unit: "cdes", default: 3, min: 1, max: 20, step: 1 },
    ],
  },
  {
    id: "poidsMaxCommande",
    category: "commande",
    label: "Poids total de commande",
    description: "Plafond de poids total (kg) d'une commande — capacité d'une tournée.",
    defaultMode: "off",
    params: [{ key: "maxKg", label: "Plafond", unit: "kg", default: 3000, min: 100, step: 100 }],
  },
  {
    id: "margeCommandeFaible",
    category: "commande",
    label: "Marge brute de commande insuffisante",
    description:
      "Alerte quand la marge brute de la commande (lignes au prix d'achat connu) est sous le seuil — 0 % = seule la commande GLOBALEMENT à perte est signalée.",
    defaultMode: "warn",
    params: [{ key: "margeMinPct", label: "Marge minimale", unit: "%", default: 0, min: 0, max: 100, step: 1 }],
  },
  // ──────────────────── CLIENT & LIVRAISON ────────────────────
  {
    id: "encoursDepasse",
    category: "client",
    label: "Encours client dépassé",
    description:
      "Alerte quand le solde SAP du client atteint le pourcentage réglé de sa limite de crédit (100 % = comportement historique). Vérifié à la création côté serveur.",
    defaultMode: "warn",
    params: [{ key: "pctLimite", label: "Seuil", unit: "% de la limite", default: 100, min: 10, max: 200, step: 5 }],
  },
  {
    id: "livraisonLointaine",
    category: "client",
    label: "Livraison lointaine",
    description: "Alerte quand la date de livraison est à plus de N jours (précommande très en avance — erreur d'année ?).",
    defaultMode: "warn",
    params: [{ key: "maxJours", label: "Horizon", unit: "jours", default: 60, min: 1, max: 366, step: 1 }],
  },
  {
    id: "doublonJour",
    category: "client",
    label: "Deuxième commande du jour",
    description:
      "Alerte quand le client a DÉJÀ une commande saisie aujourd'hui (possible double saisie). Vérifié à la création côté serveur.",
    defaultMode: "off",
    params: [],
  },
];

export const SAFEGUARD_DEFS_BY_ID: Record<SafeguardRuleId, SafeguardRuleDef> = Object.fromEntries(
  SAFEGUARD_DEFS.map((d) => [d.id, d]),
) as Record<SafeguardRuleId, SafeguardRuleDef>;

/** Réglage d'UNE règle : mode + valeurs de seuils. */
export interface SafeguardRuleConfig {
  mode: SafeguardMode;
  params: Record<string, number>;
}

export type SafeguardsConfig = Record<SafeguardRuleId, SafeguardRuleConfig>;

export const DEFAULT_SAFEGUARDS_CONFIG: SafeguardsConfig = Object.fromEntries(
  SAFEGUARD_DEFS.map((d) => [d.id, {
    mode: d.defaultMode,
    params: Object.fromEntries(d.params.map((p) => [p.key, p.default])),
  }]),
) as SafeguardsConfig;

/**
 * Normalise une config brute (JSON AppSetting, payload PUT, localStorage…) :
 * règles inconnues ignorées, règles manquantes aux défauts, modes invalides
 * ramenés au défaut, seuils non finis / hors bornes ramenés au défaut ou clampés.
 * Ne lève JAMAIS — une config corrompue retombe sur les défauts.
 */
export function normalizeSafeguardsConfig(raw: unknown): SafeguardsConfig {
  const out: SafeguardsConfig = structuredCloneConfig(DEFAULT_SAFEGUARDS_CONFIG);
  if (raw == null || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const def of SAFEGUARD_DEFS) {
    const r = obj[def.id];
    if (r == null || typeof r !== "object") continue;
    const rr = r as { mode?: unknown; params?: unknown };
    if (rr.mode === "off" || rr.mode === "warn" || rr.mode === "block") {
      out[def.id].mode = rr.mode;
    }
    if (rr.params != null && typeof rr.params === "object") {
      const rp = rr.params as Record<string, unknown>;
      for (const p of def.params) {
        const v = Number(rp[p.key]);
        if (!Number.isFinite(v)) continue;
        const min = p.min ?? Number.NEGATIVE_INFINITY;
        const max = p.max ?? Number.POSITIVE_INFINITY;
        out[def.id].params[p.key] = Math.min(max, Math.max(min, v));
      }
    }
  }
  return out;
}

/** Copie profonde d'une config (structuredClone indisponible sur vieux runtimes). */
function structuredCloneConfig(cfg: SafeguardsConfig): SafeguardsConfig {
  return Object.fromEntries(
    Object.entries(cfg).map(([id, r]) => [id, { mode: r.mode, params: { ...r.params } }]),
  ) as SafeguardsConfig;
}

/* ═══════════════════════ ÉVALUATION ═══════════════════════ */

export interface SafeguardViolation {
  ruleId: SafeguardRuleId;
  /** "warn" (confirmable) ou "block" (ferme) — recopie du mode de la règle. */
  severity: Exclude<SafeguardMode, "off">;
  /** Message FR prêt à afficher (toast, badge, 409/400 serveur). */
  message: string;
  /** Code article concerné (règles de ligne) — absent pour les règles globales. */
  itemCode?: string;
}

/** Contexte d'UNE ligne de commande, dans l'unité d'AFFICHAGE (colis/kg). */
export interface SafeguardLineCtx {
  itemCode: string;
  itemName: string;
  /** Unité d'affichage de la quantité (ex. "colis", "kg"). */
  unit: string;
  /** Quantité affichée (colis, ou kg pour un article au kg). */
  quantity: number;
  /** Prix unitaire NET saisi (déjà remisé), null = tarif SAP. */
  price: number | null;
  /** Prix d'achat (liste 2), même unité que price. null = inconnu → règles prix ignorées. */
  prixAchat: number | null;
  /** Prix conseillé Gervifrais, même unité que price. null = inconnu. */
  prixConseille: number | null;
  /** Stock disponible dans l'unité d'affichage. null = inconnu. */
  stockDisponible: number | null;
  /** Poids de la ligne en kg. null = poids colis inconnu. */
  poidsKg: number | null;
  /** Ligne 100 % offerte (promo) → règles de PRIX ignorées. */
  offerte?: boolean;
  /** Moyenne des quantités commandées par CE client pour CET article
   *  (même unité que quantity) + taille de l'historique. null = pas d'historique. */
  habitude?: { moyenne: number; nbCommandes: number } | null;
}

/** Contexte GLOBAL d'une commande. Les champs null = donnée indisponible → règle ignorée. */
export interface SafeguardOrderCtx {
  totalHT: number;
  /** Poids total connu (kg) — 0/null si aucun poids calculable. */
  poidsKg: number | null;
  /** Marge brute € et CA des lignes costées — null si aucun prix d'achat connu. */
  marge: { margeEur: number; caEur: number } | null;
  /** Panier moyen HT du client + taille de l'historique. null = pas d'historique. */
  panierMoyen?: { moyenneHT: number; nbCommandes: number } | null;
  /** Date de livraison ISO (yyyy-mm-dd ou ISO complet). null = non évaluée. */
  deliveryDate?: string | null;
  /** Date « aujourd'hui » de référence (ISO) — injectée pour testabilité. */
  today?: string | null;
  /** Le client a déjà ≥ 1 commande saisie aujourd'hui (résolu par l'appelant). */
  dejaCommandeAujourdhui?: boolean | null;
  /** Encours SAP : solde courant + limite de crédit (résolu par l'appelant). */
  encours?: { balance: number; creditLimit: number } | null;
}

const eur = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const num = (n: number) =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

function active(cfg: SafeguardsConfig, id: SafeguardRuleId): SafeguardRuleConfig | null {
  const r = cfg[id];
  return r && r.mode !== "off" ? r : null;
}

function push(
  out: SafeguardViolation[],
  cfg: SafeguardRuleConfig,
  ruleId: SafeguardRuleId,
  message: string,
  itemCode?: string,
) {
  out.push({ ruleId, severity: cfg.mode === "block" ? "block" : "warn", message, ...(itemCode ? { itemCode } : {}) });
}

/**
 * Évalue les règles de LIGNE (prix + volume) sur une ligne de panier.
 * Toute donnée manquante (prix d'achat inconnu, pas d'historique…) désarme la
 * règle concernée — un garde-fou ne crie jamais faute de données.
 */
export function evaluateLineSafeguards(cfg: SafeguardsConfig, l: SafeguardLineCtx): SafeguardViolation[] {
  const out: SafeguardViolation[] = [];
  const name = l.itemName || l.itemCode;

  // ── Prix (ignorées sur une ligne 100 % offerte : elle part à 0 € voulu) ──
  if (!l.offerte) {
    const sousAchat = active(cfg, "prixSousAchat");
    if (sousAchat && l.price != null && l.prixAchat != null && l.prixAchat > 0) {
      const seuil = l.prixAchat * (1 + (sousAchat.params.margeMinPct ?? 0) / 100);
      if (l.price < seuil - 1e-9) {
        const msg = (sousAchat.params.margeMinPct ?? 0) > 0
          ? `${name} : prix ${eur(l.price)} sous le prix d'achat ${eur(l.prixAchat)} + ${num(sousAchat.params.margeMinPct)} % de marge min.`
          : `${name} : prix ${eur(l.price)} SOUS le prix d'achat ${eur(l.prixAchat)} — vente à perte.`;
        push(out, sousAchat, "prixSousAchat", msg, l.itemCode);
      }
    }

    const loinSous = active(cfg, "prixLoinSousConseille");
    if (loinSous && l.price != null && l.prixConseille != null && l.prixConseille > 0) {
      const seuil = l.prixConseille * (1 - (loinSous.params.ecartPct ?? 25) / 100);
      if (l.price < seuil - 1e-9) {
        push(out, loinSous, "prixLoinSousConseille",
          `${name} : prix ${eur(l.price)} à plus de ${num(loinSous.params.ecartPct)} % SOUS le prix conseillé ${eur(l.prixConseille)}.`,
          l.itemCode);
      }
    }

    const loinSur = active(cfg, "prixLoinSurConseille");
    if (loinSur && l.price != null && l.prixConseille != null && l.prixConseille > 0) {
      const seuil = l.prixConseille * (1 + (loinSur.params.ecartPct ?? 100) / 100);
      if (l.price > seuil + 1e-9) {
        push(out, loinSur, "prixLoinSurConseille",
          `${name} : prix ${eur(l.price)} à plus de ${num(loinSur.params.ecartPct)} % AU-DESSUS du prix conseillé ${eur(l.prixConseille)} — faute de frappe ?`,
          l.itemCode);
      }
    }

    const pMax = active(cfg, "prixMax");
    if (pMax && l.price != null && l.price > (pMax.params.prixMaxEur ?? 100)) {
      push(out, pMax, "prixMax",
        `${name} : prix unitaire ${eur(l.price)} au-delà du plafond ${eur(pMax.params.prixMaxEur ?? 100)}.`,
        l.itemCode);
    }

    const pManq = active(cfg, "prixManquant");
    if (pManq && (l.price == null || l.price <= 0)) {
      push(out, pManq, "prixManquant", `${name} : aucun prix saisi — la ligne partira au tarif SAP.`, l.itemCode);
    }
  }

  // ── Volumes ──
  const habit = active(cfg, "volumeVsHabitude");
  if (habit && l.habitude && l.habitude.moyenne > 0
      && l.habitude.nbCommandes >= (habit.params.minCommandes ?? 3)) {
    const mult = habit.params.multiple ?? 2;
    if (l.quantity > l.habitude.moyenne * mult + 1e-9) {
      push(out, habit, "volumeVsHabitude",
        `${name} : ${num(l.quantity)} ${l.unit} — plus de ${num(mult)} × la moyenne du client (${num(l.habitude.moyenne)} ${l.unit} sur ${l.habitude.nbCommandes} cdes).`,
        l.itemCode);
    }
  }

  const vMax = active(cfg, "volumeMaxLigne");
  if (vMax && l.quantity > (vMax.params.maxColis ?? 200)) {
    push(out, vMax, "volumeMaxLigne",
      `${name} : ${num(l.quantity)} ${l.unit} — au-delà du plafond de ${num(vMax.params.maxColis ?? 200)} par ligne.`,
      l.itemCode);
  }

  const wMax = active(cfg, "poidsMaxLigne");
  if (wMax && l.poidsKg != null && l.poidsKg > (wMax.params.maxKg ?? 1000)) {
    push(out, wMax, "poidsMaxLigne",
      `${name} : ${num(l.poidsKg)} kg — au-delà du plafond de ${num(wMax.params.maxKg ?? 1000)} kg par ligne.`,
      l.itemCode);
  }

  const decouvert = active(cfg, "surVenteStock");
  if (decouvert && l.stockDisponible != null && l.quantity > l.stockDisponible + 1e-9) {
    push(out, decouvert, "surVenteStock",
      `${name} : ${num(l.quantity)} ${l.unit} demandés pour ${num(Math.max(0, l.stockDisponible))} en stock — vente à découvert.`,
      l.itemCode);
  }

  return out;
}

/** Évalue les règles GLOBALES (commande + client/livraison). */
export function evaluateOrderSafeguards(cfg: SafeguardsConfig, o: SafeguardOrderCtx): SafeguardViolation[] {
  const out: SafeguardViolation[] = [];

  const tMax = active(cfg, "totalMax");
  if (tMax && o.totalHT > (tMax.params.maxEur ?? 8000)) {
    push(out, tMax, "totalMax",
      `Total ${eur(o.totalHT)} HT au-delà du plafond de ${eur(tMax.params.maxEur ?? 8000)}.`);
  }

  const tMin = active(cfg, "totalMin");
  if (tMin && o.totalHT > 0 && o.totalHT < (tMin.params.minEur ?? 100)) {
    push(out, tMin, "totalMin",
      `Total ${eur(o.totalHT)} HT sous le minimum de commande de ${eur(tMin.params.minEur ?? 100)}.`);
  }

  const panier = active(cfg, "totalVsPanierMoyen");
  if (panier && o.panierMoyen && o.panierMoyen.moyenneHT > 0
      && o.panierMoyen.nbCommandes >= (panier.params.minCommandes ?? 3)) {
    const mult = panier.params.multiple ?? 3;
    if (o.totalHT > o.panierMoyen.moyenneHT * mult + 1e-9) {
      push(out, panier, "totalVsPanierMoyen",
        `Total ${eur(o.totalHT)} HT — plus de ${num(mult)} × le panier moyen du client (${eur(o.panierMoyen.moyenneHT)} sur ${o.panierMoyen.nbCommandes} cdes).`);
    }
  }

  const pdsMax = active(cfg, "poidsMaxCommande");
  if (pdsMax && o.poidsKg != null && o.poidsKg > (pdsMax.params.maxKg ?? 3000)) {
    push(out, pdsMax, "poidsMaxCommande",
      `Poids total ${num(o.poidsKg)} kg au-delà du plafond de ${num(pdsMax.params.maxKg ?? 3000)} kg.`);
  }

  const marge = active(cfg, "margeCommandeFaible");
  if (marge && o.marge && o.marge.caEur > 0) {
    const pct = (o.marge.margeEur / o.marge.caEur) * 100;
    const min = marge.params.margeMinPct ?? 0;
    if (pct < min - 1e-9) {
      const msg = min > 0
        ? `Marge brute de la commande ${num(pct)} % sous le seuil de ${num(min)} % (lignes au prix d'achat connu).`
        : `Commande GLOBALEMENT à perte : marge brute ${eur(o.marge.margeEur)} (${num(pct)} %).`;
      push(out, marge, "margeCommandeFaible", msg);
    }
  }

  const enc = active(cfg, "encoursDepasse");
  if (enc && o.encours && o.encours.creditLimit > 0) {
    const seuil = o.encours.creditLimit * ((enc.params.pctLimite ?? 100) / 100);
    if (o.encours.balance >= seuil - 1e-9) {
      push(out, enc, "encoursDepasse",
        `Encours : solde ${eur(o.encours.balance)} ≥ ${num(enc.params.pctLimite ?? 100)} % de la limite de crédit (${eur(o.encours.creditLimit)}).`);
    }
  }

  const loin = active(cfg, "livraisonLointaine");
  if (loin && o.deliveryDate) {
    const due = new Date(o.deliveryDate);
    const ref = o.today ? new Date(o.today) : new Date();
    if (!Number.isNaN(due.getTime()) && !Number.isNaN(ref.getTime())) {
      const days = Math.round((due.getTime() - ref.getTime()) / 86_400_000);
      const max = loin.params.maxJours ?? 60;
      if (days > max) {
        push(out, loin, "livraisonLointaine",
          `Livraison dans ${days} jours — au-delà de l'horizon de ${num(max)} jours. Vérifie la date.`);
      }
    }
  }

  const dbl = active(cfg, "doublonJour");
  if (dbl && o.dejaCommandeAujourdhui) {
    push(out, dbl, "doublonJour",
      `Ce client a DÉJÀ une commande saisie aujourd'hui — double saisie possible.`);
  }

  return out;
}

/** true si au moins une violation est bloquante. */
export function hasBlocking(violations: SafeguardViolation[]): boolean {
  return violations.some((v) => v.severity === "block");
}

/** Sépare avertissements / blocages (affichage). */
export function splitViolations(violations: SafeguardViolation[]): {
  warns: SafeguardViolation[]; blocks: SafeguardViolation[];
} {
  return {
    warns: violations.filter((v) => v.severity === "warn"),
    blocks: violations.filter((v) => v.severity === "block"),
  };
}
