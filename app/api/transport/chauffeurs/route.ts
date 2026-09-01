import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/transport/chauffeurs — liste (actifs d'abord). */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const chauffeurs = await prisma.transportChauffeur.findMany({ orderBy: [{ actif: "desc" }, { nom: "asc" }] });
  return NextResponse.json({ ok: true, chauffeurs });
}

/** POST /api/transport/chauffeurs — crée un chauffeur. Body : { nom, type?, societe?, tel?, email? } */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const nom = String(b.nom ?? "").trim();
  if (!nom) return NextResponse.json({ error: "Nom requis" }, { status: 400 });
  try {
    const chauffeur = await prisma.transportChauffeur.create({
      data: {
        nom,
        type: String(b.type) === "EXTERIEUR" ? "EXTERIEUR" : "INTERNE",
        societe: b.societe ? String(b.societe) : null,
        tel: b.tel ? String(b.tel) : null,
        email: b.email ? String(b.email) : null,
      },
    });
    return NextResponse.json({ ok: true, chauffeur });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
