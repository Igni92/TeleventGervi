import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";

/**
 * ⚠️ ROUTE DE DIAGNOSTIC TEMPORAIRE — à SUPPRIMER après usage.
 * Permet de vérifier (sans login) la présence des variables d'env et la
 * connectivité SAP/DB sur le déploiement. Protégée par une clé en query.
 * N'expose JAMAIS les valeurs secrètes — seulement présent/absent + tests.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KEY = "tvd_9f3a7c2e1b4d8a";

export async function GET(req: NextRequest) {
  if (new URL(req.url).searchParams.get("key") !== KEY) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const env = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    AUTH_SECRET: !!(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET),
    NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? "(unset)",
    AZURE_CLIENT_ID: !!process.env.AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: !!process.env.AZURE_CLIENT_SECRET,
    AZURE_TENANT_ID: !!process.env.AZURE_TENANT_ID,
    SAP_B1_BASE_URL_set: !!process.env.SAP_B1_BASE_URL,
    SAP_B1_BASE_URL_host: (() => {
      try { return new URL(process.env.SAP_B1_BASE_URL ?? "").host; } catch { return "(invalid/unset)"; }
    })(),
    SAP_B1_COMPANY_DB: process.env.SAP_B1_COMPANY_DB ?? "(unset)",
    SAP_B1_USERNAME_set: !!process.env.SAP_B1_USERNAME,
    SAP_B1_PASSWORD_set: !!process.env.SAP_B1_PASSWORD,
    SAP_B1_TLS_INSECURE: process.env.SAP_B1_TLS_INSECURE ?? "(unset)",
    RELANCE_FROM_ADDRESS: process.env.RELANCE_FROM_ADDRESS ?? "(unset)",
  };

  let db: string;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "ok";
  } catch (e) {
    db = "ERR: " + (e instanceof Error ? e.message : String(e)).slice(0, 250);
  }

  let sapTest: string;
  try {
    await sap.get("BusinessPartners?$select=CardCode&$top=1", { env: "prod" });
    sapTest = "ok";
  } catch (e) {
    sapTest = "ERR: " + (e instanceof Error ? e.message : String(e)).slice(0, 400);
  }

  return NextResponse.json({ env, db, sap: sapTest });
}
