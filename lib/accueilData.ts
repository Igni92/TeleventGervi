import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { periodBounds } from "@/lib/pilotage-time";
import { familyOf, FRUIT_FAMILIES } from "@/lib/familles";
import { colisInfo } from "@/lib/colis";
import {
  freshCogsOrderFromSql, FAB_COST_LATERAL, COGS_FRESH_RECEPTION_DAYS,
  COGS_MARGIN_HYBRID, COGS_COSTED_HYBRID,
} from "@/lib/cogs";
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
const MARGE_KG_KEY = "pilotage:marge-kg:day";
const VENTILATION_KEY = "pilotage:ventilation:day";
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

/* ─────── Ventilation du jour : CA + poids par famille, et par commande ────── */

export interface FamilyVent { key: string; label: string; weightKg: number; caEur: number }
export interface OrderVent { docNum: number | null; cardName: string | null; weightKg: number; caEur: number }
export interface VentilationJour {
  totals: { weightKg: number; caEur: number; ordersCount: number };
  families: FamilyVent[];
  orders: OrderVent[];
}

/**
 * Ventilation des ventes du jour (SapOrder) : CA HT + poids par FAMILLE de fruit,
 * et par COMMANDE. Sert aux bulles de survol des KPI (part du volume / du CA).
 * Poids ligne = quantité × poids unitaire ; CA ligne = lineTotal HT.
 */
export async function getVentilationJour(): Promise<VentilationJour> {
  return cached(VENTILATION_KEY, TTL_MS, async () => {
    const { start, end } = periodBounds("day");
    const [famRows, ordRows] = await Promise.all([
      prisma.$queryRaw<{ name: string | null; grp: string | null; w: number; ca: number }[]>`
        SELECT p."itemName" AS name, p."groupName" AS grp,
               COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS w,
               COALESCE(SUM(l."lineTotal"), 0)::float AS ca
        FROM "SapOrder" o
        JOIN "SapOrderLine" l ON l."docEntry" = o."docEntry"
        JOIN "Product" p ON p."itemCode" = l."itemCode"
        WHERE o."cancelled" = false AND l."isService" = false
          AND o."docDate" >= ${start} AND o."docDate" < ${end}
        GROUP BY p."itemName", p."groupName"`,
      prisma.$queryRaw<{ dn: number | null; card: string | null; w: number; ca: number }[]>`
        SELECT o."docNum" AS dn, o."cardName" AS card,
               COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS w,
               COALESCE(SUM(l."lineTotal"), 0)::float AS ca
        FROM "SapOrder" o
        JOIN "SapOrderLine" l ON l."docEntry" = o."docEntry"
        JOIN "Product" p ON p."itemCode" = l."itemCode"
        WHERE o."cancelled" = false AND l."isService" = false
          AND o."docDate" >= ${start} AND o."docDate" < ${end}
        GROUP BY o."docEntry", o."docNum", o."cardName"`,
    ]);

    const byFamily = new Map<string, FamilyVent>();
    let totW = 0, totCa = 0;
    for (const r of famRows) {
      const fam = familyOf(r.name, r.grp);
      const cur = byFamily.get(fam.key) ?? { key: fam.key, label: fam.label, weightKg: 0, caEur: 0 };
      cur.weightKg += Number(r.w) || 0;
      cur.caEur += Number(r.ca) || 0;
      byFamily.set(fam.key, cur);
      totW += Number(r.w) || 0;
      totCa += Number(r.ca) || 0;
    }
    const families = [...byFamily.values()].filter((f) => f.weightKg > 0 || f.caEur > 0);

    const orders: OrderVent[] = ordRows
      .map((r) => ({ docNum: r.dn, cardName: r.card, weightKg: Number(r.w) || 0, caEur: Number(r.ca) || 0 }))
      .sort((a, b) => b.caEur - a.caEur);

    return { totals: { weightKg: totW, caEur: totCa, ordersCount: orders.length }, families, orders };
  });
}

/* ─────────────── Marge / kg du jour (flat + détail par famille) ──────────── */

export interface FamilyMarge {
  key: string;
  label: string;
  weightKg: number;
  margeEur: number;
  /** Marge € par kg vendu (0 si aucun poids). */
  margeKg: number;
}
export interface MargeKgDay {
  overall: { weightKg: number; margeEur: number; margeKg: number };
  families: FamilyMarge[];
}

/**
 * Marge € PAR KG vendue aujourd'hui — globale + ventilée par FAMILLE de fruit.
 *
 * Audit 2026-08-13 (#9) : l'ancien calcul était FAUX à deux titres —
 *   1. le POIDS était sommé sur TOUTES les lignes, mais la MARGE seulement sur
 *      les lignes ayant un coût EM (barquettes/kits sans réception d'achat →
 *      poids au dénominateur SANS marge au numérateur ⇒ €/kg artificiellement bas) ;
 *   2. le coût venait de la DERNIÈRE réception EM sans plafond de fraîcheur ni
 *      repli — exactement le calcul que lib/cogs documente comme faux (un coût
 *      d'hiver appliqué à une vente d'été sur de la fraise saisonnière).
 * On aligne donc sur le CHEMIN HYBRIDE de référence (cf. aggregateActivity) :
 * réception RÉCENTE (≤ COGS_FRESH_RECEPTION_DAYS ≈ 21 j) → repli fabrication →
 * repli coût SAP de la ligne. Et on somme POIDS et MARGE sur le MÊME jeu de
 * lignes COSTÉES (FILTER COGS_COSTED_HYBRID) : plus de poids « nu » au
 * dénominateur. Mis en cache (préfixe `pilotage:`).
 */
export async function getMargeKgFamilles(): Promise<MargeKgDay> {
  return cached(MARGE_KG_KEY, TTL_MS, async () => {
    const { start, end } = periodBounds("day");
    // Alias imposés par lib/cogs : l = SapOrderLine, i = SapOrder, cogs/fab = LATERAL.
    const rows = await prisma.$queryRaw<{ name: string | null; grp: string | null; w: number; marge: number }[]>(Prisma.sql`
      SELECT p."itemName" AS name, p."groupName" AS grp,
             COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0))
                          FILTER (WHERE ${COGS_COSTED_HYBRID}), 0)::float AS w,
             COALESCE(SUM(${COGS_MARGIN_HYBRID}), 0)::float AS marge
      FROM ${freshCogsOrderFromSql(COGS_FRESH_RECEPTION_DAYS)} ${FAB_COST_LATERAL}
      LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
      WHERE i."cancelled" = false AND l."isService" = false
        AND i."docDate" >= ${start} AND i."docDate" < ${end}
      GROUP BY p."itemName", p."groupName"`);

    const byFamily = new Map<string, FamilyMarge>();
    let totW = 0, totM = 0;
    for (const r of rows) {
      const fam = familyOf(r.name, r.grp);
      const cur = byFamily.get(fam.key) ?? { key: fam.key, label: fam.label, weightKg: 0, margeEur: 0, margeKg: 0 };
      cur.weightKg += Number(r.w) || 0;
      cur.margeEur += Number(r.marge) || 0;
      byFamily.set(fam.key, cur);
      totW += Number(r.w) || 0;
      totM += Number(r.marge) || 0;
    }
    const families = [...byFamily.values()]
      .map((f) => ({ ...f, margeKg: f.weightKg > 0 ? f.margeEur / f.weightKg : 0 }))
      .filter((f) => f.weightKg > 0)
      .sort((a, b) => b.margeKg - a.margeKg);
    return { overall: { weightKg: totW, margeEur: totM, margeKg: totW > 0 ? totM / totW : 0 }, families };
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

  invalidate(MARGE_KG_KEY);
  try {
    await getMargeKgFamilles();
  } catch (e) {
    console.error("[warmAccueil] marge-kg", e instanceof Error ? e.message : String(e));
  }

  invalidate(VENTILATION_KEY);
  try {
    await getVentilationJour();
  } catch (e) {
    console.error("[warmAccueil] ventilation", e instanceof Error ? e.message : String(e));
  }

  invalidate(recentOrdersKey(WARM_RECENT_ORDERS));
  try {
    await getRecentOrders(WARM_RECENT_ORDERS);
  } catch (e) {
    console.error("[warmAccueil] recent-orders", e instanceof Error ? e.message : String(e));
  }
}
