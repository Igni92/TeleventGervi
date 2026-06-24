import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { sap } from "@/lib/sapb1";

/**
 * DIAGNOSTIC (admin, LECTURE SEULE) — modèle transporteur / tournée / BL.
 *
 *   GET /api/sap/_diag/transport?docNum=24011722,24011726  (ou ?card=APLAI)
 *
 * Tourne LÀ où SAP est joignable (prod Vercel). Révèle, sans rien écrire :
 *   - tous les champs U_* de BL réels (valeurs réelles de U_TrspCode /
 *     U_TrspHeure / U_Timbre) ;
 *   - les lignes SERG_TRCL des clients concernés (transporteur, tournée
 *     U_DistBy, heure U_Heure, défaut U_TrspDef='O'), via le chemin qui répond ;
 *   - une corrélation pour déduire la règle de remplissage.
 *
 * À retirer une fois le câblage U_TrspHeure/U_Timbre figé.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const uFields = (o: Record<string, unknown> | null | undefined) =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => k.startsWith("U_")));

/** Lit les lignes SERG_TRCL d'un client en essayant les chemins SL connus. */
async function readTrcl(cardCode: string): Promise<{ path: string | null; rows: Record<string, unknown>[] | null; error?: string }> {
  const filt = `$filter=${encodeURIComponent(`U_CardCode eq '${cardCode.replace(/'/g, "''")}'`)}`;
  for (const base of ["U_SERG_TRCL", "SERG_TRCL"]) {
    try {
      const rows = await sap.getAll<Record<string, unknown>>(`${base}?${filt}`, { env: "prod", pageSize: 100, maxPages: 3 });
      return { path: base, rows };
    } catch { /* essai suivant */ }
  }
  // UDO éventuel
  try {
    const udos = await sap.get<{ value?: { Code: string }[] }>(
      `UserObjectsMD?$filter=${encodeURIComponent("TableName eq 'SERG_TRCL'")}`, { env: "prod" },
    );
    for (const u of udos.value ?? []) {
      try {
        const rows = await sap.getAll<Record<string, unknown>>(`${encodeURIComponent(u.Code)}?${filt}`, { env: "prod", pageSize: 100, maxPages: 3 });
        return { path: `UDO:${u.Code}`, rows };
      } catch { /* suivant */ }
    }
  } catch { /* pas d'UDO lisible */ }
  return { path: null, rows: null, error: "SERG_TRCL non lisible via Service Layer (U_SERG_TRCL / SERG_TRCL / UDO)" };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const docNums = (sp.get("docNum") ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
  const card = sp.get("card");

  try {
    // 1. BL cibles (par DocNum, sinon 6 récents, éventuellement filtrés client)
    type Ord = Record<string, unknown> & { DocNum: number; DocEntry: number; CardCode: string; CardName?: string; U_TrspCode?: string };
    let orders: Ord[] = [];
    if (docNums.length) {
      for (const dn of docNums) {
        const r = await sap.getAll<Ord>(`Orders?$filter=${encodeURIComponent(`DocNum eq ${dn}`)}`, { maxPages: 1 });
        if (r[0]) orders.push(r[0]);
      }
    } else {
      const cf = card ? `CardCode eq '${card.replace(/'/g, "''")}' and ` : "";
      orders = await sap.getAll<Ord>(
        `Orders?$filter=${encodeURIComponent(`${cf}Cancelled eq 'tNO'`)}&$orderby=DocEntry desc&$top=6`,
        { maxPages: 1, pageSize: 6 },
      );
    }

    const bls = orders.map((o) => ({
      docNum: o.DocNum, docEntry: o.DocEntry, cardCode: o.CardCode, cardName: o.CardName,
      uFields: uFields(o),
    }));

    // 2. SERG_TRCL par client
    const cards = [...new Set(orders.map((o) => o.CardCode).filter(Boolean))];
    if (card && !cards.includes(card)) cards.push(card);
    const trcl: Record<string, unknown> = {};
    for (const cc of cards) {
      const { path, rows, error } = await readTrcl(cc);
      trcl[cc] = {
        path, error,
        count: rows?.length ?? null,
        rows: (rows ?? []).map((r) => ({
          U_TrspCode: r.U_TrspCode, U_DistBy: r.U_DistBy, U_Heure: r.U_Heure,
          U_DesTransp: r.U_DesTransp, U_TrspDef: r.U_TrspDef, allU: uFields(r),
        })),
      };
    }

    // 3. Corrélation BL ⇄ SERG_TRCL
    const correlation = orders.map((o) => {
      const rows = (trcl[o.CardCode] as { rows?: { U_TrspCode?: unknown; U_Heure?: unknown; U_DistBy?: unknown; U_TrspDef?: unknown }[] })?.rows ?? [];
      const match = rows.find((r) => String(r.U_TrspCode ?? "").trim() === String(o.U_TrspCode ?? "").trim());
      const def = rows.find((r) => String(r.U_TrspDef ?? "").trim().toUpperCase() === "O");
      return {
        docNum: o.DocNum, cardCode: o.CardCode,
        bl: { U_TrspCode: o.U_TrspCode, U_TrspHeure: (o as Record<string, unknown>).U_TrspHeure, U_Timbre: (o as Record<string, unknown>).U_Timbre },
        trclMatch: match ? { U_Heure: match.U_Heure, U_DistBy: match.U_DistBy } : null,
        trclDefault: def ? { U_TrspCode: def.U_TrspCode, U_Heure: def.U_Heure, U_DistBy: def.U_DistBy } : null,
      };
    });

    return NextResponse.json({
      ok: true,
      db: process.env.SAP_B1_COMPANY_DB,
      hint: "U_TrspHeure ≟ trclMatch.U_Heure ; U_Timbre ≟ ? (repère un champ allU côté SERG_TRCL, ou règle métier).",
      bls, trcl, correlation,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
