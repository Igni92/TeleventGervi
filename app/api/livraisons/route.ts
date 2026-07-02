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
  const dateParam = searchParams.get("date");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? "") ? (dateParam as string) : nextDeliveryDate();

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
    DocumentLines?: ListedLine[];
  };

  const filter = encodeURIComponent(`DocDueDate eq '${date}'`);
  const BASE_SELECT =
    "DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocTotal,VatSum,DocumentStatus,Cancelled,Comments,NumAtCard,DocumentLines";

  try {
    // U_TrspCode (transporteur) est un champ custom : on l'inclut, mais on
    // retombe sur le select de base si le Service Layer le refuse (DB sans ce
    // champ) — la livraison reste lisible, simplement « Non affecté ».
    let orders: SapOrderListed[];
    try {
      orders = await sap.getAll<SapOrderListed>(
        `Orders?$select=${BASE_SELECT},U_TrspCode,U_TrspHeur&$filter=${filter}&$orderby=CardName asc`,
        { pageSize: 200, maxPages: 20 },
      );
    } catch {
      orders = await sap.getAll<SapOrderListed>(
        `Orders?$select=${BASE_SELECT}&$filter=${filter}&$orderby=CardName asc`,
        { pageSize: 200, maxPages: 20 },
      );
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
    //    (produits, transporteurs, statuts manuels, type client, tournées
    //    mémorisées, tournées réelles SERG_TRCL). Chaque bloc gère son propre
    //    repli (best-effort) pour ne jamais faire échouer la livraison. ──
    const [prods, carrierByCode, statuses, typeByCardCode, savedTourneeByCard, trclByCard] = await Promise.all([
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
      // Type client (GMS / CHR / EXPORT) par CardCode — pour le filtre par segment.
      (async () => {
        const m = new Map<string, string>();
        if (!cardCodes.length) return m;
        try {
          const clients = await prisma.client.findMany({
            where: { code: { in: cardCodes } },
            select: { code: true, type: true },
          });
          for (const c of clients) if (c.type) m.set(c.code, c.type);
          const modes = await prisma.clientDeliveryMode.findMany({
            where: { sapCardCode: { in: cardCodes } },
            select: { sapCardCode: true, client: { select: { type: true } } },
          });
          for (const mo of modes) {
            if (mo.client?.type && !m.has(mo.sapCardCode)) m.set(mo.sapCardCode, mo.client.type);
          }
        } catch { /* type optionnel → BL rangés en « Autres » */ }
        return m;
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
    ]);
    const pMap = new Map(prods.map((p) => [p.itemCode, p]));
    const {
      prepared: faiteByDoc, preparedBy: preparedByDoc,
      departed: departedByDocEntry, departedBy: departedByDoc,
      excluded: avoirByDoc, preparer: prepByDoc, incomplete: incompleteByDoc,
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
      const colis = lines.reduce((s, l) => s + l.colisRaw, 0);
      const weightKg = lines.reduce((s, l) => s + l.weightRaw, 0);
      // Lignes émises SANS les champs bruts (sommation serveur uniquement).
      const outLines = lines.map(({ colisRaw: _c, weightRaw: _w, ...rest }) => rest);
      const trspCode = d.U_TrspCode?.trim() || null;
      return {
        docEntry: d.DocEntry,
        docNum: d.DocNum,
        docDate: d.DocDate,
        dueDate: d.DocDueDate,
        cardCode: d.CardCode,
        cardName: d.CardName ?? d.CardCode,
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
        departed: departedByDocEntry.get(d.DocEntry) ?? false, // « départ » = parti en livraison
        departedBy: departedByDoc.get(d.DocEntry) ?? null,    // qui a marqué « départ »
        preparer: prepByDoc.get(d.DocEntry) ?? null,          // préparateur affecté (qui a ouvert)
        incomplete: incompleteByDoc.get(d.DocEntry) ?? false, // « à reprendre » — remise sur la file
        // « avoir/exclu » : surcharge manuelle si présente, sinon détecté auto (ci-dessous).
        excluded: avoirByDoc.has(d.DocEntry) ? !!avoirByDoc.get(d.DocEntry) : false,
        lineCount: outLines.length,
        lines: outLines,
      };
    })
    // Demande métier : on n'affiche QUE les magasins segmentés (GMS / CHR / EXPORT).
    // Les clients sans segment n'apparaissent pas dans Détail livraison.
    .filter((d) => d.clientType === "GMS" || d.clientType === "CHR" || d.clientType === "EXPORT");

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

    // ── Regroupement par transporteur ──
    type Doc = (typeof docs)[number];
    const groups = new Map<string, { code: string | null; name: string; docs: Doc[] }>();
    for (const d of docs) {
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

    const counted = docs.filter((d) => !d.excluded);
    const totals = {
      orders: counted.length,
      clients: new Set(counted.map((d) => d.cardCode)).size,
      colis: Math.round(counted.reduce((s, d) => s + d.colis, 0) * 10) / 10,
      weightKg: Math.round(counted.reduce((s, d) => s + d.weightKg, 0) * 10) / 10,
      totalHT: Math.round(counted.reduce((s, d) => s + d.totalHT, 0) * 100) / 100,
    };

    return NextResponse.json({
      ok: true,
      date,
      holiday: frenchHolidayLabel(date),
      count: docs.length,
      totals,
      carriers,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
