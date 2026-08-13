import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessScope } from "@/lib/permissions";
import { commissionData, primeRateOf, PRIME_DEFAULT_START } from "@/lib/commissions";
import { displayNameFromSlp, normalizeSlp } from "@/lib/salespeople";
import {
  loadCommissionRules, defaultRule, winningRuleFor, describeRule, type CommissionRule,
} from "@/lib/commissionRules";

/**
 * GET /api/effectif/commissions/detail?slp=MM&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Détail LIGNE À LIGNE (une ligne = une facture / un BL) de la commission d'un
 * commercial, dans une PLAGE DE DATES. Chaque facture porte l'euro de commission
 * calculé selon la RÈGLE gagnante de SON client (qualification sur les métriques
 * CUMULÉES depuis `since`, cf. moteur de règles). Les primes FIXES apparaissent en
 * une ligne par client qualifié (imputée à sa dernière facture de la plage).
 *
 * Un commercial ne voit QUE son propre détail ; admin/direction voient n'importe qui.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (v: number) => Math.round(v * 100) / 100;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const scope = await getAccessScope(session);
  if (!scope.all && !scope.slpName) return NextResponse.json({ error: "Compte non relié à un commercial." }, { status: 403 });

  const canon = (s: string) => normalizeSlp(s) ?? s;
  const param = req.nextUrl.searchParams.get("slp");
  const target = scope.all ? canon(param ?? "") : scope.slpName!;
  if (!target) return NextResponse.json({ error: "Commercial requis" }, { status: 400 });

  const fromP = req.nextUrl.searchParams.get("from");
  const toP = req.nextUrl.searchParams.get("to");
  const from = fromP && DATE_RE.test(fromP) ? fromP : null;
  const to = toP && DATE_RE.test(toP) ? toP : null;

  const { cfg, invoicesAll, creditNotesAll, clientMetrics } = await commissionData(target);
  const rate = cfg.get(target)?.rate ?? primeRateOf(cfg, target);
  const seuilKg = cfg.get(target)?.seuilKg ?? 0;
  const since = cfg.get(target)?.since ?? PRIME_DEFAULT_START;

  const custom = await loadCommissionRules(target);
  const rules: CommissionRule[] = custom.length ? custom : [defaultRule(seuilKg, rate)];

  // Métriques CUMULÉES par client (période complète) → règle gagnante par client.
  const metricByClient = new Map<string, { kg: number; caht: number }>();
  for (const m of clientMetrics) if (canon(m.slp) === target) metricByClient.set(m.cardCode, { kg: m.kg, caht: m.caht });
  const ruleOf = (card: string) => winningRuleFor(rules, metricByClient.get(card) ?? { kg: 0, caht: 0 });

  const inRange = (d: Date) => {
    const s = d.toISOString().slice(0, 10);
    return (!from || s >= from) && (!to || s <= to);
  };

  const invoices = invoicesAll
    .filter((f) => canon(f.slp) === target && inRange(f.docDate))
    .sort((a, b) => a.docDate.getTime() - b.docDate.getTime());

  // Lignes facture (actions en %). Les clients à prime fixe → ligne dédiée (voir plus bas).
  const lastByFixedClient = new Map<string, { date: string; month: string; card: string; name: string | null }>();
  const lines = invoices.map((f) => {
    const w = ruleOf(f.cardCode);
    let commission = 0;
    if (w?.action === "rate_marge") commission = Math.max(0, f.margeNette) * w.value;
    else if (w?.action === "rate_caht") commission = f.caHt * w.value;
    else if (w?.action === "fixed") {
      const iso = f.docDate.toISOString().slice(0, 10);
      lastByFixedClient.set(f.cardCode, { date: iso, month: f.month, card: f.cardCode, name: f.cardName });
    }
    return {
      date: f.docDate.toISOString().slice(0, 10),
      month: f.month,
      docNum: f.docNum,
      cardCode: f.cardCode,
      cardName: f.cardName,
      caHt: r2(f.caHt),
      margeNette: r2(f.margeNette),
      rule: w ? describeRule(w) : "—",
      commission: r2(commission),
    };
  });

  // AVOIRS (notes de crédit) : lignes NÉGATIVES pour les clients à commission en %
  // (marge ou CA HT). Un client à prime fixe n'est pas impacté par ses avoirs.
  for (const n of creditNotesAll) {
    if (canon(n.slp) !== target || !inRange(n.docDate)) continue;
    const w = ruleOf(n.cardCode);
    let commission = 0;
    if (w?.action === "rate_marge") commission = -n.margeBrute * w.value;
    else if (w?.action === "rate_caht") commission = -n.caHt * w.value;
    else continue; // fixed : avoir sans effet
    lines.push({
      date: n.docDate.toISOString().slice(0, 10),
      month: n.month,
      docNum: n.docNum,
      cardCode: n.cardCode,
      cardName: n.cardName ? `Avoir · ${n.cardName}` : "Avoir",
      caHt: r2(-n.caHt),
      margeNette: r2(-n.margeBrute),
      rule: w ? describeRule(w) : "—",
      commission: r2(commission),
    });
  }

  // Une ligne « prime fixe » par client fixe qualifié, sur sa dernière facture de la plage.
  for (const [card, info] of lastByFixedClient) {
    const w = ruleOf(card);
    if (!w || w.action !== "fixed") continue;
    lines.push({
      date: info.date, month: info.month, docNum: null,
      cardCode: card, cardName: info.name, caHt: 0, margeNette: 0,
      rule: describeRule(w), commission: r2(w.value),
    });
  }
  lines.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));

  return NextResponse.json({
    ok: true,
    slp: target,
    name: displayNameFromSlp(target) ?? target,
    from: from ?? since.toISOString().slice(0, 10),
    to: to ?? new Date().toISOString().slice(0, 10),
    total: r2(lines.reduce((s, l) => s + l.commission, 0)),
    lines,
  });
}
