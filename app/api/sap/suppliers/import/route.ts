import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { formatPhoneDisplay } from "@/lib/phone";

/**
 * POST /api/sap/suppliers/import   body { limit?: number }
 *
 * Amorce le référentiel FOURNISSEURS avec les N derniers fournisseurs SAP **à qui
 * on a déjà passé une commande** (PurchaseOrders). On lit les dernières commandes
 * fournisseurs (DocEntry desc), on DÉDUP par CardCode en gardant l'ordre (donc le
 * fournisseur le plus récemment commandé d'abord), puis on garde les `limit`
 * premiers (défaut 50). Chaque fournisseur est enrichi (nom/email/téléphone via
 * BusinessPartners) et **upserté** dans la table Supplier locale.
 *
 * Upsert IDEMPOTENT et NON destructif : on ne vide jamais la table, on ne
 * désactive jamais une fiche, et on PRÉSERVE toute saisie manuelle (famille
 * d'achat `type`, `notes`, `adresse`, contacts). Sans risque : lecture SAP +
 * upsert local uniquement (aucune écriture SAP).
 *
 * Lecture sur l'environnement SAP **actif** (respecte le sélecteur prod/test).
 *
 * GET /api/sap/suppliers/import → { seeded } — vrai si au moins une fiche existe
 * déjà (sert à décider de l'auto-amorçage côté UI).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

interface SapPo {
  DocEntry: number;
  CardCode: string;
  CardName?: string;
  DocDate?: string;
}
interface SapVendorBp {
  CardCode: string;
  CardName?: string;
  EmailAddress?: string | null;
  Phone1?: string | null;
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const count = await prisma.supplier.count();
  return NextResponse.json({ seeded: count > 0, count });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(body?.limit ?? DEFAULT_LIMIT)) || DEFAULT_LIMIT));

  // 1) Dernières commandes fournisseurs SAP (DocEntry desc). On pagine un peu
  //    pour être sûr de trouver `limit` fournisseurs DISTINCTS même si un même
  //    fournisseur concentre plusieurs commandes récentes.
  let pos: SapPo[] = [];
  try {
    pos = await sap.getAll<SapPo>(
      "PurchaseOrders?$orderby=DocEntry desc&$select=DocEntry,CardCode,CardName,DocDate",
      { pageSize: 400, maxPages: 4 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Lecture SAP échouée : ${msg}` }, { status: 502 });
  }

  // 2) Dédup par CardCode en PRÉSERVANT l'ordre (le plus récent d'abord), puis
  //    on garde les `limit` premiers fournisseurs distincts.
  const seen = new Map<string, { cardCode: string; cardName: string; lastDocDate: string | null }>();
  for (const po of pos) {
    const code = (po.CardCode || "").trim();
    if (!code || seen.has(code)) continue;
    seen.set(code, {
      cardCode: code,
      cardName: (po.CardName || code).trim(),
      lastDocDate: po.DocDate ?? null,
    });
    if (seen.size >= limit) break;
  }
  const vendors = Array.from(seen.values());
  if (vendors.length === 0) {
    return NextResponse.json({ ok: true, pulled: pos.length, imported: 0, message: "Aucune commande fournisseur trouvée dans SAP." });
  }

  // 3) Enrichissement email / téléphone via BusinessPartners (une seule requête,
  //    filtre OR sur les CardCode). Best-effort — si ça échoue on garde le nom.
  const contactByCode = new Map<string, { email: string | null; phone: string | null }>();
  try {
    const codes = vendors.map((v) => v.cardCode);
    const orFilter = codes.map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`).join(" or ");
    const bps = await sap.get<{ value: SapVendorBp[] }>(
      `BusinessPartners?$select=CardCode,CardName,EmailAddress,Phone1&$filter=${encodeURIComponent(`(${orFilter})`)}`,
    );
    for (const bp of bps.value || []) {
      contactByCode.set(bp.CardCode, {
        email: bp.EmailAddress?.trim() || null,
        phone: bp.Phone1?.trim() || null,
      });
    }
  } catch {
    /* enrichissement facultatif — on continue sans email/tel */
  }

  // 4) Upsert non destructif. Le `code` local = CardCode SAP. On préserve la
  //    famille d'achat (`type`), les `notes`, l'`adresse` et l'état `active`
  //    déjà saisis à la main (COALESCE / OR), on rafraîchit nom / SAP / contact.
  let imported = 0;
  for (const v of vendors) {
    const contact = contactByCode.get(v.cardCode);
    const email = contact?.email?.toLowerCase() || null;
    const tel1 = contact?.phone ? formatPhoneDisplay(contact.phone) || null : null;
    await prisma.$executeRaw`
      INSERT INTO "Supplier" ("id","code","nom","type","sapCardCode","email","tel1","active","createdAt","updatedAt")
      VALUES (gen_random_uuid()::text, ${v.cardCode}, ${v.cardName}, NULL, ${v.cardCode}, ${email}, ${tel1}, true, NOW(), NOW())
      ON CONFLICT ("code") DO UPDATE SET
        "nom" = EXCLUDED."nom",
        "sapCardCode" = COALESCE("Supplier"."sapCardCode", EXCLUDED."sapCardCode"),
        -- n'écrase pas un email / téléphone déjà saisi à la main
        "email" = COALESCE("Supplier"."email", EXCLUDED."email"),
        "tel1" = COALESCE("Supplier"."tel1", EXCLUDED."tel1"),
        "updatedAt" = NOW();
    `;
    imported++;
  }

  return NextResponse.json({
    ok: true,
    company: sap.getEnvironment().company,
    pulledOrders: pos.length,
    distinctVendors: vendors.length,
    imported,
    limit,
  });
}
