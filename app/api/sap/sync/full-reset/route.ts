import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  pullBusinessPartners,
  pullInvoices,
  pullOrders,
  pullPdns,
  pullCreditNotes,
  syncClientGroupsFromMirror,
} from "@/lib/sapMirror";

/**
 * POST /api/sap/sync/full-reset?from=YYYY-MM-DD
 *
 * Actualisation GLOBALE et PROPRE depuis la base réelle (PROD) :
 *   1. VIDE les tables miroir docs (BP, factures, avoirs, commandes, PDN + lignes).
 *   2. Re-pull intégral depuis SAP PROD : BP → groupes → factures + avoirs +
 *      commandes + PDN (sur `from`, défaut 1 an).
 *
 * Élimine les données périmées/aberrantes (ex. factures test datées dans le futur).
 * Le stock/catalogue est rafraîchi à part via /api/sap/sync/products.
 *
 * ⚠️ Long (peut dépasser 1-2 min sur ~1 an) — lancer en local / hors prod serverless.
 * Les lectures sont épinglées PROD (cf. split sapb1), quel que soit le badge.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // Purge + reconstruction intégrale du miroir SAP → admins uniquement.
  if (!isAdmin(session)) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const from = fromParam
    ? new Date(fromParam)
    : (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d; })();
  if (Number.isNaN(from.getTime())) {
    return NextResponse.json({ error: "Paramètre `from` invalide (YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    // 1) Purge du miroir docs (CASCADE → lignes). Ne touche PAS Client/Product.
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "SapBusinessPartner", "SapInvoice", "SapOrder", "SapCreditNote", "SapPurchaseDeliveryNote" RESTART IDENTITY CASCADE;`,
    );
    // Reset des watermarks incrémentaux (best-effort).
    try {
      await prisma.sapMirrorCursor.update({
        where: { id: 1 },
        data: { lastBpUpdate: null, lastInvoiceUpdate: null, lastOrderUpdate: null, lastPdnUpdate: null, lastCreditNoteUpdate: null },
      });
    } catch { /* curseur absent → ignoré */ }

    // 2) BP d'abord (FK des docs), puis propagation des groupes.
    const bps = await pullBusinessPartners({});
    const groups = await syncClientGroupsFromMirror();

    // 3) Docs en parallèle (endpoints SAP indépendants).
    const [inv, cn, ord, pdn] = await Promise.all([
      pullInvoices({ from }),
      pullCreditNotes({ from }),
      pullOrders({ from }),
      pullPdns({ from }),
    ]);

    return NextResponse.json({
      ok: true,
      company: "GERVIFRAIS (PROD)",
      from: from.toISOString().slice(0, 10),
      businessPartners: bps.upserted,
      clientGroups: groups.updated,
      invoices: inv.pulled,
      creditNotes: cn.pulled,
      orders: ord.pulled,
      pdns: pdn.pulled,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Resync échouée : ${msg}` }, { status: 500 });
  }
}
