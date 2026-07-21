import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope, getOwnSlpName } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isValidStage } from "@/lib/prospection";

export const dynamic = "force-dynamic";

/**
 * Met à jour un prospect : déplacement d'ÉTAPE, résultat de qualification labo,
 * motif de perte, note libre. Journalise une ProspectionActivity (timeline).
 * Le commercial qui travaille le prospect s'en approprie la PROPRIÉTÉ
 * (prospectOwner) s'il n'en a pas déjà un. Accès scopé (clientInScope).
 * Colonnes/tables prospection en SQL brut (hors client Prisma typé).
 *
 * PATCH /api/prospection/[id]  { stage?, qualifieLabo?, lostReason?, note? }
 */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), id))) {
    return NextResponse.json({ error: "Accès refusé à ce prospect." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    stage?: unknown; qualifieLabo?: unknown; lostReason?: unknown; note?: unknown;
  };
  const stage = typeof body.stage === "string" ? body.stage : null;
  if (stage && !isValidStage(stage)) {
    return NextResponse.json({ error: "Étape inconnue." }, { status: 400 });
  }

  const email = session.user.email ?? null;
  const slp = await getOwnSlpName(session);

  try {
    // Étape actuelle (pour la timeline).
    const cur = await prisma.$queryRawUnsafe<{ prospectStage: string | null }[]>(
      `SELECT "prospectStage" FROM "Client" WHERE "id" = $1 LIMIT 1`,
      id,
    );
    if (!cur.length) return NextResponse.json({ error: "Prospect introuvable." }, { status: 404 });
    const fromStage = cur[0].prospectStage;

    // Construction dynamique du UPDATE (uniquement les champs fournis).
    const sets: string[] = [];
    const p: unknown[] = [];
    if (stage) {
      sets.push(`"prospectStage" = $${p.push(stage)}`);
      sets.push(`"prospectStageAt" = now()`);
    }
    if (typeof body.qualifieLabo === "boolean") {
      sets.push(`"qualifieLabo" = $${p.push(body.qualifieLabo)}`);
    }
    if (typeof body.lostReason === "string") {
      sets.push(`"prospectLostReason" = $${p.push(body.lostReason.slice(0, 200))}`);
    }
    if (slp) {
      // S'approprie le prospect s'il n'a pas encore de propriétaire.
      sets.push(`"prospectOwner" = COALESCE("prospectOwner", $${p.push(slp)})`);
    }
    if (sets.length) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Client" SET ${sets.join(", ")} WHERE "id" = $${p.push(id)}`,
        ...p,
      );
    }

    // Timeline.
    const note = typeof body.note === "string" ? body.note.slice(0, 1000) : null;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ProspectionActivity"
         ("id","clientId","ownerSlp","kind","fromStage","toStage","note","createdBy")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      randomUUID(), id, slp, stage ? "STAGE" : "NOTE", fromStage, stage, note, email,
    );

    return NextResponse.json({ ok: true, fromStage, toStage: stage ?? fromStage });
  } catch (e) {
    console.error("[PATCH /api/prospection/[id]]", e);
    return NextResponse.json({ error: "Erreur serveur (migration prospection appliquée ?)" }, { status: 500 });
  }
}
