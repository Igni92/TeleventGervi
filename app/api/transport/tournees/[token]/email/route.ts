import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendMailAsShared } from "@/lib/graph";
import { getRelanceEmailSettings } from "@/lib/integrationSettings";
import { fmtJourDate } from "@/lib/date-fr";

export const dynamic = "force-dynamic";

/**
 * POST /api/transport/tournees/[token]/email — envoie au chauffeur (et éventuel
 * service enlèvement en cc) le lien de sa feuille de route, ou une annonce
 * d'enlèvement. Body : { to?, cc?, annonce?: boolean }. Email via Graph
 * (sendMailAsShared, même identité applicative que les relances).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const t = await prisma.transportTournee.findUnique({
    where: { token },
    include: { chauffeur: { select: { nom: true, email: true, societe: true } } },
  });
  if (!t) return NextResponse.json({ ok: false, error: "Tournée introuvable" }, { status: 404 });

  let b: { to?: string; cc?: string[]; annonce?: boolean };
  try { b = await req.json(); } catch { b = {}; }
  const to = (b.to || t.chauffeur?.email || "").trim();
  if (!to) return NextResponse.json({ ok: false, error: "Aucun email destinataire (renseigne l'email du chauffeur)" }, { status: 400 });

  // URL absolue de la feuille (origine réelle derrière le proxy).
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const url = `${proto}://${host}/feuille-route/${token}`;
  const dateLabel = fmtJourDate(t.date.toISOString().slice(0, 10));

  const nbExp = await prisma.transportExpedition.count({
    where: { chauffeurId: t.chauffeurId ?? "__none__", date: { gte: new Date(t.date), lt: new Date(new Date(t.date).getTime() + 86_400_000) } },
  });

  const annonce = b.annonce === true;
  const subject = annonce
    ? `Annonce d'enlèvement — Gervifrais — ${dateLabel}`
    : `Feuille de route — ${dateLabel}${t.chauffeur?.nom ? ` — ${t.chauffeur.nom}` : ""}`;
  const html = annonce
    ? `<p>Bonjour${t.chauffeur?.nom ? ` ${t.chauffeur.nom}` : ""},</p>
       <p>Nous vous annonçons un <b>enlèvement le ${dateLabel}</b> (${nbExp} expédition${nbExp > 1 ? "s" : ""}).</p>
       <p>Votre feuille de route (mise à jour en temps réel) :<br><a href="${url}">${url}</a></p>
       <p>Merci de confirmer votre passage.<br>— Gervifrais, service logistique</p>`
    : `<p>Bonjour${t.chauffeur?.nom ? ` ${t.chauffeur.nom}` : ""},</p>
       <p>Voici votre <b>feuille de route du ${dateLabel}</b> (${nbExp} expédition${nbExp > 1 ? "s" : ""}), à consulter et mettre à jour depuis votre téléphone :</p>
       <p><a href="${url}">${url}</a></p>
       <p>— Gervifrais, service logistique</p>`;

  try {
    const { from } = await getRelanceEmailSettings();
    await sendMailAsShared(from, { to, subject, html, cc: b.cc });
    return NextResponse.json({ ok: true, to });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
