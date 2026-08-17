import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope, requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/archive/lookup
 *   ?docType=BL&docNum=123  → le PDF archivé le plus récent pour ce document (ou null)
 *   ?clientId=<id>          → tous les documents archivés d'un client
 *
 * Sert au composant DocumentActions (bouton PDF + envoi) placé aux points
 * d'accès document. Accès : admin ou client dans le périmètre.
 */
export const dynamic = "force-dynamic";

const pick = (d: {
  id: string; docType: string; docNum: string | null; fileName: string;
  matched: boolean; clientId: string | null; docDate: Date | null; lastSentAt: Date | null; receivedAt: Date;
}) => ({
  id: d.id, docType: d.docType, docNum: d.docNum, fileName: d.fileName,
  matched: d.matched, clientId: d.clientId, docDate: d.docDate, lastSentAt: d.lastSentAt, receivedAt: d.receivedAt,
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const docType = searchParams.get("docType")?.trim();
  const docNum = searchParams.get("docNum")?.trim();
  const docEntryRaw = searchParams.get("docEntry")?.trim();
  const docEntry = docEntryRaw && /^\d+$/.test(docEntryRaw) ? Number(docEntryRaw) : null;
  const clientId = searchParams.get("clientId")?.trim();

  const isAdmin = await requireAdmin(session);
  const scope = isAdmin ? null : await getAccessScope(session);

  // Liste par client.
  if (clientId) {
    if (!isAdmin && !(await clientInScope(scope!, clientId))) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }
    const docs = await prisma.archivedDocument.findMany({
      where: { clientId },
      orderBy: [{ docDate: "desc" }, { receivedAt: "desc" }],
      take: 200,
    });
    return NextResponse.json({ ok: true, docs: docs.map(pick) });
  }

  // Recherche ciblée par type + (docEntry SAP stable OU n° imprimé).
  if (docType && (docNum || docEntry != null)) {
    const ors: { docEntry?: number; docNum?: string }[] = [];
    if (docEntry != null) ors.push({ docEntry });
    if (docNum) ors.push({ docNum });
    const doc = await prisma.archivedDocument.findFirst({
      where: { docType, OR: ors },
      orderBy: { receivedAt: "desc" },
    });
    if (!doc) return NextResponse.json({ ok: true, doc: null });
    const allowed = isAdmin || (doc.clientId ? await clientInScope(scope!, doc.clientId) : false);
    if (!allowed) return NextResponse.json({ ok: true, doc: null }); // ne divulgue pas l'existence hors périmètre
    return NextResponse.json({ ok: true, doc: pick(doc) });
  }

  return NextResponse.json({ error: "Paramètres requis : (docType + docNum) ou clientId" }, { status: 400 });
}
