import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessScope, scopePayload, UNMAPPED_MESSAGE } from "@/lib/permissions";
import { emailFromInitials } from "@/lib/salespeople";

/**
 * GET /api/commerciaux/sap — liste des commerciaux SAP (slpName) actifs sur
 * les 12 derniers mois, avec leurs KPI :
 *
 *   - caNetYtd      : CA net facturé YTD (SapInvoice − SapCreditNote, HT)
 *   - caBlYtd       : volume HT BL YTD (SapOrder)
 *   - volumeKgYtd   : volume BL YTD en kg (règle TeleVent : qty × salesUnitWeight)
 *   - clientsActifs : nb de cardCode distincts commandés sur 12 mois
 *   - spark         : CA net hebdo des 12 dernières semaines (mini-tendance)
 *
 * Droits : un non-admin ne voit QUE sa propre ligne (compte non mappé → vide).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const scope = await getAccessScope(session);
  if (!scope.all && !scope.slpName) {
    return NextResponse.json({
      ok: true, commerciaux: [],
      restricted: true, message: UNMAPPED_MESSAGE, scope: scopePayload(scope),
    });
  }

  const now = new Date();
  const ytdStart = new Date(now.getFullYear(), 0, 1);
  const activeStart = new Date(now.getTime() - 365 * 86_400_000);
  const sparkStart = new Date(now.getTime() - 12 * 7 * 86_400_000);

  // ── PRIME commerciale ──────────────────────────────────────
  // 5 % de la marge (JMG/AG/MM). Pour l'instant marge BRUTE (la marge « nette
  // transport » n'est pas encore calculée → transport non déduit). Base = les
  // COMMANDES (SapOrder) des clients du PORTEFEUILLE (Client.commercial), depuis
  // le 01.11.2025 (début de la période de prime).
  const PRIME_RATE = 0.05;
  const primeStart = new Date(Date.UTC(2025, 10, 1)); // 1ᵉʳ novembre 2025

  // Filtre slp non-admin injecté dans chaque agrégat.
  const slpCond = (col: Prisma.Sql) =>
    !scope.all && scope.slpName ? Prisma.sql`AND ${col} = ${scope.slpName}` : Prisma.empty;

  const [active, caInv, caCn, caBl, kgBl, sparkRows, caPortInv, caPortCn, primeOrders] = await Promise.all([
    // Commerciaux actifs 12 mois (Orders ∪ Invoices) + nb clients + dernier doc.
    prisma.$queryRaw<{ slp: string; clients: number; last: Date }[]>(Prisma.sql`
      SELECT s.slp, COUNT(DISTINCT s.card)::int AS clients, MAX(s.d) AS last
      FROM (
        SELECT "slpName" AS slp, "cardCode" AS card, "docDate" AS d
        FROM "SapOrder" WHERE "cancelled" = false AND "docDate" >= ${activeStart}
          AND "slpName" IS NOT NULL AND "slpName" <> '' ${slpCond(Prisma.sql`"slpName"`)}
        UNION ALL
        SELECT "slpName", "cardCode", "docDate"
        FROM "SapInvoice" WHERE "cancelled" = false AND "docDate" >= ${activeStart}
          AND "slpName" IS NOT NULL AND "slpName" <> '' ${slpCond(Prisma.sql`"slpName"`)}
      ) s GROUP BY 1`),
    // CA + MARGE BRUTE facturés YTD (par vendeur = slpName).
    prisma.$queryRaw<{ slp: string; ca: number; marge: number; n: number }[]>(Prisma.sql`
      SELECT "slpName" AS slp, COALESCE(SUM("docTotal"), 0)::float AS ca,
             COALESCE(SUM("grossProfit"), 0)::float AS marge, COUNT(*)::int AS n
      FROM "SapInvoice"
      WHERE "cancelled" = false AND "docDate" >= ${ytdStart}
        AND "slpName" IS NOT NULL AND "slpName" <> '' ${slpCond(Prisma.sql`"slpName"`)}
      GROUP BY 1`),
    // Avoirs YTD (CA + marge à soustraire).
    prisma.$queryRaw<{ slp: string; ca: number; marge: number }[]>(Prisma.sql`
      SELECT "slpName" AS slp, COALESCE(SUM("docTotal"), 0)::float AS ca,
             COALESCE(SUM("grossProfit"), 0)::float AS marge
      FROM "SapCreditNote"
      WHERE "cancelled" = false AND "docDate" >= ${ytdStart}
        AND "slpName" IS NOT NULL AND "slpName" <> '' ${slpCond(Prisma.sql`"slpName"`)}
      GROUP BY 1`),
    // Volume HT BL YTD.
    prisma.$queryRaw<{ slp: string; ca: number; n: number }[]>(Prisma.sql`
      SELECT "slpName" AS slp, COALESCE(SUM("docTotal"), 0)::float AS ca, COUNT(*)::int AS n
      FROM "SapOrder"
      WHERE "cancelled" = false AND "docDate" >= ${ytdStart}
        AND "slpName" IS NOT NULL AND "slpName" <> '' ${slpCond(Prisma.sql`"slpName"`)}
      GROUP BY 1`),
    // Volume kg BL YTD (qty × salesUnitWeight).
    prisma.$queryRaw<{ slp: string; kg: number }[]>(Prisma.sql`
      SELECT o."slpName" AS slp, COALESCE(SUM(l."quantity" * COALESCE(p."salesUnitWeight", 0)), 0)::float AS kg
      FROM "SapOrderLine" l
      JOIN "SapOrder" o ON o."docEntry" = l."docEntry"
      LEFT JOIN "Product" p ON p."itemCode" = l."itemCode"
      WHERE o."cancelled" = false AND o."docDate" >= ${ytdStart}
        AND o."slpName" IS NOT NULL AND o."slpName" <> '' ${slpCond(Prisma.sql`o."slpName"`)}
      GROUP BY 1`),
    // Sparkline : CA facturé par semaine ISO, 12 dernières semaines.
    prisma.$queryRaw<{ slp: string; y: number; w: number; ca: number }[]>(Prisma.sql`
      SELECT "slpName" AS slp,
             EXTRACT(ISOYEAR FROM "docDate")::int AS y,
             EXTRACT(WEEK    FROM "docDate")::int AS w,
             COALESCE(SUM("docTotal"), 0)::float AS ca
      FROM "SapInvoice"
      WHERE "cancelled" = false AND "docDate" >= ${sparkStart}
        AND "slpName" IS NOT NULL AND "slpName" <> '' ${slpCond(Prisma.sql`"slpName"`)}
      GROUP BY 1, 2, 3`),
    // CA facturé YTD sur le PORTEFEUILLE (clients affectés : Client.commercial),
    // base du calcul d'objectif (≠ caNetYtd qui est par slpName de facture SAP).
    prisma.$queryRaw<{ slp: string; ca: number }[]>(Prisma.sql`
      SELECT c."commercial" AS slp, COALESCE(SUM(i."docTotal"), 0)::float AS ca
      FROM "SapInvoice" i
      JOIN "Client" c ON c."code" = i."cardCode"
      WHERE i."cancelled" = false AND i."docDate" >= ${ytdStart}
        AND c."commercial" IS NOT NULL AND c."commercial" <> '' ${slpCond(Prisma.sql`c."commercial"`)}
      GROUP BY 1`),
    // Avoirs YTD du portefeuille (à soustraire).
    prisma.$queryRaw<{ slp: string; ca: number }[]>(Prisma.sql`
      SELECT c."commercial" AS slp, COALESCE(SUM(i."docTotal"), 0)::float AS ca
      FROM "SapCreditNote" i
      JOIN "Client" c ON c."code" = i."cardCode"
      WHERE i."cancelled" = false AND i."docDate" >= ${ytdStart}
        AND c."commercial" IS NOT NULL AND c."commercial" <> '' ${slpCond(Prisma.sql`c."commercial"`)}
      GROUP BY 1`),
    // PRIME — marge BRUTE du portefeuille sur les COMMANDES depuis le 01.11.2025
    // (Client.commercial = lui). prime = PRIME_RATE × cette marge.
    prisma.$queryRaw<{ slp: string; marge: number }[]>(Prisma.sql`
      SELECT c."commercial" AS slp, COALESCE(SUM(o."grossProfit"), 0)::float AS marge
      FROM "SapOrder" o
      JOIN "Client" c ON c."code" = o."cardCode"
      WHERE o."cancelled" = false AND o."docDate" >= ${primeStart}
        AND c."commercial" IS NOT NULL AND c."commercial" <> '' ${slpCond(Prisma.sql`c."commercial"`)}
      GROUP BY 1`),
  ]);
  const primeMargeMap = new Map(primeOrders.map((r) => [r.slp, Number(r.marge)]));

  // Objectifs CA (table optionnelle — repli silencieux si DDL non lancée).
  const objMap = new Map<string, { ca: number; marge: number; volume: number }>();
  try {
    const objRows = await prisma.$queryRaw<{ slp: string; ca: number | null; marge: number | null; volume: number | null }[]>(Prisma.sql`
      SELECT "slpName" AS slp, "objectifCa"::float AS ca, "objectifMarge"::float AS marge, "objectifVolume"::float AS volume
      FROM "CommercialObjectif" WHERE 1 = 1 ${slpCond(Prisma.sql`"slpName"`)}`);
    for (const r of objRows) objMap.set(r.slp, { ca: Number(r.ca ?? 0), marge: Number(r.marge ?? 0), volume: Number(r.volume ?? 0) });
  } catch { /* table CommercialObjectif pas encore créée */ }
  const portInvMap = new Map(caPortInv.map((r) => [r.slp, Number(r.ca)]));
  const portCnMap = new Map(caPortCn.map((r) => [r.slp, Number(r.ca)]));

  const caInvMap = new Map(caInv.map((r) => [r.slp, r]));
  const caCnMap = new Map(caCn.map((r) => [r.slp, Number(r.ca)]));
  const margeCnMap = new Map(caCn.map((r) => [r.slp, Number(r.marge)]));
  const caBlMap = new Map(caBl.map((r) => [r.slp, r]));
  const kgMap = new Map(kgBl.map((r) => [r.slp, Number(r.kg)]));
  const sparkMap = new Map<string, Map<string, number>>();
  for (const r of sparkRows) {
    const m = sparkMap.get(r.slp) ?? new Map<string, number>();
    m.set(`${r.y}-${r.w}`, Number(r.ca));
    sparkMap.set(r.slp, m);
  }

  // 12 buckets hebdo glissants (clé année-semaine ISO via les dates réelles).
  const weekKeys: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 7 * 86_400_000);
    // Calcul ISO inline (équivalent lib/iso-week, côté serveur).
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dow = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dow);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    weekKeys.push(`${t.getUTCFullYear()}-${week}`);
  }

  const commerciaux = active
    .map((a) => {
      const inv = caInvMap.get(a.slp);
      const bl = caBlMap.get(a.slp);
      const weeks = sparkMap.get(a.slp);
      const obj = objMap.get(a.slp);
      return {
        slpName: a.slp,
        // Nom TeleVent (email) ; null si le trigramme n'est pas rattaché à un
        // compte (CM, ".", "ADM"…) → filtré ci-dessous.
        email: emailFromInitials(a.slp),
        clientsActifs: Number(a.clients),
        lastDocDate: a.last,
        // Ventes SAISIES par le commercial (vendeur = slpName sur le doc).
        caNetYtd: Number(inv?.ca ?? 0) - (caCnMap.get(a.slp) ?? 0),
        margeBruteYtd: Number(inv?.marge ?? 0) - (margeCnMap.get(a.slp) ?? 0),
        nbFacturesYtd: Number(inv?.n ?? 0),
        caBlYtd: Number(bl?.ca ?? 0),
        nbCommandesYtd: Number(bl?.n ?? 0),
        volumeKgYtd: kgMap.get(a.slp) ?? 0,
        // Ventes de SES CLIENTS (portefeuille : Client.commercial = lui, quel que
        // soit le vendeur qui a saisi le doc). Net d'avoirs.
        caPortefeuilleYtd: (portInvMap.get(a.slp) ?? 0) - (portCnMap.get(a.slp) ?? 0),
        // PRIME : 5 % de la marge brute du portefeuille sur les COMMANDES depuis
        // le 01.11.2025 (marge nette transport à venir).
        primeMargeBrute: primeMargeMap.get(a.slp) ?? 0,
        prime: Math.round((primeMargeMap.get(a.slp) ?? 0) * PRIME_RATE * 100) / 100,
        // Objectifs annuels (0 = non défini) — CA / marge brute / volume kg.
        objectifCa: obj?.ca ?? 0,
        objectifMarge: obj?.marge ?? 0,
        objectifVolume: obj?.volume ?? 0,
        spark: weekKeys.map((k) => weeks?.get(k) ?? 0),
      };
    })
    // On ne garde que les commerciaux rattachés à un compte TeleVent (email) :
    // masque les codes SAP non nominatifs (CM, ".", "ADM").
    .filter((c) => !!c.email)
    .sort((x, y) => y.caNetYtd - x.caNetYtd);

  return NextResponse.json({
    ok: true,
    commerciaux,
    primeMeta: { rate: PRIME_RATE, since: primeStart.toISOString() },
    scope: scopePayload(scope),
  });
}
