import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, cardCodeInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/relance/log?cardCode=XXX — historique des relances d'un client
 * (journalisation §6). Périmètre : un non-admin ne voit que ses clients.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const cardCode = new URL(req.url).searchParams.get("cardCode")?.trim();
  if (!cardCode) return NextResponse.json({ error: "cardCode requis." }, { status: 400 });

  const scope = await getAccessScope(session);
  if (!(await cardCodeInScope(scope, cardCode))) {
    return NextResponse.json({ error: "Client hors de votre périmètre." }, { status: 403 });
  }

  const logs = await prisma.relanceLog.findMany({
    where: { cardCode },
    orderBy: { sentAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ ok: true, logs });
}
