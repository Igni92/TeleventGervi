import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/clients/bulk
 *   Body: { clientIds: string[], action: "assignCommercial" | "setType" | "delete", value?: string | null }
 *
 * Bulk operations on multiple clients at once. All actions affect EVERY
 * clientId passed and are atomic (one updateMany / deleteMany call).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // Opérations de masse (réassignation, changement de type, SUPPRESSION) → admins uniquement.
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  try {
    const body = await req.json();
    const { clientIds, action, value } = body as {
      clientIds: string[];
      action: "assignCommercial" | "setType" | "delete";
      value?: string | null;
    };

    if (!Array.isArray(clientIds) || clientIds.length === 0) {
      return NextResponse.json({ error: "clientIds requis" }, { status: 400 });
    }

    if (action === "assignCommercial") {
      // value = commercial name (string) or null/empty to unassign
      const commercial = value ? String(value).trim() : null;
      const result = await prisma.client.updateMany({
        where: { id: { in: clientIds } },
        data: { commercial: commercial || null },
      });
      return NextResponse.json({ affected: result.count, commercial });
    }

    if (action === "setType") {
      const type = value ? String(value).trim() : null;
      if (type && !["EXPORT", "GMS", "CHR"].includes(type)) {
        return NextResponse.json({ error: "Type invalide" }, { status: 400 });
      }
      const result = await prisma.client.updateMany({
        where: { id: { in: clientIds } },
        data: { type: type || null },
      });
      return NextResponse.json({ affected: result.count, type });
    }

    if (action === "delete") {
      const result = await prisma.client.deleteMany({
        where: { id: { in: clientIds } },
      });
      return NextResponse.json({ affected: result.count });
    }

    return NextResponse.json({ error: "Action inconnue" }, { status: 400 });
  } catch (error) {
    console.error("[POST /api/clients/bulk]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
