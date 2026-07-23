import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope, getOwnSlpName } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { notifyAll } from "@/lib/push";

/**
 * « Client à créer dans SAP » — un prospect veut passer sa 1re commande. Comme
 * dans SAP tout est un PARTENAIRE (clients + anciens clients), un nouveau prospect
 * n'y existe pas encore : il faut le CRÉER avant de faire un BL. Cette route envoie
 * une NOTIFICATION PUSH pour le rappeler, et journalise la demande (timeline).
 *
 * POST /api/prospection/[id]/request-creation  → { ok, notified }
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), id))) {
    return NextResponse.json({ error: "Accès refusé à ce prospect." }, { status: 403 });
  }

  try {
    const rows = await prisma.$queryRawUnsafe<
      { nom: string; city: string | null; zipCode: string | null; tel1: string | null; code: string; prospectOwner: string | null }[]
    >(
      `SELECT "nom","city","zipCode","tel1","code","prospectOwner" FROM "Client" WHERE "id" = $1 LIMIT 1`,
      id,
    );
    if (!rows.length) return NextResponse.json({ error: "Prospect introuvable." }, { status: 404 });
    const p = rows[0];

    const email = session.user.email ?? null;
    const slp = await getOwnSlpName(session);
    const lieu = [p.city, p.zipCode].filter(Boolean).join(" ");
    const tel = p.tel1 ? ` · ${p.tel1}` : "";

    // Notification push (best-effort) à toute l'équipe abonnée.
    const notified = await notifyAll(
      {
        title: "🆕 Client à créer dans SAP",
        body: `${p.nom}${lieu ? " — " + lieu : ""}${tel} veut une 1ʳᵉ commande. Créer le partenaire SAP avant le BL.`,
        url: "/prospection",
        tag: `create-client-${p.code}`,
        renotify: true,
      },
      { exceptEmail: email },
    );

    // Timeline.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ProspectionActivity"("id","clientId","ownerSlp","kind","fromStage","toStage","note","createdBy")
       VALUES ($1,$2,$3,'NOTE',NULL,NULL,$4,$5)`,
      randomUUID(), id, slp, "Demande de création du client dans SAP (1ʳᵉ commande).", email,
    );

    return NextResponse.json({ ok: true, notified });
  } catch (e) {
    console.error("request-creation failed", e);
    return NextResponse.json({ error: "Échec de la demande de création." }, { status: 500 });
  }
}
