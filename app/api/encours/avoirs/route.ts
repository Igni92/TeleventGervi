import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope, cardCodeInScope } from "@/lib/permissions";
import { sap } from "@/lib/sapb1";
import { netEncours } from "@/lib/encours-net";
import { attributeAvoirs, type CreditNoteRef } from "@/lib/encours-avoirs";

/**
 * GET /api/encours/avoirs?cardCode=XXX — enrichissement AVOIRS d'UN client, LAZY.
 *
 * Chargé à l'ouverture de la modale détail (jamais dans la liste globale) : on ne
 * lit les CreditNotes que pour CE client → pas de risque de timeout sur la vue
 * d'ensemble (raison historique de la désactivation du fetch bulk). Best-effort,
 * JAMAIS bloquant : en cas d'échec SAP la modale garde ses données de base.
 *
 * Recalcule pour le client :
 *   - avoirs IMPUTÉS à une facture ouverte (par docEntry) — violet ;
 *   - avoirs NON imputés « en faveur du client » (bleu), à déduire d'une facture
 *     ultérieure ;
 *   - la scission de l'« encaisse » (règlements SEULS, une fois les avoirs sortis).
 *
 * Le NET dû reste STRICTEMENT inchangé (cf. lib/encours-avoirs) : on ne fait que
 * ventiler la déduction brut − net en règlements / avoirs imputés / avoirs en faveur.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface OpenInvoice {
  DocEntry: number;
  CardCode: string;
  DocTotal?: number;
  PaidToDate?: number;
}
interface CreditNoteDoc {
  DocEntry: number;
  DocNum?: number;
  DocDate?: string;
  CardCode: string;
  DocTotal?: number;
  DocumentLines?: { BaseType?: number; BaseEntry?: number }[];
}

/** CardCode « sûr » pour interpolation OData (alphanumérique + . _ -). */
function safeCardCode(cardCode: string): boolean {
  return /^[\w.\-]+$/.test(cardCode);
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, error: "Non autorisé" }, { status: 401 });

  const cardCode = new URL(req.url).searchParams.get("cardCode")?.trim();
  if (!cardCode || !safeCardCode(cardCode)) {
    return NextResponse.json({ ok: false, error: "cardCode invalide" }, { status: 400 });
  }

  // Anti-IDOR : un commercial ne peut demander que SES clients.
  const scope = await getAccessScope(session);
  if (!(await cardCodeInScope(scope, cardCode))) {
    return NextResponse.json({ ok: false, error: "Hors périmètre" }, { status: 403 });
  }

  const cc = cardCode.replace(/'/g, "''");
  try {
    // Factures ouvertes + solde compte + avoirs (avec lien facture), en parallèle.
    const [invs, bp, cns] = await Promise.all([
      sap.getAll<OpenInvoice>(
        "Invoices?$select=DocEntry,CardCode,DocTotal,PaidToDate"
          + `&$filter=CardCode eq '${cc}' and DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'`,
        { pageSize: 200, maxPages: 50, env: "prod" },
      ),
      sap
        .get<{ CurrentAccountBalance?: number }>(
          `BusinessPartners('${cc}')?$select=CurrentAccountBalance`,
          { env: "prod" },
        )
        .catch(() => null),
      sap
        .getAll<CreditNoteDoc>(
          "CreditNotes?$select=DocEntry,DocNum,DocDate,CardCode,DocTotal,DocumentLines"
            + `&$filter=Cancelled eq 'tNO' and CardCode eq '${cc}'`,
          { pageSize: 100, maxPages: 10, env: "prod" },
        )
        .catch(() => [] as CreditNoteDoc[]),
    ]);

    // Soldes bruts par facture ouverte (> 0,01 seulement).
    const invoices = invs
      .map((i) => ({ docEntry: i.DocEntry, balance: Math.round(((i.DocTotal ?? 0) - (i.PaidToDate ?? 0)) * 100) / 100 }))
      .filter((i) => i.balance > 0.01);
    const brut = Math.round(invoices.reduce((s, i) => s + i.balance, 0) * 100) / 100;

    const cab = bp && typeof bp.CurrentAccountBalance === "number" ? bp.CurrentAccountBalance : null;
    const { net, encaisse } = netEncours(brut, cab);

    // Avoirs → ref d'attribution (lien BaseType=13 → BaseEntry = facture d'origine).
    const creditNotes: CreditNoteRef[] = cns.map((d) => {
      let baseInvoiceEntry: number | null = null;
      for (const l of d.DocumentLines ?? []) {
        if (l.BaseType === 13 && l.BaseEntry != null) { baseInvoiceEntry = l.BaseEntry; break; }
      }
      return {
        docEntry: d.DocEntry,
        docNum: d.DocNum ?? null,
        docDate: d.DocDate ?? null,
        amount: Math.abs(d.DocTotal ?? 0),
        baseInvoiceEntry,
      };
    });

    const attr = attributeAvoirs(invoices, creditNotes, encaisse);
    const avoirsAttribues = attr.attributedTotal;
    const avoirsNonImputesTotal = Math.round(attr.unattributed.reduce((s, a) => s + a.amount, 0) * 100) / 100;
    // Encaisse résiduelle = règlements seuls (avoirs imputés + en faveur sortis).
    const encaisseReglements = Math.round((encaisse - avoirsAttribues - avoirsNonImputesTotal) * 100) / 100;

    return NextResponse.json({
      ok: true,
      cardCode,
      brut,
      encours: net,
      encaisse: encaisseReglements,
      avoirsAttribues: Math.round(avoirsAttribues * 100) / 100,
      avoirsNonImputes: attr.unattributed.map((a) => ({
        docEntry: a.docEntry, docNum: a.docNum, docDate: a.docDate,
        amount: Math.round(a.amount * 100) / 100,
      })),
      avoirsNonImputesTotal,
      // Avoirs imputés par facture (docEntry → liste). La modale les fusionne.
      invoices: invoices
        .map((i) => {
          const list = attr.byInvoice.get(i.docEntry) ?? [];
          const avoirsTotal = Math.round(list.reduce((s, a) => s + a.amount, 0) * 100) / 100;
          return {
            docEntry: i.docEntry,
            avoirs: list.map((a) => ({ docEntry: a.docEntry, docNum: a.docNum, docDate: a.docDate, amount: a.amount })),
            avoirsTotal,
            net: Math.round(Math.max(0, i.balance - avoirsTotal) * 100) / 100,
          };
        })
        .filter((i) => i.avoirs.length > 0),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Lecture SAP échouée : ${msg}` }, { status: 502 });
  }
}
