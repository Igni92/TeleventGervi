import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { appelLogSchema } from "@/lib/validations";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("clientId");
    const where = clientId ? { clientId } : {};

    const appels = await prisma.appelLog.findMany({
      where,
      include: { client: { select: { nom: true, code: true } } },
      orderBy: { heureAppel: "desc" },
      take: 100,
    });

    return NextResponse.json(appels);
  } catch (error) {
    console.error("[GET /api/appels]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  try {
    const body = await req.json();
    const data = appelLogSchema.parse(body);

    const client = await prisma.client.findUnique({ where: { id: data.clientId } });
    if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

    const appel = await prisma.appelLog.create({
      data: {
        clientId: data.clientId,
        type: data.type,
        note: data.note || null,
        heureAppel: new Date(),
        scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : null,
      },
      include: { client: { select: { nom: true, code: true } } },
    });

    return NextResponse.json(appel, { status: 201 });
  } catch (error) {
    console.error("[POST /api/appels]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
