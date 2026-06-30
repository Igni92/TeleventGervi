import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requirePreparateurOrAdmin } from "@/lib/permissions";
import { getDlcMap, setDlc } from "@/lib/lotDlc";

/**
 * DLC (fraîcheur) des lots — côté TeleVent uniquement (#1/#6).
 *
 * GET  /api/lots/dlc?batches=EM14878,EM14879 → { dlc: { [batchNumber]: ISO|null } }
 * POST /api/lots/dlc  { batchNumber, itemCode?, expirationDate } → upsert
 *
 * Lecture : toute session connectée. Écriture : préparateur / administration.
 * Ne touche jamais SAP ni la sélection de lot expédié.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const raw = req.nextUrl.searchParams.get("batches") ?? "";
  const batches = raw.split(",").map((b) => b.trim()).filter(Boolean);
  if (batches.length === 0) return NextResponse.json({ dlc: {} });

  const map = await getDlcMap(batches);
  const dlc: Record<string, string | null> = {};
  for (const b of batches) {
    const d = map.get(b);
    dlc[b] = d ? d.toISOString() : null;
  }
  return NextResponse.json({ dlc });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requirePreparateurOrAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la préparation / l'administration" }, { status: 403 });
  }

  let body: { batchNumber?: string; itemCode?: string | null; expirationDate?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const batchNumber = (body.batchNumber ?? "").trim();
  if (!batchNumber) return NextResponse.json({ error: "batchNumber requis" }, { status: 400 });

  let expirationDate: Date | null = null;
  if (body.expirationDate) {
    const d = new Date(body.expirationDate);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "Date de DLC invalide" }, { status: 400 });
    }
    expirationDate = d;
  }

  await setDlc({
    batchNumber,
    itemCode: body.itemCode ?? null,
    expirationDate,
    createdBy: session.user?.email ?? null,
  });
  return NextResponse.json({ ok: true, batchNumber });
}
