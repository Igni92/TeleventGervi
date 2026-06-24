import { NextResponse } from "next/server";
import { sap } from "@/lib/sapb1";

// TEMPORAIRE — diagnostic : dump du JSON brut SAP d'un article (tous les champs)
// pour identifier où est stockée la variété. Préversion uniquement (404 en prod),
// protégé par la protection de déploiement Vercel. À supprimer après usage.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const code = new URL(req.url).searchParams.get("code") ?? "FB4KA2D";
  try {
    // Pas de $select → SAP renvoie TOUTES les propriétés de l'article.
    const item = await sap.get<Record<string, unknown>>(`Items('${encodeURIComponent(code)}')`, { env: "prod" });
    // On isole les champs susceptibles de contenir la variété (texte non vide,
    // hors collections), pour repérer "Karima" rapidement.
    const scalars: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item)) {
      if (v == null) continue;
      if (typeof v === "object") continue; // skip collections/objets
      scalars[k] = v;
    }
    // Recherche directe d'une valeur contenant le texte cherché (?find=Karima).
    const find = new URL(req.url).searchParams.get("find");
    const matches = find
      ? Object.entries(scalars).filter(([, v]) => String(v).toLowerCase().includes(find.toLowerCase()))
      : [];
    return NextResponse.json({ code, matches, scalars });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
