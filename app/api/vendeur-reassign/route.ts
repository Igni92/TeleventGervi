import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { normalizeSlp, displayNameFromSlp } from "@/lib/salespeople";
import {
  getReassignMarkers, setReassignMarker, parisDateStr, type ReassignMarker,
} from "@/lib/vendeurReassign";

/**
 * Bascule TEMPORAIRE de clients entre deux vendeurs (télévente), avec retour
 * automatique — voir lib/vendeurReassign.ts.
 *
 *   GET  ?a=<trig>&b=<trig>
 *        → { a, b, aName, bName, clients: [{ id, code, nom, type, city,
 *            activeTelevente, vendeur, baseline, reassign|null }] }
 *          où `vendeur` = colonne courante (a ou b), `baseline` = titulaire
 *          permanent, `reassign` = marqueur en cours (to/endDate/from/by).
 *
 *   POST { ids: string[], to: <trig>, endDate: "yyyy-mm-dd"|null }
 *        Déplace chaque client vers `to`. Si `to` est le titulaire permanent du
 *        client → RETOUR (restaure + lève le marqueur, endDate ignorée). Sinon
 *        → bascule (endDate REQUISE). Réservé aux administrateurs.
 */

const trig = (v: string | null): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return normalizeSlp(t) ?? t.toUpperCase();
};

interface ClientRow {
  id: string; code: string; nom: string; type: string | null;
  city: string | null; activeTelevente: boolean; vendeur: string | null;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  const a = trig(req.nextUrl.searchParams.get("a"));
  const b = trig(req.nextUrl.searchParams.get("b"));
  if (!a || !b) return NextResponse.json({ error: "a et b requis" }, { status: 400 });
  if (a === b) return NextResponse.json({ error: "a et b doivent différer" }, { status: 400 });

  const rows = await prisma.$queryRaw<ClientRow[]>(
    Prisma.sql`SELECT "id", "code", "nom", "type", "city", "activeTelevente", "vendeur"
               FROM "Client" WHERE "vendeur" IN (${a}, ${b}) ORDER BY "nom" ASC`,
  );
  const markers = await getReassignMarkers(rows.map((r) => r.id));
  const clients = rows.map((r) => {
    const m = markers.get(r.id) ?? null;
    return {
      id: r.id, code: r.code, nom: r.nom, type: r.type, city: r.city,
      activeTelevente: r.activeTelevente,
      vendeur: r.vendeur,
      baseline: m ? m.from : r.vendeur,
      reassign: m ? { to: m.to, from: m.from, endDate: m.endDate, by: m.by } : null,
    };
  });

  return NextResponse.json({
    a, b,
    aName: displayNameFromSlp(a) ?? a,
    bName: displayNameFromSlp(b) ?? b,
    clients,
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const to = trig(typeof body.to === "string" ? body.to : null);
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string").slice(0, 4000) : [];
  const endDate: string | null = typeof body.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.endDate) ? body.endDate : null;
  if (!to) return NextResponse.json({ error: "to requis" }, { status: 400 });
  if (ids.length === 0) return NextResponse.json({ error: "ids requis" }, { status: 400 });

  // État courant (colonne vendeur) + marqueurs existants.
  const rows = await prisma.$queryRaw<{ id: string; vendeur: string | null }[]>(
    Prisma.sql`SELECT "id", "vendeur" FROM "Client" WHERE "id" IN (${Prisma.join(ids)})`,
  );
  const curMap = new Map(rows.map((r) => [r.id, r.vendeur]));
  const markers = await getReassignMarkers(ids);
  const by = session.user.name?.trim() || session.user.email || "";
  const at = new Date().toISOString();

  let moved = 0, reverted = 0, skipped = 0;
  const needDate: string[] = [];
  for (const id of ids) {
    if (!curMap.has(id)) { skipped++; continue; }
    const cur = curMap.get(id) ?? null;
    const m = markers.get(id) ?? null;
    const baseline = m ? m.from : cur; // titulaire permanent

    if (to === baseline) {
      // Retour à la maison : restaure la valeur d'origine, lève le marqueur.
      if (cur !== baseline) {
        await prisma.$executeRaw(
          Prisma.sql`UPDATE "Client" SET "vendeur" = ${baseline}, "updatedAt" = NOW() WHERE "id" = ${id}`,
        );
      }
      await setReassignMarker(id, null);
      reverted++;
      continue;
    }

    // Bascule (ou re-bascule) vers un autre vendeur → date de retour obligatoire.
    if (!endDate) { needDate.push(id); skipped++; continue; }
    if (cur !== to) {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE "Client" SET "vendeur" = ${to}, "updatedAt" = NOW() WHERE "id" = ${id}`,
      );
    }
    const marker: ReassignMarker = { from: baseline ?? to, to, endDate, by, at };
    await setReassignMarker(id, marker);
    moved++;
  }

  if (moved === 0 && reverted === 0 && needDate.length > 0) {
    return NextResponse.json({ error: "Date de retour requise pour une bascule" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, moved, reverted, skipped, today: parisDateStr() });
}
