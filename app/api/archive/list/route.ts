import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientIdsInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * GET /api/archive/list — état documentaire : liste filtrable/paginée de tous les
 * PDF archivés. Filtres : q (n°, nom de fichier, objet, client), type (BL/FACTURE/
 * AVOIR), matched. Périmètre : admin = tout ; sinon uniquement les clients du
 * périmètre de l'opérateur.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || "";
  const type = searchParams.get("type")?.trim().toUpperCase();
  const onlyMatched = searchParams.get("matched") === "1";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "40", 10) || 40));

  const ids = await clientIdsInScope(await getAccessScope(session)); // null = admin (tout)

  const where: Prisma.ArchivedDocumentWhereInput = {};
  if (ids) where.clientId = { in: ids };
  if (type && ["BL", "FACTURE", "AVOIR", "AUTRE"].includes(type)) where.docType = type;
  if (onlyMatched) where.matched = true;
  if (q) {
    where.OR = [
      { docNum: { contains: q, mode: "insensitive" } },
      { fileName: { contains: q, mode: "insensitive" } },
      { mailSubject: { contains: q, mode: "insensitive" } },
      { cardCode: { contains: q, mode: "insensitive" } },
      { client: { nom: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.archivedDocument.count({ where }),
    prisma.archivedDocument.findMany({
      where,
      orderBy: [{ docDate: "desc" }, { receivedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: { client: { select: { nom: true, code: true } } },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    total,
    page,
    limit,
    docs: rows.map((d) => ({
      id: d.id,
      docType: d.docType,
      docNum: d.docNum,
      docEntry: d.docEntry,
      fileName: d.fileName,
      clientId: d.clientId,
      clientNom: d.client?.nom ?? null,
      cardCode: d.cardCode,
      docDate: d.docDate,
      receivedAt: d.receivedAt,
      lastSentAt: d.lastSentAt,
      lastSentTo: d.lastSentTo,
      matched: d.matched,
      sizeBytes: d.sizeBytes,
    })),
  });
}
