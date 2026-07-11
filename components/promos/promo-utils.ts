/**
 * Utilitaires partagés du chantier Promotions v2
 * (PromoBanner, PromoNotifications, PromosManager).
 */

/** Promo active telle que servie par /api/promos?active=1 et /api/notifications. */
export interface ActivePromo {
  id: string;
  itemCode: string;
  kind: "PERCENT" | "X_PLUS_Y" | "FREE" | "PRICE" | string;
  value: number | null;
  buyQty: number | null;
  freeQty: number | null;
  label: string | null;
  pitch: string | null;
  /** Type de magasin ciblé (EXPORT | GMS | CHR) — null = tous les magasins. */
  storeType?: string | null;
  startsAt: string | null;
  endsAt: string | null;
  itemName?: string | null;
  // Tags produit (LEFT JOIN "Product") — servent au libellé riche.
  marque?: string | null;
  pays?: string | null;
  condi?: string | null;
  variete?: string | null;
  /** non consultée par l'utilisateur (badge « NOUVEAU ») */
  isNew?: boolean;
}

/** Prix formaté FR : « 2,80 € ». */
export function fmtPrix(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2).replace(".", ",")} €`;
}

/** Chip type courte : « −10 % », « 5+1 », « +1 offert » ou « 2,80 € » (tarif). */
export function promoChip(p: Pick<ActivePromo, "kind" | "value" | "buyQty" | "freeQty">): string {
  if (p.kind === "PERCENT") return `−${String(Math.round((p.value ?? 0) * 100) / 100)} %`;
  if (p.kind === "PRICE") return fmtPrix(p.value);
  if (p.kind === "FREE") {
    const n = p.freeQty ?? 1;
    return `+${n} offert${n > 1 ? "s" : ""}`;
  }
  return `${p.buyQty ?? "?"}+${p.freeQty ?? "?"}`;
}

/** Libellé lisible d'un type de magasin ciblé (ou « tous les magasins »). */
export function storeTypeLabel(storeType: string | null | undefined): string {
  const st = (storeType || "").trim().toUpperCase();
  if (st === "EXPORT") return "Export";
  if (st === "GMS") return "GMS";
  if (st === "CHR") return "CHR";
  return "Tous les magasins";
}

/** Tags produit d'une promo, dans l'ordre d'affichage (condi · pays · marque · variété). */
export function promoTags(
  p: Pick<ActivePromo, "condi" | "pays" | "marque" | "variete">,
): string[] {
  return [p.condi, p.pays, p.marque, p.variete]
    .map((t) => (t ?? "").trim())
    .filter(Boolean);
}

/**
 * Libellé riche d'une promo TARIF, ex. :
 *   « Groseille Mixte  12x125g  Belgique  Belorta   Prix Unitaire  2.80 EUR »
 * Nom d'article + tags produit + prix unitaire. Sert de libellé par défaut
 * (mention sur le BL) quand l'admin n'en saisit pas un à la main.
 */
export function composePriceLabel(p: {
  itemName?: string | null;
  itemCode: string;
  condi?: string | null;
  pays?: string | null;
  marque?: string | null;
  variete?: string | null;
  value: number | null;
}): string {
  const nom = (p.variete || p.itemName || p.itemCode).trim();
  const tags = promoTags(p).filter((t) => t !== nom);
  const prix = p.value != null ? `${p.value.toFixed(2)} EUR` : "—";
  // Espaces multiples volontaires : rend la lecture « en colonnes » du BL papier.
  return [nom, ...tags, `  Prix Unitaire  ${prix}`].join("  ").replace(/\s+$/g, "");
}

/** « 12/06 » — jour/mois court FR. */
function jjmm(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

/**
 * Période lisible : « du 12/06 au 19/06 », « jusqu'au 19/06 »,
 * « à partir du 12/06 » ou « permanente ».
 */
export function formatPeriode(startsAt: string | null, endsAt: string | null): string {
  const debut = jjmm(startsAt);
  const fin = jjmm(endsAt);
  if (debut && fin) return `du ${debut} au ${fin}`;
  if (fin) return `jusqu'au ${fin}`;
  if (debut) return `à partir du ${debut}`;
  return "permanente";
}

/** Nom affichable de l'article (nom produit résolu, sinon code). */
export function promoArticle(p: Pick<ActivePromo, "itemCode" | "itemName">): string {
  return p.itemName?.trim() || p.itemCode;
}

/** Titre principal d'une promo (libellé, sinon article). */
export function promoTitre(p: ActivePromo): string {
  return p.label?.trim() || promoArticle(p);
}
