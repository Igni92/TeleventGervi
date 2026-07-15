import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { colisInfo } from "@/lib/colis";
import { formatDeliveryDate } from "@/lib/livraison";
import { isLivraisonRestricted } from "@/lib/permissions";
import { getCarrierInfo } from "@/lib/carrierInfo";
import { getTransporteurDetail } from "@/lib/transporteurs";
import { sendMailAsShared } from "@/lib/graph";
import { renderBonTransport, type BonTransportRow } from "@/lib/bonTransport";

export const dynamic = "force-dynamic";

/** Boîte partagée expéditrice du bon de transport (surchageable par env). */
const FROM_MAILBOX = process.env.BON_TRANSPORT_FROM || "commercial@gervifrais.com";

/**
 * POST /api/livraisons/bon-transport
 *
 * Envoie PAR MAIL le bon de transport d'un transporteur (récap de toutes ses
 * commandes du jour de livraison), depuis la boîte partagée
 * commercial@gervifrais.com (identité applicative Graph — cf. sendMailAsShared),
 * vers l'email de la fiche transporteur.
 *
 * Body : { date: "YYYY-MM-DD", trspCode: string }
 * Réservé aux commerciaux / admins (pas préparateur ni livreur).
 * Les données sont RECONSTRUITES côté serveur depuis SAP (rien de client-fourni
 * ne part dans le mail, hors le couple date + code transporteur).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const restricted = await isLivraisonRestricted(session);
  if (restricted) return NextResponse.json({ error: "Réservé aux commerciaux / admins" }, { status: 403 });

  let body: { date?: string; trspCode?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const date = (body.date ?? "").trim();
  const trspCode = (body.trspCode ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "date requise (YYYY-MM-DD)" }, { status: 400 });
  if (!trspCode) return NextResponse.json({ error: "trspCode requis" }, { status: 400 });

  // Destinataire = email de la fiche transporteur (obligatoire).
  const fiche = await getCarrierInfo(trspCode);
  if (!fiche.email) {
    return NextResponse.json(
      { ok: false, error: "Aucun email dans la fiche transporteur — renseignez-la d'abord (bouton fiche sur le groupe transporteur)." },
      { status: 400 },
    );
  }

  try {
    // ── Commandes SAP du transporteur pour ce jour de livraison ──
    type Line = { ItemCode: string; Quantity: number };
    type Order = {
      DocEntry: number; DocNum: number; CardCode: string; CardName?: string;
      Cancelled?: string; U_TrspHeur?: string; DocumentLines?: Line[];
    };
    const filter = encodeURIComponent(
      `DocDueDate eq '${date}' and U_TrspCode eq '${trspCode.replace(/'/g, "''")}'`,
    );
    const orders = (await sap.getAll<Order>(
      `Orders?$select=DocEntry,DocNum,CardCode,CardName,Cancelled,U_TrspHeur,DocumentLines&$filter=${filter}&$orderby=CardName asc`,
      { pageSize: 200, maxPages: 10 },
    )).filter((o) => o.Cancelled !== "tYES");

    if (orders.length === 0) {
      return NextResponse.json({ ok: false, error: "Aucune commande pour ce transporteur à cette date." }, { status: 404 });
    }

    // ── Enrichissements locaux : colis/poids (Product) + nom complet client ──
    const itemCodes = Array.from(new Set(orders.flatMap((o) => (o.DocumentLines ?? []).map((l) => l.ItemCode))));
    const prods = itemCodes.length
      ? await prisma.product.findMany({
          where: { itemCode: { in: itemCodes } },
          select: { itemCode: true, salesUnit: true, salesUnitWeight: true, salesQtyPerPackUnit: true },
        })
      : [];
    const pMap = new Map(prods.map((p) => [p.itemCode, p]));

    const cardCodes = Array.from(new Set(orders.map((o) => o.CardCode)));
    const nameByCard = new Map<string, string>();
    try {
      const clients = await prisma.client.findMany({ where: { code: { in: cardCodes } }, select: { code: true, nom: true } });
      for (const c of clients) if (c.nom?.trim()) nameByCard.set(c.code, c.nom.trim());
      const modes = await prisma.clientDeliveryMode.findMany({
        where: { sapCardCode: { in: cardCodes } },
        select: { sapCardCode: true, client: { select: { nom: true } } },
      });
      for (const m of modes) if (m.client?.nom?.trim() && !nameByCard.has(m.sapCardCode)) nameByCard.set(m.sapCardCode, m.client.nom.trim());
    } catch { /* repli sur CardName SAP */ }

    // Libellé transporteur (table Carrier) + tournées (SERGTRS) pour nommer les groupes.
    let carrierName = trspCode;
    try {
      const c = await prisma.carrier.findFirst({ where: { sapValue: trspCode }, select: { name: true } });
      if (c?.name) carrierName = c.name;
    } catch { /* code brut */ }
    const tournees = await getTransporteurDetail(trspCode).then((d) => d?.tournees ?? []).catch(() => []);
    const tourneeLabel = (heure: string | null | undefined): string => {
      const h = (heure ?? "").trim();
      if (h) {
        const t = tournees.find((x) => x.heure === h);
        if (t?.nom?.trim()) return t.nom.trim();
        return `Tournée ${h.slice(0, 5)}`;
      }
      return "Sans tournée";
    };

    const rows: BonTransportRow[] = orders.map((o) => {
      let colis = 0, weightKg = 0;
      for (const l of o.DocumentLines ?? []) {
        const p = pMap.get(l.ItemCode);
        const div = (p ? colisInfo(p).unitsPerColis : 1) || 1;
        colis += (l.Quantity || 0) / div;
        weightKg += (l.Quantity || 0) * (p?.salesUnitWeight ?? 0);
      }
      return {
        tournee: tourneeLabel(o.U_TrspHeur),
        client: nameByCard.get(o.CardCode) ?? o.CardName ?? o.CardCode,
        docNum: o.DocNum,
        colis: Math.round(colis * 10) / 10,
        weightKg: Math.round(weightKg * 10) / 10,
      };
    }).sort((a, b) => a.tournee.localeCompare(b.tournee, "fr") || a.client.localeCompare(b.client, "fr"));

    const dateLabel = formatDeliveryDate(date);
    const html = renderBonTransport(
      { carrierName, dateLabel, email: fiche.email, phones: fiche.phones, rows },
      { copies: ["ORIGINAL"] },
    );

    await sendMailAsShared(FROM_MAILBOX, {
      to: fiche.email,
      subject: `Bon de transport Gervifrais — ${carrierName} — livraison du ${dateLabel}`,
      html,
    });

    return NextResponse.json({ ok: true, to: fiche.email, from: FROM_MAILBOX, orders: rows.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
