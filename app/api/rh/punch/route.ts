import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { getOrCreateEmployeeByEmail, addPunch, getTodayClock } from "@/lib/rh/db";
import { isBadgeuseEnabled } from "@/lib/rh/settings";

export const dynamic = "force-dynamic";

/**
 * POST /api/rh/punch — BADGEUSE : enregistre une arrivée/un départ géolocalisé
 * pour le salarié connecté. Body : { kind: "in"|"out", lat, lng, accuracyM? }.
 * La géolocalisation est OBLIGATOIRE (choix métier). Anti-doublon : deux pointages
 * du même sens à < 60 s sont refusés.
 */
export async function POST(req: NextRequest) {
  if (!isRhV2Enabled()) return NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 });
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await isBadgeuseEnabled())) {
    return NextResponse.json({ error: "Badgeuse désactivée — présence gérée selon les horaires du contrat." }, { status: 409 });
  }

  let b: { kind?: string; lat?: number; lng?: number; accuracyM?: number };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const kind = b.kind === "out" ? "out" : b.kind === "in" ? "in" : null;
  if (!kind) return NextResponse.json({ error: "kind requis (in|out)" }, { status: 400 });
  if (typeof b.lat !== "number" || typeof b.lng !== "number") {
    return NextResponse.json({ error: "Géolocalisation requise pour badger." }, { status: 400 });
  }

  const emp = await getOrCreateEmployeeByEmail(email, session.user?.name);
  const now = new Date();
  const today = await getTodayClock(emp.id, now);
  // Cohérence : refuse deux « in » ou deux « out » d'affilée, et le doublon rapide.
  if ((kind === "in" && today.inside) || (kind === "out" && !today.inside && today.punches.length > 0)) {
    return NextResponse.json({ error: kind === "in" ? "Déjà pointé en arrivée." : "Déjà pointé en départ." }, { status: 409 });
  }
  const res = await addPunch(emp.id, kind, { lat: b.lat, lng: b.lng, accuracyM: b.accuracyM }, now);
  return NextResponse.json({ ok: true, ...res });
}
