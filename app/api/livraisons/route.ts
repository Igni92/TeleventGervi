import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { colisInfo } from "@/lib/colis";
import { nextDeliveryDate, frenchHolidayLabel } from "@/lib/livraison";
import { getDeliveryStatuses } from "@/lib/inventory";
import { isComptoirClient } from "@/lib/segments";
import { selectCarryoverEntries } from "@/lib/livraisonCarryover";
import { getClientTournees, type ClientTournee } from "@/lib/clientTournee";
import { getClientTrclCarriers } from "@/lib/clientCarriers";
import { isLivraisonRestricted } from "@/lib/permissions";
import { isDelanchyCarrierCode } from "@/lib/carrierTariff";
import { getFeuilleSentMany } from "@/lib/carrierInfo";
import { swr } from "@/lib/swrCache";
import { isCronAuthorized } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";

/**
 * Niveau de `$select` retenu pour les Orders — MÉMORISÉ AU NIVEAU MODULE.
 *
 * Les champs custom (U_TrspCode/U_TrspHeur) et l'heure de prise (CreationTime,
 * sinon DocTime) n'existent pas sur toutes les versions du Service Layer : on
 * sonde du plus riche au plus pauvre. Déclarée DANS le handler (bug d'origine),
 * cette mémorisation était remise à zéro à chaque requête : si le SL rejetait le
 * niveau 0, CHAQUE ouverture de l'écran re-payait 1 à 3 allers-retours SAP voués
 * à l'échec — multipliés par le nombre de pages de commandes ET par chaque
 * tranche de report. Hissée ici, la sonde n'est payée qu'une fois par process.
 */
let ordersSelIdx = 0;
// Écran interrogeant SAP : sans plafond explicite, un SAP lent dépassait la durée
// par défaut de la fonction, qui mourait SANS réponse — côté front, un « chargement »
// perpétuel au lieu d'une erreur affichable.
export const maxDuration = 60;

/**
 * ISO local de la PRISE de la commande dans le système (création SAP) :
 * CreationDate (jour) + CreationTime/DocTime — « 10:48:00 », « 1048 » ou 1048
 * selon la version du Service Layer. Sans heure exploitable → null (une date
 * seule n'apporte rien à l'affichage « Prise · HH:MM »).
 */
function sapCreationISO(date?: string, time?: string | number | null): string | null {
  const day = (date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  let hh: number, mm: number;
  const t = time ?? "";
  if (typeof t === "string" && /^\d{1,2}:\d{2}/.test(t)) {
    const [h, m] = t.split(":");
    hh = Number(h); mm = Number(m);
  } else if (String(t).trim() !== "" && Number.isFinite(Number(t))) {
    const n = Number(t);
    hh = Math.floor(n / 100); mm = n % 100;
  } else {
    return null;
  }
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh > 23 || mm > 59) return null;
  const p = (x: number) => String(x).padStart(2, "0");
  // ISO SANS fuseau : l'heure SAP est locale (entrepôt) — new Date() la lit telle quelle.
  return `${day}T${p(hh)}:${p(mm)}:00`;
}

/**
 * GET /api/livraisons?date=YYYY-MM-DD
 *
 * « Détail livraison » — toutes les commandes SAP (Sales Orders) dont la date
 * de livraison prévue (DocDueDate) tombe le jour ciblé. Par défaut : la
 * prochaine livraison (J+1, sauf le samedi → J+2). La date est surchargeable
 * (jours fériés) côté front et passée ici en clair.
 *
 * Enrichissement local : nb de colis EXACT + poids net par commande/ligne
 * (depuis Product, comme /api/sap/orders) et libellé transporteur (U_TrspCode
 * résolu via la table Carrier). Les commandes annulées sont exclues.
 *
 * Réponse : { ok, date, holiday, count, totals, carriers[] }
 *   carriers[] = commandes groupées par transporteur (tri colis desc, « Non
 *   affecté » en dernier).
 */
export async function GET(req: NextRequest) {
  // Réchauffage machine (cron) : self-fetch de la date par défaut pour peupler le
  // cache des commandes du jour (SAP live) — le cron paie, jamais l'humain.
  const cron = isCronAuthorized(req);
  const session = cron ? null : await auth();
  if (!cron && !session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // Rôles à accès restreint (préparateur verrouillé, livreur) : le CA (totalHT /
  // totalTTC) est un chiffre commercial — masqué CÔTÉ SERVEUR, pas seulement
  // dans l'UI (canDispatch), sinon il reste lisible en appelant l'API.
  const restricted = cron ? false : await isLivraisonRestricted(session);

  const { searchParams } = new URL(req.url);
  const isISO = (s: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
  const dateParam = searchParams.get("date");
  // Modes de filtrage SAP :
  //   • entered=YYYY-MM-DD           → ventes SAISIES ce jour (DocDate) — « Ventes du jour »
  //   • from=YYYY-MM-DD&to=…         → livraisons d'une PLAGE (DocDueDate) — « Préparations »
  //   • date=YYYY-MM-DD (défaut)     → livraisons d'UN jour (DocDueDate) — Détail livraison
  //   • &carryover=1 (avec date=…)   → + report des prépas non faites (cf. wantCarryover)
  const enteredParam = searchParams.get("entered");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const mode: "entered" | "range" | "due" =
    isISO(enteredParam) ? "entered" : (isISO(fromParam) && isISO(toParam)) ? "range" : "due";
  const date = isISO(dateParam) ? (dateParam as string) : nextDeliveryDate();
  // Date « principale » (libellé férié + champ de réponse `date`).
  const primaryDate = mode === "entered" ? (enteredParam as string) : mode === "range" ? (fromParam as string) : date;
  const filterExpr =
    mode === "entered" ? `DocDate eq '${enteredParam}'`
    : mode === "range" ? `DocDueDate ge '${fromParam}' and DocDueDate le '${toParam}'`
    : `DocDueDate eq '${date}'`;
  // « Détail livraison » (mode due) UNIQUEMENT : reporter la file de préparation
  // — les commandes MISES EN PRÉPARATION mais PAS ENCORE FAITES — dans la vue du
  // jour, même si leur date de livraison (DocDueDate) ne tombe pas ce jour-là.
  // Piloté par le front (carryover=1) pour NE PAS polluer les autres écrans « du
  // jour » qui, eux, s'en tiennent à la stricte date de livraison (récap articles,
  // manquants, Ventes du jour).
  const wantCarryover = mode === "due" && searchParams.get("carryover") === "1";

  type ListedLine = {
    ItemCode: string;
    ItemDescription?: string;
    Quantity: number;
    WarehouseCode?: string;
    LineTotal?: number;
    /** Lot affecté. Pas besoin de l'ajouter au $select : `DocumentLines` est
     *  sélectionné en entier, le Service Layer renvoie donc déjà les UDF. */
    U_NoLot?: string;
  };
  type SapOrderListed = {
    DocEntry: number;
    DocNum: number;
    DocDate: string;
    DocDueDate: string;
    CardCode: string;
    CardName?: string;
    DocTotal?: number;
    VatSum?: number;
    DocumentStatus?: string;
    Cancelled?: string;
    Comments?: string;
    NumAtCard?: string;
    U_TrspCode?: string;
    U_TrspHeur?: string;
    CreationDate?: string;
    CreationTime?: string | number;
    DocTime?: string | number;
    DocumentLines?: ListedLine[];
  };

  const BASE_SELECT =
    "DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,VatSum,DocumentStatus,Cancelled,Comments,NumAtCard,DocumentLines";

  try {
    // Champs FACULTATIFS selon la version du Service Layer : U_TrspCode/U_TrspHeur
    // (champs custom) et l'heure de PRISE de la commande (CreationTime, sinon
    // DocTime). On tente du plus riche au plus pauvre — la livraison reste
    // lisible sans ces champs (« Non affecté », pas d'heure de prise).
    const EXTRA_SELECTS = [
      ",U_TrspCode,U_TrspHeur,CreationDate,CreationTime",
      ",U_TrspCode,U_TrspHeur,CreationDate,DocTime",
      ",U_TrspCode,U_TrspHeur",
      "",
    ];
    // Dès qu'un niveau de $select marche on le MÉMORISE (`ordersSelIdx`, portée
    // module) : ni les requêtes de report, ni les requêtes SUIVANTES ne re-sondent
    // les champs custom absents.
    const fetchOrders = async (expr: string): Promise<SapOrderListed[]> => {
      const f = encodeURIComponent(expr);
      for (let i = ordersSelIdx; i < EXTRA_SELECTS.length; i++) {
        try {
          const r = await sap.getAll<SapOrderListed>(
            `Orders?$select=${BASE_SELECT}${EXTRA_SELECTS[i]}&$filter=${f}&$orderby=CardName asc`,
            { pageSize: 200, maxPages: 20 },
          );
          ordersSelIdx = i;                             // ce niveau marche → on le garde (inter-requêtes)
          return r;
        } catch (e) {
          if (i === EXTRA_SELECTS.length - 1) throw e;   // plus aucun repli → vraie erreur
        }
      }
      return [];
    };

    // Commandes du jour ciblé (DocDueDate) + statuts manuels (misEnPrep, faite,
    // départ, avoir…) — indépendants l'un de l'autre → chargés EN PARALLÈLE.
    //
    // Le fetch SAP LIVE des commandes du jour est le SEUL coût lourd de l'écran
    // (le reste est miroir/prisma). On l'enveloppe dans un cache
    // stale-while-revalidate (clé = env + filtre du jour) : 1er accès froid mis à
    // part (couvert par le warm cron), les ouvertures suivantes sont instantanées
    // — un jeu de commandes périmé est rendu tout de suite puis rafraîchi en fond.
    // IMPORTANT : SEULES les commandes brutes sont cachées ; les STATUTS
    // (fait/départ/mis en prépa), le STOCK, les AVOIRS et le CA sont recalculés
    // FRAIS à chaque requête (plus bas) → un clic « fait » ou une rupture de stock
    // n'est jamais périmé. Le CA restreint est masqué en aval, donc cacher les
    // totaux bruts ne fuite rien.
    const [dayOrders, statuses] = await Promise.all([
      swr(`livraisons:orders:${process.env.SAP_B1_COMPANY_DB}:${filterExpr}`, 60_000, () => fetchOrders(filterExpr)),
      getDeliveryStatuses(),
    ]);
    const orders: SapOrderListed[] = dayOrders;

    // ── REPORT DE LA FILE DE PRÉPARATION (Détail livraison, mode « due ») ──
    // Une commande MISE EN PRÉPARATION par le commercial reste dans la file du
    // préparateur TANT QU'ELLE N'EST PAS FAITE : on la reporte dans la vue du jour
    // même quand sa date de livraison (DocDueDate) n'y tombe pas — en RETARD (due
    // un jour déjà passé, pas encore faite → reportée au lendemain) comme en
    // AVANCE (mise en prépa le 10 pour une livraison le 15 → visible chaque jour
    // d'ici là). Les commandes DÉJÀ dans la vue du jour sont ignorées (dédup).
    if (wantCarryover) {
      const present = new Set(orders.map((o) => o.DocEntry));
      const pending = selectCarryoverEntries(statuses, date, present);
      if (pending.length) {
        // Garde-fou : la file en cours est petite, mais on plafonne le nombre de
        // reports pour ne jamais inonder le Service Layer d'un filtre géant.
        const list = pending.slice(0, 300);
        const chunks: number[][] = [];
        for (let i = 0; i < list.length; i += 20) chunks.push(list.slice(i, i + 20));
        const extra = await Promise.all(
          chunks.map((g) =>
            fetchOrders(g.map((de) => `DocEntry eq ${de}`).join(" or ")).catch(() => [] as SapOrderListed[]),
          ),
        );
        for (const o of extra.flat()) {
          if (!present.has(o.DocEntry)) { orders.push(o); present.add(o.DocEntry); }
        }
      }
    }

    const live = orders.filter((o) => o.Cancelled !== "tYES");

    // Clés des référentiels (synchrones), calculées une fois.
    const allItemCodes = Array.from(
      new Set(live.flatMap((d) => (d.DocumentLines || []).map((l) => l.ItemCode))),
    );
    // Le CardCode d'un BL peut être le code principal OU un code d'adresse de
    // livraison (ClientDeliveryMode.sapCardCode) : on couvre les deux.
    const cardCodes = Array.from(new Set(live.map((o) => o.CardCode).filter(Boolean)));

    // ── Référentiels : tous INDÉPENDANTS entre eux → chargés EN PARALLÈLE
    //    (produits, transporteurs, statuts manuels, type + nom client, tournées
    //    mémorisées, tournées réelles SERG_TRCL, stocks SAP négatifs). Chaque bloc
    //    gère son propre repli (best-effort) pour ne jamais faire échouer la livraison. ──
    const [prods, carrierByCode, clientMeta, savedTourneeByCard, trclByCard, stockInfo] = await Promise.all([
      // Produits (poids / colis / désignation).
      allItemCodes.length
        ? prisma.product.findMany({
            where: { itemCode: { in: allItemCodes } },
            select: {
              itemCode: true, itemName: true, frgnName: true, salesUnit: true,
              salesUnitWeight: true, salesQtyPerPackUnit: true, uMarque: true, uCondi: true, uPays: true,
            },
          })
        : Promise.resolve([]),
      // Transporteur : U_TrspCode (SAP) → libellé app (Carrier.sapValue → name).
      (async () => {
        const m = new Map<string, string>();
        try {
          const carriers = await prisma.carrier.findMany({ select: { name: true, sapValue: true } });
          for (const c of carriers) if (c.sapValue) m.set(c.sapValue, c.name);
        } catch { /* table Carrier absente → code brut */ }
        return m;
      })(),
      // (Statuts manuels du Détail livraison déjà chargés plus haut — `statuses` —
      //  car nécessaires au report de la file de préparation avant ce bloc.)
      // Type client (GMS / CHR / EXPORT) + NOM COMPLET (fiche télévente) par
      // CardCode — filtre par segment + nom complet sur les documents imprimés
      // (le CardName SAP est parfois tronqué/abrégé).
      (async () => {
        const types = new Map<string, string>();
        const names = new Map<string, string>();
        // Ventes comptoir : CardCodes RÉSOLUS dont le client est HORS des 3 segments
        // livrés (GMS/CHR/EXPORT). Leur marchandise part à la vente → préparées +
        // livrées d'office (cf. markComptoirDelivered à la création). Ici c'est le
        // FILET au read time : toute commande comptoir est « faite + départ » quelle
        // que soit sa provenance (SAP direct, conversion d'offre, avant la feature…),
        // sans dépendre du marqueur persistant ni de la régularisation manuelle.
        // ⚠️ Un CardCode NON résolu n'est jamais présumé comptoir (il pourrait être
        // une adresse de livraison GMS) — même prudence que la régularisation.
        const comptoir = new Set<string>();
        const decide = (
          code: string,
          cli: { type: string | null; sapGroupCode: number | null; sapGroupName: string | null },
        ) => {
          if (isComptoirClient({ type: cli.type, groupCode: cli.sapGroupCode, groupName: cli.sapGroupName })) {
            comptoir.add(code);
          }
        };
        if (!cardCodes.length) return { types, names, comptoir };
        try {
          const resolved = new Set<string>();
          const clients = await prisma.client.findMany({
            where: { code: { in: cardCodes } },
            select: { code: true, type: true, nom: true, sapGroupCode: true, sapGroupName: true },
          });
          for (const c of clients) {
            resolved.add(c.code);
            if (c.type) types.set(c.code, c.type);
            if (c.nom?.trim()) names.set(c.code, c.nom.trim());
            decide(c.code, c);
          }
          const modes = await prisma.clientDeliveryMode.findMany({
            where: { sapCardCode: { in: cardCodes } },
            select: { sapCardCode: true, client: { select: { type: true, nom: true, sapGroupCode: true, sapGroupName: true } } },
          });
          for (const mo of modes) {
            if (!mo.client) continue;
            if (mo.client.type && !types.has(mo.sapCardCode)) types.set(mo.sapCardCode, mo.client.type);
            if (mo.client.nom?.trim() && !names.has(mo.sapCardCode)) names.set(mo.sapCardCode, mo.client.nom.trim());
            if (!resolved.has(mo.sapCardCode)) { resolved.add(mo.sapCardCode); decide(mo.sapCardCode, mo.client); }
          }
        } catch { /* type optionnel → BL rangés en « Autres » */ }
        return { types, names, comptoir };
      })(),
      // Tournée MÉMORISÉE par client (repli si SERG_TRCL indisponible).
      getClientTournees(cardCodes).catch(() => new Map<string, ClientTournee>()),
      // Tournées RÉELLES par client (SERG_TRCL vue v2) — best-effort, caché.
      (async () => {
        const m = new Map<string, Awaited<ReturnType<typeof getClientTrclCarriers>>>();
        await Promise.all(cardCodes.map(async (cc) => {
          try { m.set(cc, await getClientTrclCarriers(cc)); } catch { /* best-effort */ }
        }));
        return m;
      })(),
      // ── Articles MANQUANTS + stock + calibre — LU DEPUIS LE MIROIR (chantier C) ──
      // Avant : lecture EN DIRECT sur SAP Items par paquets — le plus gros du coût
      // SAP de cet écran. Désormais depuis Product/ProductStock, miroités par les
      // crons (delta 10 min + refresh-stock 15 min, quasi temps réel) :
      //   • onHand   = Σ inStock  (stock physique détenu, entrepôts synchronisés) ;
      //   • disponible = Σ available (stock − engagé clients) ; < 0 = à acheter ;
      //   • calibre  = Product.uCalibre.
      // Plus de « lot en échec » possible (lecture locale atomique) → failedChunks 0.
      (async () => {
        const neg: Record<string, number> = {};
        const onHand: Record<string, number> = {};
        const cal: Record<string, string> = {};
        if (allItemCodes.length === 0) return { neg, onHand, cal, failedChunks: 0 };
        const rows = await prisma.product.findMany({
          where: { itemCode: { in: allItemCodes } },
          select: { itemCode: true, uCalibre: true, stocks: { select: { inStock: true, available: true } } },
        });
        for (const p of rows) {
          onHand[p.itemCode] = p.stocks.reduce((s, w) => s + w.inStock, 0);
          const available = p.stocks.reduce((s, w) => s + w.available, 0);
          if (available < 0) neg[p.itemCode] = available;
          const c = (p.uCalibre ?? "").trim();
          if (c) cal[p.itemCode] = c;
        }
        return { neg, onHand, cal, failedChunks: 0 };
      })(),
    ]);
    const negativeStocks = stockInfo.neg;
    const onHandStocks = stockInfo.onHand;
    const calibreByCode = stockInfo.cal;
    // Audit 2026-08-13 (#14) : nb de lots de stock KO → état partiel dans la réponse.
    const stockFailedChunks = stockInfo.failedChunks;
    const typeByCardCode = clientMeta.types;
    const nameByCardCode = clientMeta.names;
    const comptoirByCardCode = clientMeta.comptoir;
    const pMap = new Map(prods.map((p) => [p.itemCode, p]));
    const {
      prepared: faiteByDoc, preparedBy: preparedByDoc, preparedAt: preparedAtDoc,
      departed: departedByDocEntry, departedBy: departedByDoc, departedAt: departedAtDoc,
      excluded: avoirByDoc, preparer: prepByDoc, incomplete: incompleteByDoc,
      incompleteMissing: incompleteMissingByDoc,
      misEnPrep: misEnPrepByDocEntry, misEnPrepBy: misEnPrepByDoc, misEnPrepAt: misEnPrepAtDoc,
      palettes: palettesByDoc,
    } = statuses;

    const weightOfItem = (code: string) => pMap.get(code)?.salesUnitWeight ?? 0;
    const colisDivOf = (code: string) => {
      const p = pMap.get(code);
      return p ? colisInfo(p).unitsPerColis : 1;
    };

    // ── Mise en forme par commande ──
    const docs = live.map((d) => {
      const lines = (d.DocumentLines || []).map((l) => {
        const p = pMap.get(l.ItemCode);
        const div = colisDivOf(l.ItemCode) || 1;
        // Valeurs BRUTES conservées pour la sommation ; l'arrondi 0,1 n'est
        // appliqué qu'à l'AFFICHAGE par ligne (colis/weightKg). Sommer les valeurs
        // déjà arrondies dérivait le total du BL (ex. 2 lignes à 0,05 → 0,2 ≠ 0,1).
        const colisRaw = (l.Quantity || 0) / div;
        const weightRaw = (l.Quantity || 0) * weightOfItem(l.ItemCode);
        return {
          itemCode: l.ItemCode,
          itemName: l.ItemDescription || p?.frgnName || p?.itemName || l.ItemCode,
          quantity: l.Quantity,
          unit: p?.salesUnit ?? null,   // unité de vente (PIE, KG, COLIS…) — bon imprimé
          colisRaw,
          weightRaw,
          lineTotalRaw: l.LineTotal ?? 0,
          colis: Math.round(colisRaw * 10) / 10,
          weightKg: Math.round(weightRaw * 10) / 10,
          warehouse: l.WarehouseCode ?? null,
          // Tags désignation (préparation) — marque · conditionnement · calibre · variété · origine.
          marque: p?.uMarque ?? null,
          condt: p?.uCondi ?? null,
          pays: p?.uPays ?? null,
          variete: p?.frgnName ?? null,
          calibre: calibreByCode[l.ItemCode] ?? null,
          // Lot affecté — édité en direct depuis le Détail livraison. À la fusion
          // de deux lignes d'un même article, on garde celui de la première : les
          // lignes d'un même article sont affectées ensemble, elles le partagent.
          lot: (l.U_NoLot ?? "").trim() || null,
        };
      });
      // Fusion des lignes d'un MÊME article (ex. ligne gratuite en plus de la
      // ligne facturée) : le préparateur ne voit qu'UNE ligne, quantités et
      // colis cumulés. Les sommations restent sur les valeurs brutes ;
      // l'arrondi 0,1 par ligne est recalculé APRÈS fusion.
      const mergedByItem = new Map<string, (typeof lines)[number]>();
      for (const l of lines) {
        const g = mergedByItem.get(l.itemCode);
        if (!g) { mergedByItem.set(l.itemCode, { ...l }); continue; }
        g.quantity += l.quantity;
        g.colisRaw += l.colisRaw;
        g.weightRaw += l.weightRaw;
        g.lineTotalRaw += l.lineTotalRaw;
      }
      const mergedLines = [...mergedByItem.values()].map((l) => ({
        ...l,
        colis: Math.round(l.colisRaw * 10) / 10,
        weightKg: Math.round(l.weightRaw * 10) / 10,
        lineTotal: Math.round(l.lineTotalRaw * 100) / 100,
        // Prix unitaire HT = LineTotal ÷ quantité (même unité que Quantity — kg/pie).
        price: l.quantity > 0 ? Math.round((l.lineTotalRaw / l.quantity) * 100) / 100 : null,
      }));
      const colis = mergedLines.reduce((s, l) => s + l.colisRaw, 0);
      const weightKg = mergedLines.reduce((s, l) => s + l.weightRaw, 0);
      // Lignes émises SANS les champs bruts (sommation serveur uniquement).
      const outLines = mergedLines.map(({ colisRaw: _c, weightRaw: _w, lineTotalRaw: _lt, ...rest }) => rest);
      const trspCode = d.U_TrspCode?.trim() || null;
      // Vente comptoir (client hors GMS/CHR/EXPORT) → « faite » + « départ » d'office.
      // On force les deux états quel que soit le marqueur persistant : la marchandise
      // est déjà partie à la vente, la commande n'a jamais à traîner en « pas préparé ».
      const comptoir = comptoirByCardCode.has(d.CardCode);
      const prepared = (faiteByDoc.get(d.DocEntry) ?? false) || comptoir;
      const departed = (departedByDocEntry.get(d.DocEntry) ?? false) || comptoir;
      return {
        docEntry: d.DocEntry,
        docNum: d.DocNum,
        docDate: d.DocDate,
        dueDate: d.DocDueDate,
        // Heure de PRISE de la commande dans le système (création SAP).
        takenAt: sapCreationISO(d.CreationDate, d.CreationTime ?? d.DocTime),
        cardCode: d.CardCode,
        cardName: d.CardName ?? d.CardCode,
        // Nom complet (fiche client) pour les documents imprimés.
        cardFullName: nameByCardCode.get(d.CardCode) ?? d.CardName ?? d.CardCode,
        totalHT: Math.round(((d.DocTotal ?? 0) - (d.VatSum ?? 0)) * 100) / 100,
        totalTTC: Math.round((d.DocTotal ?? 0) * 100) / 100,
        colis: Math.round(colis * 10) / 10,
        weightKg: Math.round(weightKg * 10) / 10,
        open: d.DocumentStatus !== "bost_Close",
        comments: d.Comments ?? "",
        numAtCard: d.NumAtCard ?? "",
        trspCode,
        trspHeure: d.U_TrspHeur?.trim() || null,
        // Tournée réelle (SERG_TRCL) pour CE transporteur, sinon défaut client,
        // sinon repli mémoire — pré-sélectionne la bonne tournée par BL.
        savedTournee: ((): ClientTournee | null => {
          const cs = trclByCard.get(d.CardCode);
          if (cs && cs.length) {
            const m = (trspCode ? cs.find((c) => c.sapValue === trspCode) : null) ?? cs[0];
            if (m) return { trspCode: m.sapValue, heure: m.heure ?? null, nom: m.tour ?? null, des: null, lineId: null };
          }
          return savedTourneeByCard.get(d.CardCode) ?? null;
        })(),
        // Libellé : tous les dépôts FT (FT54/FT86/FT94…) s'affichent « Delanchy »
        // en préparation — le trspCode réel reste porté par le BL.
        carrierName: trspCode
          ? (isDelanchyCarrierCode(trspCode) ? "Delanchy" : carrierByCode.get(trspCode) ?? trspCode)
          : null,
        clientType: typeByCardCode.get(d.CardCode) ?? null,   // GMS | CHR | EXPORT | null
        prepared,                                             // « faite » (coché) OU vente comptoir d'office
        preparedBy: preparedByDoc.get(d.DocEntry) ?? (comptoir ? "Comptoir" : null), // qui a marqué « faite »
        preparedAt: preparedAtDoc.get(d.DocEntry) ?? null,    // heure du clic « fait »
        departed,                                             // « départ » (parti) OU vente comptoir d'office
        departedBy: departedByDoc.get(d.DocEntry) ?? (comptoir ? "Comptoir" : null), // qui a marqué « départ »
        departedAt: departedAtDoc.get(d.DocEntry) ?? null,    // heure du clic « départ »
        preparer: prepByDoc.get(d.DocEntry) ?? null,          // préparateur affecté (qui a ouvert)
        incomplete: incompleteByDoc.get(d.DocEntry) ?? false, // « à reprendre » — remise sur la file
        // Articles signalés manquants par le préparateur (remise sur la file) —
        // restreints aux lignes réelles du BL (garde-fou d'affichage).
        reportedMissing: (incompleteMissingByDoc.get(d.DocEntry) ?? []).filter((code) => outLines.some((l) => l.itemCode === code)),
        // « mis en préparation » — lâché par le commercial (état « Ventes du jour »).
        // Tant que false, la commande est INVISIBLE pour les rôles restreints (filtre plus bas).
        misEnPrep: misEnPrepByDocEntry.get(d.DocEntry) ?? false,
        misEnPrepBy: misEnPrepByDoc.get(d.DocEntry) ?? null,
        misEnPrepAt: misEnPrepAtDoc.get(d.DocEntry) ?? null,
        // Articles MANQUANTS de ce BL = lignes dont le DISPONIBLE SAP est négatif
        // (en stock − engagé clients) → vendu au-delà du stock détenu.
        missingItems: outLines.filter((l) => negativeStocks[l.itemCode] !== undefined).map((l) => l.itemCode),
        // « avoir/exclu » : surcharge manuelle si présente, sinon détecté auto (ci-dessous).
        excluded: avoirByDoc.has(d.DocEntry) ? !!avoirByDoc.get(d.DocEntry) : false,
        // null = jamais compté (case à remplir à la main sur le bon de transport).
        palettes: palettesByDoc.get(d.DocEntry) ?? null,
        lineCount: outLines.length,
        lines: outLines,
      };
    });
    // TOUTES les commandes clients sont renvoyées (segmentées ou non) — le
    // filtre par segment (Tout / CHR / Export / GMS) se fait côté vue.

    // ── Détection AUTOMATIQUE des BL totalement avoirés (facturé puis avoir total) ──
    // Un avoir SAP (CreditNote) NON annulé dont le montant TTC = le total d'un BL
    // du jour pour le MÊME client, daté APRÈS ce BL → ce BL a été totalement
    // avoiré (souvent un doublon recréé). On le déduit à 100% (sauf surcharge
    // manuelle explicite, qui reste prioritaire). Best-effort : peu de clients par
    // jour → rapide ; en cas d'échec SAP, on ne déduit rien (repli sur le manuel).
    try {
      const cc = Array.from(new Set(docs.map((d) => d.cardCode).filter(Boolean)));
      if (cc.length) {
        const since = new Date(Date.parse(date) - 45 * 86_400_000).toISOString().slice(0, 10);
        // Avoirs (CreditNotes) des 45 derniers jours — LU DEPUIS LE MIROIR
        // (SapCreditNote), fini l'appel SAP chunké. TTC reconstitué = docTotal
        // (stocké HT au miroir) + vatSum, pour matcher le totalTTC des BL.
        const notes = (await prisma.sapCreditNote.findMany({
          where: { cardCode: { in: cc }, cancelled: false, docDate: { gte: new Date(since) } },
          select: { cardCode: true, docTotal: true, vatSum: true, docDate: true },
          orderBy: { docEntry: "asc" },
        })).map((n) => ({
          cardCode: n.cardCode,
          ttc: Math.abs((n.docTotal ?? 0) + (n.vatSum ?? 0)),
          day: n.docDate.toISOString().slice(0, 10),
        }));
        // BL par client, plus ANCIEN (DocEntry) d'abord — l'original avoiré précède
        // le BL recréé.
        const byClient = new Map<string, typeof docs>();
        for (const d of [...docs].sort((a, b) => a.docEntry - b.docEntry)) {
          const a = byClient.get(d.cardCode) ?? [];
          a.push(d);
          byClient.set(d.cardCode, a);
        }
        const matched = new Set<number>();
        for (const n of notes) {
          const amt = n.ttc;
          if (amt <= 0.01) continue;
          const noteDay = n.day;
          const cand = (byClient.get(n.cardCode) ?? []).find(
            (d) =>
              !matched.has(d.docEntry) &&
              Math.abs((d.totalTTC ?? 0) - amt) <= 0.05 &&        // total avoiré = total du BL
              (!noteDay || noteDay >= (d.docDate ?? "").slice(0, 10)), // avoir postérieur au BL
          );
          if (!cand) continue;
          matched.add(cand.docEntry);
          // La surcharge MANUELLE reste prioritaire (l'utilisateur a tranché).
          if (!avoirByDoc.has(cand.docEntry)) cand.excluded = true;
        }
      }
    } catch { /* avoirs best-effort → pas de déduction auto */ }

    // Masquage CA pour les rôles restreints — APRÈS la détection d'avoirs (qui
    // matche sur totalTTC) et AVANT les agrégats (totaux transporteurs à 0 aussi).
    if (restricted) {
      for (const d of docs) { d.totalHT = 0; d.totalTTC = 0; }
    }

    // Rôles restreints (préparateur verrouillé, livreur) : seules les commandes
    // « mises en préparation » par un commercial sont renvoyées — un magasin pas
    // encore lâché n'existe pas pour l'entrepôt (filtre CÔTÉ SERVEUR, pas UI).
    const visibleDocs = restricted ? docs.filter((d) => d.misEnPrep) : docs;

    // ── Regroupement par transporteur ──
    // Demande direction : TOUS les dépôts FT (FT54, FT86, FT94…) sont Delanchy
    // → un seul groupe DELANCHY en préparation (le BL garde son trspCode réel).
    type Doc = (typeof docs)[number];
    const groups = new Map<string, { code: string | null; name: string; docs: Doc[] }>();
    for (const d of visibleDocs) {
      const delanchy = !!d.trspCode && isDelanchyCarrierCode(d.trspCode);
      const key = delanchy ? "DELANCHY" : d.trspCode ?? "__none__";
      const name = delanchy ? "Delanchy" : d.carrierName ?? "Non affecté";
      const g = groups.get(key) ?? { code: delanchy ? "DELANCHY" : d.trspCode, name, docs: [] };
      g.docs.push(d);
      groups.set(key, g);
    }
    // Totaux : les BL « avoir/exclu » sont DÉDUITS (100%) — on agrège sur les BL
    // non exclus uniquement, mais on garde tous les BL dans les listes (grisés).
    const carriers = Array.from(groups.values())
      .map((g) => {
        const counted = g.docs.filter((d) => !d.excluded);
        return {
          code: g.code,
          name: g.name,
          orders: counted.length,
          colis: Math.round(counted.reduce((s, d) => s + d.colis, 0) * 10) / 10,
          weightKg: Math.round(counted.reduce((s, d) => s + d.weightKg, 0) * 10) / 10,
          totalHT: Math.round(counted.reduce((s, d) => s + d.totalHT, 0) * 100) / 100,
          docs: g.docs,
        };
      })
      // « Non affecté » toujours en dernier ; sinon tri par volume de colis.
      .sort((a, b) => {
        if (!a.code && b.code) return 1;
        if (a.code && !b.code) return -1;
        return b.colis - a.colis;
      });

    // Feuille de route déjà envoyée ce jour → pastille « envoyé » par transporteur.
    // Clé = date de la requête (identique à celle utilisée à l'envoi côté client).
    const sentMap = await getFeuilleSentMany(
      date,
      carriers.map((c) => c.code).filter((c): c is string => !!c),
    );
    const carriersOut = carriers.map((c) => {
      const s = c.code ? sentMap.get(c.code.toUpperCase()) : undefined;
      return { ...c, sentAt: s?.at ?? null, sentTo: s?.to ?? [] };
    });

    const counted = visibleDocs.filter((d) => !d.excluded);
    const totals = {
      orders: counted.length,
      clients: new Set(counted.map((d) => d.cardCode)).size,
      colis: Math.round(counted.reduce((s, d) => s + d.colis, 0) * 10) / 10,
      weightKg: Math.round(counted.reduce((s, d) => s + d.weightKg, 0) * 10) / 10,
      totalHT: Math.round(counted.reduce((s, d) => s + d.totalHT, 0) * 100) / 100,
    };

    return NextResponse.json({
      ok: true,
      date: primaryDate,
      mode,
      // Audit 2026-08-13 (#14) : état PARTIEL explicite. `partial=true` = au moins
      // un lot de stock SAP a échoué → certains articles n'ont ni « manquant » ni
      // stock détenu fiable. L'affichage côté UI est hors périmètre (à traiter).
      partial: stockFailedChunks > 0,
      failedChunks: stockFailedChunks,
      holiday: mode === "due" ? frenchHolidayLabel(date) : null,
      count: visibleDocs.length,
      totals,
      carriers: carriersOut,
      // Disponible SAP global (négatif) par article — conservé pour compat (badges).
      negativeStocks,
      // Stock PHYSIQUE détenu (QuantityOnStock, tous entrepôts) par article du jour
      // — base de l'écran Manquants : « faire d'abord avec ce qu'on a, acheter le reste ».
      onHandStocks,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
