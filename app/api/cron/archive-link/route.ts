import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { resolveInvoiceEntries } from "@/lib/archive/dossier";

/**
 * Chaînage des documents archivés (BL → Facture → Avoir) : pré-calcule le pivot
 * de dossier (invoiceEntry) sur les documents qui ne l'ont pas encore, pour que
 * « dossier lié » reste un lookup LOCAL instantané. Boucle par lots de clients
 * jusqu'à épuisement (borné). Best-effort ; ne casse jamais.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let resolved = 0, remaining = -1, rounds = 0;
  try {
    while (rounds++ < 8) {
      const r = await resolveInvoiceEntries(40);
      resolved += r.resolved;
      remaining = r.remaining;
      if (r.resolved === 0) break;
    }
    return NextResponse.json({ ok: true, resolved, remaining, rounds });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), resolved, remaining }, { status: 500 });
  }
}
