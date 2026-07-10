import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { colisInfo } from "@/lib/colis";
import { blDateLabel, type BlDoc, type BlLine, type BlExpense, type BlVatRow } from "@/lib/blOfficiel";
import { isRestrictedPreparateur } from "@/lib/preparateur";
import { isLivreur } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/bl-edition?date=YYYY-MM-DD[&type=GMS|CHR|EXPORT]
 *
 * « Édition BL » — tous les BONS DE LIVRAISON SAP (DeliveryNotes, ODLN) dont la
 * date de livraison (DocDueDate) tombe le jour demandé, prêts à imprimer au
 * format OFFICIEL (réplique du layout SAP/coresuite — cf. lib/blOfficiel).
 * SAP reste la source des données (lignes, prix, lots, frais) ; TeleVent ne
 * fait que la mise en page et l'impression.
 *
 * Filtre `type` : segment client TELEVENT (Client.type — GMS | CHR | EXPORT).
 * Sans type → tous les BL du jour.
 *
 * Rôles restreints (préparateur verrouillé, livreur) : REFUSÉ — le BL officiel
 * porte les prix (donnée commerciale).
 *
 * Réponse : { ok, date, count, docs: (BlDoc & {docEntry, cardCode, clientType})[] }
 */

type SapBatch = { BatchNumber?: string | null };
type SapDlvLine = {
  ItemCode: string;
  ItemDescription?: string;
  Quantity?: number;
  Price?: number;
  UnitPrice?: number;
  LineTotal?: number;
  VatGroup?: string | null;
  TaxPercentagePerRow?: number | null;
  TaxTotal?: number | null;
  BarCode?: string | null;
  MeasureUnit?: string | null;
  BatchNumbers?: SapBatch[];
};
type SapDlvExpense = {
  ExpenseCode?: number;
  LineTotal?: number;
  VatGroup?: string | null;
};
type SapDelivery = {
  DocEntry: number;
  DocNum: number;
  DocDate?: string;
  DocDueDate?: string;
  CardCode: string;
  CardName?: string;
  DocTotal?: number;
  VatSum?: number;
  DocumentStatus?: string;
  Cancelled?: string;
  NumAtCard?: string | null;
  Address?: string | null;   // adresse de facturation (bloc texte)
  Address2?: string | null;  // adresse de LIVRAISON (bloc texte) — prioritaire
  U_TrspCode?: string | null;
  U_GER_REF?: string | null; // référence rouge du layout (si le champ existe)
  DocumentLines?: SapDlvLine[];
  DocumentAdditionalExpenses?: SapDlvExpense[];
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (isRestrictedPreparateur(session.user?.email) || (await isLivreur(session))) {
    return NextResponse.json({ error: "Accès refusé (document commercial)" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Paramètre date invalide (YYYY-MM-DD attendu)" }, { status: 400 });
  }
  const typeFilter = (searchParams.get("type") ?? "").trim().toUpperCase() || null;

  const BASE_SELECT =
    "DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,VatSum,DocumentStatus,Cancelled," +
    "NumAtCard,Address,Address2,DocumentLines,DocumentAdditionalExpenses";
  // Champs FACULTATIFS selon la base : U_TrspCode (transporteur) et U_GER_REF
  // (référence rouge du layout). Du plus riche au plus pauvre — le BL reste
  // imprimable sans eux.
  const EXTRA_SELECTS = [",U_TrspCode,U_GER_REF", ",U_TrspCode", ""];
  const filter = encodeURIComponent(`DocDueDate eq '${date}'`);

  try {
    let dlvs: SapDelivery[] = [];
    for (let i = 0; i < EXTRA_SELECTS.length; i++) {
      try {
        dlvs = await sap.getAll<SapDelivery>(
          `DeliveryNotes?$select=${BASE_SELECT}${EXTRA_SELECTS[i]}&$filter=${filter}&$orderby=CardName asc`,
          { pageSize: 100, maxPages: 20 },
        );
        break;
      } catch (e) {
        if (i === EXTRA_SELECTS.length - 1) throw e;
      }
    }
    const live = dlvs.filter((d) => d.Cancelled !== "tYES");

    const allItemCodes = Array.from(
      new Set(live.flatMap((d) => (d.DocumentLines || []).map((l) => l.ItemCode))),
    );
    const cardCodes = Array.from(new Set(live.map((d) => d.CardCode).filter(Boolean)));

    // ── Référentiels indépendants, chargés EN PARALLÈLE (chacun best-effort) ──
    const [prods, carrierByCode, clientMeta, itemLive, emailByCard, expenseNames] = await Promise.all([
      // Produits locaux : unité / colisage / désignation (marque, condt, pays, variété).
      allItemCodes.length
        ? prisma.product.findMany({
            where: { itemCode: { in: allItemCodes } },
            select: {
              itemCode: true, itemName: true, frgnName: true, salesUnit: true,
              salesUnitWeight: true, salesQtyPerPackUnit: true, uMarque: true, uCondi: true, uPays: true,
            },
          })
        : Promise.resolve([]),
      // Transporteur : U_TrspCode → libellé (table Carrier).
      (async () => {
        const m = new Map<string, string>();
        try {
          const carriers = await prisma.carrier.findMany({ select: { name: true, sapValue: true } });
          for (const c of carriers) if (c.sapValue) m.set(c.sapValue, c.name);
        } catch { /* table absente → code brut */ }
        return m;
      })(),
      // Type client televent (GMS/CHR/EXPORT) + nom complet, par CardCode
      // (code principal OU code d'adresse de livraison).
      (async () => {
        const types = new Map<string, string>();
        const names = new Map<string, string>();
        if (!cardCodes.length) return { types, names };
        try {
          const clients = await prisma.client.findMany({
            where: { code: { in: cardCodes } },
            select: { code: true, type: true, nom: true },
          });
          for (const c of clients) {
            if (c.type) types.set(c.code, c.type);
            if (c.nom?.trim()) names.set(c.code, c.nom.trim());
          }
          const modes = await prisma.clientDeliveryMode.findMany({
            where: { sapCardCode: { in: cardCodes } },
            select: { sapCardCode: true, client: { select: { type: true, nom: true } } },
          });
          for (const mo of modes) {
            if (mo.client?.type && !types.has(mo.sapCardCode)) types.set(mo.sapCardCode, mo.client.type);
            if (mo.client?.nom?.trim() && !names.has(mo.sapCardCode)) names.set(mo.sapCardCode, mo.client.nom.trim());
          }
        } catch { /* type optionnel */ }
        return { types, names };
      })(),
      // Items SAP live : CALIBRE (U_GER_CALIBRE — pas en base locale) + code-barres
      // de repli quand la ligne n'en porte pas. Chunké, best-effort.
      (async () => {
        const m = new Map<string, { barcode: string | null; calibre: string | null }>();
        const chunks: string[][] = [];
        for (let i = 0; i < allItemCodes.length; i += 20) chunks.push(allItemCodes.slice(i, i + 20));
        await Promise.all(chunks.map(async (chunk) => {
          const or = chunk.map((c) => `ItemCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
          for (const sel of ["ItemCode,BarCode,U_GER_CALIBRE", "ItemCode,BarCode"]) {
            try {
              const items = await sap.getAll<{ ItemCode: string; BarCode?: string | null; U_GER_CALIBRE?: string | null }>(
                `Items?$select=${sel}&$filter=${encodeURIComponent(`(${or})`)}`,
                { pageSize: 50, maxPages: 2 },
              );
              for (const it of items) m.set(it.ItemCode, { barcode: it.BarCode ?? null, calibre: it.U_GER_CALIBRE ?? null });
              break;
            } catch { /* repli sans calibre, puis abandon silencieux */ }
          }
        }));
        return m;
      })(),
      // Email du client (BusinessPartners) — en-tête du BL. Chunké, best-effort.
      (async () => {
        const m = new Map<string, string>();
        const chunks: string[][] = [];
        for (let i = 0; i < cardCodes.length; i += 20) chunks.push(cardCodes.slice(i, i + 20));
        await Promise.all(chunks.map(async (chunk) => {
          try {
            const or = chunk.map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
            const bps = await sap.getAll<{ CardCode: string; EmailAddress?: string | null }>(
              `BusinessPartners?$select=CardCode,EmailAddress&$filter=${encodeURIComponent(`(${or})`)}`,
              { pageSize: 50, maxPages: 2 },
            );
            for (const bp of bps) if (bp.EmailAddress?.trim()) m.set(bp.CardCode, bp.EmailAddress.trim());
          } catch { /* email absent de l'en-tête */ }
        }));
        return m;
      })(),
      // Libellés des frais additionnels (INTERFEL, DROIT DE GARDE, PAL. EUROPE…).
      (async () => {
        const m = new Map<number, string>();
        try {
          const rows = await sap.getAll<{ ExpensCode: number; Name?: string | null }>(
            "AdditionalExpenses?$select=ExpensCode,Name",
            { pageSize: 100, maxPages: 2 },
          );
          for (const r of rows) if (r.Name?.trim()) m.set(r.ExpensCode, r.Name.trim());
        } catch { /* libellé = code */ }
        return m;
      })(),
    ]);
    const pMap = new Map(prods.map((p) => [p.itemCode, p]));

    const docs = live
      .map((d) => {
        // ── Lignes : mêmes valeurs que SAP, AUCUNE fusion (document officiel). ──
        let totalColis = 0;
        let totalWeightKg = 0;
        const lines: BlLine[] = (d.DocumentLines || []).map((l) => {
          const p = pMap.get(l.ItemCode);
          const liveIt = itemLive.get(l.ItemCode);
          const div = p ? colisInfo(p).unitsPerColis || 1 : 1;
          const qty = l.Quantity ?? 0;
          const colis = qty / div;
          totalColis += colis;
          totalWeightKg += qty * (p?.salesUnitWeight ?? 0);
          const lots = (l.BatchNumbers || []).map((b) => (b.BatchNumber ?? "").trim()).filter(Boolean);
          return {
            barcode: l.BarCode?.trim() || liveIt?.barcode || null,
            colis: Math.round(colis * 10) / 10,
            fruit: l.ItemDescription || p?.itemName || l.ItemCode,
            marque: p?.uMarque ?? null,
            variete: p?.frgnName ?? null,
            calibre: liveIt?.calibre ?? null,
            pays: p?.uPays ?? null,
            condt: p?.uCondi ?? null,
            lot: lots.length ? Array.from(new Set(lots)).join(" / ") : null,
            qty,
            unit: p?.salesUnit ?? l.MeasureUnit ?? "",
            puht: l.Price ?? l.UnitPrice ?? 0,
            tvaCode: l.VatGroup ?? null,
            totalHt: l.LineTotal ?? 0,
          };
        });

        // ── Frais additionnels : parafiscales (gauche) / prestations (droite). ──
        const expenses: BlExpense[] = (d.DocumentAdditionalExpenses || []).map((e) => {
          const name = expenseNames.get(e.ExpenseCode ?? -1) ?? `Frais ${e.ExpenseCode ?? "?"}`;
          return {
            name,
            taxCode: e.VatGroup ?? null,
            amount: Math.round((e.LineTotal ?? 0) * 100) / 100,
            kind: /INTERFEL|GARDE/i.test(name) ? "parafiscale" as const : "prestation" as const,
          };
        });

        const sousTotal = Math.round(lines.reduce((s, l) => s + l.totalHt, 0) * 100) / 100;
        const totalTtc = Math.round((d.DocTotal ?? 0) * 100) / 100;
        const vatSum = Math.round((d.VatSum ?? 0) * 100) / 100;
        const totalHt = Math.round((totalTtc - vatSum) * 100) / 100;

        // ── TVA par code — un seul code (cas courant) : base = TOTAL HT et
        //    montant = VatSum du document, comme sur l'édition SAP. Plusieurs
        //    codes : ventilation par groupe à partir des lignes. ──
        const byGroup = new Map<string, { base: number; amount: number; rate: number }>();
        for (const l of lines) {
          const code = (l.tvaCode ?? "").trim();
          if (!code) continue;
          const g = byGroup.get(code) ?? { base: 0, amount: 0, rate: 0 };
          g.base += l.totalHt;
          const sapLine = (d.DocumentLines || []).find((x) => (x.VatGroup ?? "") === code);
          g.rate = sapLine?.TaxPercentagePerRow ?? g.rate;
          byGroup.set(code, g);
        }
        for (const l of d.DocumentLines || []) {
          const code = (l.VatGroup ?? "").trim();
          if (!code) continue;
          const g = byGroup.get(code);
          if (g) g.amount += l.TaxTotal ?? 0;
        }
        let vatRows: BlVatRow[];
        if (byGroup.size <= 1) {
          const [code, g] = byGroup.size ? [...byGroup.entries()][0] : ["", { rate: 0 }];
          vatRows = [{ code: code || "—", ratePct: (g as { rate: number }).rate ?? 0, base: totalHt, amount: vatSum }];
        } else {
          vatRows = [...byGroup.entries()].map(([code, g]) => ({
            code,
            ratePct: g.rate,
            base: Math.round(g.base * 100) / 100,
            amount: Math.round(g.amount * 100) / 100,
          }));
        }

        const trspCode = d.U_TrspCode?.trim() || null;
        const addressBlock = (d.Address2?.trim() || d.Address?.trim() || "");
        const doc: BlDoc & { docEntry: number; cardCode: string; clientType: string | null } = {
          docEntry: d.DocEntry,
          docNum: d.DocNum,
          // Référence rouge du layout : U_GER_REF si le champ existe, sinon la
          // référence client du document (NumAtCard). À remapper ici si la
          // source réelle diffère.
          ref: d.U_GER_REF?.trim() || d.NumAtCard?.trim() || null,
          dateLabel: blDateLabel(d.DocDueDate?.slice(0, 10) || date),
          clientEmail: emailByCard.get(d.CardCode) ?? null,
          clientName: clientMeta.names.get(d.CardCode) ?? d.CardName ?? d.CardCode,
          addressLines: addressBlock.split(/\r\r|\r?\n|\r/).map((s) => s.trim()).filter(Boolean),
          carrierLabel: trspCode ? carrierByCode.get(trspCode) ?? trspCode : null,
          lines,
          totalColis: Math.round(totalColis * 10) / 10,
          totalWeightKg: Math.round(totalWeightKg * 10) / 10,
          expenses,
          sousTotal,
          totalHt,
          vatRows,
          totalTtc,
          cardCode: d.CardCode,
          clientType: clientMeta.types.get(d.CardCode) ?? null,
        };
        return doc;
      })
      .filter((doc) => !typeFilter || doc.clientType === typeFilter);

    return NextResponse.json({ ok: true, date, count: docs.length, docs });
  } catch (e) {
    console.error("[bl-edition] échec:", e);
    const msg = e instanceof Error ? e.message : "Erreur SAP";
    return NextResponse.json({ error: `Lecture des BL impossible : ${msg}` }, { status: 502 });
  }
}
