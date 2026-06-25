import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientSchema, clientQuerySchema } from "@/lib/validations";
import { standardizePhone } from "@/lib/phone";
import { getAccessScope, getOwnSlpName, scopePayload, UNMAPPED_MESSAGE } from "@/lib/permissions";
import { parisStartOfDay, parisEndOfDay, parisDayOfWeek } from "@/lib/paris-time";

/** Enrichit une liste de clients avec activeTelevente + vendeur (raw SQL :
 *  ces champs ne sont pas dans le client Prisma typé tant que generate est bloqué). */
async function enrichActivation(
  ids: string[],
): Promise<Map<string, { activeTelevente: boolean; vendeur: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ id: string; activeTelevente: boolean; vendeur: string | null }[]>(
    Prisma.sql`SELECT "id", "activeTelevente", "vendeur" FROM "Client" WHERE "id" IN (${Prisma.join(ids)})`,
  );
  return new Map(rows.map((r) => [r.id, { activeTelevente: r.activeTelevente, vendeur: r.vendeur }]));
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Droits : un commercial ne voit que SES clients (commercial OU vendeur =
  // son trigramme SAP). Compte non mappé → liste vide + message explicite.
  const scope = await getAccessScope(session);

  try {
    const { searchParams } = new URL(req.url);
    const query = clientQuerySchema.parse({
      search: searchParams.get("search") || undefined,
      type: searchParams.get("type") || undefined,
      commercial: searchParams.get("commercial") || undefined,
      page: searchParams.get("page") || 1,
      limit: searchParams.get("limit") || 20,
      aujourdhui: searchParams.get("aujourdhui") || undefined,
    });

    const where: Record<string, unknown> = {};

    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: "insensitive" } },
        { nom: { contains: query.search, mode: "insensitive" } },
        { commercial: { contains: query.search, mode: "insensitive" } },
        { type: { contains: query.search, mode: "insensitive" } },
      ];
    }
    if (query.type && query.type !== "ALL") where.type = query.type;
    if (query.commercial) where.commercial = { contains: query.commercial, mode: "insensitive" };

    // Scope non-admin : pré-filtre raw SQL (vendeur hors client Prisma typé).
    let scopeIds: Set<string> | null = null;
    if (!scope.all) {
      if (!scope.slpName) {
        return NextResponse.json({
          clients: [], total: 0, page: query.page, limit: query.limit, totalPages: 0,
          restricted: true, message: UNMAPPED_MESSAGE, scope: scopePayload(scope),
        });
      }
      const rows = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT "id" FROM "Client" WHERE "commercial" = ${scope.slpName} OR "vendeur" = ${scope.slpName}`,
      );
      scopeIds = new Set(rows.map((r) => r.id));
    }

    // Filtres hors client typé (activeTelevente / vendeur) : pré-filtre raw SQL
    // → liste d'ids injectée dans le where typé.
    let idIn: string[] | null = null;
    const activeParam = searchParams.get("active");   // "actifs" | "inactifs"
    const vendeurParam = searchParams.get("vendeur"); // trigramme
    if (activeParam === "actifs" || activeParam === "inactifs" || vendeurParam) {
      const conds: Prisma.Sql[] = [];
      if (activeParam === "actifs") conds.push(Prisma.sql`"activeTelevente" = true`);
      if (activeParam === "inactifs") conds.push(Prisma.sql`"activeTelevente" = false`);
      if (vendeurParam) conds.push(Prisma.sql`"vendeur" = ${vendeurParam}`);
      const rows = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT "id" FROM "Client" WHERE ${Prisma.join(conds, " AND ")}`,
      );
      idIn = rows.map((r) => r.id);
    }
    // Intersection scope ∩ filtres explicites.
    if (scopeIds) idIn = idIn ? idIn.filter((id) => scopeIds.has(id)) : Array.from(scopeIds);
    if (idIn) where.id = { in: idIn };

    // Onglet "Aujourd'hui" : filtrer les clients dont joursAppel inclut le jour courant
    // et qui n'ont pas encore eu d'appel aujourd'hui
    if (query.aujourdhui) {
      // Jour ouvré en heure de Paris (cohérent avec /api/console).
      const todayDay = parisDayOfWeek(); // 0=Dim, 1=Lun...6=Sam
      const startOfDay = parisStartOfDay();
      const endOfDay = parisEndOfDay(); // borne haute EXCLUSIVE (début du jour suivant)

      // Récupérer tous les clients qui ont joursAppel renseigné
      // Le filtrage par jour se fait côté JS (données stockées en string CSV)
      const now = new Date();
      const [allClients, total] = await Promise.all([
        prisma.client.findMany({
          where: {
            ...where,
            joursAppel: { not: null },
          },
          include: {
            _count: { select: { rappels: true, appels: true } },
            appels: {
              where: {
                heureAppel: { gte: startOfDay, lt: endOfDay },
              },
              orderBy: { heureAppel: "desc" },
              take: 1,
            },
            // Rappels planifiés dans le futur → le client est "snooze" jusqu'à cette date
            rappels: {
              where: {
                statut: "PLANIFIE",
                dateRappel: { gt: now },
              },
              take: 1,
            },
          },
          orderBy: { nom: "asc" },
        }),
        prisma.client.count({ where: { ...where, joursAppel: { not: null } } }),
      ]);

      // Filtrer :
      //  1. joursAppel contient le jour d'aujourd'hui
      //  2. Pas encore appelé aujourd'hui
      //  3. Aucun rappel planifié dans le futur (le rappel "bloque" les jours d'appel)
      const filtered = allClients.filter((c) => {
        if (!c.joursAppel) return false;
        const days = c.joursAppel.split(",").map(Number);
        const scheduledToday = days.includes(todayDay);
        const alreadyCalled = c.appels.length > 0;
        const snoozed = c.rappels.length > 0; // rappel futur existant
        return scheduledToday && !alreadyCalled && !snoozed;
      });

      const paginated = filtered.slice(
        (query.page - 1) * query.limit,
        query.page * query.limit
      );

      // Récupérer la date de dernière commande pour chaque client paginé
      const paginatedIds = paginated.map((c) => c.id);
      const lastCdes = paginatedIds.length > 0
        ? await prisma.appelLog.findMany({
            where: { clientId: { in: paginatedIds }, type: "COMMANDE" },
            orderBy: { heureAppel: "desc" },
            distinct: ["clientId"],
            select: { clientId: true, heureAppel: true },
          })
        : [];
      const cdeMap = new Map(lastCdes.map((c) => [c.clientId, c.heureAppel]));
      const actMap = await enrichActivation(paginatedIds);

      return NextResponse.json({
        clients: paginated.map((c) => ({
          ...c,
          derniereCommande: cdeMap.get(c.id) ?? null,
          activeTelevente: actMap.get(c.id)?.activeTelevente ?? false,
          vendeur: actMap.get(c.id)?.vendeur ?? null,
        })),
        total: filtered.length,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(filtered.length / query.limit),
        scope: scopePayload(scope),
      });
    }

    // Onglet normal : tous les clients
    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { nom: "asc" },
        include: {
          _count: { select: { rappels: true, appels: true } },
          // Dernière commande pour affichage dans le listing
          appels: {
            where: { type: "COMMANDE" },
            orderBy: { heureAppel: "desc" },
            take: 1,
            select: { heureAppel: true },
          },
        },
      }),
      prisma.client.count({ where }),
    ]);

    const actMap = await enrichActivation(clients.map((c) => c.id));

    return NextResponse.json({
      clients: clients.map((c) => ({
        ...c,
        derniereCommande: c.appels[0]?.heureAppel ?? null,
        activeTelevente: actMap.get(c.id)?.activeTelevente ?? false,
        vendeur: actMap.get(c.id)?.vendeur ?? null,
      })),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
      scope: scopePayload(scope),
    });
  } catch (error) {
    console.error("[GET /api/clients]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  try {
    const body = await req.json();
    // Standardisation des téléphones AVANT validation (saisie souvent sale :
    // points, espaces, préfixe international, surplus « / 65 »…) — cohérent avec
    // le PUT d'édition : on stocke 10 chiffres, l'affichage regroupe par 2.
    for (const k of ["tel1", "tel2", "tel3"] as const) {
      if (typeof body?.[k] === "string" && body[k].trim()) body[k] = standardizePhone(body[k]);
    }
    const data = clientSchema.parse(body);

    // Anti-IDOR : un non-admin ne peut créer un client QUE sous son propre
    // trigramme (interdit de s'attribuer le client d'un autre commercial).
    // Admin : le `commercial` du body est respecté tel quel.
    const scope = await getAccessScope(session);
    let commercial = data.commercial || null;
    if (!scope.all) {
      const own = await getOwnSlpName(session);
      commercial = own || commercial;
    }

    const existing = await prisma.client.findUnique({ where: { code: data.code } });
    if (existing) {
      return NextResponse.json({ error: "Un client avec ce code existe déjà" }, { status: 409 });
    }

    const client = await prisma.client.create({
      data: {
        code: data.code,
        nom: data.nom,
        type: data.type || null,
        commercial,
        tel1: data.tel1 || null,
        tel2: data.tel2 || null,
        tel3: data.tel3 || null,
        email: data.email?.trim().toLowerCase() || null,
        notes: data.notes || null,
        joursAppel: data.joursAppel?.length ? data.joursAppel.join(",") : null,
        joursLivraison: data.joursLivraison?.length ? data.joursLivraison.join(",") : null,
      },
    });

    return NextResponse.json(client, { status: 201 });
  } catch (error) {
    console.error("[POST /api/clients]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
