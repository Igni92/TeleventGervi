import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** POST /api/suppliers/bulk — active/archive en masse. Direction/admin uniquement.
 *  Body : { ids: string[], action: "activate" | "archive" }. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });

  let b: { ids?: unknown; action?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string") : [];
  const action = b.action === "activate" ? "activate" : b.action === "archive" ? "archive" : null;
  if (ids.length === 0 || !action) return NextResponse.json({ error: "ids + action requis" }, { status: 400 });

  const res = await prisma.supplier.updateMany({ where: { id: { in: ids } }, data: { active: action === "activate" } });
  return NextResponse.json({ ok: true, count: res.count, active: action === "activate" });
}
