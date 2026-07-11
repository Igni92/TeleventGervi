import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { colisInfo } from "@/lib/colis";
import { getSafeguardsConfig } from "@/lib/safeguardsStore";
import {
  evaluateLineSafeguards, evaluateOrderSafeguards,
  type SafeguardRuleId, type SafeguardsConfig, type SafeguardViolation,
} from "@/lib/safeguards";

/**
 * GET /api/safeguards/scan-ventes?date=YYYY-MM-DD
 *
 * SCAN A POSTERIORI des ventes SAISIES un jour donné (défaut : aujourd'hui,
 * date murale Paris) au regard des GARDE-FOUS configurés (Paramètres) —
 * alimente les badges d'anomalie de l'écran « Ventes du jour ».
 *
 * Source : miroir local SapOrder/SapOrderLine (aucun appel SAP) :
 *   • prix : lineTotal/qty (net), prix d'achat = lineCost (COGS SAP) →
 *     vente à perte, prix aberrant, marge de commande ;
 *   • volumes : quantités vs l'historique du client (moyenne par article,
 *     panier moyen) + plafonds absolus (colis, kg, total €) ;
 *   • doublonJour : 2ᵉ commande (et suivantes) d'un même client sur le jour.
 * Les règles sans donnée ici (prix conseillé, stock, encours, date de
 * livraison) sont désarmées pour ce scan — elles jouent à la saisie.
 *
 * Réponse : { ok, date, violations: { [docEntry]: SafeguardViolation[] } }
 */

const SCAN_LINE_MASK: SafeguardRuleId[] = [
  "prixLoinSousConseille", "prixLoinSurConseille", "prixManquant", "surVenteStock",
];
const SCAN_ORDER_MASK: SafeguardRuleId[] = ["encoursDepasse", "livraisonLointaine"];

function maskRules(cfg: SafeguardsConfig, ids: SafeguardRuleId[]): SafeguardsConfig {
  const out = { ...cfg };
  for (const id of ids) out[id] = { ...out[id], mode: "off" };
  return out;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date")
    ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: "Paramètre date invalide (attendu YYYY-MM-DD)." }, { status: 400 });
  }

  const config = await getSafeguardsConfig();
  const lineCfg = maskRules(config, SCAN_LINE_MASK);
  const orderCfg = maskRules(config, SCAN_ORDER_MASK);
  const anyActive = Object.values(config).some((r) => r.mode !== "off");
  if (!anyActive) return NextResponse.json({ ok: true, date: dateParam, violations: {} });

  try {
    // DocDate SAP = date pure (minuit UTC dans le miroir) → bornes UTC du jour.
    const dayStart = new Date(`${dateParam}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    const orders = await prisma.sapOrder.findMany({
      where: { docDate: { gte: dayStart, lt: dayEnd }, cancelled: false },
      orderBy: { docEntry: "asc" },
      select: { docEntry: true, cardCode: true, docTotal: true, vatSum: true },
    });
    if (orders.length === 0) return NextResponse.json({ ok: true, date: dateParam, violations: {} });

    const lines = await prisma.sapOrderLine.findMany({
      where: { docEntry: { in: orders.map((o) => o.docEntry) }, isService: false, itemCode: { not: null } },
      select: { docEntry: true, itemCode: true, quantity: true, lineTotal: true, lineCost: true },
    });
    const linesByDoc = new Map<number, typeof lines>();
    for (const l of lines) {
      const arr = linesByDoc.get(l.docEntry) ?? [];
      arr.push(l);
      linesByDoc.set(l.docEntry, arr);
    }

    // Méta produits : nom + unités par colis (affichage/plafond en colis) + poids.
    const allCodes = Array.from(new Set(lines.map((l) => l.itemCode!).filter(Boolean)));
    const prods = allCodes.length > 0 ? await prisma.product.findMany({
      where: { itemCode: { in: allCodes } },
      select: { itemCode: true, itemName: true, salesUnit: true, salesUnitWeight: true, salesQtyPerPackUnit: true },
    }) : [];
    const prodMap = new Map(prods.map((p) => [p.itemCode, {
      name: p.itemName,
      weight: p.salesUnitWeight ?? 0,
      unitsPerColis: colisInfo(p).unitsPerColis || 1,
    }]));

    // ── Historique par client (AVANT le jour scanné) : moyennes par article +
    // panier moyen — mêmes fenêtres que la saisie (≤ 20 cdes / 365 j). ──
    const needHabits = config.volumeVsHabitude.mode !== "off" || config.totalVsPanierMoyen.mode !== "off";
    const histOrdersByCard = new Map<string, { docEntry: number; ht: number }[]>();
    const histAvgByCardItem = new Map<string, { moyenne: number; nbCommandes: number }>(); // `${card}|${item}`
    if (needHabits) {
      const cards = Array.from(new Set(orders.map((o) => o.cardCode)));
      const since = new Date(dayStart.getTime() - 365 * 86_400_000);
      const hist = await prisma.sapOrder.findMany({
        where: { cardCode: { in: cards }, cancelled: false, docDate: { gte: since, lt: dayStart } },
        orderBy: { docDate: "desc" },
        select: { docEntry: true, cardCode: true, docTotal: true, vatSum: true },
      });
      for (const o of hist) {
        const arr = histOrdersByCard.get(o.cardCode) ?? [];
        if (arr.length < 20) arr.push({ docEntry: o.docEntry, ht: Math.max(0, (o.docTotal ?? 0) - (o.vatSum ?? 0)) });
        histOrdersByCard.set(o.cardCode, arr);
      }
      const histEntries = Array.from(histOrdersByCard.values()).flat().map((o) => o.docEntry);
      if (config.volumeVsHabitude.mode !== "off" && histEntries.length > 0) {
        const cardByEntry = new Map<number, string>();
        for (const [card, arr] of histOrdersByCard) for (const o of arr) cardByEntry.set(o.docEntry, card);
        const histLines = await prisma.sapOrderLine.findMany({
          where: { docEntry: { in: histEntries }, isService: false, itemCode: { not: null } },
          select: { docEntry: true, itemCode: true, quantity: true },
        });
        // Σ qté par (commande, article) → moyenne par commande contenant l'article.
        const perOrderItem = new Map<string, number>();
        for (const l of histLines) {
          const key = `${l.docEntry}|${l.itemCode}`;
          perOrderItem.set(key, (perOrderItem.get(key) ?? 0) + (l.quantity || 0));
        }
        const agg = new Map<string, { total: number; nb: number }>();
        for (const [key, qty] of perOrderItem) {
          const sep = key.indexOf("|");
          const docEntry = Number(key.slice(0, sep));
          const item = key.slice(sep + 1);
          const card = cardByEntry.get(docEntry);
          if (!card) continue;
          const k = `${card}|${item}`;
          const cur = agg.get(k) ?? { total: 0, nb: 0 };
          cur.total += qty; cur.nb += 1;
          agg.set(k, cur);
        }
        for (const [k, a] of agg) if (a.nb > 0) histAvgByCardItem.set(k, { moyenne: a.total / a.nb, nbCommandes: a.nb });
      }
    }

    // ── Évaluation commande par commande ──
    const violations: Record<number, SafeguardViolation[]> = {};
    const seenCards = new Set<string>();
    for (const o of orders) {
      const found: SafeguardViolation[] = [];
      const docLines = linesByDoc.get(o.docEntry) ?? [];

      // Agrégat par article : qté totale + part payante (prix/coût) — les lignes
      // 100 % offertes (lineTotal 0) sont exclues des règles de prix.
      const byItem = new Map<string, { qty: number; paidQty: number; paidTotal: number; cost: number | null }>();
      for (const l of docLines) {
        const code = l.itemCode!;
        const cur = byItem.get(code) ?? { qty: 0, paidQty: 0, paidTotal: 0, cost: null };
        cur.qty += l.quantity || 0;
        if ((l.lineTotal ?? 0) > 0 && (l.quantity ?? 0) > 0) {
          cur.paidQty += l.quantity; cur.paidTotal += l.lineTotal;
        }
        if (l.lineCost != null && l.lineCost > 0) cur.cost = l.lineCost;
        byItem.set(code, cur);
      }

      let margeEur = 0, caEur = 0, poidsKg = 0;
      for (const [code, it] of byItem) {
        const meta = prodMap.get(code);
        const upc = meta?.unitsPerColis || 1;
        const unitPrice = it.paidQty > 0 ? it.paidTotal / it.paidQty : null;
        if (unitPrice != null && it.cost != null) {
          margeEur += (unitPrice - it.cost) * it.paidQty;
          caEur += it.paidTotal;
        }
        if (meta?.weight) poidsKg += meta.weight * it.qty;
        const hab = histAvgByCardItem.get(`${o.cardCode}|${code}`);
        found.push(...evaluateLineSafeguards(lineCfg, {
          itemCode: code, itemName: meta?.name || code,
          unit: upc > 1 ? "colis" : "u.",
          quantity: it.qty / upc,
          price: unitPrice,
          prixAchat: it.cost,
          prixConseille: null,
          stockDisponible: null,
          poidsKg: meta?.weight ? meta.weight * it.qty : null,
          habitude: hab ? { moyenne: hab.moyenne / upc, nbCommandes: hab.nbCommandes } : null,
        }));
      }

      const histOrders = histOrdersByCard.get(o.cardCode) ?? [];
      const panierMoyen = histOrders.length > 0
        ? { moyenneHT: histOrders.reduce((s, h) => s + h.ht, 0) / histOrders.length, nbCommandes: histOrders.length }
        : null;
      found.push(...evaluateOrderSafeguards(orderCfg, {
        totalHT: Math.max(0, (o.docTotal ?? 0) - (o.vatSum ?? 0)),
        poidsKg: poidsKg > 0 ? poidsKg : null,
        marge: caEur > 0 ? { margeEur, caEur } : null,
        panierMoyen,
        // 2ᵉ commande (et +) du même client sur le jour → doublon potentiel.
        dejaCommandeAujourdhui: seenCards.has(o.cardCode),
      }));
      seenCards.add(o.cardCode);

      if (found.length > 0) violations[o.docEntry] = found;
    }

    return NextResponse.json({ ok: true, date: dateParam, violations });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), violations: {} },
      { status: 500 },
    );
  }
}
