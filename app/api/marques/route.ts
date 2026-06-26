import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/marques
 * Liste les marques DISTINCTES du catalogue (Product.uMarque) avec, pour
 * chacune, son logo s'il en a un et le nombre de produits concernés.
 * Sert à la page Paramètres « Marques & logos ».
 */

export const dynamic = "force-dynamic";

interface LogoRow { marque: string; logoUrl: string }

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const grouped = await prisma.product.groupBy({
    by: ["uMarque"],
    where: { uMarque: { not: null } },
    _count: { _all: true },
  });

  let logos: LogoRow[] = [];
  try {
    logos = await prisma.$queryRawUnsafe<LogoRow[]>(`SELECT "marque", "logoUrl" FROM "BrandLogo"`);
  } catch { /* table pas encore migrée → aucun logo */ }
  const logoByMarque = new Map(logos.map((l) => [l.marque, l.logoUrl]));

  const marques = grouped
    .map((g) => (g.uMarque ?? "").trim())
    .filter((m) => m.length > 0 && !/^-+$/.test(m)) // ignore les « - » / vides (cohérent console)
    .map((m) => ({ marque: m, logoUrl: logoByMarque.get(m) ?? null }));

  // Dédoublonne (au cas où la casse/espaces créeraient des doublons proches) et trie.
  const seen = new Set<string>();
  const out = marques
    .filter((m) => { const k = m.marque.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.marque.localeCompare(b.marque, "fr"));

  return NextResponse.json({ marques: out, count: out.length });
}
