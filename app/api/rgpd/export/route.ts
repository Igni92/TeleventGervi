import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessScope } from "@/lib/permissions";

/**
 * GET /api/rgpd/export?cardCode=APLAI   (ou ?clientId=<cuid>)
 *
 * Export RGPD — droit d'accès / portabilité (art. 15 & 20).
 * Rassemble en JSON, pour UN SEUL client, les données personnelles **déjà
 * stockées localement** dans TeleVent : fiche client, coordonnées, compta,
 * contacts (interlocuteurs), historique d'appels CRM, rappels, et le cache
 * mirror SAP (SapBusinessPartner) s'il existe.
 *
 * Garde‑fous (cf. docs/rgpd-conformite.md) :
 *   - **Réservé aux admins** (scope.all === true). 403 sinon.
 *   - **Lecture seule** : aucune écriture, aucun appel SAP live, aucun DELETE.
 *   - Ne renvoie que ce qui est en base (pas d'interrogation de la source ERP).
 *
 * Plusieurs champs (emailCompta/emailReception/adresseFacturation, vendeur,
 * activeTelevente) ne sont pas dans le client Prisma typé tant que `generate`
 * est bloqué → lus en raw SQL, comme ailleurs dans l'app.
 */
export const dynamic = "force-dynamic";

type ClientExtraRow = {
  emailCompta: string | null;
  emailReception: string | null;
  adresseFacturation: string | null;
  vendeur: string | null;
  activeTelevente: boolean | null;
};

type SapBpRow = {
  cardCode: string;
  cardName: string | null;
  email: string | null;
  phone: string | null;
  slpName: string | null;
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // Réservé aux admins : un export RGPD agrège des données personnelles d'un
  // client donné, hors du périmètre habituel d'un commercial.
  const scope = await getAccessScope(session);
  if (!scope.all) {
    return NextResponse.json(
      { error: "Réservé aux administrateurs.", restricted: true },
      { status: 403 },
    );
  }

  const cardCode = req.nextUrl.searchParams.get("cardCode")?.trim();
  const clientId = req.nextUrl.searchParams.get("clientId")?.trim();
  if (!cardCode && !clientId) {
    return NextResponse.json(
      { error: "Paramètre requis : cardCode ou clientId." },
      { status: 400 },
    );
  }

  try {
    // Fiche client locale (cardCode = Client.code). Champs typés via Prisma.
    const client = await prisma.client.findFirst({
      where: clientId ? { id: clientId } : { code: cardCode },
      include: {
        contacts: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
        appels: { orderBy: { heureAppel: "desc" } },
        rappels: { orderBy: { dateRappel: "desc" } },
      },
    });

    if (!client) {
      return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
    }

    // Champs hors client Prisma typé → raw SQL (compta + activation).
    const extraRows = await prisma.$queryRaw<ClientExtraRow[]>(Prisma.sql`
      SELECT "emailCompta", "emailReception", "adresseFacturation",
             "vendeur", "activeTelevente"
      FROM "Client"
      WHERE "id" = ${client.id}
      LIMIT 1;
    `);
    const extra = extraRows[0] ?? null;

    // Cache mirror SAP (lecture seule). Best‑effort : la table peut être vide.
    let sapBp: SapBpRow | null = null;
    try {
      const sapRows = await prisma.$queryRaw<SapBpRow[]>(Prisma.sql`
        SELECT "cardCode", "cardName", "email", "phone", "slpName"
        FROM "SapBusinessPartner"
        WHERE "cardCode" = ${client.code}
        LIMIT 1;
      `);
      sapBp = sapRows[0] ?? null;
    } catch {
      sapBp = null;
    }

    const payload = {
      ok: true,
      meta: {
        objet: "Export RGPD — données personnelles détenues pour ce client",
        base: "TeleVent (données locales uniquement, hors SAP live)",
        exportePar: scope.email ?? session.user.email ?? null,
        exporteLe: new Date().toISOString(),
        cardCode: client.code,
        clientId: client.id,
      },
      client: {
        id: client.id,
        code: client.code,
        nom: client.nom,
        type: client.type,
        commercial: client.commercial,
        vendeur: extra?.vendeur ?? null,
        activeTelevente: extra?.activeTelevente ?? null,
        telephones: [client.tel1, client.tel2, client.tel3].filter(Boolean),
        email: client.email,
        emailCompta: extra?.emailCompta ?? null,
        emailReception: extra?.emailReception ?? null,
        adresseFacturation: extra?.adresseFacturation ?? null,
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
      sapMirror: sapBp,
    };

    // Traçabilité a minima de l'export (cf. §6.5 doc RGPD).
    console.info(
      `[RGPD export] client=${client.code} par=${payload.meta.exportePar} le=${payload.meta.exporteLe}`,
    );

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[GET /api/rgpd/export]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
