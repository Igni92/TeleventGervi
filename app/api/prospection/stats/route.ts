import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * STATS de prospection : entonnoir par étape, gagnés / perdus (+ motifs),
 * activité par commercial, et composition du vivier (enseigne / format / proba /
 * origine). Scopé : un commercial ne voit que ses prospects (prospectOwner).
 * Colonnes prospection en SQL brut (hors client Prisma typé).
 *
 * GET /api/prospection/stats
 */
export const dynamic = "force-dynamic";

type Bucket = { k: string | null; n: number };

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const scope = await getAccessScope(session);

  // Périmètre : prospects = comptes en pipeline OU issus du vivier de prospection.
  const base = `("prospectStage" IS NOT NULL OR "prospectSource" IS NOT NULL)`;
  const scopeCond = scope.all
    ? ""
    : scope.slpName
      ? ` AND "prospectOwner" = '${scope.slpName.replace(/'/g, "''")}'`
      : ` AND false`;
  const where = `WHERE ${base}${scopeCond}`;

  try {
    const [funnel, lost, byOwner, byEnseigne, byFormat, byProba, bySource] = await Promise.all([
      prisma.$queryRawUnsafe<Bucket[]>(
        `SELECT "prospectStage" AS k, COUNT(*)::int AS n FROM "Client" ${where} GROUP BY 1`),
      prisma.$queryRawUnsafe<Bucket[]>(
        `SELECT "prospectLostReason" AS k, COUNT(*)::int AS n FROM "Client" ${where} AND "prospectStage" = 'PERDU' GROUP BY 1 ORDER BY 2 DESC`),
      prisma.$queryRawUnsafe<{ k: string | null; won: number; lost: number; active: number }[]>(
        `SELECT "prospectOwner" AS k,
                COUNT(*) FILTER (WHERE "prospectStage" = 'GAGNE')::int AS won,
                COUNT(*) FILTER (WHERE "prospectStage" = 'PERDU')::int AS lost,
                COUNT(*) FILTER (WHERE "prospectStage" IN ('A_CONTACTER','QUALIFICATION','PRESENTATION','POST_COMMANDE'))::int AS active
           FROM "Client" ${where} AND "prospectStage" IS NOT NULL GROUP BY 1 ORDER BY won DESC, active DESC`),
      // Composition du VIVIER (hors pipeline) — ce qu'il reste à travailler.
      prisma.$queryRawUnsafe<Bucket[]>(
        `SELECT "prospectEnseigne" AS k, COUNT(*)::int AS n FROM "Client" ${where} AND "prospectStage" IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
      prisma.$queryRawUnsafe<Bucket[]>(
        `SELECT "prospectFormat" AS k, COUNT(*)::int AS n FROM "Client" ${where} AND "prospectStage" IS NULL GROUP BY 1 ORDER BY 2 DESC`),
      prisma.$queryRawUnsafe<Bucket[]>(
        `SELECT "probaLabo" AS k, COUNT(*)::int AS n FROM "Client" ${where} AND "prospectStage" IS NULL GROUP BY 1 ORDER BY 2 DESC`),
      prisma.$queryRawUnsafe<Bucket[]>(
        `SELECT "prospectSource" AS k, COUNT(*)::int AS n FROM "Client" ${where} AND "prospectStage" IS NULL GROUP BY 1 ORDER BY 2 DESC`),
    ]);

    const stageCount = (key: string) => funnel.find((f) => f.k === key)?.n ?? 0;
    const won = stageCount("GAGNE");
    const lostN = stageCount("PERDU");
    const inPipeline = ["A_CONTACTER", "QUALIFICATION", "PRESENTATION", "POST_COMMANDE"].reduce((s, k) => s + stageCount(k), 0);
    const vivier = byProba.reduce((s, b) => s + b.n, 0);
    // Taux de conversion = gagnés / (gagnés + perdus) sur les issues tranchées.
    const decided = won + lostN;
    const conversion = decided > 0 ? Math.round((won / decided) * 100) : null;

    return NextResponse.json({
      ok: true,
      scope: scope.all ? "all" : scope.slpName,
      kpis: { won, lost: lostN, inPipeline, vivier, conversion },
      funnel: ["A_CONTACTER", "QUALIFICATION", "PRESENTATION", "POST_COMMANDE", "GAGNE"].map((k) => ({ k, n: stageCount(k) })),
      lostByReason: lost,
      byOwner,
      vivierComposition: { byEnseigne, byFormat, byProba, bySource },
    });
  } catch (e) {
    console.error("[GET /api/prospection/stats]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
