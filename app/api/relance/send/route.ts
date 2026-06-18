import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, cardCodeInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isRelanceCode } from "@/lib/relance/levels";
import { buildRelancePackage, RelanceInputError } from "@/lib/relance/server";
import { invoicePdfEnabled, fetchInvoicePdf, type InvoicePdf } from "@/lib/relance/invoicePdf";
import { sendMailAsShared } from "@/lib/graph";

/**
 * POST /api/relance/send — envoie le courrier de relance DEPUIS la boîte
 * partagée (compta@…) via l'identité applicative Graph, et JOURNALISE l'envoi
 * (RelanceLog, §6).
 *
 * L'opérateur connecté n'a besoin d'AUCUNE permission Graph perso : l'envoi
 * utilise la permission d'APPLICATION Mail.Send (client credentials). La session
 * ne sert qu'à l'autorisation (périmètre commercial).
 *
 * En mode test (défaut), le destinataire est redirigé vers la boîte de test
 * (cf. lib/relance/delivery) — aucun email n'atteint les vrais débiteurs.
 *
 * Body : { cardCode: string, level: "R0".."R5" }
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const cardCode = typeof body.cardCode === "string" ? body.cardCode.trim() : "";
  const level = body.level;
  if (!cardCode || !isRelanceCode(level)) {
    return NextResponse.json({ error: "cardCode et level (R0–R5) requis." }, { status: 400 });
  }

  const scope = await getAccessScope(session);
  if (!(await cardCodeInScope(scope, cardCode))) {
    return NextResponse.json({ error: "Client hors de votre périmètre." }, { status: 403 });
  }

  // Anti-doublon : refuse un envoi identique (même client + niveau) émis il y a
  // moins de 2 minutes — couvre les double-clics / double-submit qui
  // contourneraient le verrou de l'UI. Au-delà, un renvoi volontaire reste permis.
  const recentDup = await prisma.relanceLog.findFirst({
    where: { cardCode, level, status: "ENVOYE", sentAt: { gte: new Date(Date.now() - 120_000) } },
    select: { id: true },
  });
  if (recentDup) {
    return NextResponse.json(
      { ok: false, error: "Relance identique déjà envoyée il y a moins de 2 minutes (anti-doublon)." },
      { status: 409 },
    );
  }

  let pkg;
  try {
    pkg = await buildRelancePackage(cardCode, level);
  } catch (e) {
    if (e instanceof RelanceInputError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  const docEntries = pkg.context.invoices.map((i) => i.docEntry);
  const docNums = pkg.context.invoices.map((i) => (i.docNum ?? i.docEntry)).join(", ");
  const { totals } = pkg.context;
  const sentBy = session.user.email ?? null;

  // Pièces jointes : PDF des factures (si un service de rendu est configuré).
  // En cas d'échec on N'ENVOIE PAS (une relance « facture jointe » sans la pièce
  // serait trompeuse) — l'opérateur réessaie ou désactive le service.
  let attachments: InvoicePdf[] | undefined;
  if (invoicePdfEnabled()) {
    try {
      attachments = (
        await Promise.all(pkg.context.invoices.map((i) => fetchInvoicePdf(i.docEntry, i.docNum)))
      ).filter((a): a is InvoicePdf => a !== null);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        { status: 502 },
      );
    }
  }

  try {
    await sendMailAsShared(pkg.from, {
      to: pkg.recipient.to,
      subject: pkg.rendered.subject,
      html: pkg.rendered.html,
      attachments,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Journalise l'échec (piste d'audit) puis renvoie l'erreur.
    await prisma.relanceLog.create({
      data: {
        cardCode, clientId: pkg.clientId, level, channel: pkg.channel,
        subject: pkg.rendered.subject, recipient: pkg.recipient.to,
        intendedTo: pkg.recipient.intendedTo, testMode: pkg.recipient.testMode,
        docEntries, docNums,
        montantPrincipal: totals.principal, montantPenalites: totals.penalites,
        montantIfr: totals.ifr, montantTotal: totals.total,
        status: "ECHEC", error: msg.slice(0, 500), sentBy,
      },
    }).catch((logErr) => console.error("[relance/send] journalisation ECHEC impossible:", logErr));
    return NextResponse.json({ ok: false, error: `Envoi depuis ${pkg.from} échoué : ${msg}` }, { status: 502 });
  }

  const log = await prisma.relanceLog.create({
    data: {
      cardCode, clientId: pkg.clientId, level, channel: pkg.channel,
      subject: pkg.rendered.subject, recipient: pkg.recipient.to,
      intendedTo: pkg.recipient.intendedTo, testMode: pkg.recipient.testMode,
      docEntries, docNums,
      montantPrincipal: totals.principal, montantPenalites: totals.penalites,
      montantIfr: totals.ifr, montantTotal: totals.total,
      status: "ENVOYE", sentBy,
    },
  });

  return NextResponse.json({ ok: true, logId: log.id, from: pkg.from, recipient: pkg.recipient, level });
}
