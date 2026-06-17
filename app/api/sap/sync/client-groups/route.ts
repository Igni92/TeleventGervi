import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { syncClientGroupsFromMirror } from "@/lib/sapMirror";

/**
 * POST /api/sap/sync/client-groups
 *
 * Propage SapBusinessPartner.groupCode/groupName (cardType='C') vers
 * Client.sapGroupCode/sapGroupName, par match cardCode = Client.code.
 * Idempotent (IS DISTINCT FROM). Pré-requis de l'analyse "familles vs
 * groupe" sur la fiche client.
 *
 * Le tick miroir (/api/sap/sync/mirror) appelle déjà cette propagation
 * automatiquement. Cet endpoint sert à forcer un refresh sans tirer
 * Invoices/Orders/PDN — utile quand on veut juste appliquer les groupes
 * déjà présents dans le miroir local.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }

  try {
    const r = await syncClientGroupsFromMirror();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[sync/client-groups]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
