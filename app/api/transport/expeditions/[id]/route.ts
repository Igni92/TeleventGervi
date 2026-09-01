import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TRANSPORT_STATUTS } from "@/lib/transport";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/transport/expeditions/[id] — met à jour une expédition.
 * Champs acceptés : statut (+ horodatage + journal), tempChargement, chauffeurId,
 * tourneeId, ordre, canal, creneau, clientNom, clientAdresse, numCommande,
 * immatriculation, observations, colis, poidsKg.
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const data: Record<string, unknown> = {};
  const setStr = (k: string) => { if (k in b) data[k] = b[k] == null || b[k] === "" ? null : String(b[k]); };
  const setNum = (k: string) => { if (k in b) data[k] = b[k] == null || b[k] === "" ? null : Number(b[k]); };
  setStr("clientNom"); setStr("clientAdresse"); setStr("numCommande"); setStr("creneau");
  setStr("immatriculation"); setStr("observations"); setStr("chauffeurId"); setStr("tourneeId");
  setNum("tempChargement"); setNum("poidsKg"); setNum("colis");
  if ("ordre" in b) data.ordre = Math.round(Number(b.ordre) || 0);
  if ("canal" in b && ["EXPORT", "GMS", "DIRECT"].includes(String(b.canal))) data.canal = String(b.canal);

  // Changement de statut → horodatage dédié + journal (traçabilité e-boutique).
  let newStatut: string | null = null;
  if ("statut" in b && TRANSPORT_STATUTS.includes(String(b.statut) as never)) {
    newStatut = String(b.statut);
    data.statut = newStatut;
    const now = new Date();
    if (newStatut === "PREPAREE") data.prepareeAt = now;
    else if (newStatut === "EXPEDIE") data.expedieAt = now;
    else if (newStatut === "LIVREE") { data.livreeAt = now; data.departAt = data.departAt ?? now; }
  }

  try {
    const exp = await prisma.transportExpedition.update({
      where: { id },
      data: {
        ...data,
        ...(newStatut ? { logs: { create: { statut: newStatut, by: session.user?.email ?? null } } } : {}),
      },
      include: { chauffeur: { select: { id: true, nom: true, type: true, societe: true } }, tournee: { select: { id: true, libelle: true } } },
    });
    return NextResponse.json({ ok: true, expedition: exp });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** DELETE /api/transport/expeditions/[id] — retire une expédition (saisie erronée). */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    await prisma.transportExpedition.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
