import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Incidents de RÉCEPTION marchandise — rattachés aux bons de réception SAP
 * (PurchaseDeliveryNote) créés via /entrees. Distincts des incidents client.
 *
 * GET    /api/entrees/incidents              → 100 derniers (ouverts d'abord)
 *        /api/entrees/incidents?docEntry=123 → incidents d'un BR précis
 * POST   { docEntry?, docNum?, lot?, cardCode?, cardName?, itemCode?, type?, note? }
 * PATCH  { id, resolved?, type?, note? }
 * DELETE /api/entrees/incidents?id=xxx
 *
 * Accès raw SQL (pas prisma.receptionIncident) : le client Prisma régénéré est
 * bloqué EPERM tant que le dev server tourne — même pattern que activeTelevente.
 */

export interface ReceptionIncidentRow {
  id: string;
  docEntry: number | null;
  docNum: number | null;
  lot: string | null;
  cardCode: string | null;
  cardName: string | null;
  itemCode: string | null;
  type: string | null;
  note: string | null;
  createdBy: string | null;
  resolved: boolean;
  createdAt: Date;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const docEntry = new URL(req.url).searchParams.get("docEntry");

  const incidents = docEntry
    ? await prisma.$queryRaw<ReceptionIncidentRow[]>`
        SELECT * FROM "ReceptionIncident"
        WHERE "docEntry" = ${Number.parseInt(docEntry, 10)}
        ORDER BY "createdAt" DESC`
    : await prisma.$queryRaw<ReceptionIncidentRow[]>`
        SELECT * FROM "ReceptionIncident"
        ORDER BY "resolved" ASC, "createdAt" DESC
        LIMIT 100`;
  return NextResponse.json({ incidents });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let body: {
    docEntry?: number; docNum?: number; lot?: string; cardCode?: string;
    cardName?: string; itemCode?: string; type?: string; note?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  if (!body.type?.trim() && !body.note?.trim()) {
    return NextResponse.json({ error: "type ou note requis" }, { status: 400 });
  }

  const rows = await prisma.$queryRaw<ReceptionIncidentRow[]>`
    INSERT INTO "ReceptionIncident"
      ("id","docEntry","docNum","lot","cardCode","cardName","itemCode","type","note","createdBy")
    VALUES (
      gen_random_uuid()::text,
      ${body.docEntry ?? null}, ${body.docNum ?? null}, ${body.lot?.trim() || null},
      ${body.cardCode?.trim() || null}, ${body.cardName?.trim() || null},
      ${body.itemCode?.trim() || null}, ${body.type?.trim() || null}, ${body.note?.trim() || null},
      ${session.user?.name ?? session.user?.email ?? null}
    )
    RETURNING *`;
  return NextResponse.json({ ok: true, incident: rows[0] }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let body: { id?: string; resolved?: boolean; type?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const rows = await prisma.$queryRaw<ReceptionIncidentRow[]>`
    UPDATE "ReceptionIncident" SET
      "resolved" = COALESCE(${body.resolved ?? null}, "resolved"),
      "type" = CASE WHEN ${body.type !== undefined} THEN ${body.type?.trim() || null} ELSE "type" END,
      "note" = CASE WHEN ${body.note !== undefined} THEN ${body.note?.trim() || null} ELSE "note" END
    WHERE "id" = ${body.id}
    RETURNING *`;
  if (rows.length === 0) return NextResponse.json({ error: "Incident introuvable" }, { status: 404 });
  return NextResponse.json({ ok: true, incident: rows[0] });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await prisma.$executeRaw`DELETE FROM "ReceptionIncident" WHERE "id" = ${id}`;
  return NextResponse.json({ ok: true });
}
