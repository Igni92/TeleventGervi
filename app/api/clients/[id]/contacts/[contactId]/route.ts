import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * PATCH  /api/clients/[id]/contacts/[contactId]  → modifie un interlocuteur
 * DELETE /api/clients/[id]/contacts/[contactId]  → supprime
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; contactId: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let body: { name?: string; role?: string; phone?: string; email?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const data: Record<string, string | null> = {};
  if (body.name !== undefined) data.name = body.name.trim();
  if (body.role !== undefined) data.role = body.role?.trim() || null;
  if (body.phone !== undefined) data.phone = body.phone?.trim() || null;
  if (body.email !== undefined) data.email = body.email?.trim() || null;
  if (body.note !== undefined) data.note = body.note?.trim() || null;

  const contact = await prisma.contact.update({
    where: { id: params.contactId },
    data,
  });
  return NextResponse.json({ ok: true, contact });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; contactId: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  await prisma.contact.delete({ where: { id: params.contactId } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
