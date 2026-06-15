import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
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
import { requireAdmin } from "@/lib/permissions";

/**
 * POST /api/sap/sync/mirror
 *
 * Sync incrémental : pull SAP → tables miroir locales pour les docs dont
 * `UpdateDate > cursor`. Pensé pour être appelé par un cron toutes les N min
 * (ex. 5 min) ou par /loop côté Claude Code.
 *
 * Accès : admin (session) OU secret de cron (`CRON_SECRET`, via en-tête
 * `Authorization: Bearer …` ou `x-cron-secret`). Empêche un commercial de
 * déclencher des pulls SAP globaux tout en laissant le job planifié opérer.
 *
 * Throttle serveur 60 s pour empêcher les concurrences agressives.
 */

const THROTTLE_MS = 60_000;

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.headers.get("x-cron-secret") ??
    undefined;
  const isCron = Boolean(cronSecret) && provided === cronSecret;

  if (!isCron) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    if (!(await requireAdmin(session)))
      return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  const cursor = await prisma.sapMirrorCursor.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  if (Date.now() - cursor.lastTickAt.getTime() < THROTTLE_MS) {
    return NextResponse.json({ ok: true, throttled: true, lastTickAt: cursor.lastTickAt });
  }

  try {
    // BP en premier (FK) — incrémental sur UpdateDate.
    const bps = await pullBusinessPartners({
      updatedSince: cursor.lastBpUpdate ?? undefined,
    });
    // Propage le groupe SAP vers Client.sapGroup* (pré-requis flèche familles).
    const groups = await syncClientGroupsFromMirror();
    const [inv, ord, pdn, cn, pret] = await Promise.all([
      pullInvoices({ updatedSince: cursor.lastInvoiceUpdate ?? undefined }),
      pullOrders({ updatedSince: cursor.lastOrderUpdate ?? undefined }),
      pullPdns({ updatedSince: cursor.lastPdnUpdate ?? undefined }),
      pullCreditNotes({ updatedSince: cursor.lastCreditNoteUpdate ?? undefined }),
      pullPurchaseReturns({ updatedSince: cursor.lastPurchaseReturnUpdate ?? undefined }),
    ]);

    await prisma.sapMirrorCursor.update({
      where: { id: 1 },
      data: {
        lastInvoiceUpdate: inv.maxUpdate ?? cursor.lastInvoiceUpdate,
        lastOrderUpdate: ord.maxUpdate ?? cursor.lastOrderUpdate,
        lastPdnUpdate: pdn.maxUpdate ?? cursor.lastPdnUpdate,
        lastCreditNoteUpdate: cn.maxUpdate ?? cursor.lastCreditNoteUpdate,
        lastPurchaseReturnUpdate: pret.maxUpdate ?? cursor.lastPurchaseReturnUpdate,
        lastBpUpdate: new Date(),
        lastTickAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      bps: bps.upserted,
      clientGroupsUpdated: groups.updated,
      invoices: inv.pulled,
      orders: ord.pulled,
      pdns: pdn.pulled,
      creditNotes: cn.pulled,
      purchaseReturns: pret.pulled,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[sync/mirror]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
