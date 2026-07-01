import { NextResponse } from "next/server";
import { vapidPublicKey, pushEnabled } from "@/lib/push";

/**
 * GET /api/push/vapid — clé publique VAPID pour l'abonnement côté client.
 * `enabled: false` = notifications non configurées (pas de clés) → le client
 * masque simplement le bouton d'activation.
 */
export async function GET() {
  return NextResponse.json({ enabled: pushEnabled(), key: vapidPublicKey() });
}
