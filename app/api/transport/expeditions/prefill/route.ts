import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canalFromClientType, makeRefSuivi } from "@/lib/transport";

export const dynamic = "force-dynamic";

function dayOf(param: string | null): Date {
  const s = /^\d{4}-\d{2}-\d{2}$/.test(param ?? "") ? param! : new Date().toISOString().slice(0, 10);
  return new Date(`${s}T00:00:00.000Z`);
}

/**
 * POST /api/transport/expeditions/prefill?date=YYYY-MM-DD
 *
 * Pré-remplit les expéditions du jour depuis les BL/commandes du MIROIR LOCAL
 * (SapOrder dont DocDueDate = ce jour, non annulées) — AUCUN appel SAP. Idempotent :
 * on ne recrée pas une expédition déjà rattachée à ce BL (sourceDocEntry) pour ce
 * jour. Le canal est déduit du type client TeleVente (EXPORT / GMS / Direct).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const day = dayOf(new URL(req.url).searchParams.get("date"));
  const next = new Date(day.getTime() + 86_400_000);

  const orders = await prisma.sapOrder.findMany({
    where: { docDueDate: { gte: day, lt: next }, cancelled: false },
    select: { docEntry: true, docNum: true, cardCode: true, cardName: true },
  });
  if (orders.length === 0) return NextResponse.json({ ok: true, created: 0, total: 0 });

  // Déjà pré-remplis pour ce jour → on saute (idempotent).
  const already = new Set(
    (await prisma.transportExpedition.findMany({
      where: { date: { gte: day, lt: next }, sourceDocEntry: { in: orders.map((o) => o.docEntry) } },
      select: { sourceDocEntry: true },
    })).map((e) => e.sourceDocEntry),
  );

  // Canal par client (type TeleVente).
  const codes = Array.from(new Set(orders.map((o) => o.cardCode)));
  const clients = await prisma.client.findMany({ where: { code: { in: codes } }, select: { code: true, type: true } });
  const typeByCode = new Map(clients.map((c) => [c.code, c.type]));

  let created = 0;
  for (const o of orders) {
    if (already.has(o.docEntry)) continue;
    const canal = canalFromClientType(typeByCode.get(o.cardCode));
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await prisma.transportExpedition.create({
          data: {
            date: day, sourceDocEntry: o.docEntry, canal, refSuivi: makeRefSuivi(canal),
            numCommande: o.docNum != null ? String(o.docNum) : null,
            clientNom: o.cardName || o.cardCode,
            logs: { create: { statut: "A_PREPARER", by: session.user?.email ?? null } },
          },
        });
        created++;
        break;
      } catch (e) {
        if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") continue; // collision refSuivi → retry
        break; // autre erreur : on n'interrompt pas le lot
      }
    }
  }
  return NextResponse.json({ ok: true, created, total: orders.length });
}
