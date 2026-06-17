import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/rgpd/export?clientId=<cuid>   (ou ?cardCode=APLAI)
 *
 * Export RGPD — droit d'accès / portabilité (art. 15 & 20).
 * Rassemble en JSON, pour UN SEUL client, les données personnelles **déjà
 * stockées localement** dans TeleVent : fiche client (coordonnées, compta,
 * activation), contacts (interlocuteurs), historique d'appels CRM, rappels et
 * incidents.
 *
 * Garde-fous (cf. docs/rgpd-conformite.md) :
 *   - **Réservé aux admins** (`requireAdmin`). 401 si pas de session, 403 sinon.
 *   - **Lecture seule** : aucune écriture, aucun appel SAP live, aucun DELETE.
 *   - Ne renvoie que ce qui est en base (pas d'interrogation de la source ERP).
 *   - Requêtes **paramétrées** (Prisma typé) — aucune concaténation SQL.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // Un export RGPD agrège les données personnelles d'un client donné, hors du
  // périmètre habituel d'un commercial → réservé aux administrateurs.
  if (!(await requireAdmin(session))) {
    return NextResponse.json(
      { error: "Réservé aux administrateurs.", restricted: true },
      { status: 403 },
    );
  }

  const cardCode = req.nextUrl.searchParams.get("cardCode")?.trim();
  const clientId = req.nextUrl.searchParams.get("clientId")?.trim();
  if (!cardCode && !clientId) {
    return NextResponse.json(
      { error: "Paramètre requis : clientId ou cardCode." },
      { status: 400 },
    );
  }

  try {
    // Fiche client + relations personnelles (Prisma typé → requête paramétrée).
    const client = await prisma.client.findFirst({
      where: clientId ? { id: clientId } : { code: cardCode },
      include: {
        contacts: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
        appels: { orderBy: { heureAppel: "desc" } },
        rappels: { orderBy: { dateRappel: "desc" } },
        incidents: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!client) {
      return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
    }

    const exportePar = session.user.email ?? null;
    const exporteLe = new Date().toISOString();

    const payload = {
      ok: true,
      meta: {
        objet: "Export RGPD — données personnelles détenues pour ce client",
        base: "TeleVent (données locales uniquement, hors SAP live)",
        exportePar,
        exporteLe,
        cardCode: client.code,
        clientId: client.id,
      },
      client: {
        id: client.id,
        code: client.code,
        nom: client.nom,
        type: client.type,
        commercial: client.commercial,
        vendeur: client.vendeur,
        activeTelevente: client.activeTelevente,
        telephones: [client.tel1, client.tel2, client.tel3].filter(Boolean),
        email: client.email,
        emailCompta: client.emailCompta,
        emailReception: client.emailReception,
        adresseFacturation: client.adresseFacturation,
        notes: client.notes,
        joursAppel: client.joursAppel,
        createdAt: client.createdAt,
        updatedAt: client.updatedAt,
      },
      contacts: client.contacts.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        phone: c.phone,
        email: c.email,
        note: c.note,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      historiqueAppels: client.appels.map((a) => ({
        id: a.id,
        type: a.type,
        note: a.note,
        heureAppel: a.heureAppel,
        scheduledFor: a.scheduledFor,
        createdAt: a.createdAt,
      })),
      rappels: client.rappels.map((r) => ({
        id: r.id,
        dateRappel: r.dateRappel,
        note: r.note,
        statut: r.statut,
        createdAt: r.createdAt,
      })),
      incidents: client.incidents.map((i) => ({
        id: i.id,
        type: i.type,
        note: i.note,
        docNum: i.docNum,
        resolved: i.resolved,
        createdBy: i.createdBy,
        createdAt: i.createdAt,
      })),
    };

    // Traçabilité a minima de l'export (cf. §6.5 doc RGPD).
    console.info(
      `[RGPD export] client=${client.code} par=${exportePar} le=${exporteLe}`,
    );

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[GET /api/rgpd/export]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
