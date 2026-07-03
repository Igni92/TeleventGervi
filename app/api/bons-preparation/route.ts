import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listBonPreps, setBonPrepLots, deleteBonPrep, getBonPrep } from "@/lib/bonPrep";

export const dynamic = "force-dynamic";

/**
 * Bons de préparation (hors SAP) — circuit EXPORT (cf. lib/bonPrep).
 *
 *   GET    → { ok, bons }                        liste (plus récents d'abord)
 *   PATCH  → { id, lots: (string|null)[] }       pose les lots par ligne
 *   DELETE → ?id=…                               supprime un bon (annulation)
 *
 * La CRÉATION se fait dans POST /api/sap/orders (divert client EXPORT), la
 * TRANSFORMATION en BL par repost de /api/sap/orders avec bonPrepId + lots.
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    const bons = await listBonPreps();
    return NextResponse.json({ ok: true, bons });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  let body: { id?: string; lots?: (string | null)[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  if (!body.id || !Array.isArray(body.lots)) {
    return NextResponse.json({ error: "id et lots requis" }, { status: 400 });
  }
  try {
    const bon = await setBonPrepLots(body.id, body.lots);
    if (!bon) {
      return NextResponse.json({ ok: false, error: "Bon introuvable, déjà transformé ou lots invalides" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, bon });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  try {
    const bon = await getBonPrep(id);
    if (!bon) return NextResponse.json({ ok: false, error: "Bon introuvable" }, { status: 404 });
    // On ne supprime pas l'historique d'un bon déjà transformé (purge auto à 7 j).
    if (bon.status === "TRANSFORME") {
      return NextResponse.json({ ok: false, error: "Bon déjà transformé en BL — il sera purgé automatiquement." }, { status: 409 });
    }
    await deleteBonPrep(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
