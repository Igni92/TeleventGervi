import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { getSuggestedPrices } from "@/lib/gerviPricing";
import { cached } from "@/lib/ttlCache";

/**
 * GET /api/sap/prices?clientId=xxx&items=A,B,C
 *   ou ?group=275&items=...   ou ?cardCode=APLAI&items=...
 *
 * Prix de vente CONSEILLÉ (aide à la saisie, non figé) + attributs produit
 * (marque, calibre, pays), calculés via le moteur Gervifrais :
 *   PrixAchat(PriceList 2) × coef(groupe client × catégorie article), défaut 1.5.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const items = (searchParams.get("items") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return NextResponse.json({ prices: {}, group: null });

  // Résout le groupe client (BusinessPartner.GroupCode)
  let group: number | null = null;
  const groupParam = searchParams.get("group");
  if (groupParam) group = parseInt(groupParam);
  else {
    let cardCode = searchParams.get("cardCode");
    if (!cardCode && searchParams.get("clientId")) {
      const c = await prisma.client.findUnique({ where: { id: searchParams.get("clientId")! }, select: { code: true } });
      cardCode = c?.code ?? null;
    }
    if (cardCode) {
      try {
        // L'écran 2 demande les prix par tranches de 40 articles : pour un
        // catalogue complet, cette route est appelée des dizaines de fois
        // d'affilée AVEC LE MÊME cardCode, et chaque appel re-demandait le
        // groupe à SAP. Or le groupe tarifaire d'un client est du référentiel :
        // on le garde 10 min, ce qui ramène N appels à 1.
        const cc = cardCode;
        group = await cached(`sap:bpgroup:${cc}`, 10 * 60_000, async () => {
          const bp = await sap.get<{ GroupCode?: number }>(`BusinessPartners('${encodeURIComponent(cc)}')?$select=GroupCode`, { env: "prod" });
          return bp.GroupCode ?? null;
        });
      } catch { /* group null → coef défaut 1.5 */ }
    }
  }

  try {
    const prices = await getSuggestedPrices(items, group);
    return NextResponse.json({ group, count: Object.keys(prices).length, prices });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), prices: {} }, { status: 500 });
  }
}
