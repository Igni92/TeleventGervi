/**
 * COMMISSIONS COMMERCIALES — moteur UNIQUE, payées MENSUELLEMENT.
 *
 * Décision direction (07/2026) : « les commissions doivent être mises sur le
 * salaire et payées tous les mois au fur et à mesure ». L'unité de paie est
 * donc LE MOIS :
 *
 *   prime(mois) = taux × max(0, Σ max(0, marge nette de chaque facture du mois,
 *                 cadeaux neutralisés) − marge des avoirs du mois)
 *
 * Un mois négatif paie 0 (pas de déficit reporté). La prime cumulée affichée
 * (page Effectif, détail commissions) = Σ des primes mensuelles — exactement
 * ce qui est versé sur les bulletins.
 *
 * Règles par facture (identiques partout) :
 *   • cadeaux neutralisés (ligne produit offerte : 0 € / remise 100 %) ;
 *   • plancher 0 par facture ;
 *   • transport PAR POSITION via lib/transportDoc (transporteur réel du doc,
 *     repli tournée ; règle « magasin IDF = direct »).
 *
 * Consommateurs : /api/pilotage/commissions (détail), /api/commerciaux/sap
 * (page Effectif), /api/salaires (ligne de prime AUTOMATIQUE du mois).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { segmentOfGroup } from "@/lib/segments";
import { emailFromInitials, normalizeSlp, SALESPEOPLE } from "@/lib/salespeople";
import { listAllCommissionPayouts } from "@/lib/salairesRh";
import { loadDocTransportContext, docTransportCost, GIFT_LINE_SQL } from "@/lib/transportDoc";
import {
  PRIME_DEFAULT_RATE, PRIME_DEFAULT_START, r2, monthOf,
  primeRateOf, commissionMonths,
  type PrimeConfig,
  type CommissionInvoice, type CommissionCreditNote, type CommissionMonth, type PayslipCommission,
} from "@/lib/commissionsCalc";
import {
  loadAllCommissionRules, commissionMonthsRuled,
  type ClientMetric, type CommissionRule,
} from "@/lib/commissionRules";
import { loadCostOverrides, overridesToArrays } from "@/lib/costOverrides";

// Réexports : les consommateurs importent tout depuis lib/commissions.
export {
  PRIME_DEFAULT_RATE, PRIME_DEFAULT_START, primeRateOf, commissionMonths, prevMonth, selectPayslipMonths,
} from "@/lib/commissionsCalc";
export type {
  PrimeConfig, CommissionInvoice, CommissionCreditNote, CommissionMonth, PayslipCommission,
} from "@/lib/commissionsCalc";
/** id de la ligne de prime automatique — défini dans lib/salaires (client-safe). */
export { COMMISSION_PRIME_ID } from "@/lib/salaires";

/** Config de prime par commercial (table optionnelle → défauts silencieux). */
export async function loadPrimeConfig(): Promise<Map<string, PrimeConfig>> {
  const cfg = new Map<string, PrimeConfig>();
  try {
    const rows = await prisma.$queryRaw<{ slp: string; rate: number; since: Date; seuil: number }[]>(Prisma.sql`
      SELECT "slpName" AS slp, "rate"::float AS rate, "since",
             COALESCE("seuilKg", 0)::float AS seuil FROM "CommercialPrime"`);
    for (const r of rows) cfg.set(r.slp, { rate: Number(r.rate), since: new Date(r.since), seuilKg: Number(r.seuil) });
  } catch { /* table absente → défauts */ }
  return cfg;
}

/**
 * Audit 2026-08-13 (#10) — Condition SQL de restriction à UN commercial, robuste
 * aux formes multiples de `Client.commercial`. `slpFilter` est un trigramme
 * canonique (scope.slpName) ; on l'élargit à toutes ses représentations connues
 * (trigramme, email, localpart, nom SAP contenant le patronyme), exactement comme
 * normalizeSlp le fait côté JS pour la vue admin. Commercial non reconnu (pas dans
 * SALESPEOPLE) → repli sur l'égalité stricte (aucune forme longue connue).
 */
function slpSqlCond(slpFilter: string): Prisma.Sql {
  const canon = normalizeSlp(slpFilter);
  const sp = SALESPEOPLE.find((s) => s.initials === canon);
  if (!sp) return Prisma.sql`AND c."commercial" = ${slpFilter}`;
  const localPart = sp.email.split("@")[0].toLowerCase();
  return Prisma.sql`AND (
    upper(trim(c."commercial")) = ${sp.initials}
    OR lower(trim(c."commercial")) = ${sp.email.toLowerCase()}
    OR lower(trim(c."commercial")) = ${localPart}
    OR upper(c."commercial") LIKE ${`%${sp.surname.toUpperCase()}%`}
  )`;
}

/**
 * Données de commission FACTURE PAR FACTURE (+ avoirs) depuis la date de début
 * de prime de chaque commercial. `slpFilter` restreint à UN commercial
 * (périmètre non-admin ou détail) ; null = tous.
 */
export async function commissionData(slpFilter: string | null): Promise<{
  cfg: Map<string, PrimeConfig>;
  /** Documents GATÉS par le seuil kg (comportement hérité — chemin taux unique). */
  invoices: CommissionInvoice[];
  creditNotes: CommissionCreditNote[];
  /** Documents NON gatés (le moteur de règles décide lui-même de l'inclusion). */
  invoicesAll: CommissionInvoice[];
  creditNotesAll: CommissionCreditNote[];
  /** Métriques cumulées par (commercial × client) : kg + CA HT, sur la fenêtre `since`. */
  clientMetrics: ClientMetric[];
}> {
  // Audit 2026-08-13 (#10) — Client.commercial mélange les formes d'un même
  // vendeur (« MM », « Maxyme MANDINE - Gervifrais », email, localpart). En vue
  // filtrée (non-admin / détail) l'égalité stricte sur le trigramme écartait les
  // formes longues → un commercial voyait un périmètre plus étroit que l'admin
  // (qui charge tout puis normalise). On reproduit donc normalizeSlp côté SQL :
  // OR sur toutes les représentations connues du commercial demandé.
  const slpCond = slpFilter ? slpSqlCond(slpFilter) : Prisma.empty;

  // Coûts IMPOSÉS à la main (articles sans achat exploitable, ex. FEG5) — prioritaires.
  const { items: ovItems, costs: ovCosts } = overridesToArrays(await loadCostOverrides());

  const [cfg, invRows, cnRows, costRows, discRows] = await Promise.all([
    loadPrimeConfig(),
    prisma.$queryRaw<{
      slp: string; de: number; dn: number | null; dd: Date; card: string; name: string | null;
      total: number; marge: number; mcad: number; mdiv: number; cid: string; zip: string | null;
      trsp: string | null; gc: number | null; gn: string | null; kg: number;
    }[]>(Prisma.sql`
      SELECT c."commercial" AS slp, i."docEntry" AS de, i."docNum" AS dn, i."docDate" AS dd,
             i."cardCode" AS card, i."cardName" AS name, i."docTotal"::float AS total,
             COALESCE(i."grossProfit", 0)::float AS marge,
             COALESCE(SUM(l."grossProfit") FILTER (WHERE ${Prisma.raw(GIFT_LINE_SQL)}), 0)::float AS mcad,
             -- Lignes DIVERS AVEC revenu (les DIVERS à 0 € sont déjà pris par GIFT_LINE_SQL).
             -- À écarter : les « divers » ne se décomptent pas de la marge/commission.
             COALESCE(SUM(l."grossProfit") FILTER (WHERE l."itemCode" ILIKE 'DIVERS%' AND NOT (l."lineTotal" BETWEEN -0.005 AND 0.005)), 0)::float AS mdiv,
             c."id" AS cid, c."zipCode" AS zip, i."trspCode" AS trsp,
             sbp."groupCode" AS gc, sbp."groupName" AS gn,
             COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS kg
      FROM "SapInvoice" i
      JOIN "Client" c ON c."code" = i."cardCode"
      LEFT JOIN "SapBusinessPartner" sbp ON sbp."cardCode" = i."cardCode"
      LEFT JOIN "CommercialPrime" pr ON pr."slpName" = c."commercial"
      LEFT JOIN "SapInvoiceLine" l ON l."docEntry" = i."docEntry"
      LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
      WHERE i."cancelled" = false
        AND c."commercial" IS NOT NULL AND c."commercial" <> ''
        AND i."docDate" >= COALESCE(pr."since", ${PRIME_DEFAULT_START})
        ${slpCond}
      GROUP BY 1, i."docEntry", c."id", sbp."cardCode"
      ORDER BY i."docDate" DESC, i."docEntry" DESC`),
    prisma.$queryRaw<{
      slp: string; de: number; dn: number | null; dd: Date; card: string; name: string | null;
      total: number; marge: number;
    }[]>(Prisma.sql`
      SELECT c."commercial" AS slp, n."docEntry" AS de, n."docNum" AS dn, n."docDate" AS dd,
             n."cardCode" AS card, n."cardName" AS name, n."docTotal"::float AS total,
             COALESCE(n."grossProfit", 0)::float AS marge
      FROM "SapCreditNote" n
      JOIN "Client" c ON c."code" = n."cardCode"
      LEFT JOIN "CommercialPrime" pr ON pr."slpName" = c."commercial"
      WHERE n."cancelled" = false
        AND c."commercial" IS NOT NULL AND c."commercial" <> ''
        AND n."docDate" >= COALESCE(pr."since", ${PRIME_DEFAULT_START})
        ${slpCond}
      ORDER BY n."docDate" DESC, n."docEntry" DESC`),
    // ── CORRECTION DES COÛTS (par facture) — « passer par TeleVent » ─────────
    // Le coût du Service Layer SAP (lineCost) est PEU FIABLE (manquant ou aberrant).
    // On utilise donc EN PRIORITÉ le VRAI coût d'ACHAT TeleVent (EM / SapPdnLine).
    // Coût effectif d'une ligne =
    //   1) coût IMPOSÉ à la main (override) s'il existe, sinon
    //   2) MÉDIANE BASSE du coût d'achat EM de l'ARTICLE pour le MOIS de la facture
    //      → repli médiane EM toute période de l'article → repli médiane de la
    //      FAMILLE (Product.groupName), sinon
    //   3) coût SAP (dernier recours, aucun achat connu).
    // `correction` = Σ (coût effectif − coût SAP) × qté — peut être négative (le
    // coût d'achat réel peut être INFÉRIEUR au coût SAP → marge relevée). Soustraite
    // de la marge brute.
    prisma.$queryRaw<{ de: number; correction: number }[]>(Prisma.sql`
      WITH em_month AS (
        SELECT pl."itemCode" AS item, to_char(pn."docDate", 'YYYY-MM') AS mois,
               percentile_disc(0.5) WITHIN GROUP (ORDER BY pl."lineTotal" / NULLIF(pl."quantity", 0))::float AS med
        FROM "SapPdnLine" pl JOIN "SapPurchaseDeliveryNote" pn ON pn."docEntry" = pl."docEntry"
        WHERE pl."quantity" > 0 AND pl."lineTotal" > 0 AND pl."isService" = false AND pn."cancelled" = false
        GROUP BY 1, 2
      ),
      em_all AS (
        SELECT pl."itemCode" AS item,
               percentile_disc(0.5) WITHIN GROUP (ORDER BY pl."lineTotal" / NULLIF(pl."quantity", 0))::float AS med
        FROM "SapPdnLine" pl JOIN "SapPurchaseDeliveryNote" pn ON pn."docEntry" = pl."docEntry"
        WHERE pl."quantity" > 0 AND pl."lineTotal" > 0 AND pl."isService" = false AND pn."cancelled" = false
        GROUP BY 1
      ),
      fam_all AS (
        SELECT p."groupName" AS grp,
               percentile_disc(0.5) WITHIN GROUP (ORDER BY pl."lineTotal" / NULLIF(pl."quantity", 0))::float AS med
        FROM "SapPdnLine" pl JOIN "SapPurchaseDeliveryNote" pn ON pn."docEntry" = pl."docEntry"
        JOIN "Product" p ON p."itemCode" = pl."itemCode"
        WHERE pl."quantity" > 0 AND pl."lineTotal" > 0 AND pl."isService" = false AND pn."cancelled" = false
        GROUP BY 1
      ),
      ov AS (SELECT * FROM unnest(${ovItems}::text[], ${ovCosts}::float[]) AS t(item, cost))
      SELECT l."docEntry" AS de,
             SUM(
               (COALESCE(
                  ovm.cost,
                  -- Garde-fou : la médiane du MOIS n'est retenue que si elle reste
                  -- dans [0,5× ; 2×] la médiane PÉRIODE (sinon mois atypique →
                  -- on prend la période, plus robuste). Repli famille en dernier.
                  CASE
                    WHEN emm.med IS NOT NULL AND ema.med IS NOT NULL
                         AND emm.med BETWEEN 0.5 * ema.med AND 2 * ema.med THEN emm.med
                    WHEN ema.med IS NOT NULL THEN ema.med
                    WHEN emm.med IS NOT NULL THEN emm.med
                    ELSE fam.med
                  END,
                  l."lineCost", 0
                ) - COALESCE(l."lineCost", 0))
               * l."quantity"
             )::float AS correction
      FROM "SapInvoiceLine" l
      JOIN "SapInvoice" i ON i."docEntry" = l."docEntry"
      JOIN "Client" c ON c."code" = i."cardCode"
      LEFT JOIN "CommercialPrime" pr ON pr."slpName" = c."commercial"
      LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
      LEFT JOIN em_month emm ON emm.item = l."itemCode" AND emm.mois = to_char(i."docDate", 'YYYY-MM')
      LEFT JOIN em_all ema ON ema.item = l."itemCode"
      LEFT JOIN fam_all fam ON fam.grp = p."groupName"
      LEFT JOIN ov ovm ON ovm.item = l."itemCode"
      WHERE i."cancelled" = false
        AND c."commercial" IS NOT NULL AND c."commercial" <> ''
        AND l."lineTotal" > 0 AND l."isService" = false
        AND l."itemCode" NOT ILIKE 'DIVERS%'
        AND i."docDate" >= COALESCE(pr."since", ${PRIME_DEFAULT_START})
        ${slpCond}
      GROUP BY l."docEntry"`),
    // ── REMISE D'EN-TÊTE (par facture) ──────────────────────────────────────
    // SAP calcule `grossProfit` sur le CA AVANT remise de document. Une remise
    // globale réduit le CA encaissé (docTotal) sans réduire cette marge → la
    // marge commissionnée est surévaluée du montant de la remise. On la déduit :
    // remise = max(0, Σ total des lignes − docTotal HT). Pas de remise ⇒ 0.
    prisma.$queryRaw<{ de: number; discount: number }[]>(Prisma.sql`
      SELECT l."docEntry" AS de,
             GREATEST(0, SUM(l."lineTotal") - MAX(i."docTotal"))::float AS discount
      FROM "SapInvoiceLine" l
      JOIN "SapInvoice" i ON i."docEntry" = l."docEntry"
      JOIN "Client" c ON c."code" = i."cardCode"
      LEFT JOIN "CommercialPrime" pr ON pr."slpName" = c."commercial"
      WHERE i."cancelled" = false
        AND c."commercial" IS NOT NULL AND c."commercial" <> ''
        AND i."docDate" >= COALESCE(pr."since", ${PRIME_DEFAULT_START})
        ${slpCond}
      GROUP BY l."docEntry"`),
  ]);
  const costCorrection = new Map<number, number>();
  for (const r of costRows) costCorrection.set(Number(r.de), Number(r.correction) || 0);
  const headerDiscount = new Map<number, number>();
  for (const r of discRows) headerDiscount.set(Number(r.de), Number(r.discount) || 0);

  const ctx = await loadDocTransportContext(invRows.map((r) => r.card));

  const invoices: CommissionInvoice[] = invRows.map((r) => {
    const kg = Number(r.kg);
    const cadeaux = Math.max(0, -Number(r.mcad));
    // Marge brute SAP (cadeaux neutralisés) MOINS la correction des coûts manquants
    // (coût estimé médiane basse article/famille des lignes sans prix de revient).
    const costEstim = costCorrection.get(Number(r.de)) ?? 0;
    const discount = headerDiscount.get(Number(r.de)) ?? 0;
    // marge brute = marge SAP − cadeaux − DIVERS(avec revenu) − correction coût − remise.
    const margeBrute = Number(r.marge) - Number(r.mcad) - Number(r.mdiv) - costEstim - discount;
    const t = docTransportCost(ctx, {
      cardCode: r.card, clientId: r.cid, zip: r.zip, kg, trspCode: r.trsp,
      segment: segmentOfGroup(r.gn, r.gc),
    });
    const margeNette = margeBrute - t.cost;
    return {
      slp: r.slp,
      docEntry: r.de,
      docNum: r.dn,
      docDate: r.dd,
      month: monthOf(r.dd),
      cardCode: r.card,
      cardName: r.name,
      caHt: Number(r.total),
      margeBrute: r2(margeBrute),
      cadeaux: r2(cadeaux),
      costEstimated: r2(costEstim),
      kg,
      transport: r2(t.cost),
      carrier: t.carrier,
      mode: t.mode,
      fromDoc: t.fromDoc,
      margeNette: r2(margeNette),
      plancher: margeNette < 0,
    };
  });

  const creditNotes: CommissionCreditNote[] = cnRows.map((r) => ({
    slp: r.slp,
    docEntry: r.de,
    docNum: r.dn,
    docDate: r.dd,
    month: monthOf(r.dd),
    cardCode: r.card,
    cardName: r.name,
    caHt: Number(r.total),
    margeBrute: Number(r.marge),
  }));

  // ── PORTE DU SEUIL (poids livré) ────────────────────────────────────────
  // Un client n'est « acquis » (donc commissionné) qu'une fois son poids livré
  // CUMULÉ — sur la fenêtre `since` déjà appliquée par le SQL — au-dessus du
  // seuil de SON commercial. En dessous : aucune de ses factures/avoirs
  // n'entre dans la base. Au franchissement, tout bascule d'un coup (rétroactif,
  // recalculé en direct à chaque lecture/paie). Seuil 0 ⇒ aucune restriction.
  // Le cumul est calculé par (commercial × client) : un client n'a qu'un seul
  // `commercial`, on somme donc son poids livré brut (factures ; les avoirs ne
  // déduisent pas les kg — « livré » = livré).
  const kgKey = (slp: string, card: string) => `${slp} ${card}`;
  const kgByClient = new Map<string, number>();
  for (const f of invoices) kgByClient.set(kgKey(f.slp, f.cardCode), (kgByClient.get(kgKey(f.slp, f.cardCode)) ?? 0) + f.kg);
  const acquired = (slp: string, card: string): boolean => {
    const seuil = cfg.get(slp)?.seuilKg ?? 0;
    return seuil <= 0 || (kgByClient.get(kgKey(slp, card)) ?? 0) >= seuil;
  };

  // Métriques cumulées par (commercial × client) : kg + CA HT — pour le moteur de
  // règles et l'état d'avancement (la porte du seuil héritée n'utilise que kg).
  const metricsMap = new Map<string, ClientMetric>();
  for (const f of invoices) {
    const k = kgKey(f.slp, f.cardCode);
    let m = metricsMap.get(k);
    if (!m) { m = { slp: f.slp, cardCode: f.cardCode, cardName: f.cardName, kg: 0, caht: 0 }; metricsMap.set(k, m); }
    m.kg += f.kg;
    m.caht += f.caHt;
  }

  return {
    cfg,
    invoices: invoices.filter((f) => acquired(f.slp, f.cardCode)),
    creditNotes: creditNotes.filter((n) => acquired(n.slp, n.cardCode)),
    invoicesAll: invoices,
    creditNotesAll: creditNotes,
    clientMetrics: [...metricsMap.values()],
  };
}

/**
 * SOLDE DE COMMISSION par EMAIL de salarié — modèle « en montants » (plus de
 * curseur « réglé jusqu'à ») :
 *
 *   dû   = Σ des primes mensuelles depuis le début (tous les mois)
 *   payé = Σ des versements € saisis par la direction (registre `commpayout:`)
 *   écart = dû − payé   (positif = reste dû, négatif = trop-payé)
 *
 * `prime` (montant porté au bulletin) = l'écart ; withCommission n'injecte la
 * ligne que si l'écart est POSITIF (jamais de reprise auto d'un trop-payé, qui
 * se régularise au solde de tout compte). Aligné sur le relevé de la page
 * Effectif (dueCumul / paidLedger / solde) : les deux vues affichent le même €.
 */
export async function commissionBalances(): Promise<Map<string, PayslipCommission>> {
  const out = new Map<string, PayslipCommission>();
  // Audit 2026-08-13 (#11) — PAS de try/catch qui avale l'erreur ici. L'ancienne
  // version renvoyait une Map vide sur la moindre panne (SAP indispo, SQL, timeout)
  // → les bulletins partaient à 0 € de commission EN SILENCE. On laisse remonter :
  // les deux appelants (GET état + POST envoi, dans app/api/salaires/route.ts)
  // encadrent déjà l'appel d'un try/catch qui renvoie un 500 visible et, côté
  // envoi, bloque l'e-mail au cabinet — jamais de bulletin à 0 émis à l'insu.
  const [
    { cfg, invoices, creditNotes, invoicesAll, creditNotesAll, clientMetrics },
    payoutsAll, rulesBySlp,
  ] = await Promise.all([
    commissionData(null),
    listAllCommissionPayouts(),
    loadAllCommissionRules(),
  ]);
  const canon = (s: string) => normalizeSlp(s) ?? s;

  // Audit 2026-08-13 (#2) — MÊME chemin que /api/effectif/commissions, pour que
  // bulletin, PDF de vérif et écran État affichent le MÊME montant : bascule sur
  // les règles PERSONNALISÉES quand elles existent (superset non gaté + métriques
  // par client), sinon chemin HÉRITÉ (seuil kg + % marge). Auparavant
  // commissionBalances passait toujours par le chemin par défaut → un commercial
  // à règles perso était payé sur un calcul différent de son écran.

  // Config de prime ramenée au trigramme canonique (CommercialPrime.slpName est
  // saisi à la main : un taux défini sous « MM » serait perdu sinon). Doublon →
  // on garde la date de début la plus ANCIENNE (ne pas amputer l'historique).
  const cfgCanon = new Map<string, PrimeConfig>();
  for (const [k, v] of cfg) {
    const c = canon(k);
    const prev = cfgCanon.get(c);
    if (!prev || v.since < prev.since) cfgCanon.set(c, v);
  }
  // Règles de commission configurées, ramenées au trigramme canonique.
  const rulesCanon = new Map<string, CommissionRule[]>();
  for (const [k, rs] of rulesBySlp) {
    const c = canon(k);
    if (rs.length && !rulesCanon.has(c)) rulesCanon.set(c, rs);
  }
  // Métriques par client (kg + CA HT cumulés), groupées par commercial canonique.
  const metricsBySlp = new Map<string, ClientMetric[]>();
  for (const m of clientMetrics) {
    const c = canon(m.slp);
    const arr = metricsBySlp.get(c);
    if (arr) arr.push(m); else metricsBySlp.set(c, [m]);
  }

  // Superset des commerciaux depuis les documents NON gatés : un client sous le
  // seuil kg peut être commissionné par une règle CA HT → il doit compter.
  const slps = new Set<string>();
  for (const f of invoicesAll) slps.add(canon(f.slp));
  for (const n of creditNotesAll) slps.add(canon(n.slp));

  for (const slp of slps) {
    const email = emailFromInitials(slp)?.toLowerCase();
    if (!email) continue;
    const rate = cfgCanon.get(slp)?.rate ?? primeRateOf(cfg, slp);
    const customRules = rulesCanon.get(slp);
    const hasCustomRules = !!(customRules && customRules.length);
    const metrics = metricsBySlp.get(slp) ?? [];

    // Règles perso → moteur de règles sur le superset non gaté ; sinon chemin
    // hérité (documents gatés par le seuil kg + taux unique), à l'identique de la route.
    const months = hasCustomRules
      ? commissionMonthsRuled(
          invoicesAll.filter((f) => canon(f.slp) === slp),
          creditNotesAll.filter((n) => canon(n.slp) === slp),
          customRules!,
          new Map(metrics.map((m) => [m.cardCode, { kg: m.kg, caht: m.caht }])),
        )
      : commissionMonths(
          invoices.filter((f) => canon(f.slp) === slp),
          creditNotes.filter((n) => canon(n.slp) === slp),
          rate,
        );

    if (months.length === 0) continue;
    const due = r2(months.reduce((s, m) => s + m.prime, 0));
    const base = r2(months.reduce((s, m) => s + m.base, 0));
    const paid = r2((payoutsAll.get(slp) ?? []).reduce((s, p) => s + p.amount, 0));
    const ecart = r2(due - paid);
    // Détail mois par mois (ancien → récent).
    const detail = [...months]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({ month: m.month, base: m.base, prime: m.prime, invoices: m.invoices, avoirs: m.avoirs }));
    out.set(email, {
      slp, rate, base,
      prime: ecart,            // montant porté au bulletin = reste à payer (écart)
      fromMonth: detail[0].month,
      toMonth: detail[detail.length - 1].month,
      monthsCount: months.length,
      months: detail,
      due, paid, ecart,
    });
  }
  return out;
}
