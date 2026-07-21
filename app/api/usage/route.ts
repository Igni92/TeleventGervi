import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ingestUsageBatch, type UsageBatch } from "@/lib/usage";

/**
 * Ingestion de l'analytique d'usage (temps + clics + problèmes par écran).
 *
 * Reçoit un lot envoyé par components/UsageTracker via navigator.sendBeacon
 * (repli fetch keepalive). Le corps est un JSON `UsageBatch`. On rattache
 * l'utilisateur connecté (best-effort : le cookie de session accompagne le
 * beacon même au déchargement de page), sinon on enregistre en anonyme.
 *
 * Toujours 204 — le tracking est non-bloquant et ne renvoie aucune donnée :
 * une erreur d'ingestion ne doit jamais remonter au navigateur.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    let batch: UsageBatch | null = null;
    try {
      batch = (await req.json()) as UsageBatch;
    } catch {
      // sendBeacon peut poster en text/plain selon le navigateur.
      const text = await req.text().catch(() => "");
      if (text) { try { batch = JSON.parse(text) as UsageBatch; } catch { batch = null; } }
    }

    if (batch && typeof batch === "object" && batch.sessionId) {
      const session = await auth().catch(() => null);
      await ingestUsageBatch(batch, {
        userId: session?.user?.id ?? null,
        userEmail: session?.user?.email ?? null,
        userName: session?.user?.name ?? null,
        userAgent: req.headers.get("user-agent"),
      });
    }
  } catch (err) {
    console.warn("[POST /api/usage] non-bloquant:", (err as Error).message);
  }
  // 204 quoi qu'il arrive.
  return new NextResponse(null, { status: 204 });
}
