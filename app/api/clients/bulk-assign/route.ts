import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { getAccessScope, getOwnSlpName, requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { normalizeSlp } from "@/lib/salespeople";

/**
 * POST /api/clients/bulk-assign — MÊME opération sur une SÉLECTION de comptes.
 *   body { ids: string[], vendeur?, commercial?, activeTelevente?, qualifieLabo? }
 *
 * Pendant « en série » de /api/clients/[id]/assign et de la qualification de
 * /api/prospection/[id] : réaffecter un portefeuille ou disqualifier un paquet
 * de magasins se fait par centaines de lignes, une requête par ligne serait
 * absurde (et laisserait la liste à moitié traitée au premier échec).
 *
 * DROITS — repris À L'IDENTIQUE des routes unitaires, champ par champ :
 *   • vendeur / commercial / activeTelevente → ADMIN (assignation de portefeuille) ;
 *   • qualifieLabo                           → périmètre du commercial (il
 *     qualifie ce qu'il travaille). Le filtrage se fait EN SQL, dans le WHERE :
 *     un id hors périmètre n'est pas mis à jour, sans faire échouer le lot.
 *
 * Toute (dis)qualification laisse une trace ProspectionActivity : sans elle,
 * « qui a sorti ces 200 magasins du vivier, et quand ? » serait sans réponse.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Plafond de sélection — au-delà c'est un import/script, pas un geste d'écran. */
const MAX_IDS = 2000;

const clean = (v: unknown) => (typeof v === "string" ? normalizeSlp(v) : null);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    ids?: unknown; vendeur?: unknown; commercial?: unknown;
    activeTelevente?: unknown; qualifieLabo?: unknown;
  };

  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((v): v is string => typeof v === "string" && v.length > 0))]
    : [];
  if (ids.length === 0) return NextResponse.json({ error: "Aucun compte sélectionné." }, { status: 400 });
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `Sélection trop large (${ids.length}) — maximum ${MAX_IDS}.` }, { status: 400 });
  }

  const wantsPortfolio =
    body.vendeur !== undefined || body.commercial !== undefined || typeof body.activeTelevente === "boolean";
  const wantsQualif = typeof body.qualifieLabo === "boolean";
  if (!wantsPortfolio && !wantsQualif) {
    return NextResponse.json(
      { error: "Rien à modifier (vendeur, commercial, activeTelevente ou qualifieLabo requis)." },
      { status: 400 },
    );
  }

  const scope = await getAccessScope(session);
  const isAdmin = await requireAdmin(session);
  if (wantsPortfolio && !isAdmin) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  // Qualification hors admin : bornée au portefeuille du commercial.
  if (wantsQualif && !isAdmin && !scope.all && !scope.slpName) {
    return NextResponse.json({ error: "Compte non relié à un commercial." }, { status: 403 });
  }

  const sets: Prisma.Sql[] = [];
  if (typeof body.activeTelevente === "boolean") sets.push(Prisma.sql`"activeTelevente" = ${body.activeTelevente}`);
  if (body.vendeur !== undefined) sets.push(Prisma.sql`"vendeur" = ${clean(body.vendeur)}`);
  if (body.commercial !== undefined) sets.push(Prisma.sql`"commercial" = ${clean(body.commercial)}`);
  if (wantsQualif) sets.push(Prisma.sql`"qualifieLabo" = ${body.qualifieLabo as boolean}`);

  // Garde-fou de périmètre DANS la requête : un non-admin ne touche que les
  // comptes dont il est le commercial ou le vendeur.
  const scoped = isAdmin || scope.all
    ? Prisma.empty
    : Prisma.sql`AND ("commercial" = ${scope.slpName} OR "vendeur" = ${scope.slpName})`;

  try {
    // Les comptes RÉELLEMENT touchés (après filtrage de périmètre) — c'est ce
    // qu'on journalise et ce qu'on renvoie, pas la taille de la sélection.
    const touched = await prisma.$queryRaw<{ id: string; qualifieLabo: boolean | null }[]>(
      Prisma.sql`SELECT "id", "qualifieLabo" FROM "Client"
                 WHERE "id" IN (${Prisma.join(ids)}) ${scoped}`,
    );
    if (touched.length === 0) {
      return NextResponse.json({ ok: true, updated: 0, skipped: ids.length });
    }
    const touchedIds = touched.map((r) => r.id);

    await prisma.$executeRaw(
      Prisma.sql`UPDATE "Client" SET ${Prisma.join(sets, ", ")}, "updatedAt" = NOW()
                 WHERE "id" IN (${Prisma.join(touchedIds)})`,
    );

    // Trace de (dis)qualification — une ligne par compte, uniquement pour ceux
    // dont la valeur CHANGE : re-cocher un déjà-non-qualifié ne pollue pas la
    // timeline. Best-effort : la table peut manquer si la migration prospection
    // n'est pas passée, et ça ne doit pas annuler une mise à jour réussie.
    if (wantsQualif) {
      const value = body.qualifieLabo as boolean;
      const changed = touched.filter((r) => r.qualifieLabo !== value).map((r) => r.id);
      if (changed.length > 0) {
        const slp = await getOwnSlpName(session);
        const email = session.user.email ?? null;
        const note = value
          ? `Qualifié labo en série (${changed.length} comptes)`
          : `Marqué NON qualifié en série (${changed.length} comptes)`;
        try {
          await prisma.$executeRaw(
            Prisma.sql`INSERT INTO "ProspectionActivity" ("id","clientId","ownerSlp","kind","note","createdBy")
                       VALUES ${Prisma.join(
                         changed.map(
                           (cid) => Prisma.sql`(${randomUUID()}, ${cid}, ${slp}, ${"NOTE"}, ${note}, ${email})`,
                         ),
                         ", ",
                       )}`,
          );
        } catch (e) {
          console.warn("[bulk-assign] timeline non journalisée", e);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      updated: touchedIds.length,
      skipped: ids.length - touchedIds.length,
    });
  } catch (e) {
    console.error("[POST /api/clients/bulk-assign]", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
