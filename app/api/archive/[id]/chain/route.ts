import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope, requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";

/**
 * GET /api/archive/[id]/chain — dossier lié : BL → Facture → Avoir.
 *
 * RAPIDE : le lien est pré-calculé en base (invoiceEntry = facture centrale, cf.
 * lib/archive/dossier). Le dossier est alors un simple lookup LOCAL. Si le pivot
 * n'est pas encore connu (nouveau doc pas encore backfillé), on le résout à la
 * volée via SAP — borné par un timeout pour ne JAMAIS tourner en boucle.
 */
export const dynamic = "force-dynamic";

type Line = { BaseType?: number; BaseEntry?: number };
type Doc = { DocEntry: number; DocumentLines?: Line[] };

/** Résout le pivot (facture centrale) d'un doc via SAP — borné 9 s. */
async function resolveHubLive(docType: string, docEntry: number, cardCode: string): Promise<number | null> {
  const timeout = new Promise<number | null>((res) => setTimeout(() => res(null), 9000));
  const work = (async (): Promise<number | null> => {
    if (docType === "FACTURE") return docEntry;
    const esc = cardCode.replace(/'/g, "''");
    if (docType === "BL") {
      const invoices = await sap.getAll<Doc>(`Invoices?$select=DocEntry,DocumentLines&$filter=${encodeURIComponent(`CardCode eq '${esc}'`)}`, { maxPages: 8 });
      for (const f of invoices) for (const l of f.DocumentLines ?? []) if (l.BaseType === 17 && l.BaseEntry === docEntry) return f.DocEntry;
      return null;
    }
    if (docType === "AVOIR") {
      const cn = await sap.get<Doc>(`CreditNotes(${docEntry})?$select=DocEntry,DocumentLines`);
      for (const l of cn.DocumentLines ?? []) if (l.BaseType === 13 && l.BaseEntry != null) return l.BaseEntry;
      return null;
    }
    return null;
  })().catch(() => null);
  return Promise.race([work, timeout]);
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const doc = await prisma.archivedDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  const allowed = (await requireAdmin(session)) || (doc.clientId ? await clientInScope(await getAccessScope(session), doc.clientId) : false);
  if (!allowed) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  // Pivot du dossier : local si connu, sinon résolu à la volée (borné) et mémorisé.
  let hub = doc.invoiceEntry ?? null;
  if (hub == null && doc.docEntry != null && doc.cardCode) {
    hub = await resolveHubLive(doc.docType, doc.docEntry, doc.cardCode);
    if (hub != null) await prisma.archivedDocument.update({ where: { id: doc.id }, data: { invoiceEntry: hub } }).catch(() => {});
  }
  if (hub == null) return NextResponse.json({ ok: true, chain: null, reason: "dossier non résolu" });

  // Lookup LOCAL de tout le dossier (instantané).
  const rows = await prisma.archivedDocument.findMany({
    where: { invoiceEntry: hub },
    orderBy: { receivedAt: "desc" },
    select: { id: true, docType: true, docNum: true, docEntry: true, fileName: true, lastSentAt: true },
  });
  const node = (r: (typeof rows)[number]) => ({
    docEntry: r.docEntry ?? 0,
    docNum: r.docNum,
    archived: { id: r.id, fileName: r.fileName, lastSentAt: r.lastSentAt },
  });
  const bl = rows.find((r) => r.docType === "BL");
  const facture = rows.find((r) => r.docType === "FACTURE");
  const avoirs = rows.filter((r) => r.docType === "AVOIR");

  return NextResponse.json({
    ok: true,
    current: doc.docType,
    chain: {
      bl: bl ? node(bl) : null,
      facture: facture ? node(facture) : null,
      avoirs: avoirs.map(node),
    },
  });
}
