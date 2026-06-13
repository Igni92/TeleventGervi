import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sap } from "@/lib/sapb1";

/**
 * GET /api/sap/suppliers?q=...
 *
 * Recherche des fournisseurs SAP (BusinessPartners, CardType=cSupplier) pour
 * l'autocomplete du formulaire d'entrée marchandise. Retourne max 20 résultats.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const q = (new URL(req.url)).searchParams.get("q")?.trim() ?? "";

  // ⚠️ OData : on échappe les ' en ''. cSupplier = code SAP du type fournisseur.
  const esc = q.replace(/'/g, "''");
  const search = q
    ? ` and (contains(CardCode,'${esc}') or contains(CardName,'${esc}'))`
    : "";
  const filter = `CardType eq 'cSupplier' and Frozen eq 'tNO' and Valid eq 'tYES'${search}`;

  try {
    type SapBp = { CardCode: string; CardName?: string; Frozen?: string; Valid?: string };
    const r = await sap.get<{ value: SapBp[] }>(
      `BusinessPartners?$top=20&$orderby=CardName&$select=CardCode,CardName,Frozen,Valid`
      + `&$filter=${encodeURIComponent(filter)}`,
    );
    return NextResponse.json({
      count: r.value?.length || 0,
      suppliers: (r.value || []).map((bp) => ({
        cardCode: bp.CardCode,
        cardName: bp.CardName ?? bp.CardCode,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
