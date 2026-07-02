import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isRestrictedPreparateur } from "@/lib/preparateur";
import { isLivreur } from "@/lib/permissions";
import { getCarrierInfo, setCarrierInfo, sanitizeCarrierInfo } from "@/lib/carrierInfo";

export const dynamic = "force-dynamic";

/**
 * Fiche transporteur (coordonnées) — email + téléphones ajoutables.
 *
 * GET  /api/transporteurs/fiche?code=ANTOINE → { ok, fiche: { email, phones } }
 * POST /api/transporteurs/fiche { code, email, phones: [{ label, value }] }
 *
 * Lecture : tout utilisateur connecté (le bon de transport imprimé affiche les
 * coordonnées). Écriture : réservée aux commerciaux/admins (pas préparateur /
 * livreur). Persistance AppSetting (cf. lib/carrierInfo) — aucune migration.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const code = (req.nextUrl.searchParams.get("code") ?? "").trim();
  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });

  const fiche = await getCarrierInfo(code);
  return NextResponse.json({ ok: true, code, fiche });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const restricted = isRestrictedPreparateur(session.user.email) || (await isLivreur(session));
  if (restricted) return NextResponse.json({ error: "Réservé aux commerciaux / admins" }, { status: 403 });

  let body: { code?: string; email?: unknown; phones?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const code = (body.code ?? "").trim();
  if (!code) return NextResponse.json({ error: "code requis" }, { status: 400 });

  const fiche = sanitizeCarrierInfo(body);
  try {
    await setCarrierInfo(code, fiche);
    return NextResponse.json({ ok: true, code, fiche });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
