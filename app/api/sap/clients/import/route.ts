import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";

/**
 * POST /api/sap/clients/import   body { clear?: boolean }
 *
 * Importe tous les CLIENTS SAP **non gelés** (CardType='cCustomer', Frozen='tNO')
 * dans la table Client locale.
 *
 * Règles d'activation TeleVente :
 *   • U_Actif='O' (UDF OCRD) → `activeTelevente = true` (apparaît d'office dans
 *     la liste d'un commercial).
 *   • sinon → false (activation manuelle ; tout nouveau client arrive inactif).
 *   • Sur ré-import sans clear : on n'éteint jamais un client déjà actif.
 *
 * clear=true → VIDE d'abord Client + dépendants (CASCADE : appels, rappels,
 * contacts, modes de livraison, incidents) et repart de zéro.
 *
 * Lit la société SAP **active** (cf. bouton prod/test). L'import est une lecture
 * (aucune écriture SAP) → sans risque même en PROD.
 *
 * Raw SQL pour l'insert (le champ activeTelevente n'est pas dans le client
 * Prisma régénéré — EPERM dev server).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface SapBPAddress {
  AddressName?: string | null;
  AddressType?: string | null; // "bo_ShipTo" (livraison) | "bo_BillTo" (facturation)
  City?: string | null;
  ZipCode?: string | null;
  Country?: string | null;
}
interface SapBP {
  CardCode: string;
  CardName: string;
  GroupCode?: number;
  SalesPersonCode?: number;
  Phone1?: string;
  Frozen?: "tYES" | "tNO";
  U_Actif?: string | null;
  // Localisation — pour la carte géo. On géolocalise sur l'adresse de LIVRAISON
  // (ship-to dans BPAddresses), pas la facturation. Les champs de tête
  // (City/ZipCode/Country = adresse par défaut/facturation) servent de repli.
  City?: string | null;
  ZipCode?: string | null;
  Country?: string | null;
  ShipToDefault?: string | null; // AddressName de l'adresse de livraison par défaut
  BPAddresses?: SapBPAddress[];
}
interface SalesPerson { SalesEmployeeCode: number; SalesEmployeeName: string }
// ⚠️ BusinessPartnerGroups (groupes CLIENTS) = Code/Name (≠ ItemGroups = Number/GroupName).
interface SapGroup { Code: number; Name: string }

const isActif = (v: unknown) => String(v ?? "").trim().toUpperCase() === "O";

const pickStr = (v?: string | null) => (v && v.trim() ? v.trim() : null);

/**
 * Adresse de LIVRAISON (ship-to) du client, pour la géolocalisation de la carte.
 * Priorité : ship-to par défaut (ShipToDefault) → 1ʳᵉ ship-to → 1ʳᵉ bill-to →
 * champs de tête du BP (repli). On ne géolocalise JAMAIS sur la facturation si
 * une adresse de livraison existe (demande métier).
 */
function deliveryAddress(bp: SapBP): { city: string | null; zip: string | null; country: string | null; usedShipTo: boolean } {
  const addrs = bp.BPAddresses ?? [];
  const shipTos = addrs.filter((a) => a.AddressType === "bo_ShipTo");
  const chosen =
    (bp.ShipToDefault ? shipTos.find((a) => a.AddressName === bp.ShipToDefault) : undefined)
    ?? shipTos[0]
    ?? addrs.find((a) => a.AddressType === "bo_BillTo")
    ?? addrs[0]
    ?? null;
  return {
    city: pickStr(chosen?.City) ?? pickStr(bp.City),
    zip: pickStr(chosen?.ZipCode) ?? pickStr(bp.ZipCode),
    country: pickStr(chosen?.Country) ?? pickStr(bp.Country),
    usedShipTo: shipTos.length > 0,
  };
}

/** Type client dérivé du nom de groupe SAP. GMS pour tous les groupes « GMS … ». */
function clientTypeFromGroup(groupName: string | null): string | null {
  if (!groupName) return null;
  const g = groupName.trim().toUpperCase();
  if (g.startsWith("GMS")) return "GMS";
  return null;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // Import global (peut VIDER la table Client en CASCADE) → admins uniquement.
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const clear = body?.clear === true;

  let bps: SapBP[];
  let groupName: Map<number, string>;
  try {
    // Import TOUJOURS sur la base réelle (PROD) — le test n'est pas fiable.
    const groups = await sap.getAll<SapGroup>("BusinessPartnerGroups?$select=Code,Name", { env: "prod" });
    groupName = new Map(groups.map((g) => [g.Code, g.Name]));

    const baseSel = "CardCode,CardName,GroupCode,SalesPersonCode,Phone1,U_Actif,Frozen,City,ZipCode,Country";
    const filter = "&$filter=CardType eq 'cCustomer' and Frozen eq 'tNO'";
    const opts = { pageSize: 500, maxPages: 100, env: "prod" as const };
    try {
      // Idéal : on rapatrie aussi les adresses (BPAddresses) pour géolocaliser
      // sur l'adresse de LIVRAISON (ship-to).
      bps = await sap.getAll<SapBP>(`BusinessPartners?$select=${baseSel},ShipToDefault,BPAddresses${filter}`, opts);
    } catch {
      // Certaines versions de Service Layer refusent une collection dans $select
      // → repli sur l'adresse de tête (facturation) pour ne pas casser l'import.
      bps = await sap.getAll<SapBP>(`BusinessPartners?$select=${baseSel}${filter}`, opts);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Lecture SAP échouée : ${msg}` }, { status: 502 });
  }

  // Colonnes géo (cf. scripts/ddl-client-geo.mjs) — créées ici de façon
  // défensive pour que l'INSERT enrichi ne casse pas si le DDL n'a pas tourné.
  await prisma.$executeRawUnsafe(`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "city" TEXT;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "zipCode" TEXT;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "country" TEXT;`);

  if (clear) {
    // CASCADE → vide aussi appels, rappels, contacts, modes de livraison, incidents.
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "Client" RESTART IDENTITY CASCADE;`);
  }

  let activated = 0;
  let gmsCount = 0;
  let shipToCount = 0;
  const CHUNK = 50;
  for (let i = 0; i < bps.length; i += CHUNK) {
    const slice = bps.slice(i, i + CHUNK);
    await Promise.all(slice.map((bp) => {
      const active = isActif(bp.U_Actif);
      if (active) activated++;
      const grpCode = bp.GroupCode ?? null;
      const grpName = grpCode != null ? groupName.get(grpCode) ?? null : null;
      const type = clientTypeFromGroup(grpName);
      if (type === "GMS") gmsCount++;
      // Commercial = JMG par défaut (un client sans commercial revient à JMG —
      // règle métier). Réassignation manuelle préservée via le COALESCE plus bas.
      // Vendeur : GMS + actif → MM (1ʳᵉ passe).
      const vendeur = (type === "GMS" && active) ? "MM" : null;
      // Géoloc carte = adresse de LIVRAISON (ship-to), repli facturation/tête.
      const { city, zip, country, usedShipTo } = deliveryAddress(bp);
      if (usedShipTo) shipToCount++;
      return prisma.$executeRaw`
        INSERT INTO "Client" ("id","code","nom","type","commercial","vendeur","tel1","joursAppel","sapGroupCode","sapGroupName","city","zipCode","country","activeTelevente","createdAt","updatedAt")
        VALUES (gen_random_uuid()::text, ${bp.CardCode}, ${bp.CardName || bp.CardCode}, ${type}, 'JMG', ${vendeur}, ${bp.Phone1 ?? null}, '1,2,3,4,5,6', ${grpCode}, ${grpName}, ${city}, ${zip}, ${country}, ${active}, NOW(), NOW())
        ON CONFLICT ("code") DO UPDATE SET
          "nom" = EXCLUDED."nom",
          "type" = EXCLUDED."type",
          -- préserve les assignations manuelles (commercial / vendeur / jours) au ré-import
          "commercial" = COALESCE("Client"."commercial", EXCLUDED."commercial"),
          "vendeur" = COALESCE("Client"."vendeur", EXCLUDED."vendeur"),
          "joursAppel" = COALESCE("Client"."joursAppel", EXCLUDED."joursAppel"),
          "tel1" = EXCLUDED."tel1",
          "sapGroupCode" = EXCLUDED."sapGroupCode",
          "sapGroupName" = EXCLUDED."sapGroupName",
          -- localisation SAP : on rafraîchit, en conservant l'ancienne valeur si SAP renvoie vide
          "city" = COALESCE(EXCLUDED."city", "Client"."city"),
          "zipCode" = COALESCE(EXCLUDED."zipCode", "Client"."zipCode"),
          "country" = COALESCE(EXCLUDED."country", "Client"."country"),
          "activeTelevente" = "Client"."activeTelevente" OR EXCLUDED."activeTelevente",
          "updatedAt" = NOW();
      `;
    }));
  }

  return NextResponse.json({
    ok: true,
    cleared: clear,
    company: sap.getEnvironment().prodCompany, // import lu sur la base réelle
    pulled: bps.length,
    activated,
    manual: bps.length - activated,
    gms: gmsCount,
    shipTo: shipToCount, // clients géolocalisés sur leur adresse de livraison
  });
}
