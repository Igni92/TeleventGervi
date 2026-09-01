import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CANAL_ORDER, TRANSPORT_STATUTS } from "@/lib/transport";

// PUBLIQUE (pas de session) — l'accès est garanti par le TOKEN unique de la
// tournée (chauffeur extérieur sans compte). Route déclarée publique dans proxy.ts.
export const dynamic = "force-dynamic";

async function tourneeByToken(token: string) {
  return prisma.transportTournee.findUnique({
    where: { token },
    include: { chauffeur: { select: { id: true, nom: true, type: true, societe: true, tel: true } } },
  });
}

/** GET — feuille de route du chauffeur : ses expéditions du jour de la tournée. */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const t = await tourneeByToken(token);
  if (!t) return NextResponse.json({ ok: false, error: "Feuille introuvable" }, { status: 404 });
  const day = new Date(t.date);
  const next = new Date(day.getTime() + 86_400_000);
  const expeditions = await prisma.transportExpedition.findMany({
    where: { chauffeurId: t.chauffeurId ?? "__none__", date: { gte: day, lt: next } },
    select: {
      id: true, refSuivi: true, numCommande: true, clientNom: true, clientAdresse: true,
      creneau: true, canal: true, ordre: true, statut: true, colis: true, poidsKg: true,
      tempChargement: true, observations: true,
    },
  });
  expeditions.sort((a, b) => (CANAL_ORDER[a.canal] ?? 9) - (CANAL_ORDER[b.canal] ?? 9) || a.ordre - b.ordre);
  return NextResponse.json({
    ok: true,
    date: day.toISOString().slice(0, 10),
    libelle: t.libelle,
    chauffeur: t.chauffeur,
    expeditions,
  });
}

/** PATCH — le chauffeur met à jour un statut depuis sa feuille. Body : { expeditionId, statut }. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const t = await tourneeByToken(token);
  if (!t) return NextResponse.json({ ok: false, error: "Feuille introuvable" }, { status: 404 });
  let b: { expeditionId?: string; statut?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const statut = String(b.statut ?? "");
  if (!TRANSPORT_STATUTS.includes(statut as never)) return NextResponse.json({ error: "Statut invalide" }, { status: 400 });

  // Sécurité : l'expédition doit appartenir au chauffeur+jour de CETTE tournée.
  const day = new Date(t.date);
  const next = new Date(day.getTime() + 86_400_000);
  const exp = await prisma.transportExpedition.findFirst({
    where: { id: String(b.expeditionId), chauffeurId: t.chauffeurId ?? "__none__", date: { gte: day, lt: next } },
    select: { id: true },
  });
  if (!exp) return NextResponse.json({ ok: false, error: "Expédition hors de cette feuille" }, { status: 404 });

  const now = new Date();
  const stamp = statut === "PREPAREE" ? { prepareeAt: now } : statut === "EXPEDIE" ? { expedieAt: now } : statut === "LIVREE" ? { livreeAt: now } : {};
  const updated = await prisma.transportExpedition.update({
    where: { id: exp.id },
    data: { statut, ...stamp, logs: { create: { statut, by: `chauffeur:${t.chauffeur?.nom ?? token.slice(0, 6)}` } } },
    select: { id: true, statut: true },
  });
  return NextResponse.json({ ok: true, expedition: updated });
}
