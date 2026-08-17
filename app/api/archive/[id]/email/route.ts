import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope, requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getArchiveSettings, getRelanceEmailSettings } from "@/lib/integrationSettings";
import { resolveRecipient, splitEmails } from "@/lib/relance/delivery";
import { readPdf } from "@/lib/archive/storage";
import { sendMailAsShared } from "@/lib/graph";
import { docTypeLabel, renderTemplate } from "@/lib/archive/format";

/**
 * Envoi d'un document archivé au client.
 *   GET  → prépare (destinataire résolu + objet/message pré-remplis + mode test).
 *   POST → envoie (objet/message/destinataire éventuellement modifiés).
 *
 * Garde-fou TEST/LIVE des relances réutilisé : tant que le mode réel n'est pas
 * activé, tout part vers la boîte de test. Destinataire réel = emailCompta (repli
 * réception puis commercial).
 */
export const dynamic = "force-dynamic";
const MAX_SEND_BYTES = 3.5 * 1024 * 1024; // limite pièce jointe inline Graph

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "");

async function loadDoc(id: string) {
  const doc = await prisma.archivedDocument.findUnique({ where: { id } });
  if (!doc) return { error: "Document introuvable", status: 404 as const };
  const client = doc.clientId
    ? await prisma.client.findUnique({ where: { id: doc.clientId }, select: { id: true, nom: true, emailCompta: true, emailReception: true, email: true } })
    : null;
  return { doc, client };
}

/** email client effectif (compta > réception > commercial). */
function clientEmail(c: { emailCompta: string | null; emailReception: string | null; email: string | null } | null): string | null {
  return (c?.emailCompta?.trim() || c?.emailReception?.trim() || c?.email?.trim() || null);
}

async function authorize(session: Parameters<typeof requireAdmin>[0], clientId: string | null) {
  const isAdmin = await requireAdmin(session);
  if (isAdmin) return true;
  return clientId ? clientInScope(await getAccessScope(session), clientId) : false;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const r = await loadDoc(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { doc, client } = r;
  if (!(await authorize(session, doc.clientId))) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const [archive, email] = await Promise.all([getArchiveSettings(), getRelanceEmailSettings()]);
  const rcpt = resolveRecipient(clientEmail(client), { live: email.live, testRecipient: email.testRecipient });
  const vars = {
    type: docTypeLabel(doc.docType),
    num: doc.docNum ?? "",
    date: fmtDate(doc.docDate),
    client: client?.nom ?? "",
  };
  return NextResponse.json({
    ok: true,
    docType: doc.docType,
    docNum: doc.docNum,
    fileName: doc.fileName,
    clientNom: client?.nom ?? null,
    to: rcpt.to,
    intendedTo: rcpt.intendedTo,
    testMode: rcpt.testMode,
    subject: renderTemplate(archive.subjectTemplate, vars),
    body: renderTemplate(archive.bodyTemplate, vars),
    lastSentAt: doc.lastSentAt,
  });
}

const PostSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(8000),
  /** Destinataire(s) éventuellement modifié(s) — ignoré en mode test. */
  to: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const r = await loadDoc(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { doc, client } = r;
  if (!(await authorize(session, doc.clientId))) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const parsed = PostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  const { subject, body } = parsed.data;

  const email = await getRelanceEmailSettings();
  const base = resolveRecipient(clientEmail(client), { live: email.live, testRecipient: email.testRecipient });
  // En mode réel, on autorise un destinataire édité dans la fenêtre ; en test, on
  // force la boîte de test (le garde-fou ne doit jamais être contournable).
  const toList = !base.testMode && parsed.data.to ? splitEmails(parsed.data.to) : base.toList;
  if (toList.length === 0) return NextResponse.json({ error: "Aucun destinataire." }, { status: 400 });

  // Pièce jointe.
  let buf: Buffer;
  try {
    buf = await readPdf(doc.filePath);
  } catch {
    return NextResponse.json({ error: "PDF introuvable sur le disque." }, { status: 404 });
  }
  if (buf.length > MAX_SEND_BYTES) {
    return NextResponse.json({ error: "PDF trop volumineux pour l'envoi direct (> 3,5 Mo)." }, { status: 400 });
  }

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111;white-space:pre-wrap">${esc(body)}</div>`;
  try {
    await sendMailAsShared(email.from, {
      to: toList,
      subject,
      html,
      replyTo: email.from,
      attachments: [{ name: doc.fileName, base64: buf.toString("base64"), contentType: "application/pdf" }],
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Échec de l'envoi" }, { status: 502 });
  }

  await prisma.archivedDocument.update({
    where: { id: doc.id },
    data: { lastSentAt: new Date(), lastSentTo: toList.join(", ") },
  }).catch(() => {});

  return NextResponse.json({ ok: true, to: toList.join(", "), testMode: base.testMode });
}
