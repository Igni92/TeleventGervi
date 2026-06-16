import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { cardCodeToClientMap } from "@/lib/clientCardCodes";
import { sap } from "@/lib/sapb1";

/**
 * GET /api/encours — état des encours clients (factures dues).
 *
 * Lit en direct les factures **ouvertes** SAP (DocumentStatus=bost_Open, non
 * annulées) sur la **base réelle (PROD)**. Solde dû = DocTotal − PaidToDate.
 *
 * ⚠️ Conditions de paiement = 30 jours → une facture n'est « en retard » que
 * **passé 30 jours** au-delà de l'échéance. Paliers comptés : >30j / >45j / >90j.
 *
 * Agrège par client (+ id local pour lien fiche). Base d'un futur système de
 * relance automatique selon le retard.
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

interface InvoiceLine {
  docEntry: number;
  docNum: number | null;
  docDate: string | null;
  dueDate: string | null;
  balance: number;     // solde dû
  overdueDays: number; // jours au-delà de l'échéance (0 si à jour)
}
interface ClientEncours {
  cardCode: string;
  cardName: string;
  clientId: string | null;
  encours: number;
  countOpen: number;  // nb factures avec solde dû
  // Paliers de retard EXCLUSIFS (une facture ne compte que dans une tranche).
  b3045: number;      // 30 < retard ≤ 45 j
  b4590: number;      // 45 < retard ≤ 90 j
  b90: number;        // retard > 90 j
  countLate: number;  // nb factures en retard (> 30 j)
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
      // B5 — inclure les comptes SAP secondaires (modes de livraison) des clients
      // du commercial : sinon l'encours porté par ces comptes lui est invisible.
      try {
        const sec = await prisma.$queryRawUnsafe<{ code: string }[]>(
          `SELECT DISTINCT dm."sapCardCode" AS code
             FROM "ClientDeliveryMode" dm
             JOIN "Client" c ON c."id" = dm."clientId"
            WHERE (c."commercial" = $1 OR c."vendeur" = $1)
              AND dm."sapCardCode" IS NOT NULL AND dm."sapCardCode" <> ''`,
          scope.slpName,
        );
        for (const r of sec) allowed.add(r.code);
      } catch { /* ClientDeliveryMode optionnel */ }
    } else {
      allowed = new Set();
    }
  }

  let invs: OpenInvoice[];
  try {
    invs = await sap.getAll<OpenInvoice>(
      "Invoices?$select=DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,PaidToDate"
      + "&$filter=DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'",
      { pageSize: 200, maxPages: 200, env: "prod" },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Lecture SAP échouée : ${msg}` }, { status: 502 });
  }

  // B5 — regroupe les CardCodes secondaires (modes de livraison) sous le client
  // logique : « LPOI » et « LPOI. » consolidés en une seule ligne d'encours.
  const clientMap = await cardCodeToClientMap();

  const now = Date.now();
  const byClient = new Map<string, ClientEncours>();
  let totalEncours = 0;
  let tot3045 = 0, tot4590 = 0, tot90 = 0;

  for (const inv of invs) {
    if (allowed && !allowed.has(inv.CardCode)) continue; // hors périmètre commercial
    const bal = (inv.DocTotal ?? 0) - (inv.PaidToDate ?? 0);
    if (bal <= 0.01) continue; // soldée (arrondi)
    const due = inv.DocDueDate ? new Date(inv.DocDueDate).getTime() : null;
    const overdueDays = due ? Math.max(0, Math.floor((now - due) / 86_400_000)) : 0;
    const late = overdueDays > GRACE_DAYS; // en retard seulement passé 30 j
    totalEncours += bal;

    // Clé = client logique (code principal) si connu, sinon le CardCode brut.
    const ref = clientMap.get(inv.CardCode);
    const key = ref?.primaryCode ?? inv.CardCode;
    const e = byClient.get(key) ?? {
      cardCode: key, cardName: ref?.nom ?? inv.CardName ?? inv.CardCode, clientId: ref?.clientId ?? null,
      encours: 0, countOpen: 0, b3045: 0, b4590: 0, b90: 0,
      countLate: 0, maxOverdueDays: 0, invoices: [] as InvoiceLine[],
    };
    e.encours += bal;
    e.countOpen++;
    // Tranches EXCLUSIVES : la facture ne tombe que dans une seule.
    if (overdueDays > 90) { tot90 += bal; e.b90 += bal; }
    else if (overdueDays > 45) { tot4590 += bal; e.b4590 += bal; }
    else if (overdueDays > 30) { tot3045 += bal; e.b3045 += bal; }
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
    byClient.set(key, e);
  }

  const aggregated = Array.from(byClient.values()).sort((a, b) => b.encours - a.encours);

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
      clientId: c.clientId ?? idByCode.get(c.cardCode) ?? null,
      // Précision complète (cents) : le total client doit réconcilier avec la
      // somme des soldes du détail (modale). L'affichage compacte si besoin.
      encours: Math.round(c.encours * 100) / 100,
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
