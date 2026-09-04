import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { isBadgeuseEnabled, setBadgeuseEnabled } from "@/lib/rh/settings";

export const dynamic = "force-dynamic";

/** GET /api/rh/settings — réglages RH globaux (badgeuse). */
export async function GET() {
  if (!isRhV2Enabled()) return NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  return NextResponse.json({ ok: true, badgeuseEnabled: await isBadgeuseEnabled() });
}

/** POST /api/rh/settings — { badgeuseEnabled } (direction). */
export async function POST(req: NextRequest) {
  if (!isRhV2Enabled()) return NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  if (typeof b.badgeuseEnabled !== "boolean") return NextResponse.json({ error: "badgeuseEnabled requis" }, { status: 400 });
  await setBadgeuseEnabled(b.badgeuseEnabled);
  return NextResponse.json({ ok: true, badgeuseEnabled: b.badgeuseEnabled });
}
