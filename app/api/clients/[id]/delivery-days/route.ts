import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { serializeDeliveryDays } from "@/lib/deliveryDays";

/**
 * Jours de livraison du client (onglet Logistique) — mise à jour ISOLÉE de
 * Client.joursLivraison, sans passer par le formulaire complet (évite une
 * course avec l'édition « Informations »).
 *
 * Convention de stockage : tableau vide → "" (client EXPLICITEMENT non livré,
 * BL daté au jour le jour) ; sinon CSV des jours (0=dim … 6=sam).
 */
const Schema = z.object({
  jours: z.array(z.number().int().min(0).max(6)),
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 });

  try {
    const existing = await prisma.client.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

    const joursLivraison = serializeDeliveryDays(parsed.data.jours); // "" = non livré
    await prisma.client.update({ where: { id: params.id }, data: { joursLivraison } });

    return NextResponse.json({ ok: true, joursLivraison });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
