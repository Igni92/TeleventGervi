import { NextRequest, NextResponse } from "next/server";
import { sap } from "@/lib/sapb1";
import {
  pullInvoices, pullOrders, pullCreditNotes, pullPdns, pullPurchaseReturns,
} from "@/lib/sapMirror";

/**
 * ⚠️ SONDE TEMPORAIRE — à SUPPRIMER après usage.
 *  - GET ?key=…            : probes SAP (compteurs par plage, facture la + ancienne)
 *  - GET ?key=…&pull=all&from=YYYY-MM-DD&to=YYYY-MM-DD : importe l'historique SAP
 *    (factures/commandes/avoirs/réceptions) vers le miroir, par plage DocDate.
 *    Entités tirées SÉQUENTIELLEMENT (connection_limit=1). Idempotent.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const KEY = "tvd_9f3a7c2e1b4d8a";

function errStr(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 600);
}
async function probe(fn: () => Promise<unknown>): Promise<unknown> {
  try { return { ok: true, result: await fn() }; }
  catch (e) { return { ok: false, error: errStr(e) }; }
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  if (sp.get("key") !== KEY) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // ── Action IMPORT (backfill par plage) ──────────────────────────
  if (sp.get("pull")) {
    const fromS = sp.get("from");
    const toS = sp.get("to");
    if (!fromS) return NextResponse.json({ error: "from requis (YYYY-MM-DD)" }, { status: 400 });
    const from = new Date(fromS);
    const to = toS ? new Date(toS) : undefined;
    if (Number.isNaN(from.getTime()) || (to && Number.isNaN(to.getTime()))) {
      return NextResponse.json({ error: "date invalide" }, { status: 400 });
    }
    const opts = { from, to };
    try {
      // Séquentiel (1 connexion DB) : évite toute contention de pool.
      const inv = await pullInvoices(opts);
      const ord = await pullOrders(opts);
      const cn = await pullCreditNotes(opts);
      const pdn = await pullPdns(opts);
      const pret = await pullPurchaseReturns(opts);
      return NextResponse.json({
        ok: true, from: fromS, to: toS ?? null,
        invoices: inv.pulled, orders: ord.pulled, creditNotes: cn.pulled,
        pdns: pdn.pulled, purchaseReturns: pret.pulled,
      });
    } catch (e) {
      return NextResponse.json({ ok: false, error: errStr(e) }, { status: 500 });
    }
  }

  // ── Probes (lecture seule) ──────────────────────────────────────
  const out: Record<string, unknown> = {};
  out.earliestInvoice = await probe(async () => {
    const r = await sap.get<{ value: { DocEntry: number; DocDate?: string }[] }>(
      "Invoices?$select=DocEntry,DocDate&$orderby=DocDate asc&$top=1", { env: "prod" });
    return r.value;
  });
  out.count2024 = await probe(() =>
    sap.get<string | number>("Invoices/$count?$filter=DocDate ge '2024-01-01' and DocDate le '2024-12-31'", { env: "prod" }));
  out.count2025 = await probe(() =>
    sap.get<string | number>("Invoices/$count?$filter=DocDate ge '2025-01-01' and DocDate le '2025-12-31'", { env: "prod" }));
  return NextResponse.json(out);
}
