import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { standardizePhone } from "@/lib/phone";

/**
 * PATCH  /api/suppliers/[id]/contacts/[contactId]  → modifie un interlocuteur
 * DELETE /api/suppliers/[id]/contacts/[contactId]  → supprime
 */
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; contactId: string }> }
) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let body: { name?: string; role?: string; phone?: string; email?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const data: Record<string, string | null> = {};
  if (body.name !== undefined) data.name = body.name.trim();
  if (body.role !== undefined) data.role = body.role?.trim() || null;
  if (body.phone !== undefined) data.phone = body.phone?.trim() ? standardizePhone(body.phone) : null;
  if (body.email !== undefined) data.email = body.email?.trim() || null;
  if (body.note !== undefined) data.note = body.note?.trim() || null;

  // Contrainte d'appartenance : le contact doit être rattaché à CE fournisseur.
  const updated = await prisma.supplierContact.updateMany({
    where: { id: params.contactId, supplierId: params.id },
    data,
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "Contact introuvable pour ce fournisseur." }, { status: 404 });
  }
  const contact = await prisma.supplierContact.findUnique({ where: { id: params.contactId } });
  return NextResponse.json({ ok: true, contact });
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string; contactId: string }> }
) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // Contrainte d'appartenance : ne supprime que si le contact est bien à CE fournisseur.
  await prisma.supplierContact.deleteMany({ where: { id: params.contactId, supplierId: params.id } });
  return NextResponse.json({ ok: true });
}
