import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { requireAdmin, isLivreur } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/clients/[id]/logistics-sap
 *
 * Champs logistiques SAP du magasin (BusinessPartner) : coordonnées GPS +
 * créneaux de réception + temps de chargement. Réservé aux LIVREURS, à la
 * DIRECTION et aux ADMINS (les commerciaux n'y ont pas accès).
 *   U_GPS_LAT / U_GPS_LON               → coordonnées du point de livraison
 *   U_RECEP_DEB1 / U_RECEP_FIN1         → 1er créneau de réception (ouverture/fermeture)
 *   U_RECEP_DEB2 / U_RECEP_FIN2         → 2ᵉ créneau éventuel
 *   U_TPS_CHARG                         → temps de chargement estimé
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const allowed = (await requireAdmin(session)) || (await isLivreur(session));
  if (!allowed) return NextResponse.json({ error: "Accès réservé (livreur / direction / admin)" }, { status: 403 });

  const client = await prisma.client.findUnique({ where: { id }, select: { code: true } });
  if (!client?.code) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  type Bp = {
    U_GPS_LAT?: string | number | null; U_GPS_LON?: string | number | null;
    U_RECEP_DEB1?: string | number | null; U_RECEP_FIN1?: string | number | null;
    U_RECEP_DEB2?: string | number | null; U_RECEP_FIN2?: string | number | null;
    U_TPS_CHARG?: string | number | null;
  };
  try {
    const bp = await sap.get<Bp>(
      `BusinessPartners('${client.code.replace(/'/g, "''")}')` +
      `?$select=U_GPS_LAT,U_GPS_LON,U_RECEP_DEB1,U_RECEP_FIN1,U_RECEP_DEB2,U_RECEP_FIN2,U_TPS_CHARG`,
    );
    return NextResponse.json({
      ok: true,
      code: client.code,
      logistics: {
        gpsLat: bp.U_GPS_LAT ?? null,
        gpsLon: bp.U_GPS_LON ?? null,
        recepDeb1: bp.U_RECEP_DEB1 ?? null,
        recepFin1: bp.U_RECEP_FIN1 ?? null,
        recepDeb2: bp.U_RECEP_DEB2 ?? null,
        recepFin2: bp.U_RECEP_FIN2 ?? null,
        tpsCharg: bp.U_TPS_CHARG ?? null,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
