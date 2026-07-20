import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sap } from "@/lib/sapb1";
import { prisma } from "@/lib/prisma";
import { isAgreeur, requirePreparateurOrAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * ÉTAT DE COMPTE SOFRUCE — relevé des ENTRÉES MARCHANDISES (achats) du
 * fournisseur Sofruce sur une période : ce que Sofruce doit NOUS FACTURER.
 * Source : SAP PurchaseDeliveryNotes (CardCode Sofruce), annulations exclues.
 * Le PDF est construit CÔTÉ NAVIGATEUR (lib/sofrucePdf) à partir de ce JSON.
 *
 * GET /api/sap/sofruce/statement?from=YYYY-MM-DD&to=YYYY-MM-DD
 */

interface ListedLine {
  ItemCode: string; ItemDescription?: string;
  Quantity: number; PackageQuantity?: number;
  Price?: number; LineTotal?: number;
  BaseType?: number; BaseEntry?: number;
}
interface SapPdnListed {
  DocEntry: number; DocNum: number; DocDate: string;
  CardCode: string; CardName?: string;
  DocTotal?: number; VatSum?: number; Comments?: string;
  Cancelled?: string; DocumentLines?: ListedLine[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PDN_OBJTYPE = 20;   // oPurchaseDeliveryNotes — un doc dont une ligne pointe une EM = doc d'ANNULATION

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // L'état porte les PRIX D'ACHAT → interdit à l'agréeur « pur » (même règle que
  // l'historique des entrées marchandises, qui lui masque les montants).
  if ((await isAgreeur(session)) && !(await requirePreparateurOrAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la gestion (l'état porte les prix d'achat)." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "Période invalide : from et to au format YYYY-MM-DD requis." }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: "Période invalide : la date de début dépasse la date de fin." }, { status: 400 });
  }

  const cardCode = process.env.GERVIFRAIS_SOFRUCE_CARDCODE?.trim() || "SOFRUCE";

  try {
    const filter = `CardCode eq '${cardCode.replace(/'/g, "''")}' and DocDate ge '${from}' and DocDate le '${to}'`;
    const listed = await sap.getAll<SapPdnListed>(
      `PurchaseDeliveryNotes?$select=DocEntry,DocNum,DocDate,CardCode,CardName,DocTotal,VatSum,Comments,Cancelled,DocumentLines`
      + `&$orderby=DocDate,DocEntry&$filter=${encodeURIComponent(filter)}`,
      { pageSize: 200, maxPages: 25 },
    );

    // ── Annulations exclues des deux côtés ──────────────────────
    // SAP « Annuler » crée un doc d'annulation (EM inverse, lignes BaseType 20 →
    // l'EM d'origine) et marque l'origine Cancelled = tYES. Ni l'un ni l'autre
    // ne doit être facturé par Sofruce.
    const isCancellation = (d: SapPdnListed) =>
      (d.DocumentLines || []).some((l) => Number(l.BaseType) === PDN_OBJTYPE && l.BaseEntry != null);
    const docs = listed.filter((d) => d.Cancelled !== "tYES" && !isCancellation(d));

    // Désignation locale (plus complète que l'ItemDescription SAP tronquée).
    const itemCodes = Array.from(new Set(docs.flatMap((d) => (d.DocumentLines || []).map((l) => l.ItemCode))));
    const products = itemCodes.length
      ? await prisma.product.findMany({
          where: { itemCode: { in: itemCodes } },
          select: { itemCode: true, itemName: true },
        })
      : [];
    const nameOf = new Map(products.map((p) => [p.itemCode, p.itemName]));

    // Client de la vente : suffixe « Vente Sofruce — <nom> » posé par la console
    // dans les Comments de l'EM (docRef). Absent = EM saisie à la main.
    const clientOf = (comments?: string): string | null => {
      const m = /Vente Sofruce — (.+)\s*$/.exec(comments ?? "");
      return m ? m[1].trim() : null;
    };

    const out = docs.map((d) => {
      const lines = (d.DocumentLines || []).map((l) => ({
        itemCode: l.ItemCode,
        itemName: nameOf.get(l.ItemCode) ?? l.ItemDescription ?? l.ItemCode,
        quantity: l.Quantity,
        colis: l.PackageQuantity != null && l.PackageQuantity > 0 ? l.PackageQuantity : null,
        price: l.Price != null && l.Price > 0 ? l.Price : null,
        lineTotal: l.LineTotal ?? (l.Price != null ? Math.round(l.Price * l.Quantity * 100) / 100 : 0),
      }));
      const sumLines = lines.reduce((s, l) => s + l.lineTotal, 0);
      const totalTTC = d.DocTotal ?? 0;
      const totalTVA = d.VatSum ?? 0;
      return {
        docEntry: d.DocEntry, docNum: d.DocNum,
        docDate: (d.DocDate || "").slice(0, 10),
        clientNote: clientOf(d.Comments),
        lines,
        totalHT: sumLines > 0 ? Math.round(sumLines * 100) / 100 : Math.max(0, Math.round((totalTTC - totalTVA) * 100) / 100),
        totalTVA, totalTTC,
      };
    });

    const totals = {
      docs: out.length,
      ht: Math.round(out.reduce((s, d) => s + d.totalHT, 0) * 100) / 100,
      tva: Math.round(out.reduce((s, d) => s + d.totalTVA, 0) * 100) / 100,
      ttc: Math.round(out.reduce((s, d) => s + d.totalTTC, 0) * 100) / 100,
    };

    return NextResponse.json({ ok: true, cardCode, from, to, docs: out, totals });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[SofruceStatement] ❌", message);
    return NextResponse.json({ ok: false, error: `Lecture SAP impossible : ${message}` }, { status: 502 });
  }
}
