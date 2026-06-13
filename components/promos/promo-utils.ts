/**
 * Utilitaires partagés du chantier Promotions v2
 * (PromoBanner, PromoNotifications, PromosManager).
 */

/** Promo active telle que servie par /api/promos?active=1 et /api/notifications. */
export interface ActivePromo {
  id: string;
  itemCode: string;
  kind: "PERCENT" | "X_PLUS_Y" | string;
  value: number | null;
  buyQty: number | null;
  freeQty: number | null;
  label: string | null;
  pitch: string | null;
  startsAt: string | null;
  endsAt: string | null;
  itemName?: string | null;
  /** non consultée par l'utilisateur (badge « NOUVEAU ») */
  isNew?: boolean;
}

/** Chip type courte : « −10 % » ou « 5+1 ». */
export function promoChip(p: Pick<ActivePromo, "kind" | "value" | "buyQty" | "freeQty">): string {
  if (p.kind === "PERCENT") return `−${String(Math.round((p.value ?? 0) * 100) / 100)} %`;
  return `${p.buyQty ?? "?"}+${p.freeQty ?? "?"}`;
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
