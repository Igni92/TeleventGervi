import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sap } from "@/lib/sapb1";

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
    const filter = `DocumentStatus eq 'bost_Open' and DocDueDate le '${today}'`;
    const res = await sap.get<{ value: { DocEntry: number }[] }>(
      `PurchaseOrders?$select=DocEntry&$top=100&$filter=${encodeURIComponent(filter)}`,
    );
    return NextResponse.json({ count: res.value?.length ?? 0 });
  } catch {
    // Défensif : un SAP indisponible ne doit jamais casser la sidebar.
    return NextResponse.json({ count: 0 });
  }
}
