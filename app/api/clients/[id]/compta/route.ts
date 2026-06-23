import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * GET / PATCH /api/clients/[id]/compta
 *
 * Champs comptabilité de la fiche client (B6) :
 *   - emailCompta        : email distinct de l'email commercial (factures/relances)
 *   - adresseFacturation : texte libre multi-ligne (distinct de l'adresse livraison SAP)
 *
 * Implémenté en **raw SQL** pour ne pas dépendre d'un `prisma generate`
 * fraîchement régénéré (le dev server peut tenir le DLL Windows — cf. CLAUDE.md).
 * Le schéma est déjà à jour côté DB (`prisma db push` passé).
 */

type ComptaRow = {
  emailCompta: string | null;
  emailReception: string | null;
  adresseFacturation: string | null;
};

async function readCompta(clientId: string): Promise<ComptaRow | null> {
  const rows = await prisma.$queryRaw<ComptaRow[]>(Prisma.sql`
    SELECT "emailCompta", "emailReception", "adresseFacturation"
    FROM "Client"
    WHERE "id" = ${clientId}
    LIMIT 1;
  `);
  return rows[0] ?? null;
}

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  const row = await readCompta(params.id);
  if (!row) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  return NextResponse.json({ ok: true, ...row });
}

const PatchSchema = z.object({
  emailCompta: z.string().trim().email("Email invalide").or(z.literal("")).nullable().optional(),
  emailReception: z.string().trim().email("Email invalide").or(z.literal("")).nullable().optional(),
  adresseFacturation: z.string().trim().max(2000, "Trop long").nullable().optional(),
});

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }

  // Mise à jour PARTIELLE : on ne touche QUE les champs présents dans le body.
  // (La fiche édite désormais l'email réception dans la section Logistique, séparément
  //  de l'email compta / l'adresse de facturation — il ne faut pas s'écraser mutuellement.)
  const norm = (v: string | null | undefined) => (v === "" ? null : v ?? null);
  const sets: Prisma.Sql[] = [];
  if (parsed.data.emailCompta !== undefined) sets.push(Prisma.sql`"emailCompta" = ${norm(parsed.data.emailCompta)}`);
  if (parsed.data.emailReception !== undefined) sets.push(Prisma.sql`"emailReception" = ${norm(parsed.data.emailReception)}`);
  if (parsed.data.adresseFacturation !== undefined) sets.push(Prisma.sql`"adresseFacturation" = ${norm(parsed.data.adresseFacturation)}`);

  if (sets.length > 0) {
    const result = await prisma.$executeRaw(Prisma.sql`
      UPDATE "Client" SET ${Prisma.join(sets, ", ")}, "updatedAt" = NOW()
      WHERE "id" = ${params.id};
    `);
    if (result === 0) {
      return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
    }
  }

  const row = await readCompta(params.id);
  return NextResponse.json({ ok: true, ...row });
}
