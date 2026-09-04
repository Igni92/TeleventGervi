import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { syncHireDate } from "@/lib/rh/hire";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CONTRACT_TYPES = ["CDI", "CDD", "SAISONNIER", "APPRENTISSAGE", "INTERIM", "STAGE", "ADMINISTRATEUR"];
/** Durée indéterminée → jamais de date de fin saisie (seule une fin de contrat la pose). */
const OPEN_ENDED_TYPES = new Set(["CDI", "ADMINISTRATEUR"]);

/** PATCH /api/rh/contracts/[id] — édite un contrat (type, dates, heures, essai,
 *  classification, saison, statut). Direction uniquement. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  if (!isRhV2Enabled()) return NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });
  const { id } = await props.params;

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const data: Record<string, unknown> = {};
  if ("type" in b) {
    if (!CONTRACT_TYPES.includes(String(b.type))) return NextResponse.json({ error: "type invalide" }, { status: 400 });
    data.type = String(b.type);
  }
  if ("statut" in b && ["brouillon", "actif", "termine"].includes(String(b.statut))) data.statut = String(b.statut);
  if ("heuresHebdo" in b && typeof b.heuresHebdo === "number") data.heuresHebdo = b.heuresHebdo;
  if ("heuresAnnuelles" in b && typeof b.heuresAnnuelles === "number") data.heuresAnnuelles = b.heuresAnnuelles;
  if ("classification" in b) data.classification = b.classification ? String(b.classification) : null;
  if ("saisonLabel" in b) data.saisonLabel = b.saisonLabel ? String(b.saisonLabel) : null;
  for (const k of ["dateDebut", "dateFin", "essaiFin"] as const) {
    if (k in b) {
      if (!b[k]) { data[k] = null; continue; }
      const d = new Date(String(b[k]));
      if (Number.isNaN(d.getTime())) return NextResponse.json({ error: `${k} invalide` }, { status: 400 });
      data[k] = d;
    }
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });

  // CDI/ADMIN restant actif → pas de date de fin (sauf clôture par une fin de contrat).
  const current = await prisma.contract.findUnique({ where: { id }, select: { type: true, statut: true } });
  const effType = (data.type as string) ?? current?.type;
  const effStatut = (data.statut as string) ?? current?.statut;
  if (effType && OPEN_ENDED_TYPES.has(effType) && effStatut !== "termine") data.dateFin = null;

  const updated = await prisma.contract.update({ where: { id }, data }).catch(() => null);
  if (!updated) return NextResponse.json({ error: "Contrat introuvable" }, { status: 404 });
  await syncHireDate(updated.employeeId); // entrée = 1er contrat (si la date de début a bougé)
  return NextResponse.json({ ok: true, contract: updated });
}

/** DELETE /api/rh/contracts/[id] — supprime un contrat erroné (correction direction). */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  if (!isRhV2Enabled()) return NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });
  const { id } = await props.params;
  const del = await prisma.contract.delete({ where: { id } }).catch(() => null);
  if (del) await syncHireDate(del.employeeId);
  return NextResponse.json({ ok: true });
}
