import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { isDepartureReached } from "@/lib/livraison";
import { cached, invalidate } from "@/lib/ttlCache";
import { requireAdmin } from "@/lib/permissions";
import { listSessions, isPreparateur } from "@/lib/inventory";

/**
 * GET /api/nav-badges — LES pastilles de navigation en UN SEUL appel.
 *
 * Remplace les 5 polls que la Sidebar émettait séparément (notifications,
 * offres dues, commandes fournisseurs dues, inventaires à revoir, incidents
 * de réception) : l'agrégation se fait CÔTÉ SERVEUR, derrière un cache TTL.
 *
 * Contrat (consommé par lib/useNavBadges.ts) :
 *   { ok: true, notifications, offresDue, poDue, inventaire, incidents }
 * Tous les champs sont des nombres. Un compteur en échec vaut 0 — la route ne
 * renvoie JAMAIS d'erreur à un utilisateur authentifié (une pastille absente
 * vaut mieux qu'une sidebar cassée).
 *
 * `?refresh=1` purge le cache (préfixe `nav:badges`) avant lecture : utilisé
 * après l'évènement RECEPTION_INCIDENTS_CHANGED pour que la pastille incidents
 * bouge sans attendre le tick. Les caches SAP internes (`sidebar:*`, 120 s,
 * PARTAGÉS avec les routes due-count historiques) gardent leur propre TTL :
 * un refresh incidents ne doit pas marteler SAP.
 *
 * Découpage du cache — deux clés sous le même préfixe :
 *   • `nav:badges:global`      → compteurs identiques pour tous (offres, PO,
 *                                incidents, inventaires soumis) ;
 *   • `nav:badges:user:<id>`   → part dépendante de l'utilisateur : promos non
 *                                vues (isNew par PromoSeen) et droit de voir la
 *                                pastille inventaire (admin OU préparateur —
 *                                même règle que GET /api/inventaire).
 * Un cache unique partagé aurait fait fuiter le compte de notifications d'un
 * utilisateur vers les autres.
 */

export const dynamic = "force-dynamic";

const TTL_MS = 60_000;

/** Compteurs identiques pour tous les utilisateurs. */
type GlobalCounts = {
  offresDue: number;
  poDue: number;
  incidents: number;
  /** Inventaires « submitted » — exposé seulement si l'utilisateur peut les revoir. */
  inventaireSubmitted: number;
};

/** Part dépendante de l'utilisateur connecté. */
type UserCounts = {
  notifications: number;
  canManageInventaire: boolean;
};

/** Exécute un compteur en absorbant toute erreur → 0 (jamais d'échec global). */
async function safeCount(compute: () => Promise<number>): Promise<number> {
  try {
    return await compute();
  } catch {
    return 0;
  }
}

/**
 * Offres client (Quotations) au jour de départ — MÊME clé/TTL que
 * /api/bons-commande/due-count : les deux routes partagent le cache, l'appel
 * SAP n'est payé qu'une fois quel que soit le chemin qui le déclenche.
 */
function offresDueCount(): Promise<number> {
  return cached("sidebar:offres-due", 120_000, async () => {
    const filter = "DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'";
    const res = await sap.get<{ value: { DocDueDate?: string }[] }>(
      `Quotations?$select=DocDueDate&$top=200&$filter=${encodeURIComponent(filter)}`,
      // ⚠️ Sans le header Prefer, ce Service Layer plafonne la page à 20 documents.
      { headers: { Prefer: "odata.maxpagesize=200" } },
    );
    return (res.value ?? []).filter((q) => q.DocDueDate && isDepartureReached(q.DocDueDate)).length;
  });
}

/**
 * Commandes fournisseurs ouvertes arrivées à échéance — MÊME clé (datée : le
 * passage à minuit n'hérite pas du compte de la veille) et même TTL que
 * /api/sap/purchase-orders/due-count.
 */
function poDueCount(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  return cached(`sidebar:po-due:${today}`, 120_000, async () => {
    const filter = `DocumentStatus eq 'bost_Open' and DocDueDate le '${today}'`;
    const res = await sap.get<{ value: { DocEntry: number }[] }>(
      `PurchaseOrders?$select=DocEntry&$top=100&$filter=${encodeURIComponent(filter)}`,
    );
    return res.value?.length ?? 0;
  });
}

/** Incidents de réception OUVERTS (même sémantique que /api/entrees/incidents). */
async function incidentsCount(): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS "count" FROM "ReceptionIncident" WHERE "resolved" = false`;
  return rows[0]?.count ?? 0;
}

/** Inventaires soumis en attente de revue (même règle que GET /api/inventaire). */
async function inventaireSubmittedCount(): Promise<number> {
  const sessions = await listSessions();
  return sessions.filter((s) => s.status === "submitted").length;
}

function globalCounts(): Promise<GlobalCounts> {
  return cached("nav:badges:global", TTL_MS, async () => {
    const [offresDue, poDue, incidents, inventaireSubmitted] = await Promise.all([
      safeCount(offresDueCount),
      safeCount(poDueCount),
      safeCount(incidentsCount),
      safeCount(inventaireSubmittedCount),
    ]);
    return { offresDue, poDue, incidents, inventaireSubmitted };
  });
}

/**
 * Promos actives non vues par l'utilisateur — même définition d'« isNew » que
 * /api/notifications (aucune ligne PromoSeen), mais en COUNT côté SQL : pas
 * besoin de rapatrier le détail des promos pour une pastille.
 */
async function unreadNotificationsCount(userId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS "count"
    FROM "Promo" p
    LEFT JOIN "PromoSeen" s ON s."promoId" = p."id" AND s."userId" = ${userId}
    WHERE p."active" = true
      AND (p."startsAt" IS NULL OR p."startsAt" <= NOW())
      AND (p."endsAt" IS NULL OR p."endsAt" >= NOW())
      AND s."promoId" IS NULL`;
  return rows[0]?.count ?? 0;
}

function userCounts(session: Session, userId: string): Promise<UserCounts> {
  return cached(`nav:badges:user:${userId}`, TTL_MS, async () => {
    const [notifications, admin, prep] = await Promise.all([
      safeCount(() => unreadNotificationsCount(userId)),
      requireAdmin(session).catch(() => false),
      isPreparateur(session.user?.email).catch(() => false),
    ]);
    return { notifications, canManageInventaire: admin || prep };
  });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // Identifiant utilisateur : id de session, repli email (convention des autres
  // routes — `id` n'est pas déclaré sur le type Session, d'où le cast souple).
  const su = session.user as { id?: string | null; email?: string | null };
  const userId = su.id ?? su.email ?? null;
  if (!userId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // ?refresh=1 → purge global + toutes les entrées par utilisateur (préfixe).
  if (new URL(req.url).searchParams.get("refresh") === "1") invalidate("nav:badges");

  const [g, u] = await Promise.all([globalCounts(), userCounts(session, userId)]);

  return NextResponse.json({
    ok: true,
    notifications: u.notifications,
    offresDue: g.offresDue,
    poDue: g.poDue,
    // Même visibilité que /api/inventaire : la pastille n'apparaît que pour
    // ceux qui peuvent effectivement revoir les comptages.
    inventaire: u.canManageInventaire ? g.inventaireSubmitted : 0,
    incidents: g.incidents,
  });
}
