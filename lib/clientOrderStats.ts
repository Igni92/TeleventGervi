/**
 * HABITUDES DE COMMANDE d'un client — pour les garde-fous de vente
 * (lib/safeguards.ts : « volume > N × la moyenne du client », « total > N × le
 * panier moyen »).
 *
 * Source : MIROIR LOCAL SapOrder/SapOrderLine (latence 0, pas d'appel SAP) —
 * la synchro delta le tient à jour, et l'insert optimiste de la création de
 * commande y ajoute chaque bon dès sa création.
 *
 * Unités : les quantités par article sont en UNITÉ DE STOCK SAP (pièces, ou kg
 * pour les articles au poids) — les consommateurs convertissent vers l'unité
 * d'affichage (colis) via le packDivisor de l'article. Le panier moyen est HT
 * (docTotal TTC − vatSum).
 */
import { prisma } from "@/lib/prisma";

export interface ClientOrderStats {
  /** Nb de commandes de la fenêtre (≤ maxOrders). */
  nbCommandes: number;
  /** Panier moyen HT sur la fenêtre — null si aucune commande. */
  panierMoyen: { moyenneHT: number; nbCommandes: number } | null;
  /** Par article : moyenne des quantités PAR COMMANDE CONTENANT l'article
   *  (unité de stock SAP) + nb de commandes le contenant. */
  parArticle: Record<string, { moyenne: number; nbCommandes: number }>;
}

const EMPTY: ClientOrderStats = { nbCommandes: 0, panierMoyen: null, parArticle: {} };

/** Tous les CardCodes SAP d'un client TeleVent (principal + modes de livraison). */
export async function resolveClientCardCodes(clientId: string): Promise<string[]> {
  const out: string[] = [];
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { code: true } });
  if (client?.code) out.push(client.code);
  try {
    const modes = await prisma.$queryRawUnsafe<{ sapCardCode: string }[]>(
      `SELECT DISTINCT "sapCardCode" FROM "ClientDeliveryMode" WHERE "clientId" = $1`, clientId,
    );
    for (const m of modes) if (m.sapCardCode && !out.includes(m.sapCardCode)) out.push(m.sapCardCode);
  } catch { /* table optionnelle */ }
  return out;
}

/**
 * Stats d'habitude d'un client (fenêtre : `maxOrders` dernières commandes sur
 * `days` jours). Best-effort : miroir vide ou DB indisponible → stats vides
 * (les garde-fous concernés se désarment d'eux-mêmes).
 */
export async function getClientOrderStats(
  cardCodes: string[],
  opts: { maxOrders?: number; days?: number } = {},
): Promise<ClientOrderStats> {
  if (cardCodes.length === 0) return EMPTY;
  const maxOrders = opts.maxOrders ?? 20;
  const days = opts.days ?? 365;
  try {
    const since = new Date(Date.now() - days * 86_400_000);
    const orders = await prisma.sapOrder.findMany({
      where: { cardCode: { in: cardCodes }, cancelled: false, docDate: { gte: since } },
      orderBy: { docDate: "desc" },
      take: maxOrders,
      select: { docEntry: true, docTotal: true, vatSum: true },
    });
    if (orders.length === 0) return EMPTY;

    const totalHT = orders.reduce((s, o) => s + Math.max(0, (o.docTotal ?? 0) - (o.vatSum ?? 0)), 0);
    const panierMoyen = { moyenneHT: totalHT / orders.length, nbCommandes: orders.length };

    const lines = await prisma.sapOrderLine.findMany({
      where: { docEntry: { in: orders.map((o) => o.docEntry) }, isService: false, itemCode: { not: null } },
      select: { docEntry: true, itemCode: true, quantity: true },
    });
    // Σ quantité par (commande, article) → moyenne par commande CONTENANT l'article.
    const perOrderItem = new Map<string, number>();          // `${docEntry}|${itemCode}` → qty
    for (const l of lines) {
      const key = `${l.docEntry}|${l.itemCode}`;
      perOrderItem.set(key, (perOrderItem.get(key) ?? 0) + (l.quantity || 0));
    }
    const agg = new Map<string, { total: number; nb: number }>();
    for (const [key, qty] of perOrderItem) {
      const itemCode = key.slice(key.indexOf("|") + 1);
      const cur = agg.get(itemCode) ?? { total: 0, nb: 0 };
      cur.total += qty; cur.nb += 1;
      agg.set(itemCode, cur);
    }
    const parArticle: ClientOrderStats["parArticle"] = {};
    for (const [itemCode, a] of agg) {
      if (a.nb > 0) parArticle[itemCode] = { moyenne: a.total / a.nb, nbCommandes: a.nb };
    }
    return { nbCommandes: orders.length, panierMoyen, parArticle };
  } catch {
    return EMPTY;
  }
}

/**
 * true si le client (un de ses CardCodes) a déjà ≥ 1 commande SAISIE le jour
 * `dayISO` (yyyy-mm-dd, date murale Paris) — règle « doublonJour ». Les DocDate
 * SAP sont des dates pures (minuit UTC dans le miroir) → bornes UTC du jour.
 */
export async function hasOrderOnDay(cardCodes: string[], dayISO: string): Promise<boolean> {
  if (cardCodes.length === 0) return false;
  try {
    const start = new Date(`${dayISO}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 86_400_000);
    const n = await prisma.sapOrder.count({
      where: { cardCode: { in: cardCodes }, cancelled: false, docDate: { gte: start, lt: end } },
    });
    return n > 0;
  } catch {
    return false;
  }
}
