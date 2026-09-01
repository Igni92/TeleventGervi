import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isCronAuthorized } from "@/lib/cronAuth";
import { prisma } from "@/lib/prisma";
import { STATUT_LABEL } from "@/lib/transport";

export const dynamic = "force-dynamic";

/**
 * GET /api/transport/suivi/[ref] — statut d'une expédition par sa RÉFÉRENCE DE
 * SUIVI (ex. EX-1041). Phase 3 : brique du futur suivi client e-boutique
 * (« vos fraises sont bien parties de notre entrepôt » = jalon EXPEDIE).
 *
 * Accès : session interne OU auth machine (x-cron-secret / Bearer, comme les crons)
 * pour qu'une future e-boutique interne puisse l'interroger sans refonte. On
 * n'expose QUE le suivi (pas de données commerciales).
 */
export async function GET(req: NextRequest, props: { params: Promise<{ ref: string }> }) {
  const { ref } = await props.params;
  const machine = isCronAuthorized(req);
  if (!machine) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const e = await prisma.transportExpedition.findUnique({
    where: { refSuivi: ref },
    select: { refSuivi: true, statut: true, date: true, expedieAt: true, livreeAt: true, clientNom: true, numCommande: true },
  });
  if (!e) return NextResponse.json({ ok: false, error: "Référence inconnue" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    refSuivi: e.refSuivi,
    statut: e.statut,
    statutLabel: STATUT_LABEL[e.statut] ?? e.statut,
    expedie: e.statut === "EXPEDIE" || e.statut === "LIVREE",
    livree: e.statut === "LIVREE",
    dateExpedition: e.date.toISOString().slice(0, 10),
    expedieAt: e.expedieAt,
    livreeAt: e.livreeAt,
  });
}
