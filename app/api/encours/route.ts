import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { netEncours } from "@/lib/encours-net";
import { attributeAvoirs, type CreditNoteRef } from "@/lib/encours-avoirs";
import { cached, invalidate } from "@/lib/ttlCache";
// Audit 2026-08-13 (#21-encours) : bornes de JOUR Europe/Paris pour le calcul du
// retard (le serveur tourne en UTC ; sans ça, les tranches d'ancienneté peuvent
// basculer selon l'heure d'exécution). Même logique que overdueDaysFor (relance).
import { parisStartOfDay } from "@/lib/paris-time";

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
 * ⚠️ Une facture est « en retard » DÈS que l'échéance (DocDueDate) est dépassée :
 * l'échéance SAP inclut déjà le délai de paiement (30 j), on n'ajoute donc AUCUNE
 * grâce supplémentaire (sinon double compte). Paliers d'ancienneté de retard
 * (jours écoulés depuis l'échéance) : ≤ 45 j / 45-90 j / > 90 j.
 */
export const dynamic = "force-dynamic";
// Agrégation SAP lourde (toutes les factures ouvertes + soldes clients, paginés).
// Évite un timeout au seuil court par défaut des fonctions serverless.
export const maxDuration = 60;

const GRACE_DAYS = 0; // en retard dès le dépassement de l'échéance (DocDueDate)
const ENCOURS_TTL_MS = 60_000; // cache court par périmètre (reloads quasi instantanés ; ?refresh=1 force)

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
// Avoir client (CreditNote) lu en direct, avec ses lignes : on récupère le lien
// vers la facture d'origine (BaseType=13 → BaseEntry = DocEntry facture).
interface CreditNoteDoc {
  DocEntry: number;
  DocNum?: number;
  DocDate?: string;
  CardCode: string;
  DocTotal?: number;   // montant TTC de l'avoir (positif)
  DocumentLines?: { BaseType?: number; BaseEntry?: number }[];
}

/** Avoir attribué à une facture (n° d'avoir, date, montant imputé). */
interface AttributedAvoir {
  docEntry: number;
  docNum: number | null;
  docDate: string | null;
  amount: number;
}
interface InvoiceLine {
  docEntry: number;
  docNum: number | null;
  docDate: string | null;
  dueDate: string | null;
  balance: number;     // solde dû (brut, par facture)
  overdueDays: number; // jours au-delà de l'échéance (0 si à jour)
  avoirs: AttributedAvoir[]; // avoirs rattachés à CETTE facture (BaseEntry SAP)
  avoirsTotal: number;       // somme des avoirs attribués (positif)
  net: number;               // solde net facture = balance − avoirsTotal (≥ 0)
}
interface ClientEncours {
  cardCode: string;
  cardName: string;
  clientId: string | null;
  emailCompta: string | null; // destinataire(s) des relances (joint par « , ») — best-effort
  encours: number;     // NET dû (= brut − encaissé − avoirs attribués) — INCHANGÉ
  brut: number;        // somme des factures ouvertes (avant déduction)
  // Déduction globale (brut − net) scindée en DEUX postes distincts :
  //   - encaisse : PAIEMENTS + avoirs non rattachables (sac global, EN LIGNE) ;
  //   - avoirsAttribues : avoirs ré-imputés à une facture précise (affichés sous
  //     la facture). encaisse + avoirsAttribues == ancien « encaissé » global
  //     → le net total ne change pas.
  encaisse: number;        // paiements + avoirs NON affectés (déduit en ligne)
  avoirsAttribues: number; // avoirs rattachés à une facture (déduit par facture)
  // Avoirs EN FAVEUR du client non imputés à une facture ouverte (ligne bleue) :
  // à déduire d'une facture ultérieure. Peuplé seulement quand les avoirs sont
  // chargés (bulk = ENCOURS_AVOIRS_BULK, ou via l'endpoint lazy /avoirs).
  avoirsNonImputes: AttributedAvoir[];
  avoirsNonImputesTotal: number;
  countOpen: number;   // nb factures avec solde dû
  // Paliers de retard EXCLUSIFS, au BRUT : on garde le solde brut des factures
  // pour le classement par ancienneté (cohérent avec l'historique). Les avoirs
  // attribués s'affichent SOUS la facture mais n'altèrent pas les tranches.
  b3045: number;       // 30 < retard ≤ 45 j
  b4590: number;       // 45 < retard ≤ 90 j
  b90: number;         // retard > 90 j
  countLate: number;   // nb factures en retard (> 30 j)
  maxOverdueDays: number;
  invoices: InvoiceLine[];
}

const OPEN_FILTER = "DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'";
const INV_SELECT = "DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,PaidToDate";

/** Factures ouvertes (live SAP) — pagination PARALLÈLE (getAllParallel),
 *  repli séquentiel si l'endpoint /$count est indisponible. */
async function fetchOpenInvoices(): Promise<OpenInvoice[]> {
  const path = `Invoices?$select=${INV_SELECT}&$filter=${OPEN_FILTER}`;
  try {
    return await sap.getAllParallel<OpenInvoice>(path, `Invoices/$count?$filter=${OPEN_FILTER}`, {
      pageSize: 500,
      maxPages: 100,
      env: "prod",
    });
  } catch (e) {
    console.error("[encours] pagination parallèle KO → repli séquentiel:", e);
    return sap.getAll<OpenInvoice>(path, { pageSize: 500, maxPages: 100, env: "prod" });
  }
}

/**
 * Soldes compte tiers (CurrentAccountBalance) UNIQUEMENT pour les cardCodes
 * utiles (clients ayant une facture due, dans le périmètre) — au lieu de lire
 * TOUS les tiers SAP. Paquets parallèles ; best-effort (un paquet KO n'empêche
 * pas les autres → ces clients retombent simplement sur le brut).
 */
async function fetchBalances(cardCodes: string[]): Promise<{ map: Map<string, number>; failedChunks: number }> {
  const map = new Map<string, number>();
  const CHUNK = 40;
  const chunks: string[][] = [];
  for (let i = 0; i < cardCodes.length; i += CHUNK) chunks.push(cardCodes.slice(i, i + CHUNK));
  const results = await Promise.all(
    chunks.map((chunk) => {
      const filter = chunk.map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
      return sap
        .getAll<BpBalance>(
          `BusinessPartners?$select=CardCode,CurrentAccountBalance&$filter=${filter}`,
          { pageSize: 100, maxPages: 2, env: "prod" },
        )
        // Audit 2026-08-13 (#14) : on ne renvoie plus [] « silencieux » sur un
        // paquet KO. Un paquet en échec laisse ses clients sans solde (repli sur
        // le brut) ; sans signalement, la réponse affichait ok:true en masquant
        // que du déjà-payé n'a pas été déduit. On renvoie `null` pour COMPTER le
        // paquet échoué et propager un état partiel à l'appelant.
        .catch((e) => {
          console.error("[encours] lecture d'un paquet de soldes échouée (repli brut partiel):", e);
          return null;
        });
    }),
  );
  let failedChunks = 0;
  for (const arr of results) {
    if (arr === null) { failedChunks++; continue; }
    for (const b of arr) {
      if (typeof b.CurrentAccountBalance === "number") map.set(b.CardCode, b.CurrentAccountBalance);
    }
  }
  return { map, failedChunks };
}

/**
 * Avoirs clients (CreditNotes) NON annulés, UNIQUEMENT pour les cardCodes utiles.
 * On lit les DocumentLines pour récupérer le lien vers la facture d'origine
 * (BaseType=13 = Invoice → BaseEntry = DocEntry de la facture). Best-effort : un
 * paquet KO → ces clients n'auront pas d'avoir attribué (ils retombent sur le
 * comportement actuel = avoir laissé dans le sac « encaissé » global).
 *
 * NB : pas de filtre sur le statut de l'avoir. Un avoir réconcilié a déjà
 * augmenté le PaidToDate de sa facture (le solde brut est donc déjà net de lui),
 * un avoir ouvert a déjà baissé le CurrentAccountBalance : dans les deux cas le
 * garde-fou anti double-comptage de lib/encours-avoirs plafonne l'attribution
 * par l'« encaissé » réel, donc lire tous les avoirs récents est sans risque.
 */
async function fetchCreditNotes(cardCodes: string[]): Promise<{ byClient: Map<string, CreditNoteRef[]>; failedChunks: number }> {
  const byClient = new Map<string, CreditNoteRef[]>();
  if (cardCodes.length === 0) return { byClient, failedChunks: 0 };
  const CHUNK = 30; // plus petit : on tire les DocumentLines (payload plus lourd)
  const chunks: string[][] = [];
  for (let i = 0; i < cardCodes.length; i += CHUNK) chunks.push(cardCodes.slice(i, i + CHUNK));
  const results = await Promise.all(
    chunks.map((chunk) => {
      const filter =
        "Cancelled eq 'tNO' and (" +
        chunk.map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`).join(" or ") +
        ")";
      return sap
        .getAll<CreditNoteDoc>(
          `CreditNotes?$select=DocEntry,DocNum,DocDate,CardCode,DocTotal,DocumentLines&$filter=${filter}`,
          { pageSize: 100, maxPages: 5, env: "prod" },
        )
        // Audit 2026-08-13 (#14) : idem soldes — un paquet d'avoirs KO n'est plus
        // avalé en silence. On renvoie `null` pour le compter (les clients du
        // paquet retombent sur le comportement sans avoir attribué).
        .catch((e) => {
          console.error("[encours] lecture d'un paquet d'avoirs échouée (avoirs ignorés):", e);
          return null;
        });
    }),
  );
  let failedChunks = 0;
  for (const arr of results) {
    if (arr === null) { failedChunks++; continue; }
    for (const d of arr) {
      // 1ère ligne pointant une facture (BaseType=13) → facture d'origine.
      let baseInvoiceEntry: number | null = null;
      for (const l of d.DocumentLines ?? []) {
        if (l.BaseType === 13 && l.BaseEntry != null) { baseInvoiceEntry = l.BaseEntry; break; }
      }
      const list = byClient.get(d.CardCode) ?? [];
      list.push({
        docEntry: d.DocEntry,
        docNum: d.DocNum ?? null,
        docDate: d.DocDate ?? null,
        amount: Math.abs(d.DocTotal ?? 0),
        baseInvoiceEntry,
      });
      byClient.set(d.CardCode, list);
    }
  }
  return { byClient, failedChunks };
}

export async function GET(req: Request) {
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

  // Cache court PAR PÉRIMÈTRE (l'agrégation SAP est lourde) ; ?refresh=1 force.
  const cacheKey = `encours:${scope.all ? "ALL" : (scope.slpName ?? "none")}`;
  if (new URL(req.url).searchParams.get("refresh") === "1") invalidate(cacheKey);
  try {
    const payload = await cached(cacheKey, ENCOURS_TTL_MS, () => computeEncours(allowed));
    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Lecture SAP échouée : ${msg}` }, { status: 502 });
  }
}

async function computeEncours(allowed: Set<string> | null) {
  const invs = await fetchOpenInvoices();

  // Soldes compte : on ne lit QUE les clients ayant une facture ouverte due (et
  // dans le périmètre commercial) — au lieu de TOUS les tiers SAP. Best-effort :
  // si une lecture échoue, ces clients retombent sur le brut.
  const neededCodes = new Set<string>();
  for (const inv of invs) {
    if (allowed && !allowed.has(inv.CardCode)) continue;
    if ((inv.DocTotal ?? 0) - (inv.PaidToDate ?? 0) > 0.01) neededCodes.add(inv.CardCode);
  }
  // Soldes compte + avoirs (avec lien facture d'origine) pour les mêmes clients,
  // en parallèle.
  const [balancesResult, creditNotesResult] = await Promise.all([
    fetchBalances([...neededCodes]),
    // ⚠️ PERF : la lecture EN MASSE des avoirs (CreditNotes + DocumentLines pour
    // tous les clients) faisait dépasser le timeout Vercel (504 → écran vide).
    // Désactivée par défaut. À réactiver via un calcul PAR CLIENT à l'ouverture
    // du détail (chantier « avoirs lazy »). Opt-in explicite par flag d'env.
    process.env.ENCOURS_AVOIRS_BULK === "1"
      ? fetchCreditNotes([...neededCodes])
      : Promise.resolve({ byClient: new Map<string, CreditNoteRef[]>(), failedChunks: 0 }),
  ]);
  const cabByCode = balancesResult.map;
  const creditNotesByCode = creditNotesResult.byClient;
  // Audit 2026-08-13 (#14) : total des paquets SAP (soldes + avoirs) tombés en
  // échec → propagé en `partial`/`failedChunks` dans la réponse (l'UI n'est pas
  // dans mon périmètre : elle devra afficher un bandeau « données partielles »).
  const failedChunks = balancesResult.failedChunks + creditNotesResult.failedChunks;

  // Audit 2026-08-13 (#21-encours) : « aujourd'hui » = début de journée Paris (et
  // non l'instant UTC), pour aligner le calcul du retard sur overdueDaysFor.
  const nowParis = parisStartOfDay().getTime();
  const byClient = new Map<string, ClientEncours>();

  for (const inv of invs) {
    if (allowed && !allowed.has(inv.CardCode)) continue; // hors périmètre commercial
    const bal = (inv.DocTotal ?? 0) - (inv.PaidToDate ?? 0);
    if (bal <= 0.01) continue; // soldée (arrondi)
    // Audit 2026-08-13 (#21-encours) : bornes de JOUR Paris des deux côtés (jour
    // courant ET échéance), au lieu d'un delta UTC brut qui décalait le nombre de
    // jours — et donc la tranche d'ancienneté — selon l'heure d'exécution.
    const due = inv.DocDueDate ? parisStartOfDay(new Date(inv.DocDueDate)).getTime() : null;
    const overdueDays = due !== null ? Math.max(0, Math.floor((nowParis - due) / 86_400_000)) : 0;
    const late = overdueDays > GRACE_DAYS; // en retard seulement passé 30 j

    const e = byClient.get(inv.CardCode) ?? {
      cardCode: inv.CardCode, cardName: inv.CardName ?? inv.CardCode, clientId: null, emailCompta: null,
      encours: 0, brut: 0, encaisse: 0, avoirsAttribues: 0,
      avoirsNonImputes: [] as AttributedAvoir[], avoirsNonImputesTotal: 0, countOpen: 0,
      b3045: 0, b4590: 0, b90: 0,
      countLate: 0, maxOverdueDays: 0, invoices: [] as InvoiceLine[],
    };
    e.encours += bal; // brut pour l'instant — mis au net après la boucle
    e.countOpen++;
    // Tranches EXCLUSIVES : la facture ne tombe que dans une seule.
    if (overdueDays > 90) e.b90 += bal;
    else if (overdueDays > 45) e.b4590 += bal;
    else if (overdueDays > GRACE_DAYS) e.b3045 += bal;   // 0 < retard ≤ 45 j
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
      avoirs: [],            // rempli après la boucle (attribution des avoirs)
      avoirsTotal: 0,
      net: Math.round(bal * 100) / 100,
    });
    byClient.set(inv.CardCode, e);
  }

  // Mise au NET : net = brut − déduction (solde compte tiers). La déduction
  // (brut − net) regroupe paiements ET avoirs non encore affectés. On NE touche
  // PAS au net (cf. lib/encours-avoirs : un avoir a déjà impacté soit le solde
  // brut de sa facture, soit le solde compte). On se contente de SCINDER cette
  // déduction : la part expliquée par des avoirs rattachables à une facture
  // ouverte est ré-imputée SOUS la facture ; le reste (paiements + avoirs non
  // affectés) reste dans le sac global « encaisse ».
  for (const e of byClient.values()) {
    const cab = cabByCode.has(e.cardCode) ? cabByCode.get(e.cardCode)! : null;
    const { net, encaisse } = netEncours(e.encours, cab);
    e.brut = e.encours;
    e.encours = net;

    // Attribution des avoirs aux factures (plafonnée par l'encaissé → anti
    // double-comptage). attributedTotal SORT du sac « encaisse ».
    const cns = creditNotesByCode.get(e.cardCode) ?? [];
    const attr = attributeAvoirs(
      e.invoices.map((i) => ({ docEntry: i.docEntry, balance: i.balance })),
      cns,
      encaisse,
    );
    e.avoirsAttribues = attr.attributedTotal;
    // Avoirs en faveur (non imputés, bleus) : sortis eux aussi du sac « encaisse »
    // → l'« encaisse » résiduel affiché ne reste QUE les règlements.
    e.avoirsNonImputes = attr.unattributed.map((a) => ({
      docEntry: a.docEntry, docNum: a.docNum, docDate: a.docDate, amount: Math.round(a.amount * 100) / 100,
    }));
    e.avoirsNonImputesTotal = Math.round(attr.unattributed.reduce((s, a) => s + a.amount, 0) * 100) / 100;
    e.encaisse = Math.round((encaisse - attr.attributedTotal - e.avoirsNonImputesTotal) * 100) / 100;
    for (const inv of e.invoices) {
      const list = attr.byInvoice.get(inv.docEntry);
      if (!list || list.length === 0) continue;
      inv.avoirs = list;
      inv.avoirsTotal = Math.round(list.reduce((s, a) => s + a.amount, 0) * 100) / 100;
      inv.net = Math.round(Math.max(0, inv.balance - inv.avoirsTotal) * 100) / 100;
    }
  }

  // On ne liste que les clients dont le NET reste dû (le déjà-payé sort de la liste).
  const aggregated = Array.from(byClient.values())
    .filter((c) => c.encours > 0.01)
    .sort((a, b) => b.encours - a.encours);

  // Totaux : encours au NET ; tranches d'ancienneté au BRUT ; encaissé + avoirs.
  const totalEncours = aggregated.reduce((s, c) => s + c.encours, 0);
  const totalEncaisse = aggregated.reduce((s, c) => s + c.encaisse, 0);
  const totalAvoirs = aggregated.reduce((s, c) => s + c.avoirsAttribues, 0);
  const totalAvoirsNonImputes = aggregated.reduce((s, c) => s + c.avoirsNonImputesTotal, 0);
  const tot3045 = aggregated.reduce((s, c) => s + c.b3045, 0);
  const tot4590 = aggregated.reduce((s, c) => s + c.b4590, 0);
  const tot90 = aggregated.reduce((s, c) => s + c.b90, 0);

  // Lien fiche : id local par code (quand le client existe en base).
  const codes = aggregated.map((c) => c.cardCode);
  const locals = codes.length
    ? await prisma.client.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, emailCompta: true } })
    : [];
  const idByCode = new Map(locals.map((l) => [l.code, l.id]));
  const emailComptaByCode = new Map(locals.map((l) => [l.code, l.emailCompta]));

  return {
    ok: true,
    company: sap.getEnvironment().prodCompany,
    // Audit 2026-08-13 (#14) : état PARTIEL explicite. `partial=true` = au moins un
    // paquet SAP (soldes compte et/ou avoirs) a échoué → certains clients sont au
    // brut sans déduction de l'encaissé. La réponse n'est plus « ok » silencieux.
    partial: failedChunks > 0,
    failedChunks,
    totals: {
      encours: Math.round(totalEncours),
      encaisse: Math.round(totalEncaisse),
      avoirsAttribues: Math.round(totalAvoirs),
      avoirsNonImputes: Math.round(totalAvoirsNonImputes),
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
      emailCompta: emailComptaByCode.get(c.cardCode) ?? null,
      // Précision complète (cents). Encours = NET ; brut, encaissé et avoirs en plus.
      encours: Math.round(c.encours * 100) / 100,
      brut: Math.round(c.brut * 100) / 100,
      encaisse: Math.round(c.encaisse * 100) / 100,
      avoirsAttribues: Math.round(c.avoirsAttribues * 100) / 100,
      avoirsNonImputes: c.avoirsNonImputes,
      avoirsNonImputesTotal: Math.round(c.avoirsNonImputesTotal * 100) / 100,
      countOpen: c.countOpen,
      b3045: Math.round(c.b3045 * 100) / 100,
      b4590: Math.round(c.b4590 * 100) / 100,
      b90: Math.round(c.b90 * 100) / 100,
      countLate: c.countLate,
      maxOverdueDays: c.maxOverdueDays,
      invoices: [...c.invoices].sort((a, b) => b.overdueDays - a.overdueDays),
    })),
  };
}
