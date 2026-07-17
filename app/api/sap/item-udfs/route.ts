import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sap } from "@/lib/sapb1";

/**
 * GET /api/sap/item-udfs
 *
 * Retourne les VALEURS VALIDES (listes déroulantes) définies dans SAP pour les
 * champs utilisateur (UDF) de la table Articles (OITM) — lues depuis les
 * métadonnées `UserFieldsMD`. Sert à contraindre la saisie de la fiche article
 * (calibre, origine/pays, marque) aux valeurs autorisées côté SAP.
 *
 * Repli gracieux : en cas d'erreur SAP, renvoie `fields: {}` (HTTP 200) → la
 * fiche retombe alors sur des champs texte libres.
 */

export const dynamic = "force-dynamic";

interface ValidValue { Value?: string | null; Description?: string | null }
interface UserFieldMD { Name?: string; Description?: string; ValidValuesMD?: ValidValue[] }

// Nom du UDF côté SAP (colonne = U_<Name>) → clé exposée à la fiche article.
const WANTED: Record<string, string> = {
  GER_CALIBRE: "uCalibre",
  Pays: "uPays",
  GER_Marque: "uMarque",
};

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const fields: Record<string, { value: string; label: string }[]> = {};
  try {
    // Tous les UDF de la table Articles ; on filtre les 3 voulus en mémoire
    // (robuste à la casse du nom). ValidValuesMD est une collection → on ne met
    // pas de $select (certaines versions du Service Layer le refusent).
    const rows = await sap.getAll<UserFieldMD>("UserFieldsMD?$filter=TableName eq 'OITM'", { pageSize: 200, maxPages: 20 });
    for (const r of rows) {
      const name = (r.Name || "").trim();
      const key = Object.entries(WANTED).find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1];
      if (!key) continue;
      fields[key] = (r.ValidValuesMD || [])
        .filter((v) => (v.Value ?? "").toString().trim() !== "")
        .map((v) => {
          const value = String(v.Value).trim();
          const desc = (v.Description ?? "").toString().trim();
          return { value, label: desc && desc !== value ? `${value} — ${desc}` : value };
        });
    }
    return NextResponse.json({ ok: true, fields });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e), fields: {} });
  }
}
