import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  pullBusinessPartners,
  pullAllSalesSliced,
  syncClientGroupsFromMirror,
} from "@/lib/sapMirror";
import { invalidate } from "@/lib/ttlCache";

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
 * ⚠️ Long (peut dépasser 1-2 min sur ~1 an) — à lancer plutôt en local. Sur
 * Vercel, le plan Hobby plafonne maxDuration à 300 s (au-delà → échec de build).
 * Les lectures sont épinglées PROD (cf. split sapb1), quel que soit le badge.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300; // max plan Hobby (Pro : jusqu'à 800)

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // Purge + reconstruction intégrale du miroir SAP → admins uniquement.
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const from = fromParam
    ? new Date(fromParam)
    : (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d; })();
  if (Number.isNaN(from.getTime())) {
    return NextResponse.json({ error: "Paramètre `from` invalide (YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    // 1) Purge du miroir docs (CASCADE → lignes, dont SapPurchaseReturnLine via
    //    SapPurchaseReturn). Ne touche PAS Client/Product.
    //    NB : SapPurchaseReturn (retours/avoirs fournisseurs) est inclus, sans
    //    quoi les Achats NET (= Σ PDN − Σ retours) restent périmés après reset.
    //    ⚠️ Le truncate précède le pull : si un pull échoue ensuite, le miroir
    //    peut rester partiel — relancer le full-reset pour le reconstruire.
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "SapBusinessPartner", "SapInvoice", "SapOrder", "SapCreditNote", "SapPurchaseDeliveryNote", "SapPurchaseReturn" RESTART IDENTITY CASCADE;`,
    );
    // Reset des watermarks incrémentaux (best-effort).
    try {
      await prisma.sapMirrorCursor.update({
        where: { id: 1 },
        data: { lastBpUpdate: null, lastInvoiceUpdate: null, lastOrderUpdate: null, lastPdnUpdate: null, lastCreditNoteUpdate: null, lastPurchaseReturnUpdate: null },
      });
    } catch { /* curseur absent → ignoré */ }

    // 2) BP d'abord (FK des docs), puis propagation des groupes.
    const bps = await pullBusinessPartners({});
    const groups = await syncClientGroupsFromMirror();

    // 3) Docs reconstruits par tranches MENSUELLES, plus récente d'abord.
    //    Indispensable : un `from` d'un an dépasse le plafond de pagination
    //    (10 000 docs/pull) → un pull global en `DocEntry desc` garderait les
    //    récents mais perdrait l'historique ; pire, l'ancienne version (asc)
    //    gardait les 10 000 plus VIEUX et laissait le JOUR COURANT hors miroir
    //    (cause des KPI du jour à 0). Le découpage mensuel évite toute
    //    troncature et fait remonter le récent en premier (cf. pullAllSalesSliced).
    const docs = await pullAllSalesSliced(from, new Date());

    // Purge les agrégats pilotage en cache (TTL 5 min) pour que le cockpit
    // reflète la resync immédiatement, sans attendre l'expiration.
    invalidate("pilotage:");

    return NextResponse.json({
      ok: true,
      company: "GERVIFRAIS (PROD)",
      from: from.toISOString().slice(0, 10),
      monthsSliced: docs.slices,
      businessPartners: bps.upserted,
      clientGroups: groups.updated,
      invoices: docs.invoices,
      creditNotes: docs.creditNotes,
      orders: docs.orders,
      pdns: docs.pdns,
      purchaseReturns: docs.purchaseReturns,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Resync échouée : ${msg}` }, { status: 500 });
  }
}
