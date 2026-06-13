import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientSchema } from "@/lib/validations";
import { sap } from "@/lib/sapb1";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

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

    const client = await prisma.client.update({
      where: { id: params.id },
      data: {
        code: data.code,
        nom: data.nom,
        type: data.type || null,
        commercial: data.commercial || null,
        tel1: data.tel1 || null,
        tel2: data.tel2 || null,
        tel3: data.tel3 || null,
        email: nextEmail,
        notes: data.notes || null,
        joursAppel: data.joursAppel?.length ? data.joursAppel.join(",") : null,
      },
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
