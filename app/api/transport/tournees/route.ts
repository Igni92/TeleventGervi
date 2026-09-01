import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function dayOf(s?: string): Date {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s ?? "") ? s! : new Date().toISOString().slice(0, 10);
  return new Date(`${d}T00:00:00.000Z`);
}

/**
 * POST /api/transport/tournees — récupère (ou crée) la tournée d'un chauffeur pour
 * un jour, et renvoie son lien tokenisé (feuille de route à partager, sans compte).
 * Body : { date, chauffeurId, libelle? }
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let b: { date?: string; chauffeurId?: string; libelle?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const chauffeurId = String(b.chauffeurId ?? "");
  if (!chauffeurId) return NextResponse.json({ error: "Chauffeur requis" }, { status: 400 });
  const date = dayOf(b.date);
  const next = new Date(date.getTime() + 86_400_000);

  let tournee = await prisma.transportTournee.findFirst({ where: { chauffeurId, date: { gte: date, lt: next } } });
  if (!tournee) {
    tournee = await prisma.transportTournee.create({ data: { date, chauffeurId, libelle: b.libelle ? String(b.libelle) : null } });
  } else if (b.libelle != null) {
    tournee = await prisma.transportTournee.update({ where: { id: tournee.id }, data: { libelle: String(b.libelle) } });
  }
  return NextResponse.json({ ok: true, tournee, path: `/feuille-route/${tournee.token}` });
}
