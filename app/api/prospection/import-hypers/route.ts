import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import hypers from "@/data/hypers-fr.json";

/**
 * IMPORT des HYPERMARCHÉS de France (data/hypers-fr.json — collecte SIRENE
 * NAF 47.11F, ≥ 50 salariés, cf. scripts/fetch-hypers-fr.mjs). N'ajoute que la
 * PROVINCE (l'IDF est déjà couverte par l'import GMS) au VIVIER (prospectStage
 * NULL). Idempotent (ON CONFLICT (code) DO NOTHING). Réservé direction/admin.
 *
 * POST /api/prospection/import-hypers  → { ok, total, inserted, already }
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Hyper = {
  enseigne: string; enseigneCode: string; enseigneLabel: string;
  ville: string; cp: string; dept: string; adresse: string; siren: string; proba: string;
};

const IDF = new Set(["75", "77", "78", "91", "92", "93", "94", "95"]);
const codeOf = (p: Hyper) =>
  "PRSP" + createHash("md5").update(p.adresse || `${p.enseigne}${p.ville}`).digest("hex").slice(0, 12).toUpperCase();

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la direction / aux administrateurs" }, { status: 403 });
  }

  const seen = new Set<string>();
  const rows: { code: string; nom: string; cp: string; ville: string; proba: string; ens: string }[] = [];
  for (const p of hypers as Hyper[]) {
    if (IDF.has(p.dept)) continue; // IDF déjà couverte
    const code = codeOf(p);
    if (seen.has(code)) continue;
    seen.add(code);
    const label = p.enseigneLabel === "Indépendant / autre" ? (p.enseigne || "Hyper") : p.enseigneLabel;
    rows.push({
      code,
      nom: `${label} · ${p.ville}`.slice(0, 120),
      cp: p.cp || "",
      ville: p.ville || "",
      proba: p.proba || "Moyenne",
      ens: p.enseigneCode || "AUTRE",
    });
  }

  const BATCH = 400;
  let inserted = 0;
  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const values = slice
        .map((_, k) => {
          const b = k * 6;
          return `(gen_random_uuid()::text,$${b + 1},$${b + 2},$${b + 3},$${b + 4},false,NULL,NULL,'import-hyper-fr',$${b + 5},$${b + 6},'Hyper',now(),now())`;
        })
        .join(",");
      const params = slice.flatMap((r) => [r.code, r.nom, r.cp, r.ville, r.proba, r.ens]);
      const n = await prisma.$executeRawUnsafe(
        `INSERT INTO "Client"(id,code,nom,"zipCode",city,"activeTelevente","prospectStage","prospectStageAt","prospectSource","probaLabo","prospectEnseigne","prospectFormat","createdAt","updatedAt")
         VALUES ${values} ON CONFLICT (code) DO NOTHING`,
        ...params,
      );
      inserted += typeof n === "number" ? n : 0;
    }
  } catch (e) {
    console.error("[POST /api/prospection/import-hypers]", e);
    return NextResponse.json({ error: "Erreur d'import" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, total: rows.length, inserted, already: rows.length - inserted });
}
