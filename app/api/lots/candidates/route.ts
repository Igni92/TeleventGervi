import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLotMaps, resolveLotForSegment, LOT_PENDING } from "@/lib/lotResolver";
import { getEmAffects } from "@/lib/emAffect";

export const dynamic = "force-dynamic";

/**
 * GET /api/lots/candidates?items=CODE1,CODE2&segment=EXPORT
 *
 * Candidats de LOTS par article pour l'affectation manuelle (bons de
 * préparation) : les EM récentes connues du résolveur (lib/lotResolver),
 * enrichies de leur AFFECTATION (Tous/Export/GMS/CHR — lib/emAffect) et du
 * magasin de réception. `suggested` = le lot que choisirait la télévente pour
 * ce segment (resolveLotForSegment) — pré-sélection de l'UI.
 *
 * Réponse : { ok, items: { [itemCode]: {
 *   candidates: [{ lot, docNum, warehouse, affect }],   // plus récent d'abord
 *   suggested: string | null,
 * } }, pending: "EM_PENDING" }
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const items = (searchParams.get("items") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);
  const segment = (searchParams.get("segment") ?? "").trim().toUpperCase() || null;
  if (items.length === 0) return NextResponse.json({ error: "items requis" }, { status: 400 });

  try {
    const [maps, affects] = await Promise.all([getLotMaps(), getEmAffects()]);
    const out: Record<string, {
      candidates: { lot: string; docNum: number; warehouse: string | null; affect: string }[];
      suggested: string | null;
    }> = {};
    for (const code of items) {
      const docs = maps.byItemList.get(code) ?? [];
      const candidates = docs.map((d) => ({
        lot: `EM${d}`,
        docNum: d,
        warehouse: maps.whsOfItemDoc.get(`${code}|${d}`) ?? null,
        affect: affects.get(d) ?? "TOUS",
      }));
      const suggested = resolveLotForSegment(maps, affects, code, undefined, segment).lot;
      out[code] = { candidates, suggested };
    }
    return NextResponse.json({ ok: true, items: out, pending: LOT_PENDING });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
