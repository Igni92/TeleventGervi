import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

/**
 * PUT /api/commerciaux/prime
 *   Body: { slpName: string, rate?: number, since?: string }
 *
 * Paramètre la PRIME d'un commercial (trigramme) : taux (fraction, 0–1, ex.
 * 0.05 = 5 %) et/ou date de début. Réservé aux admins. La prime réalisée est
 * calculée dans /api/commerciaux/sap (rate × marge brute du portefeuille,
 * factures nettes d'avoirs, depuis `since`). Upsert raw SQL (table hors client
 * Prisma typé — cf. migration additive « commercial_prime »).
 */

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const slpName = typeof body.slpName === "string" ? body.slpName.trim() : "";
  if (!slpName) return NextResponse.json({ error: "slpName requis" }, { status: 400 });

  let rate: number | null = null;
  let since: Date | null = null;

  if (body.rate !== undefined && body.rate !== null) {
    const n = Number(body.rate);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      return NextResponse.json({ error: "rate doit être une fraction entre 0 et 1 (0.05 = 5 %)" }, { status: 400 });
    }
    rate = Math.round(n * 10000) / 10000;
  }
  if (body.since !== undefined && body.since !== null && body.since !== "") {
    const d = new Date(String(body.since));
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "since invalide (date attendue)" }, { status: 400 });
    since = d;
  }

  if (rate === null && since === null) {
    return NextResponse.json({ error: "rate et/ou since requis" }, { status: 400 });
  }

  // INSERT (défauts pour les champs absents) + ON CONFLICT qui ne met à jour QUE
  // les champs fournis (EXCLUDED) → on ne réécrase jamais l'autre champ existant.
  const values: unknown[] = [slpName];
  let rateExpr = "0.05";                                  // défaut si nouveau + non fourni
  let sinceExpr = "TIMESTAMP '2025-11-01 00:00:00'";
  const updates: string[] = [];
  if (rate !== null) { values.push(rate); rateExpr = `$${values.length}`; updates.push(`"rate" = EXCLUDED."rate"`); }
  if (since !== null) { values.push(since); sinceExpr = `$${values.length}`; updates.push(`"since" = EXCLUDED."since"`); }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "CommercialPrime" ("slpName", "rate", "since", "updatedAt")
     VALUES ($1, ${rateExpr}, ${sinceExpr}, NOW())
     ON CONFLICT ("slpName") DO UPDATE SET ${updates.join(", ")}, "updatedAt" = NOW()`,
    ...values,
  );

  return NextResponse.json({ ok: true, slpName, ...(rate !== null ? { rate } : {}), ...(since !== null ? { since: since.toISOString() } : {}) });
}
