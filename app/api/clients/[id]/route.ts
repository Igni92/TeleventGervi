import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { clientSchema } from "@/lib/validations";
import { sap } from "@/lib/sapb1";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
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

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const scope = await getAccessScope(session);
  if (!(await clientInScope(scope, params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  try {
    const body = await req.json();
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

    // Bidir SAP : push l'email sur le BusinessPartner si modifié. Best-effort —
    // si SAP est down, le cache DB reste correct, on log juste l'erreur.
    if (emailChanged) {
      try {
        await sap.patch(`BusinessPartners('${data.code.replace(/'/g, "''")}')`, {
          EmailAddress: nextEmail ?? "",
        });
      } catch (e) {
        console.warn(`[PUT /api/clients/${params.id}] PATCH SAP email failed:`, e);
      }
    }

    return NextResponse.json(client);
  } catch (error) {
    console.error("[PUT /api/clients/[id]]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  try {
    const existing = await prisma.client.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
    await prisma.client.delete({ where: { id: params.id } });
    return NextResponse.json({ message: "Client supprimé" });
  } catch (error) {
    console.error("[DELETE /api/clients/[id]]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
