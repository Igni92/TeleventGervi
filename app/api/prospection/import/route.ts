import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import prospects from "@/data/prospects-gms-idf.json";

/**
 * IMPORT des prospects GMS IDF pâtisserie (fichier data/prospects-gms-idf.json,
 * déjà recoupé avec la base SAP → aucun doublon avec l'existant). Crée des fiches
 * Client en étape « À contacter ». Idempotent : ON CONFLICT (code) DO NOTHING —
 * relançable sans créer de doublons. Réservé à la direction / aux admins.
 *
 * POST /api/prospection/import  → { ok, total, inserted, already }
 * Colonnes prospection en SQL brut (hors client Prisma typé).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Prospect = { enseigne: string; type: string; ville: string; cp: string; adresse: string; proba: string };

const codeOf = (p: Prospect) =>
  "PRSP" + createHash("md5").update(p.adresse || `${p.enseigne}${p.ville}`).digest("hex").slice(0, 12).toUpperCase();

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la direction / aux administrateurs" }, { status: 403 });
  }

  // Dédoublonnage par code (adresses identiques éventuelles).
  const seen = new Set<string>();
  const rows: { code: string; nom: string; cp: string; ville: string; proba: string }[] = [];
  for (const p of prospects as Prospect[]) {
    const code = codeOf(p);
    if (seen.has(code)) continue;
    seen.add(code);
    rows.push({
      code,
      nom: `${p.enseigne} · ${p.ville}`.slice(0, 120),
      cp: p.cp || "",
      ville: p.ville || "",
      proba: p.proba || "À qualifier",
    });
  }

  const BATCH = 400;
  let inserted = 0;
  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const values = slice
        .map((_, k) => {
          const b = k * 5;
          return `(gen_random_uuid()::text,$${b + 1},$${b + 2},$${b + 3},$${b + 4},false,'A_CONTACTER',now(),'import-gms-idf-patisserie',$${b + 5},now(),now())`;
        })
        .join(",");
      const params = slice.flatMap((r) => [r.code, r.nom, r.cp, r.ville, r.proba]);
      const n = await prisma.$executeRawUnsafe(
        `INSERT INTO "Client"(id,code,nom,"zipCode",city,"activeTelevente","prospectStage","prospectStageAt","prospectSource","probaLabo","createdAt","updatedAt")
         VALUES ${values} ON CONFLICT (code) DO NOTHING`,
        ...params,
      );
      inserted += typeof n === "number" ? n : 0;
    }
  } catch (e) {
    console.error("[POST /api/prospection/import]", e);
    return NextResponse.json({ error: "Erreur d'import (migration prospection appliquée ?)" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, total: rows.length, inserted, already: rows.length - inserted });
}
