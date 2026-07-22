import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessScope, scopePayload, UNMAPPED_MESSAGE } from "@/lib/permissions";

/**
 * GET /api/plan-appel — cockpit manager pour piloter les appels.
 *
 * Pour chaque client : assignation (vendeur télévente + commercial), dernière
 * commande (SapOrder), incidents ouverts, dernier appel, jours d'appel, activation.
 *
 * Filtres : vendeur, commercial, type, active=actifs|inactifs, incidents=1,
 *           stale=<jours sans commande>.
 *
 * Raw SQL : agrégats + champs hors client Prisma typé (vendeur/activeTelevente).
 */
export const dynamic = "force-dynamic";

type Row = {
  id: string; code: string; nom: string; type: string | null;
  commercial: string | null; vendeur: string | null;
  tel1: string | null; tel2: string | null; joursAppel: string | null;
  activeTelevente: boolean; prospectStage: string | null;
  last_order: Date | null; openIncidents: number; last_call: Date | null;
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Droits : un commercial ne voit que SES clients (commercial OU vendeur =
  // son trigramme SAP). Compte non mappé → liste vide + message explicite.
  const scope = await getAccessScope(session);
  if (!scope.all && !scope.slpName) {
    return NextResponse.json({
      ok: true, clients: [], total: 0,
      restricted: true, message: UNMAPPED_MESSAGE, scope: scopePayload(scope),
    });
  }

  const sp = req.nextUrl.searchParams;
  const conds: Prisma.Sql[] = [];
  // Le cockpit d'appel = CLIENTS (et prospects gagnés). Les prospects importés
  // pour la prospection (prospectSource renseigné, non encore GAGNE) vivent
  // dans /prospection : sans ça, les 1 000 fiches sans commande (last_order NULL)
  // passent en tête (ORDER BY … NULLS FIRST) et saturent la LIMIT → 0 client.
  // RÈGLE « BL → client » : dès qu'une commande existe (< 365 j), le compte
  // réintègre le cockpit même s'il porte encore un prospectSource (il redevient
  // client automatiquement à la 1re commande, sans manip).
  conds.push(Prisma.sql`(c."prospectSource" IS NULL OR c."prospectStage" = 'GAGNE' OR lo."last_order" >= now() - interval '365 days')`);
  if (!scope.all && scope.slpName) {
    conds.push(Prisma.sql`(c."commercial" = ${scope.slpName} OR c."vendeur" = ${scope.slpName})`);
  }
  const vendeur = sp.get("vendeur");
  const commercial = sp.get("commercial");
  const type = sp.get("type");
  const active = sp.get("active");
  const incidents = sp.get("incidents") === "1";
  const stale = Number.parseInt(sp.get("stale") ?? "", 10);
  const search = sp.get("search")?.trim();

  if (vendeur) conds.push(Prisma.sql`c."vendeur" = ${vendeur}`);
  if (commercial === "__none__") conds.push(Prisma.sql`c."commercial" IS NULL`);
  else if (commercial) conds.push(Prisma.sql`c."commercial" = ${commercial}`);
  if (type) conds.push(Prisma.sql`c."type" = ${type}`);
  if (active === "actifs") conds.push(Prisma.sql`c."activeTelevente" = true`);
  if (active === "inactifs") conds.push(Prisma.sql`c."activeTelevente" = false`);
  if (incidents) conds.push(Prisma.sql`COALESCE(inc."open", 0) > 0`);
  if (Number.isFinite(stale) && stale > 0) {
    conds.push(Prisma.sql`(lo."last_order" IS NULL OR lo."last_order" < NOW() - (${stale} || ' days')::interval)`);
  }
  if (search) {
    const like = `%${search}%`;
    conds.push(Prisma.sql`(c."code" ILIKE ${like} OR c."nom" ILIKE ${like})`);
  }
  const whereSql = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}` : Prisma.empty;

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT c."id", c."code", c."nom", c."type", c."commercial", c."vendeur",
           c."tel1", c."tel2", c."joursAppel", c."activeTelevente", c."prospectStage",
           lo."last_order",
           COALESCE(inc."open", 0)::int AS "openIncidents",
           lc."last_call"
    FROM "Client" c
    LEFT JOIN (
      -- dernière commande = dernier BON DE LIVRAISON (SapOrder) uniquement.
      SELECT o."cardCode", MAX(o."docDate") AS "last_order"
      FROM "SapOrder" o WHERE o."cancelled" = false GROUP BY 1
    ) lo ON lo."cardCode" = c."code"
    LEFT JOIN (
      SELECT i."clientId", COUNT(*) AS "open"
      FROM "Incident" i WHERE i."resolved" = false GROUP BY 1
    ) inc ON inc."clientId" = c."id"
    LEFT JOIN (
      SELECT a."clientId", MAX(a."heureAppel") AS "last_call"
      FROM "AppelLog" a GROUP BY 1
    ) lc ON lc."clientId" = c."id"
    ${whereSql}
    ORDER BY lo."last_order" ASC NULLS FIRST, c."nom" ASC
    LIMIT 1000;
  `);

  const now = Date.now();
  const clients = rows.map((r) => ({
    id: r.id, code: r.code, nom: r.nom, type: r.type,
    commercial: r.commercial, vendeur: r.vendeur,
    tel1: r.tel1, tel2: r.tel2, joursAppel: r.joursAppel,
    activeTelevente: r.activeTelevente, prospectStage: r.prospectStage,
    openIncidents: Number(r.openIncidents),
    lastOrderDays: r.last_order ? Math.floor((now - new Date(r.last_order).getTime()) / 86_400_000) : null,
    lastCallDays: r.last_call ? Math.floor((now - new Date(r.last_call).getTime()) / 86_400_000) : null,
  }));

  return NextResponse.json({ ok: true, clients, total: clients.length, scope: scopePayload(scope) });
}
