import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientIdsInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * GET /api/archive/folders — vue « dossiers » de l'état documentaire : un dossier
 * PAR CLIENT avec le décompte de documents par type. Filtre q (nom/code client).
 * Périmètre : admin = tout ; sinon uniquement les clients de l'opérateur.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  const ids = await clientIdsInScope(await getAccessScope(session));

  const where: Prisma.ArchivedDocumentWhereInput = {};
  if (ids) where.clientId = { in: ids };
  if (q) {
    where.OR = [
      { client: { nom: { contains: q, mode: "insensitive" } } },
      { cardCode: { contains: q, mode: "insensitive" } },
      { client: { code: { contains: q, mode: "insensitive" } } },
    ];
  }

  const groups = await prisma.archivedDocument.groupBy({
    by: ["clientId", "docType"],
    where,
    _count: { _all: true },
    _max: { receivedAt: true },
  });

  // Agrège par client (clientId null = « non rattachés »).
  type Folder = { clientId: string | null; clientNom: string | null; cardCode: string | null; total: number; byType: Record<string, number>; lastReceivedAt: string | null };
  const map = new Map<string, Folder>();
  for (const g of groups) {
    const key = g.clientId ?? "__none__";
    const f = map.get(key) ?? { clientId: g.clientId, clientNom: null, cardCode: null, total: 0, byType: {}, lastReceivedAt: null };
    const c = g._count._all;
    f.total += c;
    f.byType[g.docType] = (f.byType[g.docType] ?? 0) + c;
    const rx = g._max.receivedAt ? new Date(g._max.receivedAt).toISOString() : null;
    if (rx && (!f.lastReceivedAt || rx > f.lastReceivedAt)) f.lastReceivedAt = rx;
    map.set(key, f);
  }

  // Noms/codes clients.
  const clientIds = [...map.keys()].filter((k) => k !== "__none__");
  if (clientIds.length) {
    const clients = await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, nom: true, code: true } });
    for (const c of clients) {
      const f = map.get(c.id);
      if (f) { f.clientNom = c.nom; f.cardCode = c.code; }
    }
  }

  const folders = [...map.values()].sort((a, b) => {
    // « non rattachés » en dernier, sinon par nom client.
    if (a.clientId === null) return 1;
    if (b.clientId === null) return -1;
    return (a.clientNom ?? "").localeCompare(b.clientNom ?? "");
  });

  return NextResponse.json({ ok: true, folders, totalDocs: folders.reduce((s, f) => s + f.total, 0) });
}
