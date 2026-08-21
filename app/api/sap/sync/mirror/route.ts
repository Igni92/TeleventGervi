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
  pullQuotations,
  pullPurchaseOrders,
  pullAllSalesSliced,
  syncClientGroupsFromMirror,
} from "@/lib/sapMirror";
import { annualWindowStart } from "@/lib/pilotage-time";
import { invalidate } from "@/lib/ttlCache";
import { warmAccueil } from "@/lib/accueilData";
import { warmLotMaps } from "@/lib/lotResolver";
import { isCronAuthorized } from "@/lib/cronAuth";

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
 * Seed initial du miroir (curseur neuf) — pull DÉCOUPÉ par mois sur la fenêtre
 * du rapport annuel (3 ans), identique à /sync/backfill mais sans purge. Évite
 * la troncature à 10 000 docs du pull incrémental non borné. Idempotent (upsert
 * par DocEntry) : rejouable si un timeout serverless l'interrompt (récent d'abord
 * → l'année courante et N-1 sont en base avant l'historique profond).
 */
async function bootstrapMirror() {
  try {
    const bps = await pullBusinessPartners({});
    const groups = await syncClientGroupsFromMirror();
    const docs = await pullAllSalesSliced(annualWindowStart(), new Date());
    // Docs ouverts (offres + PO) : seed de tous les ouverts, sans borne de date.
    const [quo, po] = await Promise.all([pullQuotations({}), pullPurchaseOrders({})]);

    await prisma.sapMirrorCursor.update({
      where: { id: 1 },
      data: {
        lastInvoiceUpdate: docs.maxUpdate.invoice ?? undefined,
        lastOrderUpdate: docs.maxUpdate.order ?? undefined,
        lastPdnUpdate: docs.maxUpdate.pdn ?? undefined,
        lastCreditNoteUpdate: docs.maxUpdate.creditNote ?? undefined,
        lastPurchaseReturnUpdate: docs.maxUpdate.purchaseReturn ?? undefined,
        lastQuotationUpdate: quo.maxUpdate ?? undefined,
        lastPurchaseOrderUpdate: po.maxUpdate ?? undefined,
        lastBpUpdate: new Date(),
        lastTickAt: new Date(),
      },
    });
    invalidate("pilotage:");

    return NextResponse.json({
      ok: true,
      bootstrap: true,
      monthsSliced: docs.slices,
      bps: bps.upserted,
      clientGroupsUpdated: groups.updated,
      invoices: docs.invoices,
      orders: docs.orders,
      pdns: docs.pdns,
      creditNotes: docs.creditNotes,
      purchaseReturns: docs.purchaseReturns,
      quotations: quo.pulled,
      purchaseOrders: po.pulled,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[sync/mirror] bootstrap", message);
    // Curseur laissé NEUF (aucun watermark posé) → le prochain tick relance le
    // bootstrap (idempotent) au lieu de basculer en incrémental sur un miroir vide.
    return NextResponse.json({ ok: false, bootstrap: true, error: message }, { status: 500 });
  }
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

  // ── Bootstrap d'un miroir jamais seedé ────────────────────────────────────
  // Si AUCUN watermark n'est posé (curseur neuf), un pull incrémental sans borne
  // (`updatedSince: undefined`) plafonnerait SILENCIEUSEMENT à 10 000 docs
  // (getAll 100×100, `DocEntry desc`) → seuls les ~10 000 plus récents seraient
  // gardés, tout l'historique plus ancien serait tronqué, ET le curseur avancé
  // au max UpdateDate de ce sous-ensemble : les mois manquants ne seraient
  // JAMAIS rattrapés. On bootstrappe donc par un pull DÉCOUPÉ par mois sur la
  // fenêtre du rapport annuel (3 ans), comme /sync/backfill (idempotent, sûr à
  // rejouer si un timeout l'interrompt : recommence récent→ancien).
  const mirrorNeverSeeded =
    !cursor.lastInvoiceUpdate && !cursor.lastOrderUpdate && !cursor.lastPdnUpdate &&
    !cursor.lastCreditNoteUpdate && !cursor.lastPurchaseReturnUpdate;
  if (mirrorNeverSeeded) return bootstrapMirror();

  try {
    // BP en premier (FK) — incrémental sur UpdateDate.
    const bps = await pullBusinessPartners({
      updatedSince: cursor.lastBpUpdate ?? undefined,
    });
    // Propage le groupe SAP vers Client.sapGroup* (pré-requis flèche familles).
    const groups = await syncClientGroupsFromMirror();
    const [inv, ord, pdn, cn, pret, quo, po] = await Promise.all([
      pullInvoices({ updatedSince: cursor.lastInvoiceUpdate ?? undefined }),
      pullOrders({ updatedSince: cursor.lastOrderUpdate ?? undefined }),
      pullPdns({ updatedSince: cursor.lastPdnUpdate ?? undefined }),
      pullCreditNotes({ updatedSince: cursor.lastCreditNoteUpdate ?? undefined }),
      pullPurchaseReturns({ updatedSince: cursor.lastPurchaseReturnUpdate ?? undefined }),
      // Offres/PO : curseur neuf ⇒ seed de tous les ouverts (cf. pullOpenDocs).
      pullQuotations({ updatedSince: cursor.lastQuotationUpdate ?? undefined }),
      pullPurchaseOrders({ updatedSince: cursor.lastPurchaseOrderUpdate ?? undefined }),
    ]);

    await prisma.sapMirrorCursor.update({
      where: { id: 1 },
      data: {
        lastInvoiceUpdate: inv.maxUpdate ?? cursor.lastInvoiceUpdate,
        lastOrderUpdate: ord.maxUpdate ?? cursor.lastOrderUpdate,
        lastPdnUpdate: pdn.maxUpdate ?? cursor.lastPdnUpdate,
        lastCreditNoteUpdate: cn.maxUpdate ?? cursor.lastCreditNoteUpdate,
        lastPurchaseReturnUpdate: pret.maxUpdate ?? cursor.lastPurchaseReturnUpdate,
        lastQuotationUpdate: quo.maxUpdate ?? cursor.lastQuotationUpdate,
        lastPurchaseOrderUpdate: po.maxUpdate ?? cursor.lastPurchaseOrderUpdate,
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
      // …puis RE-CHAUFFE aussitôt TOUT le chemin de lancement de l'accueil (KPI
      // du jour, poids par famille, dernières commandes) : le cron paie le
      // recalcul, jamais l'humain. Sans ça, le PREMIER utilisateur après ce tick
      // déclenchait le gros recalcul à froid → « l'app charge en boucle ».
      // Best-effort : n'échoue jamais la synchro.
      await warmAccueil();
    }

    // Maps de lots : préchauffées à CHAQUE tick, y compris quand rien de neuf
    // n'est entré. Leur fraîcheur ne dépend pas que des nouveaux documents mais
    // aussi de l'expiration du TTL : sans ce rafraîchissement régulier, la
    // première personne à ouvrir les bons de commande / la console après
    // expiration repayait le scan des 1500 réceptions (7 à 15 s). Coût SAP
    // inchangé (même fréquence qu'avant), mais payé ici et non par un humain.
    await warmLotMaps();

    return NextResponse.json({
      ok: true,
      bps: bps.upserted,
      clientGroupsUpdated: groups.updated,
      invoices: inv.pulled,
      orders: ord.pulled,
      pdns: pdn.pulled,
      creditNotes: cn.pulled,
      purchaseReturns: pret.pulled,
      quotations: quo.pulled,
      purchaseOrders: po.pulled,
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
