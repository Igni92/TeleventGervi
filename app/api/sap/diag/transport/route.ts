import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { sap } from "@/lib/sapb1";

/**
 * DIAGNOSTIC (admin, LECTURE SEULE) — modèle transporteur / tournée / BL.
 *
 *   GET /api/sap/diag/transport?docNum=24011722,24011726  (ou ?card=APLAI)
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
  const scan = sp.get("scan");

  // Mode SCAN : agrège l'historique récent PAR transporteur (U_TrspCode) →
  // valeurs U_TrspHeur / U_Timbre observées. Révèle la config par transporteur.
  if (scan !== null) {
    try {
      const top = Math.min(Math.max(parseInt(scan || "300", 10) || 300, 50), 1500);
      const rows = await sap.getAll<{ U_TrspCode?: string; U_TrspHeur?: string; U_Timbre?: number }>(
        `Orders?$select=DocEntry,U_TrspCode,U_TrspHeur,U_Timbre&$filter=${encodeURIComponent("Cancelled eq 'tNO'")}&$orderby=DocEntry desc&$top=${top}`,
        { pageSize: 200, maxPages: Math.ceil(top / 200) },
      );
      const byCode: Record<string, { count: number; heures: Record<string, number>; timbres: Record<string, number> }> = {};
      for (const r of rows) {
        const code = (r.U_TrspCode ?? "").toString().trim() || "(vide)";
        const e = (byCode[code] ??= { count: 0, heures: {}, timbres: {} });
        e.count++;
        const h = (r.U_TrspHeur ?? "").toString().trim() || "(vide)";
        e.heures[h] = (e.heures[h] ?? 0) + 1;
        const t = r.U_Timbre == null ? "(null)" : String(r.U_Timbre);
        e.timbres[t] = (e.timbres[t] ?? 0) + 1;
      }
      const perCarrier = Object.entries(byCode)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([code, v]) => ({
          U_TrspCode: code, commandes: v.count,
          U_TrspHeur: Object.entries(v.heures).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`),
          U_Timbre: Object.entries(v.timbres).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`),
        }));
      return NextResponse.json({ ok: true, mode: "scan", scanned: rows.length, perCarrier });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  // Mode ENTITIES : découvre ce que le Service Layer expose et qui matche
  // TRCL/SERG (service document + $metadata), puis teste-lit chaque candidat.
  // Sert à VÉRIFIER que SERG_TRCL a bien été exposée (et sous quel nom).
  if (sp.get("entities") !== null) {
    const terms = (sp.get("entities") || "TRCL,SERG").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const hit = (name: string) => terms.some((t) => name.toUpperCase().includes(t));
    const found = new Set<string>(["U_SERG_TRCL", "SERG_TRCL"]);
    const discovery: Record<string, unknown> = {};

    // a) Service document (liste des entity sets, en JSON)
    try {
      const root = await sap.get<{ value?: { name?: string; url?: string }[] }>("", { env: "prod" });
      const names = (root.value ?? []).map((e) => e.name || e.url || "").filter(Boolean);
      discovery.serviceDocMatches = names.filter(hit);
      names.filter(hit).forEach((n) => found.add(n));
    } catch (e) { discovery.serviceDocError = e instanceof Error ? e.message : String(e); }

    // b) $metadata (XML brut) — repère EntityType/EntitySet Name="…"
    try {
      const meta = await sap.get<string>("$metadata", { env: "prod" });
      const xml = typeof meta === "string" ? meta : JSON.stringify(meta);
      const names = [...xml.matchAll(/Name="([^"]+)"/g)].map((m) => m[1]);
      const matches = [...new Set(names.filter(hit))];
      discovery.metadataMatches = matches;
      matches.forEach((n) => found.add(n));
    } catch (e) { discovery.metadataError = e instanceof Error ? e.message : String(e); }

    // c) test-lecture de chaque candidat
    const probes = await Promise.all([...found].map(async (name) => {
      try {
        const rows = await sap.getAll<Record<string, unknown>>(`${encodeURIComponent(name)}?$top=2`, { env: "prod", maxPages: 1, pageSize: 2 });
        return { name, ok: true, sample: rows.length, columns: Object.keys(rows[0] ?? {}) };
      } catch (e) {
        return { name, ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
      }
    }));

    const readable = probes.filter((p) => p.ok);
    return NextResponse.json({
      ok: true, mode: "entities",
      SERG_TRCL_accessible: readable.length > 0,
      verdict: readable.length
        ? `✅ Exposée et lisible via : ${readable.map((p) => p.name).join(", ")}`
        : "❌ Toujours pas lisible (aucun candidat ne répond) — l'intégrateur n'a pas (encore) exposé SERG_TRCL au Service Layer, ou pas pour cet utilisateur.",
      discovery, probes,
    });
  }

  // Mode SERG : déplie l'UDO SERGTRS (en-tête + collections enfant) pour
  // un/des client(s) → comprendre la structure réelle (où vivent transporteur,
  // tournée, heure, défaut, timbre). ?serg=AARR,ABET,APET
  if (sp.get("serg") !== null) {
    const cards = (sp.get("serg") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const data: Record<string, unknown> = {};
    for (const cc of cards) {
      const filt = `$filter=${encodeURIComponent(`U_CardCode eq '${cc.replace(/'/g, "''")}'`)}`;
      let strategy: string | null = null;
      let rows: Record<string, unknown>[] | null = null;
      let error: string | null = null;
      // 1) filtre + $expand des 3 collections
      try {
        rows = await sap.getAll<Record<string, unknown>>(
          `SERGTRS?${filt}&$expand=SERG_TRS1Collection,SERG_TRS2Collection,SERG_TRS3Collection`,
          { env: "prod", maxPages: 2, pageSize: 50 },
        );
        strategy = "filter+expand";
      } catch {
        // 2) en-têtes puis GET unitaire par DocEntry / Code (children inlinés)
        try {
          const heads = await sap.getAll<{ Code?: unknown; DocEntry?: unknown }>(
            `SERGTRS?${filt}&$select=Code,DocEntry,U_CardCode,U_Timbre`,
            { env: "prod", maxPages: 2, pageSize: 50 },
          );
          rows = [];
          for (const h of heads) {
            let full: Record<string, unknown> | null = null;
            const keys = [h.DocEntry, typeof h.Code === "string" ? `'${h.Code}'` : h.Code];
            for (const k of keys) {
              if (k === null || k === undefined) continue;
              try { full = await sap.get<Record<string, unknown>>(`SERGTRS(${k})`, { env: "prod" }); break; } catch { /* clé suivante */ }
            }
            rows.push(full ?? (h as Record<string, unknown>));
          }
          strategy = "headers+single";
        } catch (e2) { error = e2 instanceof Error ? e2.message : String(e2); }
      }
      data[cc] = { strategy, error, count: rows?.length ?? null, rows };
    }
    return NextResponse.json({ ok: true, mode: "serg", note: "U_Timbre est en en-tête (par client) ; transporteur/tournée/heure/défaut dans une des collections SERG_TRS#.", data });
  }

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
