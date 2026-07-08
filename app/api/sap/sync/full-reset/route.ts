import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  pullBusinessPartners,
  pullAllSalesSliced,
  syncClientGroupsFromMirror,
} from "@/lib/sapMirror";
import { annualWindowStart } from "@/lib/pilotage-time";
import { invalidate } from "@/lib/ttlCache";

/**
 * POST /api/sap/sync/full-reset?from=YYYY-MM-DD
 *
 * Actualisation GLOBALE et PROPRE depuis la base réelle (PROD) :
 *   1. VIDE les tables miroir docs (BP, factures, avoirs, commandes, PDN + lignes).
 *   2. Re-pull intégral depuis SAP PROD : BP → groupes → factures + avoirs +
 *      commandes + PDN (sur `from`, défaut = 1er janvier de N-2 = borne basse du
 *      rapport annuel 3 ans, cf. annualWindowStart ; `?from=` reste prioritaire).
 *
 * Élimine les données périmées/aberrantes (ex. factures test datées dans le futur).
 * Le stock/catalogue est rafraîchi à part via /api/sap/sync/products.
 *
 * ⚠️ Long (le défaut couvre ~3 ans → plusieurs dizaines de tranches mensuelles).
 * Le pull est découpé par mois, plus récent d'abord (pullAllSalesSliced) : un
 * éventuel timeout laisse au moins l'année courante et N-1 en base. Sur
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
  // Défaut = 1er janvier de N-2 (borne basse du rapport annuel, cf.
  // annualWindowStart) et NON plus « today − 1 an » : sinon la matrice 3 ans
  // (N-2, N-1, N) affiche des colonnes vides faute de docs importés (2024 et
  // début 2025 manquaient). `?from=YYYY-MM-DD` reste prioritaire pour un
  // historique plus profond.
  const from = fromParam ? new Date(fromParam) : annualWindowStart();
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

    // 4) Repose les watermarks (max UpdateDate vu) — SINON le curseur reste NEUF
    //    (tous nuls, cf. étape 1) et le prochain tick /sync/mirror le prendrait
    //    pour un miroir jamais seedé → il relancerait un bootstrap 3 ans complet
    //    à chaque passage au lieu de basculer en incrémental. On reseed donc le
    //    curseur comme le fait /sync/backfill.
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
