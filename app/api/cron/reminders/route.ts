import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pushEnabled, sendPush } from "@/lib/push";

/**
 * GET /api/cron/reminders — déclenché par Vercel Cron (cf. vercel.json).
 *
 * Envoie une notification push « rappel dû » pour chaque Rappel PLANIFIE dont
 * l'heure est passée et qui n'a pas encore été notifié. Route vers les
 * abonnements de l'auteur du rappel (match par email). Marque `notifiedAt`
 * pour éviter les doublons.
 *
 * Sécurité : Vercel Cron ajoute `Authorization: Bearer ${CRON_SECRET}` quand la
 * variable est définie. En son absence, la route refuse (fail-closed) sauf en
 * développement.
 */
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!pushEnabled()) return NextResponse.json({ ok: true, skipped: "push non configuré" });

  const now = new Date();
  // Fenêtre : rappels échus dans les dernières 24 h non notifiés (au-delà = on
  // évite de spammer d'anciens rappels oubliés au 1er déploiement du cron).
  const floor = new Date(now.getTime() - 24 * 3600_000);

  const due = await prisma.rappel.findMany({
    where: {
      statut: "PLANIFIE",
      notifiedAt: null,
      dateRappel: { lte: now, gte: floor },
    },
    include: { client: { select: { nom: true } } },
    orderBy: { dateRappel: "asc" },
    take: 200,
  });

  if (due.length === 0) return NextResponse.json({ ok: true, sent: 0, due: 0 });

  // Abonnements des auteurs concernés (match par email de session).
  const emails = Array.from(new Set(due.map((r) => r.createdBy).filter((e): e is string => !!e)));
  const subs = emails.length
    ? await prisma.pushSubscription.findMany({ where: { email: { in: emails } } })
    : [];
  const subsByEmail = new Map<string, typeof subs>();
  for (const s of subs) {
    if (!s.email) continue;
    const arr = subsByEmail.get(s.email) ?? [];
    arr.push(s);
    subsByEmail.set(s.email, arr);
  }

  let sent = 0;
  const goneEndpoints: string[] = [];
  for (const r of due) {
    const targets = r.createdBy ? subsByEmail.get(r.createdBy) ?? [] : [];
    for (const t of targets) {
      const res = await sendPush(
        { endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth },
        {
          title: "⏰ Rappel client",
          body: `${r.client?.nom ?? "Client"}${r.note ? ` — ${r.note}` : ""}`,
          url: "/console",
          tag: `rappel-${r.id}`,
          renotify: true,
        },
      );
      if (res === "ok") sent++;
      else if (res === "gone") goneEndpoints.push(t.endpoint);
    }
  }

  // Marque tous les rappels traités (même sans abonnement : le bandeau in-app
  // les affiche déjà ; on évite de les re-traiter à chaque tick du cron).
  await prisma.rappel.updateMany({
    where: { id: { in: due.map((r) => r.id) } },
    data: { notifiedAt: now },
  });

  // Purge les abonnements expirés (404/410).
  if (goneEndpoints.length) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: goneEndpoints } } });
  }

  return NextResponse.json({ ok: true, due: due.length, sent, cleaned: goneEndpoints.length });
}
