import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Incidents rattachés aux BL (commandes SAP) d'un client.
 * GET    /api/incidents?clientId=xxx   → tous les incidents du client
 *        /api/incidents?docEntry=123   → incidents d'un BL précis
 * POST   /api/incidents { clientId, docEntry?, docNum?, type?, note? }
 * PATCH  /api/incidents { id, resolved?, type?, note? }
 * DELETE /api/incidents?id=xxx
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");
  const docEntry = searchParams.get("docEntry");
  const where: Record<string, unknown> = {};
  if (clientId) where.clientId = clientId;
  if (docEntry) where.docEntry = parseInt(docEntry);
  if (!clientId && !docEntry) return NextResponse.json({ incidents: [] });
  const incidents = await prisma.incident.findMany({ where, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ incidents });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let body: { clientId?: string; docEntry?: number; docNum?: number; type?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  if (!body.clientId) return NextResponse.json({ error: "clientId requis" }, { status: 400 });
  const incident = await prisma.incident.create({
    data: {
      clientId: body.clientId,
      docEntry: body.docEntry ?? null,
      docNum: body.docNum ?? null,
      type: body.type?.trim() || null,
      note: body.note?.trim() || null,
      createdBy: session.user?.name ?? session.user?.email ?? null,
    },
  });
  return NextResponse.json({ ok: true, incident }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let body: { id?: string; resolved?: boolean; type?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const data: Record<string, unknown> = {};
  if (typeof body.resolved === "boolean") data.resolved = body.resolved;
  if (body.type !== undefined) data.type = body.type?.trim() || null;
  if (body.note !== undefined) data.note = body.note?.trim() || null;
  const incident = await prisma.incident.update({ where: { id: body.id }, data });
  return NextResponse.json({ ok: true, incident });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await prisma.incident.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
