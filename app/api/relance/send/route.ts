import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, cardCodeInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isRelanceCode } from "@/lib/relance/levels";
import { buildRelancePackage, RelanceInputError } from "@/lib/relance/server";
import { type InvoicePdf } from "@/lib/relance/invoicePdf";
import { invoiceAttachment } from "@/lib/relance/archivedInvoicePdf";
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

  // Relances désactivées pour ce client (case décochée dans Encours) : on refuse
  // l'envoi (défense en profondeur — l'UI masque déjà le bouton).
  if (!pkg.relanceActive) {
    return NextResponse.json(
      { ok: false, error: "Les relances sont désactivées pour ce client (case « Relance » décochée)." },
      { status: 422 },
    );
  }

  // Les factures de SERVICE sont désormais EXCLUES des relances normales (R0→R5)
  // et traitées par le niveau dédié « RS » (courrier interne → compta). Plus de
  // blocage ici (RS est un envoi légitime, vers la compta).

  // Destinataire EFFECTIF = résolu selon les réglages MODIFIABLES dans l'app
  // (Paramètres → Administration) : en mode test (défaut), la boîte de test
  // configurable ; en mode live, les emails compta du client. Le destinataire
  // CLIENT réel reste tracé dans `intendedTo`.
  const effectiveTo = pkg.recipient.to;
  const effectiveIntendedTo = pkg.recipient.intendedTo ?? pkg.recipient.to;
  const effectiveTestMode = pkg.recipient.testMode;

  // Pièces jointes : PDF des factures EN RETARD UNIQUEMENT. On n'attache pas les
  // factures dues mais non encore échues (overdueDays <= 0) — seules les factures
  // effectivement en retard justifient un document joint. Source : PDF archivé
  // (boîte factures-archive@) en priorité, sinon service Crystal.
  // En cas d'échec du repli Crystal on N'ENVOIE PAS (facture « jointe » sans la
  // pièce = trompeur) — l'opérateur réessaie ou désactive le service.
  const overdueInvoices = pkg.context.invoices.filter((i) => i.overdueDays > 0);
  let attachments: InvoicePdf[] | undefined;
  try {
    attachments = (
      await Promise.all(overdueInvoices.map((i) => invoiceAttachment(i.docEntry, i.docNum)))
    ).filter((a): a is InvoicePdf => a !== null);
    if (attachments.length === 0) attachments = undefined;
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  try {
    await sendMailAsShared(pkg.from, {
      to: effectiveTo,
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
        subject: pkg.rendered.subject, recipient: effectiveTo,
        intendedTo: effectiveIntendedTo, testMode: effectiveTestMode,
        docEntries, docNums,
        montantPrincipal: totals.principal, montantPenalites: totals.penalites,
        montantIfr: totals.ifr, montantTotal: totals.total,
        status: "ECHEC", error: msg.slice(0, 500), sentBy,
      },
    }).catch((logErr) => console.error("[relance/send] journalisation ECHEC impossible:", logErr));
    return NextResponse.json({ ok: false, error: `Envoi depuis ${pkg.from} échoué : ${msg}` }, { status: 502 });
  }

  // Audit 2026-08-13 (#23) : le mail EST déjà parti. L'insert du log 'ENVOYE'
  // n'était PAS protégé (contrairement au 'ECHEC') : un échec d'insert faisait
  // lever un 500, l'opérateur voyait une erreur et recliquait → 2e courrier
  // (l'anti-doublon repose sur l'existence de cette ligne < 2 min, justement
  // perdue). On entoure donc l'insert d'un try/catch : on journalise l'échec et on
  // répond quand même ok (mail parti) en signalant que le renvoi est à éviter.
  let logId: string | null = null;
  let logWarning: string | undefined;
  try {
    const log = await prisma.relanceLog.create({
      data: {
        cardCode, clientId: pkg.clientId, level, channel: pkg.channel,
        subject: pkg.rendered.subject, recipient: effectiveTo,
        intendedTo: effectiveIntendedTo, testMode: effectiveTestMode,
        docEntries, docNums,
        montantPrincipal: totals.principal, montantPenalites: totals.penalites,
        montantIfr: totals.ifr, montantTotal: totals.total,
        status: "ENVOYE", sentBy,
      },
    });
    logId = log.id;
  } catch (logErr) {
    console.error("[relance/send] journalisation ENVOYE impossible (mail déjà parti):", logErr);
    logWarning =
      "Courrier envoyé, mais la journalisation a échoué : l'anti-doublon n'a pas été enregistré — NE PAS renvoyer cette relance.";
  }

  return NextResponse.json({
    ok: true, logId, from: pkg.from, level,
    recipient: { to: effectiveTo, intendedTo: effectiveIntendedTo, testMode: effectiveTestMode },
    ...(logWarning ? { warning: logWarning } : {}),
  });
}
