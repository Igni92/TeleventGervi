import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CANAL_ORDER, makeRefSuivi } from "@/lib/transport";

export const dynamic = "force-dynamic";

/** Jour (00:00) à partir d'un ?date=YYYY-MM-DD (défaut : aujourd'hui). */
function dayOf(param: string | null): Date {
  const s = /^\d{4}-\d{2}-\d{2}$/.test(param ?? "") ? param! : new Date().toISOString().slice(0, 10);
  return new Date(`${s}T00:00:00.000Z`);
}

/**
 * GET /api/transport/expeditions?date=YYYY-MM-DD
 * Expéditions du jour, triées EXPORT d'abord (départ 6h30) puis GMS, Direct ;
 * dans chaque canal par ordre de passage puis création.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const day = dayOf(new URL(req.url).searchParams.get("date"));
  const next = new Date(day.getTime() + 86_400_000);
  const rows = await prisma.transportExpedition.findMany({
    where: { date: { gte: day, lt: next } },
    include: { chauffeur: { select: { id: true, nom: true, type: true, societe: true } }, tournee: { select: { id: true, libelle: true } } },
  });
  rows.sort((a, b) =>
    (CANAL_ORDER[a.canal] ?? 9) - (CANAL_ORDER[b.canal] ?? 9)
    || a.ordre - b.ordre
    || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  return NextResponse.json({ ok: true, date: day.toISOString().slice(0, 10), expeditions: rows });
}

/**
 * POST /api/transport/expeditions — création MANUELLE d'une expédition.
 * Body : { date, clientNom, canal?, numCommande?, clientAdresse?, creneau?, colis?, poidsKg?, chauffeurId?, observations? }
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const clientNom = String(b.clientNom ?? "").trim();
  if (!clientNom) return NextResponse.json({ error: "Client requis" }, { status: 400 });
  const canal = ["EXPORT", "GMS", "DIRECT"].includes(String(b.canal)) ? String(b.canal) : "GMS";
  const day = dayOf(typeof b.date === "string" ? b.date : null);

  // refSuivi unique (retry sur collision).
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const exp = await prisma.transportExpedition.create({
        data: {
          date: day, clientNom, canal, refSuivi: makeRefSuivi(canal),
          numCommande: b.numCommande ? String(b.numCommande) : null,
          clientAdresse: b.clientAdresse ? String(b.clientAdresse) : null,
          creneau: b.creneau ? String(b.creneau) : null,
          colis: Number.isFinite(Number(b.colis)) ? Math.round(Number(b.colis)) : null,
          poidsKg: Number.isFinite(Number(b.poidsKg)) ? Number(b.poidsKg) : null,
          chauffeurId: b.chauffeurId ? String(b.chauffeurId) : null,
          observations: b.observations ? String(b.observations) : null,
          logs: { create: { statut: "A_PREPARER", by: session.user?.email ?? null } },
        },
      });
      return NextResponse.json({ ok: true, expedition: exp });
    } catch (e) {
      // P2002 = collision refSuivi → on retente ; autre erreur → on remonte.
      if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") continue;
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: false, error: "Réf. de suivi non générée (collisions)" }, { status: 500 });
}
