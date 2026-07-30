import { prisma } from "@/lib/prisma";
import { periodBounds } from "@/lib/pilotage-time";
import { familyOf, FRUIT_FAMILIES } from "@/lib/familles";
import { colisInfo } from "@/lib/colis";
import { cached, invalidate } from "@/lib/ttlCache";
import { warmActivity } from "@/lib/pilotageActivity";

/**
 * Données du chemin de LANCEMENT de l'accueil, servies depuis le MIROIR (jamais
 * SAP en direct) et mises en cache sous le préfixe `pilotage:` — donc purgées ET
 * ré-chauffées par le cron mirror à chaque tick qui ramène du neuf (cf.
 * `warmAccueil`). Objectif : l'accueil ne fait plus que lire des caches chauds,
 * aucun recalcul ni aller-retour réseau SAP au chargement.
 *
 *   • poids vendu par famille de fruit (panneau PoidsFamilles) ;
 *   • dernières commandes globales (panneau DernieresCommandes, liste par défaut).
 *
 * Les KPI du jour (panneau KpiStrip) vivent dans `lib/pilotageActivity`
 * (`warmActivity`), ré-chauffés ici aussi via `warmAccueil`.
 */

// Aligné sur PILOTAGE_ACTIVITY_TTL_MS : doit couvrir l'intervalle du cron
// miroir (10 min), sinon le cache est froid une fois sur deux. Fraîcheur assurée
// par `invalidate("pilotage:")` au tick, pas par l'expiration.
const TTL_MS = 15 * 60_000;

const POIDS_FAMILLES_KEY = "pilotage:poids-familles:day";
const recentOrdersKey = (limit: number) => `pilotage:orders:recent:${limit}`;

export interface FamilyWeight {
  key: string;
  label: string;
  weightKg: number;
}

/**
 * Poids VENDU aujourd'hui par famille de fruit — MÊME requête que l'ancienne
 * route /api/accueil/poids-familles, désormais mise en cache. Toujours les 6
 * familles connues (0 si rien vendu), puis les autres familles ayant des ventes.
 */
export async function getPoidsFamilles(): Promise<FamilyWeight[]> {
  return cached(POIDS_FAMILLES_KEY, TTL_MS, async () => {
    const { start, end } = periodBounds("day");
    const rows = await prisma.$queryRaw<{ name: string | null; grp: string | null; w: number }[]>`
      SELECT p."itemName" AS name, p."groupName" AS grp,
             COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS w
      FROM "SapOrder" o
      JOIN "SapOrderLine" l ON l."docEntry" = o."docEntry"
      JOIN "Product" p ON p."itemCode" = l."itemCode"
      WHERE o."cancelled" = false AND l."isService" = false
        AND o."docDate" >= ${start} AND o."docDate" < ${end}
      GROUP BY p."itemName", p."groupName"`;

    const byFamily = new Map<string, FamilyWeight>();
    for (const r of rows) {
      const fam = familyOf(r.name, r.grp);
      const cur = byFamily.get(fam.key) ?? { key: fam.key, label: fam.label, weightKg: 0 };
      cur.weightKg += Number(r.w) || 0;
      byFamily.set(fam.key, cur);
    }

    const families = FRUIT_FAMILIES.map(
      (f) => byFamily.get(f.key) ?? { key: f.key, label: f.label, weightKg: 0 },
    );
    for (const [k, v] of byFamily) {
      if (!FRUIT_FAMILIES.some((f) => f.key === k) && v.weightKg > 0) families.push(v);
    }
    return families;
  });
}

export interface RecentOrder {
  docEntry: number;
  docNum: number | null;
  docDate: Date;
  cardCode: string;
  cardName: string | null;
  total: number;   // TTC
  totalHT: number; // HT
  weightKg: number;
  colis: number;
}

/**
 * Dernières commandes GLOBALES depuis le MIROIR (remplace l'appel SAP en direct
 * de GET /api/sap/orders?last=N sans code client). Poids net et nb de colis EXACT
 * calculés comme le chemin live (poids unitaire × qté ; qté ÷ unitsPerColis).
 *
 * Le miroir est à jour au tick près (≤ 10 min) ET immédiatement pour les
 * commandes créées via TeleVent (insert optimiste `mirrorInsertOrder`) — donc
 * cette liste ne « rate » jamais une commande passée depuis l'app.
 */
export async function getRecentOrders(limit: number): Promise<RecentOrder[]> {
  return cached(recentOrdersKey(limit), TTL_MS, async () => {
    const orders = await prisma.sapOrder.findMany({
      where: { cancelled: false },
      orderBy: { docEntry: "desc" },
      take: limit,
      select: {
        docEntry: true, docNum: true, docDate: true, cardCode: true, cardName: true,
        docTotal: true, vatSum: true,
        lines: { select: { itemCode: true, quantity: true } },
      },
    });

    const itemCodes = Array.from(
      new Set(orders.flatMap((o) => o.lines.map((l) => l.itemCode).filter((c): c is string => !!c))),
    );
    const weightByItem = new Map<string, number>();
    const unitsPerColisByItem = new Map<string, number>();
    if (itemCodes.length > 0) {
      const prods = await prisma.product.findMany({
        where: { itemCode: { in: itemCodes } },
        select: { itemCode: true, salesUnit: true, salesUnitWeight: true, salesQtyPerPackUnit: true },
      });
      for (const p of prods) {
        weightByItem.set(p.itemCode, p.salesUnitWeight ?? 0);
        unitsPerColisByItem.set(p.itemCode, colisInfo(p).unitsPerColis);
      }
    }

    return orders.map((o) => {
      const weightKg = o.lines.reduce(
        (s, l) => s + (l.quantity || 0) * (l.itemCode ? weightByItem.get(l.itemCode) ?? 0 : 0), 0,
      );
      const colis = o.lines.reduce(
        (s, l) => s + (l.quantity || 0) / (l.itemCode ? unitsPerColisByItem.get(l.itemCode) || 1 : 1), 0,
      );
      return {
        docEntry: o.docEntry,
        docNum: o.docNum,
        docDate: o.docDate,
        cardCode: o.cardCode,
        cardName: o.cardName,
        totalHT: o.docTotal,               // miroir stocke le HT (= DocTotal − VatSum)
        total: o.docTotal + o.vatSum,      // TTC reconstitué
        weightKg: Math.round(weightKg * 10) / 10,
        colis: Math.round(colis * 10) / 10,
      };
    });
  });
}

/** Nb de dernières commandes ré-chauffées (l'accueil charge `last=8`). */
const WARM_RECENT_ORDERS = 8;

/**
 * Ré-chauffe TOUT le chemin de lancement de l'accueil après un tick mirror :
 * KPI du jour (jour/semaine/mois), poids par famille, dernières commandes.
 * Appelé par le cron mirror juste après `invalidate("pilotage:")`. Best-effort :
 * chaque bloc échoue en silence (le prochain chargement recalculera), rien ne
 * doit faire échouer la synchro.
 */
export async function warmAccueil(): Promise<void> {
  await warmActivity();

  invalidate(POIDS_FAMILLES_KEY);
  try {
    await getPoidsFamilles();
  } catch (e) {
    console.error("[warmAccueil] poids-familles", e instanceof Error ? e.message : String(e));
  }

  invalidate(recentOrdersKey(WARM_RECENT_ORDERS));
  try {
    await getRecentOrders(WARM_RECENT_ORDERS);
  } catch (e) {
    console.error("[warmAccueil] recent-orders", e instanceof Error ? e.message : String(e));
  }
}
