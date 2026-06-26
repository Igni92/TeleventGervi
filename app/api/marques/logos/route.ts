import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Logos de marques — table additive "BrandLogo" (marque PK → logoUrl data-URL).
 * Accédée en SQL brut (convention repo : Prisma client possiblement en retard).
 *
 *   GET    /api/marques/logos            → { logos: [{ marque, logoUrl }] }
 *   PUT    /api/marques/logos            → upsert { marque, logoUrl (data:image/...) }
 *   DELETE /api/marques/logos?marque=…   → supprime le logo d'une marque
 *
 * Le logo est stocké en data-URL base64 (image redimensionnée côté client),
 * partagé pour tous les postes → s'affiche dans la console pour tout le monde.
 */

export const dynamic = "force-dynamic";

interface LogoRow { marque: string; logoUrl: string }

// Garde-fou taille : une data-URL de logo redimensionné reste petite.
const MAX_LOGO_CHARS = 400_000; // ~300 Ko encodés

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    const logos = await prisma.$queryRawUnsafe<LogoRow[]>(
      `SELECT "marque", "logoUrl" FROM "BrandLogo" ORDER BY "marque" ASC`,
    );
    return NextResponse.json({ logos });
  } catch {
    // Table absente (env pas encore migré) → pas de logos, jamais d'erreur bloquante.
    return NextResponse.json({ logos: [] });
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { marque?: string; logoUrl?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const marque = String(body.marque ?? "").trim();
  const logoUrl = String(body.logoUrl ?? "").trim();
  if (!marque) return NextResponse.json({ error: "marque requise" }, { status: 400 });
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(logoUrl)) {
    return NextResponse.json({ error: "logoUrl doit être une image (data-URL base64)" }, { status: 400 });
  }
  if (logoUrl.length > MAX_LOGO_CHARS) {
    return NextResponse.json({ error: "Logo trop volumineux (réduis l'image)" }, { status: 413 });
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "BrandLogo" ("marque","logoUrl","updatedAt") VALUES ($1,$2,now())
     ON CONFLICT ("marque") DO UPDATE SET "logoUrl" = EXCLUDED."logoUrl", "updatedAt" = now()`,
    marque, logoUrl,
  );
  return NextResponse.json({ ok: true, marque });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const marque = new URL(req.url).searchParams.get("marque")?.trim();
  if (!marque) return NextResponse.json({ error: "marque requise" }, { status: 400 });
  await prisma.$executeRawUnsafe(`DELETE FROM "BrandLogo" WHERE "marque" = $1`, marque);
  return NextResponse.json({ ok: true, marque });
}
