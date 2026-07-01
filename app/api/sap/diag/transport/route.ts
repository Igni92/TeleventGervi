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

  // Mode WHOAMI : révèle l'utilisateur technique Service Layer avec lequel l'app
  // se connecte (pour dire à l'intégrateur QUEL compte autoriser sur SERG_TRCL).
  if (sp.get("whoami") !== null) {
    return NextResponse.json({
      ok: true, mode: "whoami",
      serviceLayerUser: process.env.SAP_B1_USERNAME ?? null,
      companyDB: process.env.SAP_B1_COMPANY_DB ?? null,
      baseUrl: (process.env.SAP_B1_BASE_URL ?? "").replace(/\/+$/, ""),
      note: "C'est CE compte (utilisateur Service Layer) qu'il faut autoriser à lire SERG_TRCL — pas un utilisateur de l'interface SAP.",
    });
  }

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

  // Mode RAWSERG : dump BRUT de SERGTRS (sans filtre) — voir ce que contient
  // vraiment l'objet : domaine de U_CardCode + structure complète (children
  // inlinés via GET unitaire). ?rawserg[=N]  (N objets complets, défaut 6)
  if (sp.get("rawserg") !== null) {
    try {
      const n = Math.min(Math.max(parseInt(sp.get("rawserg") || "6", 10) || 6, 1), 25);
      const heads = await sap.getAll<Record<string, unknown>>(`SERGTRS?$top=60`, { env: "prod", maxPages: 1, pageSize: 60 });
      const cardCodesSample = [...new Set(heads.map((h) => JSON.stringify(h.U_CardCode ?? null)))].slice(0, 80);
      const full: unknown[] = [];
      for (const h of heads.slice(0, n)) {
        let obj: Record<string, unknown> | null = null;
        let via: string | null = null;
        for (const k of [h.DocEntry, typeof h.Code === "string" ? `'${h.Code}'` : h.Code]) {
          if (k === null || k === undefined) continue;
          try { obj = await sap.get<Record<string, unknown>>(`SERGTRS(${k})`, { env: "prod" }); via = `SERGTRS(${k})`; break; } catch { /* clé suivante */ }
        }
        full.push({ key: via, headerKeys: { Code: h.Code, DocEntry: h.DocEntry, U_CardCode: h.U_CardCode, U_Timbre: h.U_Timbre }, object: obj });
      }
      return NextResponse.json({ ok: true, mode: "rawserg", totalHeadsReturned: heads.length, cardCodesSample, full });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  // Mode BP : dump des champs U_* + adresse de la FICHE CLIENT (BusinessPartners)
  // pour voir si le transporteur/tournée par défaut du client y vit (UDF), et
  // récupérer son département (pour rapprocher de SERG_TRS1.U_Des). ?bp=AARR,ABET
  if (sp.get("bp") !== null) {
    const cards = (sp.get("bp") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const data: Record<string, unknown> = {};
    for (const cc of cards) {
      try {
        const bp = await sap.get<Record<string, unknown>>(`BusinessPartners('${cc.replace(/'/g, "''")}')`, { env: "prod" });
        const ship = (bp.BPAddresses as Array<Record<string, unknown>> | undefined)?.filter((a) => a.AddressType === "bo_ShipTo")
          .map((a) => ({ AddressName: a.AddressName, Street: a.Street, ZipCode: a.ZipCode, City: a.City, County: a.County }));
        data[cc] = {
          CardCode: bp.CardCode, CardName: bp.CardName,
          ZipCode: bp.ZipCode, City: bp.City, MailZipCode: bp.MailZipCode, MailCity: bp.MailCity,
          shipTo: ship,
          uFields: uFields(bp),
        };
      } catch (e) {
        data[cc] = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    return NextResponse.json({ ok: true, mode: "bp", note: "Cherche U_TrspCode / tournée / heure sur la fiche client + son département (ZipCode/County) pour rapprocher de SERG_TRS1.U_Des.", data });
  }

  // Mode TRCL : SERG_TRCL vient d'être exposée. Découvre l'entité (service doc +
  // $metadata + UDO sur table SERG_TRCL), dump un échantillon + les lignes par
  // client (affectation client→transporteur→tournée→défaut). ?trcl=ABET,AARR,APET
  if (sp.get("trcl") !== null) {
    const cards = (sp.get("trcl") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const hit = (n: string) => n.toUpperCase().includes("TRCL");
    const found = new Set<string>(["SERG_TRCL", "U_SERG_TRCL", "SERGTRCL"]);
    const discovery: Record<string, unknown> = {};
    try {
      const root = await sap.get<{ value?: { name?: string; url?: string }[] }>("", { env: "prod" });
      const names = (root.value ?? []).map((e) => e.name || e.url || "").filter(Boolean);
      discovery.serviceDocMatches = names.filter(hit);
      names.filter(hit).forEach((n) => found.add(n));
    } catch (e) { discovery.serviceDocError = e instanceof Error ? e.message : String(e); }
    try {
      const meta = await sap.get<string>("$metadata", { env: "prod" });
      const xml = typeof meta === "string" ? meta : JSON.stringify(meta);
      const names = [...new Set([...xml.matchAll(/Name="([^"]+)"/g)].map((m) => m[1]).filter(hit))];
      discovery.metadataMatches = names;
      names.forEach((n) => found.add(n));
    } catch (e) { discovery.metadataError = e instanceof Error ? e.message : String(e); }
    try {
      const udos = await sap.get<{ value?: { Code: string }[] }>(
        `UserObjectsMD?$filter=${encodeURIComponent("TableName eq 'SERG_TRCL'")}`, { env: "prod" });
      discovery.udoCodes = (udos.value ?? []).map((u) => u.Code);
      (udos.value ?? []).forEach((u) => found.add(u.Code));
    } catch (e) { discovery.udoError = e instanceof Error ? e.message : String(e); }

    const probes = await Promise.all([...found].map(async (name) => {
      try {
        const sample = await sap.getAll<Record<string, unknown>>(`${encodeURIComponent(name)}?$top=3`, { env: "prod", maxPages: 1, pageSize: 3 });
        const byClient: Record<string, unknown> = {};
        for (const cc of cards) {
          try {
            byClient[cc] = await sap.getAll<Record<string, unknown>>(
              `${encodeURIComponent(name)}?$filter=${encodeURIComponent(`U_CardCode eq '${cc.replace(/'/g, "''")}'`)}`,
              { env: "prod", maxPages: 2, pageSize: 50 });
          } catch (e) { byClient[cc] = { error: (e instanceof Error ? e.message : String(e)).slice(0, 140) }; }
        }
        return { name, ok: true, columns: Object.keys(sample[0] ?? {}), sample, byClient };
      } catch (e) {
        return { name, ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
      }
    }));
    const readable = probes.filter((p) => p.ok);
    return NextResponse.json({
      ok: true, mode: "trcl",
      SERG_TRCL_accessible: readable.length > 0,
      verdict: readable.length ? `✅ Lisible via : ${readable.map((p) => p.name).join(", ")}` : "❌ Toujours pas lisible",
      discovery, probes,
    });
  }

  // Mode SQLQ : SERG_TRCL exposée comme SQLQuery Service Layer (GERVI_SERG_TRCL).
  // Liste les SQLQueries, exécute la/les candidate(s) via /List, montre colonnes
  // + échantillon + lignes des clients demandés. ?sqlq=ABET,AARR,APET
  if (sp.get("sqlq") !== null) {
    const cards = (sp.get("sqlq") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const out: Record<string, unknown> = {};
    let saved: { SqlCode?: string; SqlName?: string }[] = [];
    try {
      const q = await sap.get<{ value?: { SqlCode?: string; SqlName?: string }[] }>("SQLQueries", { env: "prod" });
      saved = q.value ?? [];
      out.savedQueries = saved.map((s) => ({ SqlCode: s.SqlCode, SqlName: s.SqlName }));
    } catch (e) { out.listError = e instanceof Error ? e.message : String(e); }

    const candidates = [...new Set([
      ...saved.filter((s) => /TRCL|SERG/i.test(`${s.SqlCode} ${s.SqlName}`)).map((s) => s.SqlCode).filter(Boolean) as string[],
      "GERVI_SERG_TRCL",
    ])];
    out.candidates = candidates;

    const exec: Record<string, unknown> = {};
    for (const code of candidates) {
      try {
        const rows = await sap.getAll<Record<string, unknown>>(
          `SQLQueries(${encodeURIComponent(`'${code.replace(/'/g, "''")}'`)})/List`,
          { env: "prod", pageSize: 200, maxPages: 30 },
        );
        // Devine la colonne CardCode (le SQL peut aliaser les noms).
        const cardKey = Object.keys(rows[0] ?? {}).find((k) => /cardcode/i.test(k))
          ?? Object.keys(rows[0] ?? {}).find((k) => /card/i.test(k)) ?? null;
        const byClient: Record<string, unknown[]> = {};
        if (cardKey) for (const cc of cards) {
          byClient[cc] = rows.filter((r) => String(r[cardKey] ?? "").trim().toUpperCase() === cc);
        }
        exec[code] = {
          ok: true, total: rows.length, columns: Object.keys(rows[0] ?? {}),
          cardKeyGuess: cardKey, sample: rows.slice(0, 3), byClient,
        };
      } catch (e) {
        exec[code] = { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
      }
    }
    out.exec = exec;
    return NextResponse.json({ ok: true, mode: "sqlq", ...out });
  }

  // Mode VIEW : SERG_TRCL exposée en VUE via le Service Layer v2 (view.svc).
  // ?view=ABET,AARR,APET → login v1 (cookie partagé), GET v2/view.svc/<vue>,
  // colonnes + échantillon + lignes par client. (v1 → v2 : cookie B1SESSION commun.)
  if (sp.get("view") !== null) {
    const cards = (sp.get("view") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const viewName = sp.get("viewName") || "GERVI_SERG_TRCLB1SLQuery";
    const base = (process.env.SAP_B1_BASE_URL ?? "").replace(/\/+$/, "");
    const v2base = base.replace(/\/v1$/, "/v2");
    const viewUrl = `${v2base}/view.svc/${encodeURIComponent(viewName)}`;
    const out: Record<string, unknown> = { viewName, viewUrl };
    try {
      const sample = await sap.get<{ value?: Record<string, unknown>[] }>(`${viewUrl}?$top=5`, { env: "prod" });
      const rows = sample.value ?? [];
      const columns = Object.keys(rows[0] ?? {});
      out.columns = columns;
      out.sample = rows;
      const cardKey = columns.find((k) => /cardcode/i.test(k)) ?? columns.find((k) => /card/i.test(k)) ?? null;
      out.cardKeyGuess = cardKey;
      const byClient: Record<string, unknown> = {};
      if (cardKey) for (const cc of cards) {
        try {
          const r = await sap.get<{ value?: Record<string, unknown>[] }>(
            `${viewUrl}?$filter=${encodeURIComponent(`${cardKey} eq '${cc.replace(/'/g, "''")}'`)}&$top=50`, { env: "prod" });
          byClient[cc] = r.value ?? [];
        } catch (e) { byClient[cc] = { error: (e instanceof Error ? e.message : String(e)).slice(0, 160) }; }
      }
      out.byClient = byClient;
      return NextResponse.json({ ok: true, mode: "view", accessible: true, ...out });
    } catch (e) {
      return NextResponse.json({ ok: false, mode: "view", accessible: false, ...out, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
    }
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
