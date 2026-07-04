import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAgreages } from "@/lib/agreage";

export const dynamic = "force-dynamic";

/**
 * AGRÉAGE des entrées marchandises — LECTURE seule.
 *
 * GET  /api/entrees/agreage?docEntries=1,2,3
 *      → { ok, agreages: { [docEntry]: Agreage } } (lot d'EM, une requête)
 *
 * L'agréage ne se POSE que lors de la réception d'une COMMANDE FOURNISSEUR
 * (CF → EM) — cf. POST /api/sap/purchase-orders/receive. Une EM saisie en
 * direct n'est pas agréée.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const raw = new URL(req.url).searchParams.get("docEntries") ?? "";
  const docEntries = raw.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const map = await getAgreages(docEntries);
  return NextResponse.json({ ok: true, agreages: Object.fromEntries(map) });
}
