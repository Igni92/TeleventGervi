import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeInsights } from "@/lib/insights";
import { getAccessScope, getOwnSlpName } from "@/lib/permissions";
import { parisStartOfDay, parisEndOfDay, parisDayOfWeek } from "@/lib/paris-time";

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

  // Jour ouvré en heure de PARIS (le serveur tourne en UTC) — sinon la file et
  // les stats du jour basculent à 02h heure française (cf. lib/paris-time).
  const now = new Date();
  const todayStart = parisStartOfDay(now);
  const todayEnd = parisEndOfDay(now);
  const todayDay = parisDayOfWeek(now); // 0=dim..6=sam, en heure de Paris

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
  // La console est une FILE D'APPEL : elle ne montre QUE des clients ACTIFS en
  // télévente. Un client inactif — même s'il a un vendeur — ne doit jamais y
  // apparaître (il reste pilotable depuis le Plan d'appel pour réactivation).
  const scope = await getAccessScope(session);
  const mySlp = scope.all ? await getOwnSlpName(session) : scope.slpName;
  let scopeIdList: string[];
  if (scope.all && !mySlp) {
    // Admin dont on ne résout pas le trigramme → vue globale, bornée aux actifs.
    const rows = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "Client" WHERE "activeTelevente" = true`,
    );
    scopeIdList = rows.map((r) => r.id);
  } else {
    const rows = mySlp
      ? await prisma.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT "id" FROM "Client" WHERE "vendeur" = ${mySlp} AND "activeTelevente" = true`,
        )
      : [];
    const scopeIds = new Set<string>(rows.map((r) => r.id));
    // Reprises explicites du jour (couverture d'un collègue absent) : conservées
    // telles quelles — c'est une action volontaire, pas la file automatique.
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
    where: { id: { in: scopeIdList } },
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
        select: { id: true, type: true, outcome: true, note: true, heureAppel: true, scheduledFor: true },
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
      // Stats cohérentes avec la file scopée : on ne compte que MES clients actifs.
      clientId: { in: scopeIdList },
    },
    select: { id: true, clientId: true, type: true, outcome: true, heureAppel: true },
    orderBy: { heureAppel: "desc" },
  });
  // Issue = contact établi ? (COMMANDE/DEMAIN/REFUS/RAPPELE/LITIGE) vs
  // « personne au bout du fil » (NRP/REPONDEUR). Un client dont TOUTES les
  // tentatives du jour sont sans décroché doit être RE-PROPOSÉ (retry), pas
  // sorti de la file jusqu'à son prochain jour d'appel.
  const NON_CONNECT = new Set(["NRP", "REPONDEUR"]);
  const isConnectLog = (l: { type: string; outcome: string | null }) =>
    !NON_CONNECT.has((l.outcome && l.outcome.trim()) || l.type);
  const calledTodayMap = new Map<string, { type: string; outcome: string | null; heureAppel: Date }[]>();
  // Per-client "final outcome" of the day
  type Outcome = { hadCmd: boolean; hadDem: boolean };
  const outcomeByClient = new Map<string, Outcome>();
  for (const l of todayLogs) {
    const arr = calledTodayMap.get(l.clientId) ?? [];
    arr.push({ type: l.type, outcome: l.outcome, heureAppel: l.heureAppel });
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
  type Insights = ReturnType<typeof computeInsights>;
  type Enriched = (typeof clients)[number] & {
    insights: Insights;
    claimedFrom: string | null;
    ownerAbsent: boolean;
    openIncidents: number;
    // Repli « cold-start » : heure de décroché typique des clients du même TYPE,
    // utilisée quand le client n'a pas assez d'historique perso (recommendedHour null).
    fallbackHour: number | null;
    // Tenté aujourd'hui sans décroché (NRP/répondeur) → à re-tenter plus tard.
    retryAfterNrp: boolean;
  };

  // ── Passe 1 : calcule les insights + garde les candidats du jour ──
  const candidates: {
    c: (typeof clients)[number];
    insights: Insights;
    calls: { type: string; outcome: string | null; heureAppel: Date }[];
    futureSnooze: boolean;
    preCommandeSnooze: boolean;
  }[] = [];
  for (const c of clients) {
    if (!c.joursAppel) continue;
    const days = c.joursAppel.split(",").map(Number);
    if (!days.includes(todayDay)) continue;

    const calls = calledTodayMap.get(c.id) ?? [];
    const futureSnooze = c.rappels.some((r) => new Date(r.dateRappel) > now);
    // Pré-commande snooze : le client a déjà une commande programmée pour un
    // JOUR DE LIVRAISON ULTÉRIEUR → inutile de le rappeler avant. On compare au
    // DÉBUT du jour de livraison (todayEnd = minuit demain, heure de Paris) et
    // NON à l'instant courant : un client livré AUJOURD'HUI doit réapparaître
    // dès le matin pour qu'on l'appelle pour la livraison du lendemain. Avec
    // `> now`, il restait masqué jusqu'à l'heure de livraison (ex. 09:00 par
    // défaut du constructeur de commande), voire toute la journée.
    const preCommandeSnooze = c.appels.some(
      (a) => a.type === "COMMANDE" && a.scheduledFor && new Date(a.scheduledFor) >= todayEnd,
    );
    candidates.push({ c, insights: computeInsights(c.appels), calls, futureSnooze, preCommandeSnooze });
  }

  // ── Repli par type : heure de décroché typique (médiane des recommendedHour
  //    des clients bien renseignés). Sert de créneau par défaut aux clients
  //    neufs / peu actifs pour qu'ils ne finissent pas en fin de file. ──
  const hoursByType = new Map<string, number[]>();
  for (const { c, insights } of candidates) {
    const t = c.type ?? "_";
    const h = insights.bestPickup?.hour ?? (insights.confidence !== "low" ? insights.recommendedHour : null);
    if (h != null) { const arr = hoursByType.get(t) ?? []; arr.push(h); hoursByType.set(t, arr); }
  }
  const fallbackByType = new Map<string, number>();
  hoursByType.forEach((arr, t) => {
    const s = [...arr].sort((a, b) => a - b);
    fallbackByType.set(t, s[Math.floor(s.length / 2)]);
  });

  // ── Passe 2 : construit la file / les faits ──
  const queue: Enriched[] = [];
  const done: Enriched[] = [];
  for (const { c, insights, calls, futureSnooze, preCommandeSnooze } of candidates) {
    const claimedFrom = claimedMap.get(c.id) ?? null;
    const fallbackHour = insights.recommendedHour == null
      ? (fallbackByType.get(c.type ?? "_") ?? null)
      : null;
    // Contact établi aujourd'hui ? Si OUI → traité (done). Si NON mais des
    // tentatives existent (que des NRP/répondeur) → on le garde dans la file
    // pour re-tenter plus tard dans la journée (retryAfterNrp).
    const hadConnect = calls.some(isConnectLog);
    const retryAfterNrp = !hadConnect && calls.length > 0;
    const enriched = {
      ...c,
      appels: c.appels.slice(0, 5),
      insights,
      claimedFrom,
      // « à couvrir » = VRAIE couverture d'un collègue absent (client REPRIS
      // aujourd'hui dont le commercial d'origine est effectivement absent).
      ownerAbsent: !!(claimedFrom && absentNames.has(claimedFrom)),
      openIncidents: openIncByClient.get(c.id) ?? 0,
      fallbackHour,
      retryAfterNrp,
    } as Enriched;

    if (hadConnect) done.push(enriched);
    else if (futureSnooze) continue;
    else if (preCommandeSnooze) continue;
    else queue.push(enriched); // inclut les « retry NRP » du jour
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

  // Nombre de clients « à couvrir » dans ma file = reprises effectives d'un
  // collègue absent (cf. ownerAbsent ci-dessus, qui implique claimedFrom).
  const toCover = queue.filter((c) => (c as { ownerAbsent?: boolean }).ownerAbsent).length;

  // ── Rappels DUS maintenant (bandeau in-app) ──
  // Mes rappels planifiés dont l'heure est passée : à traiter tout de suite.
  // Routés par auteur (createdBy = email de session) — cohérent avec le push.
  const myEmail = session.user?.email ?? null;
  const dueRappels = myEmail
    ? (await prisma.rappel.findMany({
        where: { statut: "PLANIFIE", createdBy: myEmail, dateRappel: { lte: now } },
        include: { client: { select: { id: true, nom: true } } },
        orderBy: { dateRappel: "asc" },
        take: 50,
      })).map((r) => ({
        id: r.id,
        clientId: r.clientId,
        clientNom: r.client?.nom ?? "Client",
        dateRappel: r.dateRappel,
        note: r.note,
      }))
    : [];

  return NextResponse.json({
    queue,
    done,
    dueRappels,
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
