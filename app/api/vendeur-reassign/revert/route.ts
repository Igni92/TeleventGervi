import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/cronAuth";
import { getReassignMarkers, setReassignMarker, parisDateStr } from "@/lib/vendeurReassign";

/**
 * Retour automatique des bascules vendeur temporaires arrivées à échéance.
 *
 * Appelé chaque jour par le cron (`televent-cron-call /api/vendeur-reassign/revert`,
 * en GET avec `x-cron-secret`). Pour chaque marqueur dont `endDate <= aujourd'hui`
 * (Europe/Paris), on remet `Client.vendeur = from` (le titulaire) et on lève le
 * marqueur. On ne réécrit QUE si la colonne vaut encore `to` — si quelqu'un a
 * déjà rebasculé le client à la main entre-temps, on respecte son choix.
 *
 * Aussi déclenchable manuellement par un admin (session), pour forcer le retour.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    const session = await auth();
    if (!(await requireAdmin(session))) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }
  }

  const today = parisDateStr();
  const markers = await getReassignMarkers();
  let reverted = 0;
  const details: { clientId: string; from: string; to: string; endDate: string }[] = [];
  for (const [clientId, m] of markers) {
    if (m.endDate > today) continue; // pas encore échu
    await prisma.$executeRaw(
      Prisma.sql`UPDATE "Client" SET "vendeur" = ${m.from}, "updatedAt" = NOW()
                 WHERE "id" = ${clientId} AND "vendeur" = ${m.to}`,
    );
    await setReassignMarker(clientId, null);
    reverted++;
    details.push({ clientId, from: m.from, to: m.to, endDate: m.endDate });
  }
  if (reverted > 0) {
    console.log(`[VendeurReassign] Retour automatique de ${reverted} client(s) échu(s) au ${today}.`);
  }
  return NextResponse.json({ ok: true, today, reverted, details });
}
