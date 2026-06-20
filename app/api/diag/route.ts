import { NextRequest, NextResponse } from "next/server";
import { sap } from "@/lib/sapb1";

/**
 * ⚠️ SONDE TEMPORAIRE — à SUPPRIMER après usage.
 * Vérifie l'appel SAP du backfill : SAP renvoie-t-il du 2024 / début 2025 avec
 * le filtre DocDate utilisé ? Et quelle est la facture la PLUS ANCIENNE de SAP
 * (si SAP n'a pas de 2024, l'import ne peut rien ramener). Protégée par clé.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KEY = "tvd_9f3a7c2e1b4d8a";

function errStr(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 600);
}
async function probe(fn: () => Promise<unknown>): Promise<unknown> {
  try { return { ok: true, result: await fn() }; }
  catch (e) { return { ok: false, error: errStr(e) }; }
}

export async function GET(req: NextRequest) {
  if (new URL(req.url).searchParams.get("key") !== KEY) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const out: Record<string, unknown> = {};

  // 1) Facture la PLUS ANCIENNE de SAP (sans filtre) — borne de l'historique dispo.
  out.earliestInvoice = await probe(async () => {
    const r = await sap.get<{ value: { DocEntry: number; DocDate?: string }[] }>(
      "Invoices?$select=DocEntry,DocDate&$orderby=DocDate asc&$top=1",
      { env: "prod" },
    );
    return r.value;
  });

  // 2) Compteurs par plage (le /$count est-il supporté ? + combien de docs ?)
  out.count2024 = await probe(() =>
    sap.get<string | number>(
      "Invoices/$count?$filter=DocDate ge '2024-01-01' and DocDate le '2024-12-31'",
      { env: "prod" },
    ));
  out.count2025 = await probe(() =>
    sap.get<string | number>(
      "Invoices/$count?$filter=DocDate ge '2025-01-01' and DocDate le '2025-12-31'",
      { env: "prod" },
    ));
  out.count2025H1 = await probe(() =>
    sap.get<string | number>(
      "Invoices/$count?$filter=DocDate ge '2025-01-01' and DocDate le '2025-05-31'",
      { env: "prod" },
    ));

  // 3) Échantillon 2024 (sélection légère) — la plage renvoie-t-elle des lignes ?
  out.sample2024 = await probe(async () => {
    const r = await sap.get<{ value: { DocEntry: number; DocNum?: number; DocDate?: string }[] }>(
      "Invoices?$select=DocEntry,DocNum,DocDate&$filter=DocDate ge '2024-01-01' and DocDate le '2024-12-31'&$orderby=DocDate asc&$top=3",
      { env: "prod" },
    );
    return { n: r.value.length, rows: r.value };
  });

  // 4) Requête EXACTE du backfill (avec DocumentLines + orderby DocEntry) sur un top court.
  out.backfillStyle2024 = await probe(async () => {
    const r = await sap.get<{ value: { DocEntry: number; DocDate?: string }[] }>(
      "Invoices?$select=DocEntry,DocNum,DocDate,CardCode,CardName,SalesPersonCode,DocTotal,VatSum,Cancelled,UpdateDate,DocumentLines"
        + "&$filter=DocDate ge '2024-01-01' and DocDate le '2024-12-31'&$orderby=DocEntry asc&$top=2",
      { env: "prod" },
    );
    return { n: r.value.length, firstDocEntry: r.value[0]?.DocEntry, firstDocDate: r.value[0]?.DocDate };
  });

  return NextResponse.json(out);
}
