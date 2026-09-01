import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** PATCH /api/transport/chauffeurs/[id] — édite un chauffeur (nom, type, societe, tel, email, actif). */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const data: Record<string, unknown> = {};
  if ("nom" in b) data.nom = String(b.nom ?? "").trim();
  if ("type" in b) data.type = String(b.type) === "EXTERIEUR" ? "EXTERIEUR" : "INTERNE";
  if ("societe" in b) data.societe = b.societe ? String(b.societe) : null;
  if ("tel" in b) data.tel = b.tel ? String(b.tel) : null;
  if ("email" in b) data.email = b.email ? String(b.email) : null;
  if ("actif" in b) data.actif = !!b.actif;
  try {
    const chauffeur = await prisma.transportChauffeur.update({ where: { id }, data });
    return NextResponse.json({ ok: true, chauffeur });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** DELETE /api/transport/chauffeurs/[id] — supprime (les affectations passent à null via onDelete: SetNull). */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    await prisma.transportChauffeur.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
