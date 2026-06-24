import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";
import { formatPhoneDisplay } from "@/lib/phone";

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

/** Vrai si le CardCode est une variante « transporteur » (suffixe « . ») :
 *  même client, autre mode de livraison (ex. LPOI. = SCACHAP de LPOI). */
const isDotVariant = (code: string) => code.trim().endsWith(".");

/** Upsert d'un BP SAP dans la table Client (insert idempotent, préserve les
 *  affectations manuelles commercial/vendeur/jours). Renvoie de quoi alimenter
 *  les compteurs de la réponse. */
async function upsertClientBp(
  bp: SapBP,
  groupName: Map<number, string>,
): Promise<{ active: boolean; gms: boolean; shipTo: boolean }> {
  const active = isActif(bp.U_Actif);
  const grpCode = bp.GroupCode ?? null;
  const grpName = grpCode != null ? groupName.get(grpCode) ?? null : null;
  const type = clientTypeFromGroup(grpName);
  // Vendeur : GMS + actif → MM (1ʳᵉ passe). Commercial = JMG par défaut.
  const vendeur = type === "GMS" && active ? "MM" : null;
  // Géoloc carte = adresse de LIVRAISON (ship-to), repli facturation/tête.
  const { city, zip, country, usedShipTo } = deliveryAddress(bp);
  // Téléphone normalisé à l'import au format « xx xx xx xx xx ».
  const tel1 = formatPhoneDisplay(bp.Phone1) || null;
  await prisma.$executeRaw`
    INSERT INTO "Client" ("id","code","nom","type","commercial","vendeur","tel1","joursAppel","sapGroupCode","sapGroupName","city","zipCode","country","activeTelevente","createdAt","updatedAt")
    VALUES (gen_random_uuid()::text, ${bp.CardCode}, ${bp.CardName || bp.CardCode}, ${type}, 'JMG', ${vendeur}, ${tel1}, '1,2,3,4,5,6', ${grpCode}, ${grpName}, ${city}, ${zip}, ${country}, ${active}, NOW(), NOW())
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
  return { active, gms: type === "GMS", shipTo: usedShipTo };
}

/**
 * Replie un BP « code. » (variante transporteur SAP) en MODE DE LIVRAISON du
 * client parent (« code »), au lieu d'en faire un client séparé en double.
 *   - crée le mode « Direct » (CardCode = code parent) + « SCACHAP » (CardCode
 *     = code point) sur le parent — idempotent ;
 *   - fusionne un éventuel client point déjà importé : son historique CRM
 *     (appels, rappels, incidents, contacts) est rapatrié sur le parent, puis
 *     la fiche en double est supprimée.
 * Renvoie "orphan" si aucun parent n'existe (l'appelant importe alors le BP
 * comme client normal, pour ne rien perdre).
 */
async function foldDotVariant(dotCode: string, altName = "SCACHAP"): Promise<"folded" | "orphan"> {
  const parentCode = dotCode.replace(/\.+$/, "");
  if (!parentCode || parentCode === dotCode) return "orphan";
  const parent = await prisma.client.findUnique({ where: { code: parentCode }, select: { id: true } });
  if (!parent) return "orphan";

  // Mode « Direct » — défaut seulement si le client n'a encore AUCUN mode (on ne
  // force pas un défaut déjà choisi à la main).
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ClientDeliveryMode" ("id","clientId","name","sapCardCode","isDefault","createdAt","updatedAt")
     SELECT gen_random_uuid()::text, $1, 'Direct', $2,
            NOT EXISTS (SELECT 1 FROM "ClientDeliveryMode" WHERE "clientId" = $1),
            NOW(), NOW()
     WHERE NOT EXISTS (SELECT 1 FROM "ClientDeliveryMode" WHERE "clientId" = $1 AND "sapCardCode" = $2)
     ON CONFLICT ("clientId","sapCardCode") DO NOTHING`,
    parent.id, parentCode,
  );
  // Mode alternatif (SCACHAP) = le CardCode point.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ClientDeliveryMode" ("id","clientId","name","sapCardCode","isDefault","createdAt","updatedAt")
     SELECT gen_random_uuid()::text, $1, $2, $3, false, NOW(), NOW()
     WHERE NOT EXISTS (SELECT 1 FROM "ClientDeliveryMode" WHERE "clientId" = $1 AND "sapCardCode" = $3)
     ON CONFLICT ("clientId","sapCardCode") DO NOTHING`,
    parent.id, altName, dotCode,
  );
  // Fusionne un client point déjà présent (doublon) → parent, puis supprime.
  const dot = await prisma.client.findUnique({ where: { code: dotCode }, select: { id: true } });
  if (dot && dot.id !== parent.id) {
    for (const table of ["AppelLog", "Rappel", "Incident", "Contact"]) {
      await prisma.$executeRawUnsafe(`UPDATE "${table}" SET "clientId" = $1 WHERE "clientId" = $2`, parent.id, dot.id);
    }
    // TempAssignment (éphémère, unique (clientId,date)) → supprimé par cascade.
    await prisma.client.delete({ where: { id: dot.id } });
  }
  return "folded";
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

  // Sépare les variantes « transporteur » (code finissant par « . ») des clients
  // normaux : une variante n'est PAS un client séparé, c'est un MODE DE LIVRAISON
  // du parent (cf. foldDotVariant) — ex. LPOI (Direct) / LPOI. (SCACHAP).
  const mainBps = bps.filter((bp) => !isDotVariant(bp.CardCode));
  const dotBps = bps.filter((bp) => isDotVariant(bp.CardCode));

  let activated = 0;
  let gmsCount = 0;
  let shipToCount = 0;
  const bump = (r: { active: boolean; gms: boolean; shipTo: boolean }) => {
    if (r.active) activated++;
    if (r.gms) gmsCount++;
    if (r.shipTo) shipToCount++;
  };

  const CHUNK = 50;
  for (let i = 0; i < mainBps.length; i += CHUNK) {
    const slice = mainBps.slice(i, i + CHUNK);
    const res = await Promise.all(slice.map((bp) => upsertClientBp(bp, groupName)));
    res.forEach(bump);
  }

  // Replie les variantes « code. » en modes de livraison du parent. Un orphelin
  // (parent absent) est importé comme client normal pour ne rien perdre.
  let foldedModes = 0;
  let orphanDots = 0;
  for (const bp of dotBps) {
    const r = await foldDotVariant(bp.CardCode);
    if (r === "folded") { foldedModes++; continue; }
    orphanDots++;
    bump(await upsertClientBp(bp, groupName));
  }

  const importedClients = mainBps.length + orphanDots;
  return NextResponse.json({
    ok: true,
    cleared: clear,
    company: sap.getEnvironment().prodCompany, // import lu sur la base réelle
    pulled: bps.length,
    clientsImported: importedClients,
    activated,
    manual: importedClients - activated,
    gms: gmsCount,
    shipTo: shipToCount, // clients géolocalisés sur leur adresse de livraison
    foldedDeliveryModes: foldedModes, // variantes « code. » repliées en modes Direct/SCACHAP
    orphanDotClients: orphanDots, // variantes « code. » sans parent → importées telles quelles
  });
}
