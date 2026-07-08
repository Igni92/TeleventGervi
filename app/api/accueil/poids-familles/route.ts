import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { periodBounds } from "@/lib/pilotage-time";
import { familyOf, FRUIT_FAMILIES } from "@/lib/familles";

export const dynamic = "force-dynamic";

/**
 * GET /api/accueil/poids-familles → { ok, families: [{ key, label, weightKg }] }
 *
 * Poids VENDU aujourd'hui (commandes du jour, hors annulées) par FAMILLE de fruit
 * (fraise, framboise, myrtille…). Poids d'une ligne = quantité × Product.salesUnitWeight
 * (même règle que le KPI « Volume kg »). Les 6 familles connues sont toujours
 * renvoyées (0 si aucune vente) ; les autres familles ayant des ventes sont ajoutées.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    const { start, end } = periodBounds("day");
    const rows = await prisma.$queryRaw<{ name: string | null; grp: string | null; w: number }[]>`
      SELECT p."itemName" AS name, p."groupName" AS grp,
             COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS w
      FROM "SapOrder" o
      JOIN "SapOrderLine" l ON l."docEntry" = o."docEntry"
      JOIN "Product" p ON p."itemCode" = l."itemCode"
      WHERE o."cancelled" = false AND l."isService" = false
        AND o."docDate" >= ${start} AND o."docDate" < ${end}
      GROUP BY p."itemName", p."groupName"`;

    const byFamily = new Map<string, { key: string; label: string; weightKg: number }>();
    for (const r of rows) {
      const fam = familyOf(r.name, r.grp);
      const cur = byFamily.get(fam.key) ?? { key: fam.key, label: fam.label, weightKg: 0 };
      cur.weightKg += Number(r.w) || 0;
      byFamily.set(fam.key, cur);
    }

    // Toujours les 6 familles fruit (0 si rien vendu), puis les autres avec ventes.
    const families = FRUIT_FAMILIES.map((f) => byFamily.get(f.key) ?? { key: f.key, label: f.label, weightKg: 0 });
    for (const [k, v] of byFamily) if (!FRUIT_FAMILIES.some((f) => f.key === k) && v.weightKg > 0) families.push(v);

    return NextResponse.json({ ok: true, families });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), families: [] });
  }
}
