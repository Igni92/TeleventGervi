import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sap } from "@/lib/sapb1";

/**
 * GET /api/sap/business-partner-groups
 *
 * Liste des GROUPES CLIENTS SAP (BusinessPartnerGroups, type client) — pour le
 * sélecteur de groupe sur la fiche client (édition bidirectionnelle du groupe).
 * { groups: [{ code, name }] }
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ groups: [] }, { status: 200 });

  try {
    const res = await sap.get<{ value: { Code: number; Name: string }[] }>(
      `BusinessPartnerGroups?$select=Code,Name&$filter=${encodeURIComponent("Type eq 'bbpgt_CustomerGroup'")}`,
    );
    const groups = (res.value ?? [])
      .map((g) => ({ code: g.Code, name: g.Name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ groups });
  } catch (e) {
    return NextResponse.json({ groups: [], error: e instanceof Error ? e.message : String(e) });
  }
}
