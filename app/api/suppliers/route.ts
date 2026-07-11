import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supplierSchema } from "@/lib/validations";
import { standardizePhone } from "@/lib/phone";

/**
 * Fiches FOURNISSEURS — tiers d'ACHAT (distinct du CLIENT, tiers de vente).
 *
 * GET  /api/suppliers?search=&active=       → liste (recherche code/nom/type)
 * POST /api/suppliers                        → crée une fiche
 *
 * Les fournisseurs sont un référentiel PARTAGÉ (pas de portefeuille par
 * commercial comme les clients) : tout compte authentifié y accède.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim() || "";
    const activeParam = searchParams.get("active"); // "actifs" | "inactifs" | null

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { code: { contains: search, mode: "insensitive" } },
        { nom: { contains: search, mode: "insensitive" } },
        { type: { contains: search, mode: "insensitive" } },
      ];
    }
    if (activeParam === "actifs") where.active = true;
    if (activeParam === "inactifs") where.active = false;

    const suppliers = await prisma.supplier.findMany({
      where,
      orderBy: { nom: "asc" },
      include: { _count: { select: { contacts: true } } },
    });

    return NextResponse.json({ suppliers, total: suppliers.length });
  } catch (error) {
    console.error("[GET /api/suppliers]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  try {
    const body = await req.json();
    // Standardisation des téléphones AVANT validation (cohérent avec les clients).
    for (const k of ["tel1", "tel2", "tel3"] as const) {
      if (typeof body?.[k] === "string" && body[k].trim()) body[k] = standardizePhone(body[k]);
    }
    const data = supplierSchema.parse(body);

    const existing = await prisma.supplier.findUnique({ where: { code: data.code } });
    if (existing) {
      return NextResponse.json({ error: "Un fournisseur avec ce code existe déjà" }, { status: 409 });
    }

    const supplier = await prisma.supplier.create({
      data: {
        code: data.code.trim(),
        nom: data.nom.trim(),
        type: data.type?.trim() || null,
        sapCardCode: data.sapCardCode?.trim() || null,
        email: data.email?.trim().toLowerCase() || null,
        tel1: data.tel1 || null,
        tel2: data.tel2 || null,
        tel3: data.tel3 || null,
        adresse: data.adresse?.trim() || null,
        notes: data.notes?.trim() || null,
      },
    });

    return NextResponse.json(supplier, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json({ error: "Données invalides", issues: (error as { issues: unknown }).issues }, { status: 400 });
    }
    console.error("[POST /api/suppliers]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
