import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope, requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";

/**
 * GET /api/archive/[id]/chain — dossier lié d'un document : BL → Facture → Avoir.
 *
 * Les liens vivent dans SAP (DocumentLines.BaseType/BaseEntry), pas dans le miroir :
 *   - ligne de FACTURE BaseType=17 → BaseEntry = DocEntry de la COMMANDE (BL)
 *   - ligne d'AVOIR   BaseType=13 → BaseEntry = DocEntry de la FACTURE
 * On résout à la volée (best-effort : si SAP indispo → chain:null), puis on relie
 * chaque maillon à son PDF archivé (ArchivedDocument) quand il existe.
 */
export const dynamic = "force-dynamic";

type Line = { BaseType?: number; BaseEntry?: number };
type Doc = { DocEntry: number; DocNum?: number | null; DocumentLines?: Line[] };

async function archived(docType: string, docEntry: number | null) {
  if (docEntry == null) return null;
  const d = await prisma.archivedDocument.findFirst({
    where: { docType, docEntry },
    orderBy: { receivedAt: "desc" },
    select: { id: true, docNum: true, fileName: true, lastSentAt: true },
  }).catch(() => null);
  return d;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const doc = await prisma.archivedDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  const allowed = (await requireAdmin(session)) || (doc.clientId ? await clientInScope(await getAccessScope(session), doc.clientId) : false);
  if (!allowed) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  if (!doc.cardCode || doc.docEntry == null) {
    return NextResponse.json({ ok: true, chain: null, reason: "document non résolu à SAP" });
  }

  try {
    const cc = doc.cardCode.replace(/'/g, "''");
    const [invoices, creditNotes] = await Promise.all([
      sap.getAll<Doc>(`Invoices?$select=DocEntry,DocNum,DocumentLines&$filter=${encodeURIComponent(`CardCode eq '${cc}'`)}`, { maxPages: 6 }),
      sap.getAll<Doc>(`CreditNotes?$select=DocEntry,DocNum,DocumentLines&$filter=${encodeURIComponent(`CardCode eq '${cc}'`)}`, { maxPages: 6 }),
    ]);
    const invByEntry = new Map(invoices.map((f) => [f.DocEntry, f]));
    const invByOrder = new Map<number, Doc>();
    for (const f of invoices) for (const l of f.DocumentLines ?? []) if (l.BaseType === 17 && l.BaseEntry != null && !invByOrder.has(l.BaseEntry)) invByOrder.set(l.BaseEntry, f);

    let invoiceEntry: number | null = null;
    let orderEntry: number | null = null;
    if (doc.docType === "FACTURE") invoiceEntry = doc.docEntry;
    else if (doc.docType === "BL") { orderEntry = doc.docEntry; invoiceEntry = invByOrder.get(doc.docEntry)?.DocEntry ?? null; }
    else if (doc.docType === "AVOIR") {
      const cn = creditNotes.find((c) => c.DocEntry === doc.docEntry);
      for (const l of cn?.DocumentLines ?? []) if (l.BaseType === 13 && l.BaseEntry != null) { invoiceEntry = l.BaseEntry; break; }
    }
    // Commande (BL) depuis la facture centrale.
    if (invoiceEntry != null && orderEntry == null) {
      for (const l of invByEntry.get(invoiceEntry)?.DocumentLines ?? []) if (l.BaseType === 17 && l.BaseEntry != null) { orderEntry = l.BaseEntry; break; }
    }
    // Avoirs rattachés à la facture centrale.
    const avoirDocs: Doc[] = [];
    if (invoiceEntry != null) for (const c of creditNotes) for (const l of c.DocumentLines ?? []) if (l.BaseType === 13 && l.BaseEntry === invoiceEntry) { avoirDocs.push(c); break; }

    // Numéros de document.
    const invoiceDocNum = invoiceEntry != null ? invByEntry.get(invoiceEntry)?.DocNum ?? null : null;
    const orderDocNum = orderEntry != null
      ? (await prisma.sapOrder.findUnique({ where: { docEntry: orderEntry }, select: { docNum: true } }).catch(() => null))?.docNum ?? null
      : null;

    const [blArch, factArch, avoirArch] = await Promise.all([
      archived("BL", orderEntry),
      archived("FACTURE", invoiceEntry),
      Promise.all(avoirDocs.map((a) => archived("AVOIR", a.DocEntry))),
    ]);

    const chain = {
      bl: orderEntry != null ? { docEntry: orderEntry, docNum: orderDocNum ?? blArch?.docNum ?? null, archived: blArch } : null,
      facture: invoiceEntry != null ? { docEntry: invoiceEntry, docNum: invoiceDocNum ?? factArch?.docNum ?? null, archived: factArch } : null,
      avoirs: avoirDocs.map((a, i) => ({ docEntry: a.DocEntry, docNum: a.DocNum ?? avoirArch[i]?.docNum ?? null, archived: avoirArch[i] })),
    };
    return NextResponse.json({ ok: true, chain, current: doc.docType });
  } catch (e) {
    return NextResponse.json({ ok: true, chain: null, reason: e instanceof Error ? e.message : "SAP indisponible" });
  }
}
