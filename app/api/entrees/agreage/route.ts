import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireCanReceivePurchaseOrder } from "@/lib/permissions";
import { getAgreages, applyAgreage, type AgreageStatus } from "@/lib/agreage";

export const dynamic = "force-dynamic";

/**
 * AGRÉAGE des entrées marchandises (contrôle qualité à la réception).
 *
 * GET  /api/entrees/agreage?docEntries=1,2,3
 *      → { ok, agreages: { [docEntry]: Agreage } } (lot d'EM, une requête)
 * POST { docEntry, docNum?, cardCode?, cardName?, lot?, status, type?, note? }
 *      → pose (ou remplace) l'agréage d'une EM. status = CONFORME | RESERVE ;
 *        une RÉSERVE ouvre automatiquement un incident de réception.
 *
 * Geste réservé aux rôles autorisés à réceptionner (agréeur / préparation /
 * administration) — cf. requireCanReceivePurchaseOrder.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const raw = new URL(req.url).searchParams.get("docEntries") ?? "";
  const docEntries = raw.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const map = await getAgreages(docEntries);
  return NextResponse.json({ ok: true, agreages: Object.fromEntries(map) });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireCanReceivePurchaseOrder(session))) {
    return NextResponse.json({ error: "Réservé à l'agréeur / la préparation / l'administration" }, { status: 403 });
  }

  let body: {
    docEntry?: number; docNum?: number; cardCode?: string; cardName?: string;
    lot?: string; status?: string; type?: string; note?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const docEntry = Number(body.docEntry);
  if (!Number.isInteger(docEntry) || docEntry <= 0) {
    return NextResponse.json({ error: "docEntry invalide" }, { status: 400 });
  }
  const status = body.status as AgreageStatus;
  if (status !== "CONFORME" && status !== "RESERVE") {
    return NextResponse.json({ error: "status invalide (CONFORME | RESERVE)" }, { status: 400 });
  }
  const me = session.user.name?.trim() || session.user.email || "?";

  try {
    const agreage = await applyAgreage({
      docEntry, docNum: body.docNum ?? null, lot: body.lot ?? null,
      cardCode: body.cardCode ?? null, cardName: body.cardName ?? null,
      status, type: body.type, note: body.note, by: me,
    });
    return NextResponse.json({ ok: true, agreage });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
