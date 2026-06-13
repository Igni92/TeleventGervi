import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Libellés réutilisables et incrémentaux (types de contact, types d'incident…).
 * GET    /api/types?kind=contact      → liste des libellés
 * POST   /api/types  { kind, label }  → crée (idempotent)
 * DELETE /api/types?id=xxx            → supprime un libellé (les enregistrements
 *                                       qui l'utilisent gardent leur valeur)
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const kind = new URL(req.url).searchParams.get("kind") || "contact";
  const types = await prisma.typeOption.findMany({ where: { kind }, orderBy: { label: "asc" } });
  return NextResponse.json({ types });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let body: { kind?: string; label?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const kind = (body.kind || "contact").trim();
  const label = (body.label || "").trim();
  if (!label) return NextResponse.json({ error: "label requis" }, { status: 400 });
  const type = await prisma.typeOption.upsert({
    where: { kind_label: { kind, label } },
    create: { kind, label },
    update: {},
  });
  return NextResponse.json({ ok: true, type });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await prisma.typeOption.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
