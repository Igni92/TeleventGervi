import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { colisInfo } from "@/lib/colis";
import { nextDeliveryDate, frenchHolidayLabel } from "@/lib/livraison";
import { getDeliveryStatuses } from "@/lib/inventory";
import { getClientTournees, type ClientTournee } from "@/lib/clientTournee";
import { getClientTrclCarriers } from "@/lib/clientCarriers";
import { isRestrictedPreparateur } from "@/lib/preparateur";
import { isLivreur } from "@/lib/permissions";

export const dynamic = "force-dynamic";

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
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // Rôles à accès restreint (préparateur verrouillé, livreur) : le CA (totalHT /
  // totalTTC) est un chiffre commercial — masqué CÔTÉ SERVEUR, pas seulement
  // dans l'UI (canDispatch), sinon il reste lisible en appelant l'API.
  const restricted = isRestrictedPreparateur(session.user?.email) || (await isLivreur(session));

  const { searchParams } = new URL(req.url);
  const isISO = (s: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
  const dateParam = searchParams.get("date");
  // Modes de filtrage SAP :
  //   • entered=YYYY-MM-DD           → ventes SAISIES ce jour (DocDate) — « Ventes du jour »
  //   • from=YYYY-MM-DD&to=…         → livraisons d'une PLAGE (DocDueDate) — « Préparations »
  //   • date=YYYY-MM-DD (défaut)     → livraisons d'UN jour (DocDueDate) — Détail livraison
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

  type ListedLine = {
    ItemCode: string;
    ItemDescription?: string;
    Quantity: number;
    WarehouseCode?: string;
    LineTotal?: number;
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

  const filter = encodeURIComponent(filterExpr);
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
    let orders: SapOrderListed[] = [];
    for (let i = 0; i < EXTRA_SELECTS.length; i++) {
      try {
        orders = await sap.getAll<SapOrderListed>(
          `Orders?$select=${BASE_SELECT}${EXTRA_SELECTS[i]}&$filter=${filter}&$orderby=CardName asc`,
          { pageSize: 200, maxPages: 20 },
        );
        break;
      } catch (e) {
        if (i === EXTRA_SELECTS.length - 1) throw e;   // plus aucun repli → vraie erreur
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
    const [prods, carrierByCode, statuses, clientMeta, savedTourneeByCard, trclByCard, negativeStocks] = await Promise.all([
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
      // Statuts manuels du Détail livraison, par DocEntry (une requête) :
      //   « faite » + auteur, « départ » + auteur, « avoir / exclu »,
      //   préparateur affecté, signalement « incomplète (à reprendre) ».
      getDeliveryStatuses(),
      // Type client (GMS / CHR / EXPORT) + NOM COMPLET (fiche télévente) par
      // CardCode — filtre par segment + nom complet sur les documents imprimés
      // (le CardName SAP est parfois tronqué/abrégé).
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
        } catch { /* type optionnel → BL rangés en « Autres » */ }
        return { types, names };
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
      // ── Articles MANQUANTS = stock SAP total NÉGATIF (somme tous entrepôts) ──
      // Interrogé EN DIRECT dans SAP (le miroir local ne conserve pas les stocks
      // négatifs) sur les seuls articles des commandes du jour, par lots de 20.
      // Stock total < 0 = on a vendu plus qu'on ne détient → achat à faire.
      // Filtre « < 0 » côté app : QuantityOnStock est un champ calculé que
      // certains Service Layer refusent en $filter. Lot en échec → ignoré.
      (async () => {
        const neg: Record<string, number> = {};
        const chunks: string[][] = [];
        for (let i = 0; i < allItemCodes.length; i += 20) chunks.push(allItemCodes.slice(i, i + 20));
        await Promise.all(chunks.map(async (chunk) => {
          try {
            const or = chunk.map((c) => `ItemCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
            const items = await sap.getAll<{ ItemCode: string; QuantityOnStock?: number }>(
              `Items?$select=ItemCode,QuantityOnStock&$filter=${encodeURIComponent(`(${or})`)}`,
              { pageSize: 50, maxPages: 2 },
            );
            for (const it of items) {
              const q = it.QuantityOnStock ?? 0;
              if (q < 0) neg[it.ItemCode] = q;
            }
          } catch { /* lot en échec → pas de manquants pour ces articles */ }
        }));
        return neg;
      })(),
    ]);
    const typeByCardCode = clientMeta.types;
    const nameByCardCode = clientMeta.names;
    const pMap = new Map(prods.map((p) => [p.itemCode, p]));
    const {
      prepared: faiteByDoc, preparedBy: preparedByDoc, preparedAt: preparedAtDoc,
      departed: departedByDocEntry, departedBy: departedByDoc, departedAt: departedAtDoc,
      excluded: avoirByDoc, preparer: prepByDoc, incomplete: incompleteByDoc,
      incompleteMissing: incompleteMissingByDoc,
      misEnPrep: misEnPrepByDocEntry, misEnPrepBy: misEnPrepByDoc, misEnPrepAt: misEnPrepAtDoc,
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
          colis: Math.round(colisRaw * 10) / 10,
          weightKg: Math.round(weightRaw * 10) / 10,
          warehouse: l.WarehouseCode ?? null,
          // Tags désignation (préparation) — marque · conditionnement · origine.
          marque: p?.uMarque ?? null,
          condt: p?.uCondi ?? null,
          pays: p?.uPays ?? null,
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
      }
      const mergedLines = [...mergedByItem.values()].map((l) => ({
        ...l,
        colis: Math.round(l.colisRaw * 10) / 10,
        weightKg: Math.round(l.weightRaw * 10) / 10,
      }));
      const colis = mergedLines.reduce((s, l) => s + l.colisRaw, 0);
      const weightKg = mergedLines.reduce((s, l) => s + l.weightRaw, 0);
      // Lignes émises SANS les champs bruts (sommation serveur uniquement).
      const outLines = mergedLines.map(({ colisRaw: _c, weightRaw: _w, ...rest }) => rest);
      const trspCode = d.U_TrspCode?.trim() || null;
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
        carrierName: trspCode ? carrierByCode.get(trspCode) ?? trspCode : null,
        clientType: typeByCardCode.get(d.CardCode) ?? null,   // GMS | CHR | EXPORT | null
        prepared: faiteByDoc.get(d.DocEntry) ?? false,        // « faite » = coché manuellement
        preparedBy: preparedByDoc.get(d.DocEntry) ?? null,    // qui a marqué « faite »
        preparedAt: preparedAtDoc.get(d.DocEntry) ?? null,    // heure du clic « fait »
        departed: departedByDocEntry.get(d.DocEntry) ?? false, // « départ » = parti en livraison
        departedBy: departedByDoc.get(d.DocEntry) ?? null,    // qui a marqué « départ »
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
        // Articles MANQUANTS de ce BL = lignes dont le stock SAP total est négatif.
        missingItems: outLines.filter((l) => negativeStocks[l.itemCode] !== undefined).map((l) => l.itemCode),
        // « avoir/exclu » : surcharge manuelle si présente, sinon détecté auto (ci-dessous).
        excluded: avoirByDoc.has(d.DocEntry) ? !!avoirByDoc.get(d.DocEntry) : false,
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
        // Filtre OR chunké (25 clients/requête) : une seule URL avec tous les
        // clients du jour pouvait dépasser plusieurs Ko et se faire rejeter par
        // le Service Layer. Les lots partent en parallèle et sont fusionnés.
        const CHUNK = 25;
        const chunks: string[][] = [];
        for (let i = 0; i < cc.length; i += CHUNK) chunks.push(cc.slice(i, i + CHUNK));
        const notesByChunk = await Promise.all(chunks.map((group) => {
          const orCard = group.map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
          const cnFilter = encodeURIComponent(`(${orCard}) and DocDate ge '${since}' and Cancelled eq 'tNO'`);
          return sap.getAll<{ CardCode: string; DocTotal?: number; DocDate?: string }>(
            `CreditNotes?$select=CardCode,DocTotal,DocDate&$filter=${cnFilter}&$orderby=DocEntry asc`,
            { pageSize: 100, maxPages: 5 },
          );
        }));
        const notes = notesByChunk.flat();
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
          const amt = Math.abs(n.DocTotal ?? 0);
          if (amt <= 0.01) continue;
          const noteDay = (n.DocDate ?? "").slice(0, 10);
          const cand = (byClient.get(n.CardCode) ?? []).find(
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
    type Doc = (typeof docs)[number];
    const groups = new Map<string, { code: string | null; name: string; docs: Doc[] }>();
    for (const d of visibleDocs) {
      const key = d.trspCode ?? "__none__";
      const name = d.carrierName ?? "Non affecté";
      const g = groups.get(key) ?? { code: d.trspCode, name, docs: [] };
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
      holiday: mode === "due" ? frenchHolidayLabel(date) : null,
      count: visibleDocs.length,
      totals,
      carriers,
      // Stock SAP total (négatif) par article manquant — pilote les achats.
      negativeStocks,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
