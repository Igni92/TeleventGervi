import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { getOrCreateEmployeeByEmail } from "@/lib/rh/db";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** GET /api/rh/documents/[id] — CONTENU d'un document. Accès : direction, ou le
 *  salarié PROPRIÉTAIRE si le document lui est visible (visibleSalarie). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  if (!isRhV2Enabled()) return NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 });
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const { id } = await props.params;
  const doc = await prisma.rhDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const manager = await requireAdmin(session);
  if (!manager) {
    const emp = await getOrCreateEmployeeByEmail(email, session.user?.name);
    if (doc.employeeId !== emp.id || !doc.visibleSalarie) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, nom: doc.nom, mime: doc.mime, contenu: doc.contenu });
}

/** DELETE /api/rh/documents/[id] — direction uniquement. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  if (!isRhV2Enabled()) return NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });
  const { id } = await props.params;
  await prisma.rhDocument.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
