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
import type { CreditNoteRef } from "@/lib/encours-avoirs";
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
  /** Lignes — sert à distinguer une facture de SERVICE (prestation/location/
   *  déchet : aucune ligne avec ItemCode) d'une facture d'ARTICLE (négoce). */
  DocumentLines?: { ItemCode?: string | null; LineTotal?: number }[];
}

/**
 * Facture de SERVICE = aucune ligne « produit » (aucun ItemCode). Prestation,
 * location, refacturation, déchet… Ces relances doivent être retraitées et
 * personnalisées à la main (le modèle automatique, orienté négoce, ne convient
 * pas). Une facture d'ARTICLE a au moins une ligne avec ItemCode → relance auto.
 * Lignes absentes/inconnues → considérée ARTICLE (on ne bloque pas par défaut).
 */
function isServiceInvoice(lines: OpenInvoice["DocumentLines"]): boolean {
  if (!lines || lines.length === 0) return false;
  return !lines.some((l) => typeof l.ItemCode === "string" && l.ItemCode.trim() !== "");
}
interface CreditNoteDoc {
  DocEntry: number;
  DocNum?: number;
  DocDate?: string;
  DocTotal?: number;
  DocumentLines?: { BaseType?: number; BaseEntry?: number }[];
}

export interface RelancePackage {
  cardCode: string;
  cardName: string;
  clientId: string | null;
  clientEmailCompta: string | null;
  /** Relances activées pour ce client ? (false = décoché dans Encours → à ne pas
   *  relancer). L'aperçu reste consultable ; l'ENVOI est bloqué côté route. */
  relanceActive: boolean;
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
    "Invoices?$select=DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,PaidToDate,DocumentLines"
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
      isService: isServiceInvoice(inv.DocumentLines),
    });
  }
  if (all.length === 0) {
    throw new RelanceInputError("Aucune facture ouverte à relancer pour ce client.");
  }

  // 2) Sélection des factures : mono-facture pour R0/R1, toutes pour R2+.
  const included = lvl.multiInvoice ? all : [mostOverdue(all)];

  // 3) Fiche locale (email compta, contact, adresse) + date de mise en demeure (R5)
  //    + solde NET du compte tiers (pour soustraire l'encaissé sur les relances
  //    multi-factures = relances « compte »).
  const [client, params, lastR4, bp, creditNoteDocs] = await Promise.all([
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
    // Solde compte (SAP CurrentAccountBalance) = net de tous les encaissements/
    // avoirs (= SOLDE du grand livre). Live, donc indépendant de la resync miroir.
    lvl.multiInvoice
      ? sap
          .get<{ CurrentAccountBalance?: number }>(
            `BusinessPartners('${cardCode}')?$select=CurrentAccountBalance`,
            { env: "prod" },
          )
          // Audit 2026-08-13 (#15) : NE PLUS avaler l'échec en `null`. Avant, une
          // lecture KO du solde net du compte tiers faisait retomber le principal
          // au BRUT (openTotal) SANS aucune alerte, et la relance multi-factures
          // (mise en demeure) partait quand même avec un montant potentiellement
          // surévalué (encaissé non lettré non déduit). On propage donc l'erreur
          // pour BLOQUER l'émission (l'appelant la mappe en 502) : mieux vaut
          // refuser d'émettre qu'envoyer un montant faux dans un courrier à portée
          // juridique. (mono-facture R0/R1 : pas concerné, on garde `null`.)
          .catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(
              `Solde compte tiers (CurrentAccountBalance) illisible pour ${cardCode} — relance multi-factures bloquée (risque de surévaluation du dû) : ${msg}`,
            );
          })
      : Promise.resolve(null),
    // Avoirs du client (multi-factures uniquement) : lien facture d'origine via
    // BaseType=13 → BaseEntry. Best-effort : un échec n'empêche pas la relance
    // (le courrier omet simplement la mention des avoirs).
    lvl.multiInvoice
      ? sap
          .getAll<CreditNoteDoc>(
            "CreditNotes?$select=DocEntry,DocNum,DocDate,DocTotal,DocumentLines"
              + `&$filter=Cancelled eq 'tNO' and CardCode eq '${cardCode}'`,
            { pageSize: 100, maxPages: 10, env: "prod" },
          )
          .catch(() => [] as CreditNoteDoc[])
      : Promise.resolve([] as CreditNoteDoc[]),
  ]);

  const currentAccountBalance =
    lvl.multiInvoice && bp && typeof bp.CurrentAccountBalance === "number" ? bp.CurrentAccountBalance : null;

  // Avoirs → réf. d'attribution (montant positif + lien facture si traçable).
  const creditNotes: CreditNoteRef[] = creditNoteDocs.map((d) => {
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
    currentAccountBalance,
    creditNotes,
  });

  const rendered = renderRelance(level, context);
  // Relances = email de la COMPTABILITÉ uniquement (cf. Client.emailCompta). On
  // ne retombe PAS sur l'email général/commercial : en mode live, mieux vaut
  // rediriger vers la boîte de test (resolveRecipient) que d'adresser une mise en
  // demeure à un contact non-compta.
  const clientEmailCompta = client?.emailCompta?.trim() || null;
  const recipient = resolveRecipient(clientEmailCompta);

  // Activation des relances (colonne db-push → lue en RAW SQL, client Prisma
  // possiblement en retard). Absente / client inconnu → true (défaut).
  let relanceActive = true;
  if (client?.id) {
    try {
      const rows = await prisma.$queryRaw<{ relanceActive: boolean }[]>`
        SELECT COALESCE("relanceActive", true) AS "relanceActive" FROM "Client" WHERE "id" = ${client.id} LIMIT 1;`;
      relanceActive = rows[0]?.relanceActive ?? true;
    } catch { /* colonne absente → true */ }
  }

  return {
    cardCode,
    cardName,
    clientId: client?.id ?? null,
    clientEmailCompta,
    relanceActive,
    level,
    channel: lvl.canal,
    from: fromAddress(),
    recipient,
    context,
    rendered,
  };
}
