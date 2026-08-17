import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope, requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readPdf } from "@/lib/archive/storage";

/**
 * GET /api/archive/[id]/pdf — sert le PDF archivé (inline) pour visualisation.
 * Accès : admin, ou client rattaché dans le périmètre de l'opérateur.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const doc = await prisma.archivedDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });

  const isAdmin = await requireAdmin(session);
  const allowed = isAdmin || (doc.clientId ? await clientInScope(await getAccessScope(session), doc.clientId) : false);
  if (!allowed) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  let buf: Buffer;
  try {
    buf = await readPdf(doc.filePath);
  } catch {
    return NextResponse.json({ error: "Fichier introuvable sur le disque" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${encodeURIComponent(doc.fileName)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
