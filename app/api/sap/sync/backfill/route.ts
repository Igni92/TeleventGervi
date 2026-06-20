import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  pullBusinessPartners,
  pullInvoices,
  pullOrders,
  pullPdns,
  pullCreditNotes,
  pullPurchaseReturns,
  syncClientGroupsFromMirror,
} from "@/lib/sapMirror";

// Backfill historique long (plusieurs années × 5 entités, pagination SAP) →
// autoriser la durée max du plan (Vercel Hobby = 300s). Pour de très gros
// historiques, découper en tranches via le couple from/to (anti-timeout).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/sap/sync/backfill?from=YYYY-MM-DD[&to=YYYY-MM-DD]
 *
 * One-shot rétrospectif : ramène ~1 an de SAP B1 dans les tables miroir locales
 * (SapBusinessPartner, SapInvoice, SapOrder, SapPurchaseDeliveryNote, avoirs
 * clients SapCreditNote, avoirs fournisseurs SapPurchaseReturn + lignes).
 * Les avoirs sont indispensables au CA NET (factures − avoirs) et aux Achats
 * NET (EM − retours), donc à la marge réelle (cf. lib/cogs).
 *
 * `from` (optionnel, défaut = today - 365j) borne par DocDate côté SAP.
 *
 * Idempotent : upsert par DocEntry / CardCode. Sûr à relancer.
 *
 * NB : long (peut dépasser 60s sur ~1 an). À déclencher hors heures bureau,
 *      idéalement depuis un job dédié (cf. scheduled-tasks). Renvoie un résumé
 *      par entité quand le pull est terminé.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = fromParam
    ? new Date(fromParam)
    : (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d; })();
  const to = toParam ? new Date(toParam) : undefined;

  if (Number.isNaN(from.getTime())) {
    return NextResponse.json({ error: "Paramètre `from` invalide (attendu YYYY-MM-DD)" }, { status: 400 });
  }
  if (to && Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "Paramètre `to` invalide (attendu YYYY-MM-DD)" }, { status: 400 });
  }

  const startedAt = new Date();
  const log = await prisma.syncLog.create({
    data: {
      source: "sap",
      type: "mirror-backfill",
      status: "running",
      startedAt,
      triggeredBy: session.user.id ?? null,
    },
  });

  try {
    // 1) BP d'abord — référentiel partagé FK des docs.
    const bps = await pullBusinessPartners({});
    // 1bis) Propage le groupe SAP vers Client.sapGroup* (idempotent).
    const groups = await syncClientGroupsFromMirror();

    // 2) Invoices + Orders + PDN + avoirs (clients & fournisseurs) en parallèle
    //    — 5 endpoints SAP indépendants.
    const [inv, ord, pdn, cn, pret] = await Promise.all([
      pullInvoices({ from, to }),
      pullOrders({ from, to }),
      pullPdns({ from, to }),
      pullCreditNotes({ from, to }),
      pullPurchaseReturns({ from, to }),
    ]);

    // 3) Update cursor (max UpdateDate vu sur tout le backfill).
    await prisma.sapMirrorCursor.upsert({
      where: { id: 1 },
      update: {
        lastInvoiceUpdate: inv.maxUpdate ?? undefined,
        lastOrderUpdate: ord.maxUpdate ?? undefined,
        lastPdnUpdate: pdn.maxUpdate ?? undefined,
        lastCreditNoteUpdate: cn.maxUpdate ?? undefined,
        lastPurchaseReturnUpdate: pret.maxUpdate ?? undefined,
        lastBpUpdate: new Date(),
        lastTickAt: new Date(),
      },
      create: {
        id: 1,
        lastInvoiceUpdate: inv.maxUpdate,
        lastOrderUpdate: ord.maxUpdate,
        lastPdnUpdate: pdn.maxUpdate,
        lastCreditNoteUpdate: cn.maxUpdate,
        lastPurchaseReturnUpdate: pret.maxUpdate,
        lastBpUpdate: new Date(),
      },
    });

    const finishedAt = new Date();
    const total = bps.upserted + inv.pulled + ord.pulled + pdn.pulled + cn.pulled + pret.pulled;
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "success",
        finishedAt,
        itemsTotal: total,
        itemsSynced: total,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
    });

    return NextResponse.json({
      ok: true,
      from: from.toISOString().slice(0, 10),
      to: to ? to.toISOString().slice(0, 10) : null,
      bps,
      clientGroups: groups,
      invoices: inv,
      orders: ord,
      pdns: pdn,
      creditNotes: cn,
      purchaseReturns: pret,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    });
  } catch (e) {
    const finishedAt = new Date();
    const message = e instanceof Error ? e.message : String(e);
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: "error",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errors: JSON.stringify({ message }),
      },
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** GET → état courant du curseur miroir. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const cursor = await prisma.sapMirrorCursor.findUnique({ where: { id: 1 } });
  const counts = {
    bps: await prisma.sapBusinessPartner.count(),
    invoices: await prisma.sapInvoice.count(),
    orders: await prisma.sapOrder.count(),
    pdns: await prisma.sapPurchaseDeliveryNote.count(),
    creditNotes: await prisma.sapCreditNote.count(),
    purchaseReturns: await prisma.sapPurchaseReturn.count(),
  };
  return NextResponse.json({ cursor, counts });
}
