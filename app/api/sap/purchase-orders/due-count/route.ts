import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sap } from "@/lib/sapb1";
import { cached } from "@/lib/ttlCache";

/**
 * GET /api/sap/purchase-orders/due-count
 *
 * Nombre de COMMANDES FOURNISSEURS ouvertes dont la date de livraison prévue
 * (DocDueDate) est atteinte (≤ aujourd'hui) → alimente la pastille « à
 * réceptionner » sur la tuile / l'onglet Commandes fournisseurs.
 *
 * Léger : on ne ramène que DocEntry (filtré côté SAP), on compte la longueur.
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ count: 0 }, { status: 200 });

  try {
    const today = new Date().toISOString().slice(0, 10);
    // Pastille de la sidebar : montée sur TOUTES les pages (cf. le badge des
    // offres). Compte GLOBAL → clé unique, datée pour que le passage à minuit
    // n'hérite pas du compte de la veille. TTL = intervalle client (120 s).
    const count = await cached(`sidebar:po-due:${today}`, 120_000, async () => {
      const filter = `DocumentStatus eq 'bost_Open' and DocDueDate le '${today}'`;
      const res = await sap.get<{ value: { DocEntry: number }[] }>(
        `PurchaseOrders?$select=DocEntry&$top=100&$filter=${encodeURIComponent(filter)}`,
      );
      return res.value?.length ?? 0;
    });
    return NextResponse.json({ count });
  } catch {
    // Défensif : un SAP indisponible ne doit jamais casser la sidebar.
    return NextResponse.json({ count: 0 });
  }
}
