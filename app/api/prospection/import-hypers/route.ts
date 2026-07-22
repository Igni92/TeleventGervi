import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import hypers from "@/data/hypers-fr.json";

/**
 * IMPORT des HYPERMARCHÉS de France (data/hypers-fr.json — collecte SIRENE
 * NAF 47.11F, ≥50 salariés, cf. scripts/fetch-hypers-fr.mjs).
 *
 * Règles (demande direction) :
 *  • CODES façon SAP : lettre enseigne + ville (A=Auchan, C=Carrefour, L=Leclerc,
 *    ITM=Intermarché, U=U, CORA, G=Géant). Ex. Auchan Douai → « ADOUAI ».
 *  • VÉRIFICATION anti-doublon AVANT insertion : on n'ajoute pas un magasin déjà
 *    présent en base (même enseigne + même ville, tolérant aux variantes de
 *    libellé/CP entre SAP et SIRENE).
 *  • Province uniquement (IDF déjà couverte), enseignes identifiées uniquement
 *    (les indépendants « AUTRE » et les fiches sans ville sont ignorés).
 *
 * POST /api/prospection/import-hypers → { ok, candidats, inserted, deja }
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Hyper = {
  enseigne: string; enseigneCode: string; enseigneLabel: string;
  ville: string; cp: string; dept: string; adresse: string; siren: string; proba: string;
};

const IDF = new Set(["75", "77", "78", "91", "92", "93", "94", "95"]);
// Enseigne → préfixe de code SAP (convention direction). Carrefour = K (C est
// pris par Cora). `null` = enseigne non gérée (ignorée).
const LETTER: Record<string, string> = { A: "A", CARR: "K", L: "L", ITM: "ITM", U: "U", CORA: "CORA", CASINO: "G" };
const MULTI = new Set(["ITM", "CORA"]); // préfixes multi-lettres (code avec espace)

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const cityNorm = (c: string | null) => strip((c || "").toUpperCase()).replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["SUR", "LES", "LEZ", "DE", "DU", "LA", "LE", "SOUS", "EN", "AUX", "ET", "SAINT", "ST", "STE", "CEDEX"]);
const cityCore = (c: string | null) => {
  const words = cityNorm(c).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
  return words.sort((a, b) => b.length - a.length)[0] || cityNorm(c);
};

/** Enseigne d'un client existant, déduite de son nom (convention SAP). */
function bannerOfExisting(nom: string | null): string | null {
  const s = (nom || "").toUpperCase().replace(/^[*\s]+/, "");
  if (s.startsWith("ITM") || s.includes("INTERMARCHE")) return "ITM";
  if (s.startsWith("CORA")) return "CORA";
  if (/^U[\s.]/.test(s)) return "U";
  if (/^A[\s.]/.test(s) || s.includes("AUCHAN")) return "A";
  if (/^K[\s.]/.test(s) || s.includes("CARREFOUR")) return "K"; // Carrefour = K
  if (/^L[\s.]/.test(s) || s.includes("LECLERC")) return "L";
  if (/^G[\s.]/.test(s) || s.includes("GEANT")) return "G";
  return null;
}

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la direction / aux administrateurs" }, { status: 403 });
  }

  // ── Index de l'existant (clients + prospects déjà en base, hors ce même import).
  const existing = await prisma.$queryRawUnsafe<{ code: string; nom: string | null; city: string | null; zipCode: string | null }[]>(
    `SELECT "code","nom","city","zipCode" FROM "Client" WHERE "prospectSource" IS DISTINCT FROM 'import-hyper-fr'`,
  );
  const cp5 = (z: string | null) => (z || "").replace(/\D/g, "").slice(0, 5);
  const usedCodes = new Set(existing.map((e) => e.code.toUpperCase()));
  // Par enseigne : liste des { cœur de ville, ville normalisée, CP } déjà présents.
  const byBanner = new Map<string, { norm: string; core: string; cp: string }[]>();
  for (const e of existing) {
    const b = bannerOfExisting(e.nom);
    if (!b) continue;
    if (!byBanner.has(b)) byBanner.set(b, []);
    byBanner.get(b)!.push({ norm: cityNorm(e.city), core: cityCore(e.city), cp: cp5(e.zipCode) });
  }
  // Rapprochement AGRESSIF : même enseigne ET (même CP OU rapprochement de ville).
  // Le CP rattrape les magasins renommés (ex. Auchan Val d'Europe = Marne-la-Vallée = Serris 77700).
  const alreadyInBase = (letter: string, ville: string, cp: string) => {
    const list = byBanner.get(letter);
    if (!list) return false;
    const iNorm = cityNorm(ville), iCore = cityCore(ville);
    return list.some((x) =>
      (cp && x.cp && cp === x.cp) ||
      (x.core && iCore && (x.norm.includes(iCore) || iNorm.includes(x.core))));
  };

  // ── Sélection des candidats (province, enseigne gérée, ville renseignée, non doublon).
  const batchCodes = new Set<string>();
  const rows: { code: string; nom: string; cp: string; ville: string; proba: string; ens: string }[] = [];
  let deja = 0;
  for (const p of hypers as Hyper[]) {
    if (IDF.has(p.dept)) continue;
    const letter = LETTER[p.enseigneCode];
    if (!letter) continue;                       // enseigne non gérée (AUTRE…)
    if (!p.ville || !p.ville.trim()) continue;   // pas de ville → ignoré
    if (alreadyInBase(letter, p.ville, cp5(p.cp))) { deja++; continue; }

    // Code façon SAP : lettre + VILLE (unique, on suffixe si collision).
    const villeCode = cityNorm(p.ville).replace(/ /g, "").slice(0, 11);
    let code = MULTI.has(letter) ? `${letter} ${villeCode}` : `${letter}${villeCode}`;
    code = code.slice(0, 15);
    let base = code, k = 1;
    while (usedCodes.has(code.toUpperCase()) || batchCodes.has(code.toUpperCase())) code = `${base}${++k}`.slice(0, 15);
    batchCodes.add(code.toUpperCase());

    rows.push({
      code,
      nom: `${p.enseigneLabel} · ${p.ville}`.slice(0, 120),
      cp: p.cp || "", ville: p.ville, proba: p.proba || "Moyenne", ens: p.enseigneCode,
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

  return NextResponse.json({ ok: true, candidats: rows.length, inserted, deja });
}
