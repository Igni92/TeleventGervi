import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getCarrierTariff, setCarrierTariff } from "@/lib/transportCostStore";
import { normCarrier } from "@/lib/transportCost";
import { sanitizeCarrierTariff } from "@/lib/carrierTariff";
import {
  parseTariffMatrix,
  mergeExtraValues,
  matchCarrierCodes,
  type CellMatrix,
} from "@/lib/carrierTariffImport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * IMPORT d'un fichier tarif transporteur (xlsx Delanchy / Antoine) : un simple
 * dépôt du fichier reconstruit la GRILLE PAR POSITION et l'applique aux
 * transporteurs concernés — le coût de transport de TOUS les clients en
 * découle (département × tranche de poids), sans ressaisie.
 *
 * POST /api/transport/tarifs/import  (multipart/form-data, direction/admin)
 *   file : le .xlsx du transporteur
 *   codes: optionnel, JSON array de codes U_TrspCode cibles — sinon
 *          auto-affectation aux transporteurs du catalogue dont le code
 *          contient DELANCHY/FT86 (format Delanchy) ou ANTOINE.
 * → { ok, format, applied, matched, zones, brackets, warnings }
 *
 * Garde-fous : format inconnu ou grille vide → 400, rien n'est écrit. Les
 * lignes en % (majoration gazole, GO/GNR) reprennent la valeur déjà saisie
 * (sinon celle du modèle pré-rempli) — le fichier n'en porte pas.
 */

const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Aplatit une cellule exceljs (richText, formule…) en texte/nombre. */
function flattenCell(v: ExcelJS.CellValue): string | number | null {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return flattenCell(v.result as ExcelJS.CellValue);
    if ("text" in v) return String((v as { text: unknown }).text);
    if ("error" in v) return null;
  }
  return String(v);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la direction / aux administrateurs" }, { status: 403 });
  }

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Requête multipart invalide" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "Fichier trop volumineux (4 Mo max)" }, { status: 400 });
  }

  // Décodage xlsx → matrice de cellules (1re feuille).
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Fichier illisible — attendu un classeur .xlsx" }, { status: 400 });
  }
  const ws = wb.worksheets[0];
  if (!ws) return NextResponse.json({ error: "Classeur vide" }, { status: 400 });
  const matrix: CellMatrix = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row: (string | number | null)[] = [];
    for (let c = 1; c <= ws.columnCount; c++) row.push(flattenCell(ws.getRow(r).getCell(c).value));
    matrix.push(row);
  }

  // Détection + parse (400 explicite si le format n'est pas reconnu).
  let parsed;
  try {
    parsed = parseTariffMatrix(matrix);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  if (parsed.tariff.zones.length === 0 || parsed.tariff.brackets.length === 0) {
    return NextResponse.json({ error: "Aucune zone/tranche exploitable dans le fichier — rien n'a été importé." }, { status: 400 });
  }

  // Codes cibles : fournis, sinon auto-affectation depuis le catalogue local.
  let codes: string[] = [];
  const rawCodes = form.get("codes");
  if (typeof rawCodes === "string" && rawCodes.trim()) {
    try { codes = (JSON.parse(rawCodes) as unknown[]).map((c) => normCarrier(String(c ?? ""))).filter(Boolean); } catch { /* ignoré */ }
  }
  let matched = true;
  if (codes.length === 0) {
    let catalog: string[] = [];
    try {
      const rows = await prisma.$queryRaw<{ sapValue: string | null }[]>(
        Prisma.sql`SELECT "sapValue" FROM "Carrier" WHERE "active" = true`,
      );
      catalog = rows.map((r) => r.sapValue ?? "").filter(Boolean);
    } catch { /* catalogue indisponible → repli repères */ }
    ({ codes, matched } = matchCarrierCodes(parsed.format, catalog));
  }

  // Application : une grille par code cible (les % reprennent l'existant).
  const nowIso = new Date().toISOString();
  const by = session.user.email ?? session.user.name ?? null;
  const applied: string[] = [];
  for (const code of codes) {
    const existing = await getCarrierTariff(code);
    const tariff = sanitizeCarrierTariff({
      ...parsed.tariff,
      carrierCode: code,
      extras: mergeExtraValues(parsed.tariff.extras, existing, code),
      updatedAt: nowIso,
      updatedBy: by,
    });
    await setCarrierTariff(tariff);
    applied.push(code);
  }

  return NextResponse.json({
    ok: true,
    format: parsed.format,
    applied,
    matched,
    zones: parsed.tariff.zones.length,
    brackets: parsed.tariff.brackets.length,
    warnings: parsed.warnings,
  });
}
