import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope, requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { clientSchema } from "@/lib/validations";
import { sap } from "@/lib/sapb1";
import { standardizePhone } from "@/lib/phone";
import { writeAudit } from "@/lib/audit";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  try {
    const client = await prisma.client.findUnique({
      where: { id: params.id },
      include: {
        rappels: { orderBy: { dateRappel: "desc" } },
        appels: { orderBy: { heureAppel: "desc" }, take: 50 },
      },
    });
    if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
    return NextResponse.json(client);
  } catch (error) {
    console.error("[GET /api/clients/[id]]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const scope = await getAccessScope(session);
  if (!(await clientInScope(scope, params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  try {
    const body = await req.json();
    // Standardisation des téléphones AVANT validation (la saisie est souvent
    // sale : points, espaces, surplus « / 65 »…). On nettoie → 10 chiffres.
    for (const k of ["tel1", "tel2", "tel3"] as const) {
      if (typeof body?.[k] === "string" && body[k].trim()) body[k] = standardizePhone(body[k]);
    }
    const data = clientSchema.parse(body);

    const existing = await prisma.client.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

    if (data.code !== existing.code) {
      const conflict = await prisma.client.findUnique({ where: { code: data.code } });
      if (conflict) {
        return NextResponse.json({ error: "Un client avec ce code existe déjà" }, { status: 409 });
      }
    }

    const nextEmail = data.email?.trim().toLowerCase() || null;
    const emailChanged = nextEmail !== existing.email;
    const nameChanged = data.nom.trim() !== (existing.nom ?? "").trim();

    const updateData: Record<string, unknown> = {
      code: data.code,
      nom: data.nom,
      type: data.type || null,
      tel1: data.tel1 || null,
      tel2: data.tel2 || null,
      tel3: data.tel3 || null,
      email: nextEmail,
      notes: data.notes || null,
      joursAppel: data.joursAppel?.length ? data.joursAppel.join(",") : null,
    };
    // Les jours de LIVRAISON sont gérés à part (onglet Logistique, route
    // dédiée /delivery-days). Le formulaire « Informations » ne les envoie plus
    // → on ne les touche QUE s'ils sont explicitement fournis (sinon préservés).
    // Tableau vide fourni = "" (client explicitement non livré).
    if (data.joursLivraison !== undefined) {
      updateData.joursLivraison = data.joursLivraison.length ? data.joursLivraison.join(",") : "";
    }
    // Sécurité : un non-admin ne peut pas se (ré)attribuer un client → on ignore
    // les champs d'affectation `commercial`/`vendeur` du payload. Admin inchangé.
    // (`vendeur` n'est pas dans le schéma validé ni dans le data d'update → déjà
    //  ignoré de fait ; on garde `commercial` admin-only.)
    if (scope.all) {
      updateData.commercial = data.commercial || null;
    }

    const client = await prisma.client.update({
      where: { id: params.id },
      data: updateData,
    });

    // Bidir SAP : push email + nom (CardName) sur le BusinessPartner si modifiés.
    // Best-effort — si SAP est down, le cache DB reste correct, on log juste.
    const sapPatch: Record<string, unknown> = {};
    if (emailChanged) sapPatch.EmailAddress = nextEmail ?? "";
    if (nameChanged) sapPatch.CardName = data.nom.trim();
    if (Object.keys(sapPatch).length > 0) {
      try {
        await sap.patch(`BusinessPartners('${data.code.replace(/'/g, "''")}')`, sapPatch);
      } catch (e) {
        console.warn(`[PUT /api/clients/${params.id}] PATCH SAP (email/nom) failed:`, e);
      }
    }

    return NextResponse.json(client);
  } catch (error) {
    console.error("[PUT /api/clients/[id]]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const scope = await getAccessScope(session);
  if (!(await clientInScope(scope, params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });
  // #19 — La SUPPRESSION d'une fiche client est une action destructive : réservée
  // aux admins / direction (un commercial ne supprime jamais un client, même le
  // sien). Le contrôle de périmètre ci-dessus est conservé en plus.
  if (!(await requireAdmin(session)))
    return NextResponse.json({ error: "Réservé à l'administration / direction" }, { status: 403 });
  // TODO (#19) : passer en soft-delete (archivage) plutôt qu'un hard-delete dès
  // qu'un champ d'archivage existera au schéma (ex. Client.archivedAt). Tant que
  // le schéma n'a pas ce champ, on conserve la suppression définitive, gatée admin.

  try {
    const existing = await prisma.client.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
    await prisma.client.delete({ where: { id: params.id } });
    await writeAudit({
      session,
      action: "CLIENT_DELETE",
      entity: "Client",
      entityId: params.id,
      summary: `Suppression du client ${existing.code ?? params.id}`,
      details: { code: existing.code, nom: existing.nom },
    });
    return NextResponse.json({ message: "Client supprimé" });
  } catch (error) {
    console.error("[DELETE /api/clients/[id]]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
