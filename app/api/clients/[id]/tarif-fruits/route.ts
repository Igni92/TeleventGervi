import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sanitizeTarifFruitRows, type TarifFruitRow } from "@/lib/tarifFruits";

export const dynamic = "force-dynamic";

/**
 * TARIF PAR FRUITS d'un client — prix négociés au niveau DÉSIGNATION (famille +
 * origine + calibre + variété), pas par code article. Édité dans la fiche client
 * ET la console ; appliqué à la création (le prix descend de la ligne la plus
 * précise qui matche l'article choisi).
 *
 *   GET  /api/clients/[id]/tarif-fruits  → { ok, rows: TarifFruitRow[] }
 *   PUT  /api/clients/[id]/tarif-fruits  → { rows } (remplacement complet)
 *
 * Persistance : AppSetting `tariffruit:<clientId>` (JSON) — même mécanique que
 * `tarifclient:` (tarif par SKU) et les autres réglages métier.
 */

const keyOf = (clientId: string) => `tariffruit:${clientId}`;

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id))) {
    return NextResponse.json({ error: "Client hors de votre périmètre" }, { status: 403 });
  }
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: keyOf(params.id) } });
    const parsed: TarifFruitRow[] = row ? sanitizeTarifFruitRows(JSON.parse(row.value)) : [];
    return NextResponse.json({ ok: true, rows: parsed });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id))) {
    return NextResponse.json({ error: "Client hors de votre périmètre" }, { status: 403 });
  }
  let body: { rows?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const rows = sanitizeTarifFruitRows(body.rows);
  try {
    const key = keyOf(params.id);
    if (rows.length === 0) {
      await prisma.appSetting.deleteMany({ where: { key } });
    } else {
      const value = JSON.stringify(rows);
      await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
