/**
 * Assemblage serveur d'une relance pour un client — NT-2026-RC-01.
 *
 * Lit les factures **ouvertes** en direct SAP (base réelle, comme /api/encours),
 * rattache la fiche locale (email compta, contact, adresse), construit le
 * contexte de fusion et rend le courrier. Aperçu et envoi appellent la MÊME
 * fonction avec les mêmes entrées (cardCode, niveau) : les montants reflètent
 * l'état SAP au moment de l'appel (l'envoi relit donc les valeurs à jour).
 */
import { sap } from "@/lib/sapb1";
import { prisma } from "@/lib/prisma";
import { getRelanceParams } from "./params";
import {
  buildRelanceContext,
  overdueDaysFor,
  type RelanceContext,
  type RelanceInvoice,
} from "./fields";
import { getLevel, type RelanceCode } from "./levels";
import { renderRelance, type RenderedRelance } from "./render";
import { resolveRecipient, fromAddress, type ResolvedRecipient } from "./delivery";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Erreur d'ENTRÉE (cardCode invalide, aucune facture…) — distincte d'une panne
 * SAP. Les routes la mappent en 400/404 (et non 502).
 */
export class RelanceInputError extends Error {}

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

export interface RelancePackage {
  cardCode: string;
  cardName: string;
  clientId: string | null;
  clientEmailCompta: string | null;
  level: RelanceCode;
  channel: string;
  /** Boîte expéditrice (boîte partagée — identité applicative). */
  from: string;
  recipient: ResolvedRecipient;
  context: RelanceContext;
  rendered: RenderedRelance;
}

/** CardCode SAP « sûr » pour interpolation OData (alphanumérique + . _ -). */
function assertSafeCardCode(cardCode: string): void {
  if (!/^[\w.\-]+$/.test(cardCode)) {
    throw new RelanceInputError("CardCode invalide.");
  }
}

/** Facture la plus en retard (référence des courriers mono-facture R0/R1). */
function mostOverdue(invoices: RelanceInvoice[]): RelanceInvoice {
  return invoices.reduce((best, inv) =>
    inv.overdueDays > best.overdueDays ||
    (inv.overdueDays === best.overdueDays && inv.balance > best.balance)
      ? inv
      : best,
  );
}

/**
 * Construit le « package » de relance complet pour un client et un niveau.
 * Lève si le client n'a aucune facture ouverte.
 */
export async function buildRelancePackage(
  cardCode: string,
  level: RelanceCode,
): Promise<RelancePackage> {
  assertSafeCardCode(cardCode);
  const lvl = getLevel(level);

  // 1) Factures ouvertes du client (live SAP, base réelle) — solde = DocTotal − PaidToDate.
  const invs = await sap.getAll<OpenInvoice>(
    "Invoices?$select=DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,PaidToDate"
      + `&$filter=CardCode eq '${cardCode}' and DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'`,
    { pageSize: 200, maxPages: 50, env: "prod" },
  );

  const now = new Date();
  let cardName = cardCode;
  const all: RelanceInvoice[] = [];
  for (const inv of invs) {
    if (inv.CardName) cardName = inv.CardName;
    const balance = round2((inv.DocTotal ?? 0) - (inv.PaidToDate ?? 0));
    if (balance <= 0.01) continue; // soldée (lettrée) → escalade suspendue (§6)
    const dueDate = inv.DocDueDate ? new Date(inv.DocDueDate) : null;
    all.push({
      docEntry: inv.DocEntry,
      docNum: inv.DocNum ?? null,
      docDate: inv.DocDate ? new Date(inv.DocDate) : null,
      dueDate,
      docTotal: inv.DocTotal ?? 0,
      balance,
      overdueDays: overdueDaysFor(dueDate, now),
    });
  }
  if (all.length === 0) {
    throw new RelanceInputError("Aucune facture ouverte à relancer pour ce client.");
  }

  // 2) Sélection des factures : mono-facture pour R0/R1, toutes pour R2+.
  const included = lvl.multiInvoice ? all : [mostOverdue(all)];

  // 3) Fiche locale (email compta, contact, adresse) + date de mise en demeure (R5).
  const [client, params, lastR4] = await Promise.all([
    prisma.client.findUnique({
      where: { code: cardCode },
      select: {
        id: true,
        nom: true,
        emailCompta: true,
        email: true,
        adresseFacturation: true,
        contacts: { orderBy: { position: "asc" }, take: 1, select: { name: true } },
      },
    }),
    getRelanceParams(),
    prisma.relanceLog.findFirst({
      where: { cardCode, level: "R4", status: "ENVOYE" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
  ]);

  const context = buildRelanceContext({
    client: {
      cardCode,
      raisonSociale: client?.nom ?? cardName,
      adresse: client?.adresseFacturation ?? null,
      contactNom: client?.contacts?.[0]?.name ?? null,
    },
    invoices: included,
    params,
    dateMiseEnDemeure: lastR4?.sentAt ?? null,
  });

  const rendered = renderRelance(level, context);
  // Relances = email de la COMPTABILITÉ uniquement (cf. Client.emailCompta). On
  // ne retombe PAS sur l'email général/commercial : en mode live, mieux vaut
  // rediriger vers la boîte de test (resolveRecipient) que d'adresser une mise en
  // demeure à un contact non-compta.
  const clientEmailCompta = client?.emailCompta?.trim() || null;
  const recipient = resolveRecipient(clientEmailCompta);

  return {
    cardCode,
    cardName,
    clientId: client?.id ?? null,
    clientEmailCompta,
    level,
    channel: lvl.canal,
    from: fromAddress(),
    recipient,
    context,
    rendered,
  };
}
