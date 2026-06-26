import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTransporteurs, getTransporteurDetail } from "@/lib/transporteurs";

/**
 * GET /api/transporteurs            → catalogue { code, name, timbre } (SERGTRS)
 * GET /api/transporteurs?code=ANTOINE → détail + tournées { …, tournees:[{nom,des,heure}] }
 *
 * Source : UDO SAP SERGTRS (cf. lib/transporteurs). Le `code` peut contenir des
 * espaces (ex. "DELANCHY FT86") → passé en query, pas en segment d'URL.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const code = req.nextUrl.searchParams.get("code");
  try {
    if (code) {
      const detail = await getTransporteurDetail(code);
      if (!detail) return NextResponse.json({ ok: false, error: "Transporteur introuvable" }, { status: 404 });
      return NextResponse.json({ ok: true, transporteur: detail });
    }
    const transporteurs = await getTransporteurs();
    return NextResponse.json({ ok: true, transporteurs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
