import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supplierSchema } from "@/lib/validations";
import { standardizePhone } from "@/lib/phone";
import { requirePreparateurOrAdmin } from "@/lib/permissions";

/**
 * GET    /api/suppliers/[id]   → fiche + contacts
 * PUT    /api/suppliers/[id]   → met à jour la fiche
 * DELETE /api/suppliers/[id]   → supprime (réservé préparateur/admin)
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const supplier = await prisma.supplier.findUnique({
    where: { id: params.id },
    include: { contacts: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } },
  });
  if (!supplier) return NextResponse.json({ error: "Fournisseur introuvable" }, { status: 404 });
  return NextResponse.json(supplier);
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  try {
    const body = await req.json();
    for (const k of ["tel1", "tel2", "tel3"] as const) {
      if (typeof body?.[k] === "string" && body[k].trim()) body[k] = standardizePhone(body[k]);
    }
    // Le `code` n'est pas modifiable (identifiant) — on l'ignore s'il est fourni.
    const data = supplierSchema.omit({ code: true }).parse(body);

    const existing = await prisma.supplier.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Fournisseur introuvable" }, { status: 404 });

    const supplier = await prisma.supplier.update({
      where: { id: params.id },
      data: {
        nom: data.nom.trim(),
        type: data.type?.trim() || null,
        sapCardCode: data.sapCardCode?.trim() || null,
        email: data.email?.trim().toLowerCase() || null,
        tel1: data.tel1 || null,
        tel2: data.tel2 || null,
        tel3: data.tel3 || null,
        adresse: data.adresse?.trim() || null,
        notes: data.notes?.trim() || null,
        // `active` optionnel — on ne le touche que s'il est explicitement fourni.
        ...(typeof body?.active === "boolean" ? { active: body.active } : {}),
      },
    });

    return NextResponse.json(supplier);
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json({ error: "Données invalides", issues: (error as { issues: unknown }).issues }, { status: 400 });
    }
    console.error("[PUT /api/suppliers/[id]]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // Suppression d'une fiche = geste « gestion » → préparateur / admin / direction.
  if (!(await requirePreparateurOrAdmin(session)))
    return NextResponse.json({ error: "Action réservée à la gestion (préparateur / administration)." }, { status: 403 });

  await prisma.supplier.delete({ where: { id: params.id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
