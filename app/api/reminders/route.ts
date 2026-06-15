import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope, clientIdsInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { rappelSchema } from "@/lib/validations";
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/graph";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("clientId");

    // Droits : un non-admin ne voit que les rappels de SES clients.
    const ids = await clientIdsInScope(await getAccessScope(session));
    const where: { clientId?: string | { in: string[] } } = {};
    if (clientId) where.clientId = clientId;
    if (ids) {
      if (clientId) { if (!ids.includes(clientId)) return NextResponse.json([]); }
      else where.clientId = { in: ids };
    }

    const rappels = await prisma.rappel.findMany({
      where,
      include: { client: { select: { nom: true, code: true } } },
      orderBy: { dateRappel: "desc" },
    });

    return NextResponse.json(rappels);
  } catch (error) {
    console.error("[GET /api/reminders]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const data = rappelSchema.parse(body);

    if (!(await clientInScope(await getAccessScope(session), data.clientId)))
      return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

    // Fetch client info for event creation
    const client = await prisma.client.findUnique({
      where: { id: data.clientId },
    });

    if (!client) {
      return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
    }

    const dateRappel = new Date(data.dateRappel);

    let msEventId: string | null = null;

    // Try to create Microsoft Calendar event if we have an access token
    if (session.accessToken) {
      try {
        const event = await createCalendarEvent(
          session.accessToken,
          client,
          dateRappel,
          data.note
        );
        msEventId = event.id;
      } catch (graphError) {
        console.error("Graph API error (non-blocking):", graphError);
        // Don't fail the request if Graph API fails
      }
    }

    const rappel = await prisma.rappel.create({
      data: {
        clientId: data.clientId,
        dateRappel,
        note: data.note || null,
        msEventId,
        statut: "PLANIFIE",
      },
      include: {
        client: { select: { nom: true, code: true } },
      },
    });

    return NextResponse.json(rappel, { status: 201 });
  } catch (error: unknown) {
    console.error("[POST /api/reminders]", error);
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Données invalides" }, { status: 400 });
    }
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, statut } = body;

    if (!id || !statut) {
      return NextResponse.json({ error: "id et statut sont requis" }, { status: 400 });
    }

    if (!["PLANIFIE", "FAIT", "ANNULE"].includes(statut)) {
      return NextResponse.json({ error: "Statut invalide" }, { status: 400 });
    }

    const existing = await prisma.rappel.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Rappel introuvable" }, { status: 404 });
    }
    if (!(await clientInScope(await getAccessScope(session), existing.clientId)))
      return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

    // Delete Microsoft Calendar event if cancelling and event exists
    if (statut === "ANNULE" && existing.msEventId && session.accessToken) {
      try {
        await deleteCalendarEvent(session.accessToken, existing.msEventId);
      } catch (graphError) {
        console.error("Graph API delete error (non-blocking):", graphError);
      }
    }

    const rappel = await prisma.rappel.update({
      where: { id },
      data: { statut },
    });

    return NextResponse.json(rappel);
  } catch (error) {
    console.error("[PATCH /api/reminders]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
