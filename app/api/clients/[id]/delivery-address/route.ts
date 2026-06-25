import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getAccessScope, clientInScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { sap } from "@/lib/sapb1";

/**
 * Adresse de LIVRAISON du client — structurée, source de vérité SAP
 * (BusinessPartners.BPAddresses, type bo_ShipTo / table CRD1).
 *
 * Parallèle exact de billing-address (bo_BillTo) mais sur l'adresse de
 * livraison « Expédier à ». On édite l'adresse de livraison PAR DÉFAUT
 * (ShipToDefault → 1ʳᵉ ship-to), comme le fait déjà l'import clients.
 *
 * GET  → lit l'adresse « Expédier à » par défaut depuis SAP.
 * PATCH→ écrit Street/Block/City/ZipCode/County/Country sur CETTE adresse, en
 *         renvoyant la collection COMPLÈTE des adresses (sinon le Service Layer
 *         écraserait les autres adresses — facturation, autres ship-to).
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

/**
 * Récupère toutes les adresses + repère l'adresse de livraison par défaut.
 * Priorité : ShipToDefault (AddressName) → 1ʳᵉ bo_ShipTo. -1 si aucune.
 */
async function fetchAddresses(code: string): Promise<{ all: SapAddress[]; shipIdx: number }> {
  const esc = code.replace(/'/g, "''");
  const bp = await sap.get<{ BPAddresses?: SapAddress[]; ShipToDefault?: string | null }>(
    `BusinessPartners('${esc}')?$select=BPAddresses,ShipToDefault`,
  );
  const all = bp.BPAddresses ?? [];
  const shipTos = all.filter((a) => a.AddressType === "bo_ShipTo");
  let shipIdx = -1;
  if (bp.ShipToDefault) {
    shipIdx = all.findIndex((a) => a.AddressType === "bo_ShipTo" && a.AddressName === bp.ShipToDefault);
  }
  if (shipIdx < 0 && shipTos.length > 0) {
    shipIdx = all.findIndex((a) => a.AddressType === "bo_ShipTo");
  }
  return { all, shipIdx };
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
    const { all, shipIdx } = await fetchAddresses(code);
    return NextResponse.json({ ok: true, ...toOut(shipIdx >= 0 ? all[shipIdx] : undefined) });
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
    const { all, shipIdx } = await fetchAddresses(code);
    const d = parsed.data;

    // Construit la collection COMPLÈTE (on ne touche QUE l'adresse de livraison).
    const next: SapAddress[] = all.map((a) => ({ ...a }));
    const patchFields: SapAddress = {
      AddressType: "bo_ShipTo",
      Street: d.street ?? "", Block: d.block ?? "", City: d.city ?? "",
      ZipCode: d.zipCode ?? "", County: d.county ?? "", Country: (d.country || "FR").toUpperCase(),
    };
    if (shipIdx >= 0) {
      next[shipIdx] = { ...next[shipIdx], ...patchFields, AddressType: "bo_ShipTo" };
    } else {
      // Aucune adresse de livraison → on en crée une « Livraison ».
      next.push({ AddressName: "Livraison", ...patchFields });
    }

    await sap.patch(`BusinessPartners('${code.replace(/'/g, "''")}')`, { BPAddresses: next });

    const written = shipIdx >= 0 ? next[shipIdx] : next[next.length - 1];
    // Rafraîchit le cache localisation (City/ZipCode/Country dérivent du ship-to
    // par défaut côté import) pour rester cohérent avec la carte / le pilotage.
    await prisma.client.update({
      where: { id: params.id },
      data: {
        city: written.City || null,
        zipCode: written.ZipCode || null,
        country: (written.Country || null)?.toUpperCase() || null,
      },
    }).catch(() => {});

    return NextResponse.json({ ok: true, ...toOut(written) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
