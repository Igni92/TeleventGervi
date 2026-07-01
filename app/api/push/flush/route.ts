import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pushEnabled, sendPush } from "@/lib/push";

/**
 * POST /api/push/flush — envoie les notifications push des rappels DUS de
 * l'utilisateur connecté, puis les marque notifiés (anti-doublon).
 *
 * Déclenché CÔTÉ CLIENT depuis la console (à chaque rafraîchissement), pas par
 * un cron : Vercel Hobby limite les crons à 1/jour, insuffisant pour des
 * rappels horaires. Effet : quand un agent a la console ouverte, ses rappels
 * échus lui sont poussés sur ses AUTRES appareils (mobile). Le bandeau in-app
 * couvre déjà l'appareil courant.
 *
 * Ne traite QUE les rappels de l'appelant (createdBy = email de session) →
 * aucun accès aux rappels d'autrui, aucun secret partagé nécessaire.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!pushEnabled()) return NextResponse.json({ ok: true, skipped: "push non configuré" });

  const now = new Date();
  // Rappels échus dans les dernières 24 h, non encore notifiés.
  const floor = new Date(now.getTime() - 24 * 3600_000);
  const due = await prisma.rappel.findMany({
    where: {
      statut: "PLANIFIE",
      createdBy: email,
      notifiedAt: null,
      dateRappel: { lte: now, gte: floor },
    },
    include: { client: { select: { nom: true } } },
    orderBy: { dateRappel: "asc" },
    take: 50,
  });
  if (due.length === 0) return NextResponse.json({ ok: true, sent: 0, due: 0 });

  const subs = await prisma.pushSubscription.findMany({ where: { email } });

  let sent = 0;
  const goneEndpoints: string[] = [];
  for (const r of due) {
    for (const t of subs) {
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

  // Marque notifiés (même sans abonnement : le bandeau in-app les affiche déjà).
  await prisma.rappel.updateMany({
    where: { id: { in: due.map((r) => r.id) } },
    data: { notifiedAt: now },
  });
  if (goneEndpoints.length) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: goneEndpoints } } });
  }

  return NextResponse.json({ ok: true, due: due.length, sent, cleaned: goneEndpoints.length });
}
