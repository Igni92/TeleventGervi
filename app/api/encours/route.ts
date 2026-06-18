import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { netEncours } from "@/lib/encours-net";

/**
 * GET /api/encours — état des encours clients (factures dues), AU NET.
 *
 * Lit en direct les factures **ouvertes** SAP (DocumentStatus=bost_Open, non
 * annulées) sur la **base réelle (PROD)**. Solde facture = DocTotal − PaidToDate.
 *
 * ⚠️ Le dû affiché est le **NET** : on soustrait l'encaissé non encore affecté
 * (= solde compte tiers SAP `CurrentAccountBalance`, lu en direct = SOLDE du
 * grand livre), alloué aux tranches d'ancienneté les plus anciennes d'abord
 * (cf. lib/encours-net). On ne compte donc jamais du déjà payé.
 *
 * ⚠️ Conditions de paiement = 30 jours → une facture n'est « en retard » que
 * **passé 30 jours** au-delà de l'échéance. Paliers : >30j / >45j / >90j.
 */
export const dynamic = "force-dynamic";

const GRACE_DAYS = 30; // tolérance avant de considérer "en retard"

interface OpenInvoice {
  DocEntry: number;
  DocNum?: number;
  DocDate?: string;
  DocDueDate?: string;
  CardCode: string;
  CardName?: string;
  DocTotal?: number;
  PaidToDate?: number;
}
interface BpBalance {
  CardCode: string;
  CurrentAccountBalance?: number;
}

interface InvoiceLine {
  docEntry: number;
  docNum: number | null;
  docDate: string | null;
  dueDate: string | null;
  balance: number;     // solde dû (brut, par facture)
  overdueDays: number; // jours au-delà de l'échéance (0 si à jour)
}
interface ClientEncours {
  cardCode: string;
  cardName: string;
  clientId: string | null;
  encours: number;     // NET dû (= brut − encaissé)
  brut: number;        // somme des factures ouvertes (avant déduction)
  encaisse: number;    // encaissé/avoirs non affectés (déduit EN LIGNE, pas par facture)
  countOpen: number;   // nb factures avec solde dû
  // Paliers de retard EXCLUSIFS, au BRUT (on ne répartit pas les avoirs par
  // facture : un avoir peut viser une autre facture → déduction globale en ligne).
  b3045: number;       // 30 < retard ≤ 45 j
  b4590: number;       // 45 < retard ≤ 90 j
  b90: number;         // retard > 90 j
  countLate: number;   // nb factures en retard (> 30 j)
  maxOverdueDays: number;
  invoices: InvoiceLine[];
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Droits : un non-admin ne voit que les encours de SES clients (commercial OU
  // vendeur = son slpName). `allowed = null` → admin (aucun filtre) ; non mappé
  // → ensemble vide → encours à zéro (jamais la vue globale).
  const scope = await getAccessScope(session);
  let allowed: Set<string> | null = null;
  if (!scope.all) {
    if (scope.slpName) {
      const rows = await prisma.$queryRawUnsafe<{ code: string }[]>(
        `SELECT "code" FROM "Client" WHERE "commercial" = $1 OR "vendeur" = $1`,
        scope.slpName,
      );
      allowed = new Set(rows.map((r) => r.code));
    } else {
      allowed = new Set();
    }
  }

  let invs: OpenInvoice[];
  let bps: BpBalance[];
  try {
    [invs, bps] = await Promise.all([
      sap.getAll<OpenInvoice>(
        "Invoices?$select=DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,PaidToDate"
        + "&$filter=DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'",
        { pageSize: 200, maxPages: 200, env: "prod" },
      ),
      // Solde NET par client (encaissé déduit). Best-effort : si KO, on garde le
      // brut (pas de blocage de la page).
      sap.getAll<BpBalance>(
        "BusinessPartners?$select=CardCode,CurrentAccountBalance&$filter=CardType eq 'cCustomer'",
        { pageSize: 500, maxPages: 100, env: "prod" },
      ).catch((e) => {
        console.error("[encours] lecture des soldes compte échouée (repli brut):", e);
        return [] as BpBalance[];
      }),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Lecture SAP échouée : ${msg}` }, { status: 502 });
  }

  const cabByCode = new Map<string, number>();
  for (const b of bps) {
    if (typeof b.CurrentAccountBalance === "number") cabByCode.set(b.CardCode, b.CurrentAccountBalance);
  }

  const now = Date.now();
  const byClient = new Map<string, ClientEncours>();

  for (const inv of invs) {
    if (allowed && !allowed.has(inv.CardCode)) continue; // hors périmètre commercial
    const bal = (inv.DocTotal ?? 0) - (inv.PaidToDate ?? 0);
    if (bal <= 0.01) continue; // soldée (arrondi)
    const due = inv.DocDueDate ? new Date(inv.DocDueDate).getTime() : null;
    const overdueDays = due ? Math.max(0, Math.floor((now - due) / 86_400_000)) : 0;
    const late = overdueDays > GRACE_DAYS; // en retard seulement passé 30 j

    const e = byClient.get(inv.CardCode) ?? {
      cardCode: inv.CardCode, cardName: inv.CardName ?? inv.CardCode, clientId: null,
      encours: 0, brut: 0, encaisse: 0, countOpen: 0, b3045: 0, b4590: 0, b90: 0,
      countLate: 0, maxOverdueDays: 0, invoices: [] as InvoiceLine[],
    };
    e.encours += bal; // brut pour l'instant — mis au net après la boucle
    e.countOpen++;
    // Tranches EXCLUSIVES : la facture ne tombe que dans une seule.
    if (overdueDays > 90) e.b90 += bal;
    else if (overdueDays > 45) e.b4590 += bal;
    else if (overdueDays > 30) e.b3045 += bal;
    if (late) { e.countLate++; e.maxOverdueDays = Math.max(e.maxOverdueDays, overdueDays); }
    e.invoices.push({
      docEntry: inv.DocEntry,
      docNum: inv.DocNum ?? null,
      docDate: inv.DocDate ?? null,
      dueDate: inv.DocDueDate ?? null,
      // Détail des encours : précision complète (au centime) — JAMAIS arrondi à
      // l'euro (directive métier). L'arrondi 2 déc. évite seulement le bruit float.
      balance: Math.round(bal * 100) / 100,
      overdueDays,
    });
    byClient.set(inv.CardCode, e);
  }

  // Mise au NET : net = brut − encaissé/avoirs (solde compte tiers). On NE répartit
  // PAS l'encaissé sur les factures/tranches (un avoir peut viser une autre
  // facture) → factures et tranches restent au BRUT, déduction présentée en ligne.
  for (const e of byClient.values()) {
    const cab = cabByCode.has(e.cardCode) ? cabByCode.get(e.cardCode)! : null;
    const { net, encaisse } = netEncours(e.encours, cab);
    e.brut = e.encours;
    e.encours = net;
    e.encaisse = encaisse;
  }

  // On ne liste que les clients dont le NET reste dû (le déjà-payé sort de la liste).
  const aggregated = Array.from(byClient.values())
    .filter((c) => c.encours > 0.01)
    .sort((a, b) => b.encours - a.encours);

  // Totaux : encours au NET ; tranches d'ancienneté au BRUT ; encaissé total.
  const totalEncours = aggregated.reduce((s, c) => s + c.encours, 0);
  const totalEncaisse = aggregated.reduce((s, c) => s + c.encaisse, 0);
  const tot3045 = aggregated.reduce((s, c) => s + c.b3045, 0);
  const tot4590 = aggregated.reduce((s, c) => s + c.b4590, 0);
  const tot90 = aggregated.reduce((s, c) => s + c.b90, 0);

  // Lien fiche : id local par code (quand le client existe en base).
  const codes = aggregated.map((c) => c.cardCode);
  const locals = codes.length
    ? await prisma.client.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } })
    : [];
  const idByCode = new Map(locals.map((l) => [l.code, l.id]));

  return NextResponse.json({
    ok: true,
    company: sap.getEnvironment().prodCompany,
    totals: {
      encours: Math.round(totalEncours),
      encaisse: Math.round(totalEncaisse),
      overdueTotal: Math.round(tot3045 + tot4590 + tot90),
      b3045: Math.round(tot3045),
      b4590: Math.round(tot4590),
      b90: Math.round(tot90),
      invoices: aggregated.reduce((s, c) => s + c.countOpen, 0),
      clients: aggregated.length,
    },
    clients: aggregated.map((c) => ({
      cardCode: c.cardCode,
      cardName: c.cardName,
      clientId: idByCode.get(c.cardCode) ?? null,
      // Précision complète (cents). Encours = NET ; brut et encaissé en plus.
      encours: Math.round(c.encours * 100) / 100,
      brut: Math.round(c.brut * 100) / 100,
      encaisse: Math.round(c.encaisse * 100) / 100,
      countOpen: c.countOpen,
      b3045: Math.round(c.b3045 * 100) / 100,
      b4590: Math.round(c.b4590 * 100) / 100,
      b90: Math.round(c.b90 * 100) / 100,
      countLate: c.countLate,
      maxOverdueDays: c.maxOverdueDays,
      invoices: [...c.invoices].sort((a, b) => b.overdueDays - a.overdueDays),
    })),
  });
}
