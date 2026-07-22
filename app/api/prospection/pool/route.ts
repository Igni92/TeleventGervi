import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, getOwnSlpName } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * VIVIER de prospects — les fiches importées PAS ENCORE dans la pipeline
 * (prospectStage IS NULL, prospectSource renseigné). On les CHERCHE ici et on
 * les AJOUTE à la pipeline (individuellement ou en série).
 *
 * GET  ?search=&sort=proba|ville|nom&limit=  → liste du vivier (scopée).
 * POST { ids:[...] }  ou  { all:true, search?, proba? }  → passe les prospects
 *      choisis en étape « À contacter » (les fait entrer dans la pipeline) et
 *      les rattache au commercial qui les ajoute (prospectOwner).
 * Colonnes prospection en SQL brut (hors client Prisma typé).
 */
export const dynamic = "force-dynamic";

type PoolRow = {
  id: string; code: string; nom: string; city: string | null; zipCode: string | null;
  probaLabo: string | null; prospectEnseigne: string | null; prospectFormat: string | null;
  prospectSource: string | null;
};

/** Condition d'accès au vivier : admin → tout ; commercial → non attribué ou à lui. */
function scopeCond(scopeAll: boolean, slp: string | null): { sql: string; params: unknown[] } {
  if (scopeAll) return { sql: "", params: [] };
  if (!slp) return { sql: " AND false", params: [] };
  return { sql: ` AND ("prospectOwner" IS NULL OR "prospectOwner" = $__)`, params: [slp] };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const scope = await getAccessScope(session);

  const sp = req.nextUrl.searchParams;
  const search = (sp.get("search") || "").trim();
  const sort = sp.get("sort") || "proba";
  const enseigne = (sp.get("enseigne") || "").trim();      // code enseigne (A, ITM, …)
  const source = (sp.get("source") || "").trim();          // 'gms' | 'ancien'
  const limit = Math.min(500, Math.max(1, Number(sp.get("limit") || 100)));

  const conds: string[] = [`c."prospectStage" IS NULL`, `c."prospectSource" IS NOT NULL`];
  const params: unknown[] = [];
  if (search) {
    params.push(`%${search}%`);
    conds.push(`(c."nom" ILIKE $${params.length} OR c."city" ILIKE $${params.length} OR c."zipCode" ILIKE $${params.length})`);
  }
  if (enseigne) {
    params.push(enseigne);
    conds.push(`c."prospectEnseigne" = $${params.length}`);
  }
  if (source === "gms") conds.push(`c."prospectSource" = 'import-gms-idf-patisserie'`);
  else if (source === "ancien") conds.push(`c."prospectSource" = 'ancien-client'`);
  if (!scope.all) {
    if (!scope.slpName) return NextResponse.json({ rows: [], total: 0 });
    params.push(scope.slpName);
    conds.push(`(c."prospectOwner" IS NULL OR c."prospectOwner" = $${params.length})`);
  }
  const order =
    sort === "ville" ? `c."city" ASC NULLS LAST, c."nom" ASC`
    : sort === "nom" ? `c."nom" ASC`
    : sort === "enseigne" ? `c."prospectEnseigne" ASC NULLS LAST, c."nom" ASC`
    : // proba : Élevée → Moyenne-haute → Moyenne → À qualifier
      `CASE c."probaLabo" WHEN 'Élevée' THEN 0 WHEN 'Moyenne-haute' THEN 1 WHEN 'Moyenne' THEN 2 ELSE 3 END, c."nom" ASC`;

  try {
    const rows = await prisma.$queryRawUnsafe<PoolRow[]>(
      `SELECT c."id", c."code", c."nom", c."city", c."zipCode", c."probaLabo",
              c."prospectEnseigne", c."prospectFormat", c."prospectSource"
         FROM "Client" c WHERE ${conds.join(" AND ")}
        ORDER BY ${order} LIMIT ${limit}`,
      ...params,
    );
    const totalRows = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM "Client" c WHERE ${conds.join(" AND ")}`,
      ...params,
    );
    return NextResponse.json({ rows, total: totalRows[0]?.n ?? rows.length, shown: rows.length });
  } catch (e) {
    console.error("[GET /api/prospection/pool]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const scope = await getAccessScope(session);
  const slp = await getOwnSlpName(session);

  const body = (await req.json().catch(() => ({}))) as { ids?: unknown; all?: unknown; search?: unknown; proba?: unknown; enseigne?: unknown; source?: unknown };

  // Sélecteur : liste d'ids OU tout le vivier filtré (all + search/proba).
  const conds: string[] = [`"prospectStage" IS NULL`, `"prospectSource" IS NOT NULL`];
  const params: unknown[] = [];
  if (Array.isArray(body.ids) && body.ids.length) {
    const ids = body.ids.filter((x): x is string => typeof x === "string").slice(0, 2000);
    if (!ids.length) return NextResponse.json({ ok: true, added: 0 });
    params.push(ids);
    conds.push(`"id" = ANY($${params.length}::text[])`);
  } else if (body.all) {
    if (typeof body.search === "string" && body.search.trim()) {
      params.push(`%${body.search.trim()}%`);
      conds.push(`("nom" ILIKE $${params.length} OR "city" ILIKE $${params.length} OR "zipCode" ILIKE $${params.length})`);
    }
    if (typeof body.proba === "string" && body.proba) {
      params.push(body.proba);
      conds.push(`"probaLabo" = $${params.length}`);
    }
    if (typeof body.enseigne === "string" && body.enseigne) {
      params.push(body.enseigne);
      conds.push(`"prospectEnseigne" = $${params.length}`);
    }
    if (body.source === "gms") conds.push(`"prospectSource" = 'import-gms-idf-patisserie'`);
    else if (body.source === "ancien") conds.push(`"prospectSource" = 'ancien-client'`);
  } else {
    return NextResponse.json({ error: "Rien à ajouter (ids ou all requis)." }, { status: 400 });
  }
  // Accès : un commercial ne peut ajouter que des prospects non attribués (ou à lui).
  if (!scope.all) {
    if (!scope.slpName) return NextResponse.json({ error: "Compte non mappé." }, { status: 403 });
    params.push(scope.slpName);
    conds.push(`("prospectOwner" IS NULL OR "prospectOwner" = $${params.length})`);
  }
  // Propriétaire posé à l'ajout (le commercial s'approprie ; admin → inchangé si null).
  const ownerSet = slp ? `, "prospectOwner" = COALESCE("prospectOwner", $${params.push(slp)})` : "";

  try {
    const n = await prisma.$executeRawUnsafe(
      `UPDATE "Client" SET "prospectStage" = 'A_CONTACTER', "prospectStageAt" = now()${ownerSet}
        WHERE ${conds.join(" AND ")}`,
      ...params,
    );
    return NextResponse.json({ ok: true, added: typeof n === "number" ? n : 0 });
  } catch (e) {
    console.error("[POST /api/prospection/pool]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
