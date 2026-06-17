import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * PATCH  /api/clients/[id]/contacts/[contactId]  → modifie un interlocuteur
 * DELETE /api/clients/[id]/contacts/[contactId]  → supprime
 */
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; contactId: string }> }
) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });
  let body: { name?: string; role?: string; phone?: string; email?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const data: Record<string, string | null> = {};
  if (body.name !== undefined) data.name = body.name.trim();
  if (body.role !== undefined) data.role = body.role?.trim() || null;
  if (body.phone !== undefined) data.phone = body.phone?.trim() || null;
  if (body.email !== undefined) data.email = body.email?.trim() || null;
  if (body.note !== undefined) data.note = body.note?.trim() || null;

  // Contrainte d'appartenance : le contact doit être rattaché à CE client
  // (mirror du pattern delivery-modes — empêche d'éditer le contact d'un autre).
  const updated = await prisma.contact.updateMany({
    where: { id: params.contactId, clientId: params.id },
    data,
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "Contact introuvable pour ce client." }, { status: 404 });
  }
  const contact = await prisma.contact.findUnique({ where: { id: params.contactId } });
  return NextResponse.json({ ok: true, contact });
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string; contactId: string }> }
) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });
  // Contrainte d'appartenance : ne supprime que si le contact est bien à CE client.
  await prisma.contact.deleteMany({ where: { id: params.contactId, clientId: params.id } });
  return NextResponse.json({ ok: true });
}
