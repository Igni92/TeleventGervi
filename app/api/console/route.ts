import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeInsights } from "@/lib/insights";
import { getAccessScope, getOwnSlpName } from "@/lib/permissions";

/**
 * GET /api/console
 *
 * Returns everything the daily call console needs in a single roundtrip:
 *   - today's queue (clients scheduled today, not yet called, not snoozed)
 *   - full details per client (notes, joursAppel, tel*, commercial, type)
 *   - last 5 commandes per client (history shown inline)
 *   - planned rappels per client
 *   - aggregate today stats (called / commande / demain / remaining)
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  const todayDay = now.getDay(); // 0..6

  // Today's temp assignments for me (clients I've claimed from other commercials)
  const myClaims = session.user.id
    ? await prisma.tempAssignment.findMany({
        where: { userId: session.user.id, date: todayStart },
        select: { clientId: true, fromCommercial: true },
      })
    : [];
  const claimedMap = new Map(myClaims.map((c) => [c.clientId, c.fromCommercial]));

  // ── Périmètre de la console (poste de travail PERSONNEL) ──
  // On n'affiche QUE les clients dont le VENDEUR (= celui qui réalise les ventes)
  // est le trigramme du commercial connecté. On NE filtre PAS sur `commercial`
  // (account manager) : un client géré par un collègue mais vendu par moi DOIT
  // apparaître, et un client dont je suis l'account manager mais que je ne vends
  // pas NE doit PAS encombrer ma file.
  //   - non-admin mappé      → son slpName
  //   - non-admin non mappé  → console vide (cohérent avec le reste de l'app)
  //   - admin                → son propre trigramme (résolu via email) ; si on ne
  //                            peut pas le résoudre → repli sur la vue globale
  //                            (aucune régression pour un admin hors mapping).
  // + clients récupérés aujourd'hui (TempAssignment) pour conserver la
  //   couverture ponctuelle d'un collègue absent.
  // `vendeur` est hors client Prisma typé → pré-filtre raw SQL → liste d'ids.
  const scope = await getAccessScope(session);
  const mySlp = scope.all ? await getOwnSlpName(session) : scope.slpName;
  let scopeIdList: string[] | null = null; // null = aucun filtre (vue globale)
  if (!(scope.all && !mySlp)) {
    const rows = mySlp
      ? await prisma.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT "id" FROM "Client" WHERE "vendeur" = ${mySlp}`,
        )
      : [];
    const scopeIds = new Set<string>(rows.map((r) => r.id));
    for (const c of myClaims) scopeIds.add(c.clientId);
    scopeIdList = Array.from(scopeIds);
  }

  // ── Présence du jour → distribution des clients ──
  // Un commercial absent : ses clients sont signalés "à couvrir" pour les présents.
  const usersForPresence = await prisma.user.findMany({
    select: { id: true, name: true, stockSharePct: true },
  });
  const presencesToday = await prisma.presence.findMany({ where: { date: todayStart } });
  const presByUser = new Map(presencesToday.map((p) => [p.userId, p.present]));
  const absentNames = new Set(
    usersForPresence.filter((u) => u.name && (presByUser.get(u.id) ?? true) === false).map((u) => u.name as string),
  );
  const presentNames = usersForPresence
    .filter((u) => u.name && (presByUser.get(u.id) ?? true) !== false)
    .map((u) => u.name as string);
  const myStockSharePct = usersForPresence.find((u) => u.id === session.user!.id)?.stockSharePct ?? 100;

  // Incidents ouverts par client (pour signaler dans la file)
  const openInc = await prisma.incident.groupBy({
    by: ["clientId"], where: { resolved: false }, _count: { id: true },
  });
  const openIncByClient = new Map(openInc.map((g) => [g.clientId, g._count.id]));

  // Fetch all candidate clients in one query, then filter by joursAppel in JS.
  // We pull the **full** appel history (limited window for performance) so we
  // can compute behavioral insights without an extra round-trip.
  const last180 = new Date(now); last180.setDate(now.getDate() - 180);
  const clients = await prisma.client.findMany({
    where: scopeIdList ? { id: { in: scopeIdList } } : undefined,
    select: {
      id: true, code: true, nom: true, type: true,
      commercial: true, tel1: true, tel2: true, tel3: true,
      email: true, sapGroupCode: true, sapGroupName: true,
      notes: true, joursAppel: true,
      rappels: {
        where: { statut: "PLANIFIE" },
        orderBy: { dateRappel: "asc" },
        take: 5,
        select: { id: true, dateRappel: true, note: true, statut: true },
      },
      appels: {
        where: { heureAppel: { gte: last180 } },
        orderBy: { heureAppel: "desc" },
        select: { id: true, type: true, note: true, heureAppel: true, scheduledFor: true },
      },
    },
    orderBy: { nom: "asc" },
  });

  // Today's calls (used to detect "already called today" + stats).
  // Business rule: COMMANDE always overrides DEMAIN on the same day.
  // We still keep both entries in DB for audit, but stats count each client once.
  const todayLogs = await prisma.appelLog.findMany({
    where: {
      heureAppel: { gte: todayStart, lt: todayEnd },
      // Stats cohérentes avec la file scopée : on ne compte que MES clients.
      ...(scopeIdList ? { clientId: { in: scopeIdList } } : {}),
    },
    select: { id: true, clientId: true, type: true, heureAppel: true },
    orderBy: { heureAppel: "desc" },
  });
  const calledTodayMap = new Map<string, { type: string; heureAppel: Date }[]>();
  // Per-client "final outcome" of the day
  type Outcome = { hadCmd: boolean; hadDem: boolean };
  const outcomeByClient = new Map<string, Outcome>();
  for (const l of todayLogs) {
    const arr = calledTodayMap.get(l.clientId) ?? [];
    arr.push({ type: l.type, heureAppel: l.heureAppel });
    calledTodayMap.set(l.clientId, arr);

    const o = outcomeByClient.get(l.clientId) ?? { hadCmd: false, hadDem: false };
    if (l.type === "COMMANDE") o.hadCmd = true;
    if (l.type === "DEMAIN")   o.hadDem = true;
    outcomeByClient.set(l.clientId, o);
  }

  // Build queue: scheduled today, not called yet, no future rappel snooze.
  // We also attach behavioral insights (computed in-memory from the appel
  // history we just fetched) and trim the appels list to the most recent 5
  // for the UI — full history was needed only for insights.
  type Enriched = (typeof clients)[number] & { insights: ReturnType<typeof computeInsights> };
  const queue: Enriched[] = [];
  const done: Enriched[] = [];
  for (const c of clients) {
    if (!c.joursAppel) continue;
    const days = c.joursAppel.split(",").map(Number);
    if (!days.includes(todayDay)) continue;

    const calls = calledTodayMap.get(c.id) ?? [];
    const futureSnooze = c.rappels.some((r) => new Date(r.dateRappel) > now);
    // Pre-commande snooze: client a déjà passé une commande programmée pour
    // une date future — pas besoin de le rappeler avant cette date.
    const preCommandeSnooze = c.appels.some(
      (a) => a.type === "COMMANDE" && a.scheduledFor && new Date(a.scheduledFor) > now,
    );

    const insights = computeInsights(c.appels);
    const claimedFrom = claimedMap.get(c.id) ?? null;
    const enriched = {
      ...c,
      appels: c.appels.slice(0, 5),
      insights,
      // null = not claimed; string = name of the commercial I claimed this from
      claimedFrom,
      // true = le commercial propriétaire est absent aujourd'hui → à couvrir
      ownerAbsent: !!(c.commercial && absentNames.has(c.commercial)),
      openIncidents: openIncByClient.get(c.id) ?? 0,
    } as Enriched & { claimedFrom: string | null; ownerAbsent: boolean; openIncidents: number };

    if (calls.length > 0) done.push(enriched);
    else if (futureSnooze) continue;
    else if (preCommandeSnooze) continue;
    else queue.push(enriched);
  }

  // Today aggregates — counted per client, not per log entry.
  // A client appealed twice (DEMAIN then COMMANDE) counts as ONE call → COMMANDE wins.
  let cmdToday = 0;
  let demainTodayOnly = 0;
  outcomeByClient.forEach((o) => {
    if (o.hadCmd) cmdToday++;
    else if (o.hadDem) demainTodayOnly++;
  });
  const calledToday = outcomeByClient.size; // distinct clients touched today

  const toCover = queue.filter((c) => (c as { ownerAbsent?: boolean }).ownerAbsent).length;

  return NextResponse.json({
    queue,
    done,
    stats: {
      remaining: queue.length,
      called: calledToday,
      commandes: cmdToday,
      demains: demainTodayOnly,
      conversion: calledToday > 0 ? Math.round((cmdToday / calledToday) * 100) : 0,
    },
    // Présence du jour + part de stock perso du commercial connecté
    presence: { present: presentNames, absent: Array.from(absentNames), toCover },
    me: { stockSharePct: myStockSharePct },
  });
}
