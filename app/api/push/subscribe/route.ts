import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Abonnements Web-Push de l'utilisateur connecté.
 *   POST   — enregistre (upsert par endpoint) un abonnement navigateur.
 *   DELETE — désabonne l'endpoint fourni.
 */

const subSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  try {
    const body = await req.json();
    const data = subSchema.parse(body);
    const userAgent = req.headers.get("user-agent")?.slice(0, 255) ?? null;

    // Upsert par endpoint (unique) : re-souscrire depuis le même navigateur met
    // à jour les clés / le propriétaire plutôt que d'empiler des doublons.
    await prisma.pushSubscription.upsert({
      where: { endpoint: data.endpoint },
      create: {
        userId: session.user.id,
        email: session.user.email ?? null,
        endpoint: data.endpoint,
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
        userAgent,
      },
      update: {
        userId: session.user.id,
        email: session.user.email ?? null,
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
        userAgent,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/push/subscribe]", error);
    return NextResponse.json({ error: "Données invalides" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  try {
    const { endpoint } = await req.json();
    if (typeof endpoint !== "string") {
      return NextResponse.json({ error: "endpoint requis" }, { status: 400 });
    }
    // On ne supprime QUE ses propres abonnements.
    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: session.user.id },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/push/subscribe]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
