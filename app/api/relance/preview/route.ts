import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, cardCodeInScope } from "@/lib/permissions";
import { isRelanceCode } from "@/lib/relance/levels";
import { buildRelancePackage, RelanceInputError } from "@/lib/relance/server";

/**
 * POST /api/relance/preview — aperçu d'un courrier de relance (objet + corps
 * HTML/texte + décompte + destinataire effectif), SANS envoi ni journalisation.
 *
 * Body : { cardCode: string, level: "R0".."R5" }
 * Périmètre : un non-admin ne peut prévisualiser que ses propres clients.
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

  try {
    const pkg = await buildRelancePackage(cardCode, level);
    return NextResponse.json({
      ok: true,
      cardCode: pkg.cardCode,
      cardName: pkg.cardName,
      level: pkg.level,
      channel: pkg.channel,
      subject: pkg.rendered.subject,
      html: pkg.rendered.html,
      text: pkg.rendered.text,
      recommande: pkg.rendered.recommande,
      recipient: pkg.recipient,
      clientEmailCompta: pkg.clientEmailCompta,
      totals: pkg.context.totals,
      invoices: pkg.context.invoices.map((i) => ({
        docEntry: i.docEntry,
        docNum: i.docNum,
        docDate: i.docDate?.toISOString() ?? null,
        dueDate: i.dueDate?.toISOString() ?? null,
        balance: i.balance,
        overdueDays: i.overdueDays,
      })),
    });
  } catch (e) {
    if (e instanceof RelanceInputError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Lecture SAP échouée : ${msg}` }, { status: 502 });
  }
}
