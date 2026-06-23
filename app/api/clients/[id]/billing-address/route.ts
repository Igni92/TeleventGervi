import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";

/**
 * Adresse de FACTURATION du client — structurée, source de vérité SAP
 * (BusinessPartners.BPAddresses, type bo_BillTo / table CRDR1).
 *
 * GET  → lit l'adresse « Facturer à » depuis SAP.
 * PATCH→ écrit Street/Block/City/ZipCode/County/Country sur CETTE adresse, en
 *         renvoyant la collection COMPLÈTE des adresses (sinon le Service Layer
 *         écraserait les autres adresses — livraison, etc.).
 */

type SapAddress = {
  AddressName?: string;
  AddressType?: string;     // bo_BillTo | bo_ShipTo
  Street?: string | null;
  Block?: string | null;
  City?: string | null;
  ZipCode?: string | null;
  County?: string | null;
  Country?: string | null;
};

async function clientCode(id: string): Promise<string | null> {
  const c = await prisma.client.findUnique({ where: { id }, select: { code: true } });
  return c?.code ?? null;
}

/** Récupère toutes les adresses + repère l'adresse de facturation (bo_BillTo). */
async function fetchAddresses(code: string): Promise<{ all: SapAddress[]; billIdx: number }> {
  const bp = await sap.get<{ BPAddresses?: SapAddress[] }>(
    `BusinessPartners('${code.replace(/'/g, "''")}')?$select=BPAddresses`,
  );
  const all = bp.BPAddresses ?? [];
  let billIdx = all.findIndex((a) => a.AddressType === "bo_BillTo");
  if (billIdx < 0 && all.length > 0) billIdx = 0; // fallback : 1re adresse
  return { all, billIdx };
}

const toOut = (a: SapAddress | undefined) => ({
  addressName: a?.AddressName ?? null,
  street: a?.Street ?? "",
  block: a?.Block ?? "",
  city: a?.City ?? "",
  zipCode: a?.ZipCode ?? "",
  county: a?.County ?? "",
  country: a?.Country ?? "",
});

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  const code = await clientCode(params.id);
  if (!code) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  try {
    const { all, billIdx } = await fetchAddresses(code);
    return NextResponse.json({ ok: true, ...toOut(billIdx >= 0 ? all[billIdx] : undefined) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

const Schema = z.object({
  street: z.string().trim().max(254).optional(),
  block: z.string().trim().max(254).optional(),
  city: z.string().trim().max(100).optional(),
  zipCode: z.string().trim().max(20).optional(),
  county: z.string().trim().max(100).optional(),
  country: z.string().trim().max(3).optional(),   // code pays SAP (ex. FR)
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await clientInScope(await getAccessScope(session), params.id)))
    return NextResponse.json({ error: "Accès refusé à ce client." }, { status: 403 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 });

  const code = await clientCode(params.id);
  if (!code) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  try {
    const { all, billIdx } = await fetchAddresses(code);
    const d = parsed.data;

    // Construit la collection COMPLÈTE (on ne touche QUE l'adresse de facturation).
    const next: SapAddress[] = all.map((a) => ({ ...a }));
    const patchFields: SapAddress = {
      AddressType: "bo_BillTo",
      Street: d.street ?? "", Block: d.block ?? "", City: d.city ?? "",
      ZipCode: d.zipCode ?? "", County: d.county ?? "", Country: (d.country || "FR").toUpperCase(),
    };
    if (billIdx >= 0) {
      next[billIdx] = { ...next[billIdx], ...patchFields, AddressType: "bo_BillTo" };
    } else {
      // Aucune adresse → on en crée une « Facturation ».
      next.push({ AddressName: "Facturation", ...patchFields });
    }

    await sap.patch(`BusinessPartners('${code.replace(/'/g, "''")}')`, { BPAddresses: next });

    const written = billIdx >= 0 ? next[billIdx] : next[next.length - 1];
    // Cache local (lisibilité hors-ligne) : on garde une version texte.
    const text = [written.Street, written.Block, [written.ZipCode, written.City].filter(Boolean).join(" "), written.County, written.Country]
      .filter((x) => x && String(x).trim()).join("\n");
    await prisma.client.update({ where: { id: params.id }, data: { adresseFacturation: text || null } }).catch(() => {});

    return NextResponse.json({ ok: true, ...toOut(written) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
