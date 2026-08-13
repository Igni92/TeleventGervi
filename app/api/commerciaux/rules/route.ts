import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { normalizeSlp } from "@/lib/salespeople";
import { loadCommissionRules, saveCommissionRules } from "@/lib/commissionRules";

/**
 * Règles de commission configurables PAR COMMERCIAL (liste ordonnée « SI … ALORS … »).
 * Stockées en JSON (AppSetting `commrules:<trigramme>`), évaluées en direct par le
 * moteur (cf. lib/commissionRules). Réservé à la DIRECTION et aux ADMINS
 * (`requireAdmin` = admin OU direction) — comme la config prime/objectif.
 *
 *   GET ?slp=MM            → { slpName, rules }
 *   PUT { slpName, rules } → enregistre (liste vide = suppression → règle par défaut)
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });

  const slp = normalizeSlp(req.nextUrl.searchParams.get("slp") ?? "");
  if (!slp) return NextResponse.json({ error: "Commercial requis" }, { status: 400 });
  return NextResponse.json({ ok: true, slpName: slp, rules: await loadCommissionRules(slp) });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const slp = normalizeSlp(typeof body.slpName === "string" ? body.slpName : "");
  if (!slp) return NextResponse.json({ error: "Commercial requis" }, { status: 400 });

  // saveCommissionRules assainit chaque règle (métrique/action valides, taux borné,
  // seuils ≥ 0) ; une liste vide supprime la config → retour à la règle par défaut.
  const rules = await saveCommissionRules(slp, body.rules);
  return NextResponse.json({ ok: true, slpName: slp, rules });
}
