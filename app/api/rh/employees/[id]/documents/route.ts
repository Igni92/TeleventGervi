import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DOC_TYPES = ["contrat", "bulletin", "attestation", "justificatif", "autre"];
const MAX_BYTES = 8 * 1024 * 1024; // 8 Mo (base64 ≈ +33 %)

async function guard() {
  if (!isRhV2Enabled()) return { err: NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 }) };
  const session = await auth();
  if (!session?.user) return { err: NextResponse.json({ error: "Non autorisé" }, { status: 401 }) };
  if (!(await requireAdmin(session))) return { err: NextResponse.json({ error: "Réservé à la direction" }, { status: 403 }) };
  return { session };
}

/** GET /api/rh/employees/[id]/documents — liste (métadonnées, sans le contenu). */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const g = await guard(); if (g.err) return g.err;
  const { id } = await props.params;
  const docs = await prisma.rhDocument.findMany({
    where: { employeeId: id },
    select: { id: true, type: true, nom: true, mime: true, visibleSalarie: true, createdAt: true, uploadedBy: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ ok: true, documents: docs, types: DOC_TYPES });
}

/** POST /api/rh/employees/[id]/documents — dépose un document (base64 data-URL). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const g = await guard(); if (g.err) return g.err;
  const { id } = await props.params;
  const email = g.session.user?.email ?? null;
  const emp = await prisma.employee.findUnique({ where: { id }, select: { id: true } });
  if (!emp) return NextResponse.json({ error: "Salarié introuvable" }, { status: 404 });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const type = DOC_TYPES.includes(String(b.type)) ? String(b.type) : "autre";
  const nom = String(b.nom ?? "").trim();
  const contenu = String(b.contenu ?? "");
  if (!nom) return NextResponse.json({ error: "Nom requis" }, { status: 400 });
  if (!contenu.startsWith("data:")) return NextResponse.json({ error: "Fichier invalide" }, { status: 400 });
  if (contenu.length > MAX_BYTES) return NextResponse.json({ error: "Fichier trop lourd (max 8 Mo)" }, { status: 413 });

  const doc = await prisma.rhDocument.create({
    data: { employeeId: id, type, nom, mime: b.mime ? String(b.mime) : null, contenu, visibleSalarie: b.visibleSalarie !== false, uploadedBy: email },
    select: { id: true, type: true, nom: true, visibleSalarie: true, createdAt: true },
  });
  await prisma.rhEvent.create({ data: { employeeId: id, type: "note", date: new Date(), createdBy: email, meta: JSON.stringify({ text: `Document ajouté : ${nom}` }) } });
  return NextResponse.json({ ok: true, document: doc });
}
