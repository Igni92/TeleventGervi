import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { isRhV2Enabled } from "@/lib/rh/flag";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/rh/employees — EMBAUCHE : crée un salarié (et optionnellement son
 * premier contrat). Body : { email, firstName?, lastName?, displayName?, poste?,
 * service?, phone?, hireDate?, sapSlpName?, contract?: {...} }.
 * Réservé direction. Lie au compte User si l'email existe déjà.
 */
export async function POST(req: NextRequest) {
  if (!isRhV2Enabled()) return NextResponse.json({ error: "Module RH V2 désactivé" }, { status: 404 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé à la direction" }, { status: 403 });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) return NextResponse.json({ error: "Email valide requis" }, { status: 400 });

  const exists = await prisma.employee.findUnique({ where: { email }, select: { id: true } });
  if (exists) return NextResponse.json({ error: "Un salarié avec cet email existe déjà." }, { status: 409 });

  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
  const hireDate = b.hireDate ? new Date(String(b.hireDate)) : null;

  const emp = await prisma.$transaction(async (tx) => {
    const e = await tx.employee.create({
      data: {
        email, userId: user?.id ?? null,
        firstName: b.firstName ? String(b.firstName) : null,
        lastName: b.lastName ? String(b.lastName) : null,
        displayName: b.displayName ? String(b.displayName) : ([b.firstName, b.lastName].filter(Boolean).join(" ") || null),
        poste: b.poste ? String(b.poste) : null,
        service: b.service ? String(b.service) : null,
        phone: b.phone ? String(b.phone) : null,
        sapSlpName: b.sapSlpName ? String(b.sapSlpName) : null,
        hireDate: hireDate && !Number.isNaN(hireDate.getTime()) ? hireDate : null,
        statutEmploi: "actif",
      },
    });
    await tx.rhEvent.create({ data: { employeeId: e.id, type: "embauche", date: hireDate ?? new Date(), meta: null } });
    // Contrat initial optionnel.
    const c = b.contract as Record<string, unknown> | undefined;
    if (c && c.type && c.dateDebut) {
      const dd = new Date(String(c.dateDebut));
      const df = c.dateFin ? new Date(String(c.dateFin)) : null;
      const ef = c.essaiFin ? new Date(String(c.essaiFin)) : null;
      if (!Number.isNaN(dd.getTime())) {
        await tx.contract.create({
          data: {
            employeeId: e.id, type: String(c.type), statut: "actif", dateDebut: dd,
            dateFin: df && !Number.isNaN(df.getTime()) ? df : null,
            essaiFin: ef && !Number.isNaN(ef.getTime()) ? ef : null,
            heuresHebdo: typeof c.heuresHebdo === "number" ? c.heuresHebdo : 35,
            heuresAnnuelles: typeof c.heuresAnnuelles === "number" ? c.heuresAnnuelles : 1600,
            saisonLabel: c.saisonLabel ? String(c.saisonLabel) : null,
            motif: c.motif ? String(c.motif) : null,
          },
        });
      }
    }
    return e;
  });

  return NextResponse.json({ ok: true, employee: emp });
}
