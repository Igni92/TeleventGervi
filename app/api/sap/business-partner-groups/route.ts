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
    // On récupère TOUS les groupes (sans $filter Type, parfois non sélectionnable
    // selon le SAP) puis on filtre les groupes CLIENTS côté serveur. Fallback : si
    // aucun n'est typé client, on renvoie tous les groupes (mieux que rien).
    const res = await sap.get<{ value: { Code: number; Name: string; Type?: string }[] }>(
      `BusinessPartnerGroups?$select=Code,Name,Type`,
    );
    const all = res.value ?? [];
    const customers = all.filter((g) => g.Type == null || g.Type === "bbpgt_CustomerGroup");
    const groups = (customers.length > 0 ? customers : all)
      .map((g) => ({ code: g.Code, name: g.Name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ groups });
  } catch {
    // Dernier recours : sans $select (certains SAP rejettent le champ Type).
    try {
      const res2 = await sap.get<{ value: { Code: number; Name: string }[] }>(`BusinessPartnerGroups`);
      const groups = (res2.value ?? [])
        .map((g) => ({ code: g.Code, name: g.Name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return NextResponse.json({ groups });
    } catch (e2) {
      return NextResponse.json({ groups: [], error: e2 instanceof Error ? e2.message : String(e2) });
    }
  }
}
