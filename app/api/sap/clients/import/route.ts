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

interface SapBP {
  CardCode: string;
  CardName: string;
  GroupCode?: number;
  SalesPersonCode?: number;
  Phone1?: string;
  Frozen?: "tYES" | "tNO";
  U_Actif?: string | null;
}
interface SalesPerson { SalesEmployeeCode: number; SalesEmployeeName: string }
// ⚠️ BusinessPartnerGroups (groupes CLIENTS) = Code/Name (≠ ItemGroups = Number/GroupName).
interface SapGroup { Code: number; Name: string }

const isActif = (v: unknown) => String(v ?? "").trim().toUpperCase() === "O";

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

    bps = await sap.getAll<SapBP>(
      "BusinessPartners?$select=CardCode,CardName,GroupCode,SalesPersonCode,Phone1,U_Actif,Frozen"
      + "&$filter=CardType eq 'cCustomer' and Frozen eq 'tNO'",
      { pageSize: 500, maxPages: 100, env: "prod" },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Lecture SAP échouée : ${msg}` }, { status: 502 });
  }

  if (clear) {
    // CASCADE → vide aussi appels, rappels, contacts, modes de livraison, incidents.
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "Client" RESTART IDENTITY CASCADE;`);
  }

  let activated = 0;
  let gmsCount = 0;
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
      // Commercial = null par défaut (affecté à la main). Vendeur : GMS + actif → MM (1ʳᵉ passe).
      const vendeur = (type === "GMS" && active) ? "MM" : null;
      return prisma.$executeRaw`
        INSERT INTO "Client" ("id","code","nom","type","commercial","vendeur","tel1","joursAppel","sapGroupCode","sapGroupName","activeTelevente","createdAt","updatedAt")
        VALUES (gen_random_uuid()::text, ${bp.CardCode}, ${bp.CardName || bp.CardCode}, ${type}, NULL, ${vendeur}, ${bp.Phone1 ?? null}, '1,2,3,4,5,6', ${grpCode}, ${grpName}, ${active}, NOW(), NOW())
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
  });
}
