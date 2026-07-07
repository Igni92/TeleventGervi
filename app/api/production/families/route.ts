import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FAMILY_CTE_SQL } from "@/lib/famillesSql";

/**
 * GET /api/production/families
 *
 * Liste des familles effectives (cf. lib/familles) pour le picker de recette
 * d'ordre de production : groseille / mûre / myrtille / framboise / cassis /
 * fraise, puis les groupes SAP restants. Une « famille » regroupe plusieurs
 * SKU ; à la production on choisit le lot réellement en stock (FIFO).
 *
 * Raw SQL (CTE partagée) pour ne pas dépendre d'un prisma generate à jour.
 */

type FamilyRow = { familyKey: string; familyLabel: string; productCount: number };

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const rows = await prisma.$queryRaw<FamilyRow[]>(Prisma.sql`
    SELECT t."familyKey",
           MIN(t."familyLabel")  AS "familyLabel",
           COUNT(*)::int         AS "productCount"
    FROM (${FAMILY_CTE_SQL}) AS t
    GROUP BY t."familyKey"
    ORDER BY MIN(t."familyLabel") ASC;
  `);

  // Les familles « fruit » (clé courte, sans préfixe g_) remontent en tête.
  const isFruit = (k: string) => !k.startsWith("g_");
  const families = [...rows].sort((a, b) => {
    const fa = isFruit(a.familyKey) ? 0 : 1;
    const fb = isFruit(b.familyKey) ? 0 : 1;
    return fa - fb || a.familyLabel.localeCompare(b.familyLabel);
  });

  return NextResponse.json({ ok: true, families });
}
