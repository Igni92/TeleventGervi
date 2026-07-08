import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  pullBusinessPartners,
  pullAllSalesSliced,
  syncClientGroupsFromMirror,
} from "@/lib/sapMirror";
import { periodBounds, annualWindowStart } from "@/lib/pilotage-time";
import { invalidate } from "@/lib/ttlCache";

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
 * `from` (optionnel, défaut = 1er janvier de N-2 = borne basse du rapport
 * annuel, cf. annualWindowStart) borne par DocDate côté SAP.
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
  // Défaut = 1er janvier de N-2 (borne basse du rapport annuel, cf.
  // annualWindowStart) et NON plus « today − 1 an » : couvre la matrice 3 ans.
  const from = fromParam ? new Date(fromParam) : annualWindowStart();
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

    // 2) Docs reconstruits par tranches MENSUELLES (plus récente d'abord) :
    //    aucune fenêtre ne dépasse le plafond de pagination (10 000 docs/pull),
    //    donc le récent n'est jamais tronqué (cf. pullAllSalesSliced).
    const docs = await pullAllSalesSliced(from, to ?? new Date());

    // 3) Update cursor (max UpdateDate vu sur tout le backfill).
    await prisma.sapMirrorCursor.upsert({
      where: { id: 1 },
      update: {
        lastInvoiceUpdate: docs.maxUpdate.invoice ?? undefined,
        lastOrderUpdate: docs.maxUpdate.order ?? undefined,
        lastPdnUpdate: docs.maxUpdate.pdn ?? undefined,
        lastCreditNoteUpdate: docs.maxUpdate.creditNote ?? undefined,
        lastPurchaseReturnUpdate: docs.maxUpdate.purchaseReturn ?? undefined,
        lastBpUpdate: new Date(),
        lastTickAt: new Date(),
      },
      create: {
        id: 1,
        lastInvoiceUpdate: docs.maxUpdate.invoice,
        lastOrderUpdate: docs.maxUpdate.order,
        lastPdnUpdate: docs.maxUpdate.pdn,
        lastCreditNoteUpdate: docs.maxUpdate.creditNote,
        lastPurchaseReturnUpdate: docs.maxUpdate.purchaseReturn,
        lastBpUpdate: new Date(),
      },
    });

    // Purge le cache pilotage pour refléter le backfill immédiatement.
    invalidate("pilotage:");

    const finishedAt = new Date();
    const total = bps.upserted + docs.invoices + docs.creditNotes + docs.orders + docs.pdns + docs.purchaseReturns;
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
      monthsSliced: docs.slices,
      bps,
      clientGroups: groups,
      invoices: docs.invoices,
      orders: docs.orders,
      pdns: docs.pdns,
      creditNotes: docs.creditNotes,
      purchaseReturns: docs.purchaseReturns,
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

/**
 * GET → diagnostic miroir. État du curseur + volumétrie + **fenêtre du jour** :
 * permet de vérifier d'un coup d'œil si les commandes d'aujourd'hui sont bien
 * dans le miroir (KPI du jour). Si `orders.today` = 0 alors que SAP a des
 * commandes datées d'aujourd'hui, c'est une troncature de pull (fenêtre > 10k)
 * ou un décalage de fuseau sur `ordersDocDateRange.max`.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { start, end } = periodBounds("day");
  const cursor = await prisma.sapMirrorCursor.findUnique({ where: { id: 1 } });
  const [
    bps, invoices, orders, pdns, creditNotes, purchaseReturns,
    ordersToday, ordersTodayAll, orderAgg,
  ] = await Promise.all([
    prisma.sapBusinessPartner.count(),
    prisma.sapInvoice.count(),
    prisma.sapOrder.count(),
    prisma.sapPurchaseDeliveryNote.count(),
    prisma.sapCreditNote.count(),
    prisma.sapPurchaseReturn.count(),
    prisma.sapOrder.count({ where: { docDate: { gte: start, lt: end }, cancelled: false } }),
    prisma.sapOrder.count({ where: { docDate: { gte: start, lt: end } } }),
    prisma.sapOrder.aggregate({
      _min: { docDate: true, docEntry: true },
      _max: { docDate: true, docEntry: true },
    }),
  ]);

  return NextResponse.json({
    todayWindow: { start, end },
    counts: { bps, invoices, orders, pdns, creditNotes, purchaseReturns },
    orders: {
      today: ordersToday,               // non annulées dans la fenêtre du jour (= base KPI)
      todayInclCancelled: ordersTodayAll,
      docDateRange: { min: orderAgg._min.docDate, max: orderAgg._max.docDate },
      docEntryRange: { min: orderAgg._min.docEntry, max: orderAgg._max.docEntry },
    },
    cursor,
  });
}
