import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/clients/resolve?code=APLAI → { id } | { id: null }
 *
 * Résout un CardCode SAP vers l'id de la fiche Client locale.
 * Support du composant <ClientLink /> (lien fiche client universel).
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // L'import stocke les codes en MAJUSCULES → on normalise pour ne pas rater la
  // résolution sur un CardCode saisi en minuscules/casse mixte.
  const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase();
  if (!code) return NextResponse.json({ id: null });

  const client = await prisma.client.findUnique({
    where: { code },
    select: { id: true },
  });
  return NextResponse.json({ id: client?.id ?? null });
}
