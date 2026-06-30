import { NextRequest, NextResponse } from "next/server";
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
import { invalidate } from "@/lib/ttlCache";

// Pull de 5 entités + BP (pagination SAP) → peut dépasser le défaut serverless.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/sap/sync/mirror
 *
 * Sync incrémental : pull SAP → tables miroir locales pour les docs dont
 * `UpdateDate > cursor`. Pensé pour être appelé par un cron toutes les N min
 * (ex. 5 min) ou par /loop côté Claude Code.
 *
 * Throttle serveur 60 s pour empêcher les concurrences agressives.
 */

const THROTTLE_MS = 60_000;

/**
 * Auth machine pour cron Vercel : `Authorization: Bearer <CRON_SECRET>` ou
 * en-tête `x-cron-secret`. Vercel ajoute automatiquement le Bearer aux requêtes
 * cron. Désactivé si `CRON_SECRET` n'est pas défini (aucun bypass possible).
 */
function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}

/** Cœur de la synchro miroir, partagé entre le déclenchement manuel (POST) et le cron (GET). */
async function runMirrorSync() {
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

    // Si de NOUVEAUX documents sont entrés, purge les caches d'agrégats pilotage
    // (annual/geo/weekly/tops…) pour que les dashboards reflètent ce tick sans
    // attendre l'expiration du TTL (jusqu'à 7 j pour l'annuel). Si rien de neuf,
    // on garde le cache (la plupart des ticks ne ramènent aucun doc).
    if (inv.pulled || ord.pulled || pdn.pulled || cn.pulled || pret.pulled) {
      invalidate("pilotage:");
    }

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

/** Déclenchement manuel (console admin) — contrôle session/admin INCHANGÉ. */
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  return runMirrorSync();
}

/** Déclenchement machine (cron Vercel) — auth par CRON_SECRET, sans session. */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  return runMirrorSync();
}
