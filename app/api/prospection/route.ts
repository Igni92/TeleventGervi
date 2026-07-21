import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * BOARD PROSPECTION — liste des prospects (Client.prospectStage renseigné),
 * scopée : un non-admin ne voit que SES prospects (prospectOwner = son trigramme,
 * ou commercial/vendeur = son trigramme). Colonnes lues en SQL brut (hors client
 * Prisma typé tant que `prisma generate` est bloqué — même convention que vendeur).
 *
 * GET (aucun effet de bord). Le regroupement par étape se fait côté écran.
 */
export const dynamic = "force-dynamic";

type BoardRow = {
  id: string;
  code: string;
  nom: string;
  city: string | null;
  zipCode: string | null;
  tel1: string | null;
  email: string | null;
  probaLabo: string | null;
  prospectStage: string | null;
  prospectOwner: string | null;
  prospectSource: string | null;
  prospectLostReason: string | null;
  qualifieLabo: boolean | null;
  prospectStageAt: Date | null;
  nextRdvAt: Date | null;
};

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const scope = await getAccessScope(session);

  // Filtre d'accès : admin → tout ; commercial → ses prospects (propriétaire OU
  // commercial OU vendeur = son trigramme). Non mappé → rien.
  let where = `c."prospectStage" IS NOT NULL`;
  const params: unknown[] = [];
  if (!scope.all) {
    if (!scope.slpName) return NextResponse.json({ rows: [], scope: { all: false, slpName: null } });
    params.push(scope.slpName);
    where += ` AND (c."prospectOwner" = $1 OR c."commercial" = $1 OR c."vendeur" = $1)`;
  }

  try {
    const rows = await prisma.$queryRawUnsafe<BoardRow[]>(
      `SELECT c."id", c."code", c."nom", c."city", c."zipCode", c."tel1", c."email",
              c."probaLabo", c."prospectStage", c."prospectOwner", c."prospectSource",
              c."prospectLostReason", c."qualifieLabo", c."prospectStageAt",
              (SELECT MIN(r."startAt") FROM "RendezVous" r
                 WHERE r."clientId" = c."id" AND r."status" = 'PLANIFIE'
                   AND r."startAt" >= now()) AS "nextRdvAt"
         FROM "Client" c
        WHERE ${where}
        ORDER BY c."prospectStageAt" DESC NULLS LAST, c."nom" ASC`,
      ...params,
    );
    return NextResponse.json({ rows, scope: { all: scope.all, slpName: scope.all ? null : scope.slpName } });
  } catch (e) {
    console.error("[GET /api/prospection]", e);
    return NextResponse.json({ error: "Erreur serveur (migration prospection appliquée ?)" }, { status: 500 });
  }
}
