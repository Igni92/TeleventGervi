import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { standardizePhone } from "@/lib/phone";

/**
 * GET  /api/suppliers/[id]/contacts   → interlocuteurs du fournisseur
 * POST /api/suppliers/[id]/contacts   → ajoute un interlocuteur
 *   body: { name, role?, phone?, email?, note? }
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const contacts = await prisma.supplierContact.findMany({
    where: { supplierId: params.id },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ contacts });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Le fournisseur doit exister (FK + message clair).
  const supplier = await prisma.supplier.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!supplier) return NextResponse.json({ error: "Fournisseur introuvable" }, { status: 404 });

  let body: { name?: string; role?: string; phone?: string; email?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  if (!body.name?.trim()) return NextResponse.json({ error: "Nom requis" }, { status: 400 });

  const count = await prisma.supplierContact.count({ where: { supplierId: params.id } });
  const contact = await prisma.supplierContact.create({
    data: {
      supplierId: params.id,
      name: body.name.trim(),
      role: body.role?.trim() || null,
      phone: body.phone?.trim() ? standardizePhone(body.phone) : null,
      email: body.email?.trim() || null,
      note: body.note?.trim() || null,
      position: count,
    },
  });
  return NextResponse.json({ ok: true, contact }, { status: 201 });
}
