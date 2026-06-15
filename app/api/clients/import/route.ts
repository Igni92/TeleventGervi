import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

interface ImportRow {
  code: string;
  nom?: string;
  tel1?: string;
  tel2?: string;
  tel3?: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  // Import/upsert de clients en masse → admins uniquement.
  if (!(await requireAdmin(session))) return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });

  try {
    const body = await req.json();
    const rows: ImportRow[] = body.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "Aucune ligne à importer" }, { status: 400 });
    }

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const row of rows) {
      if (!row.code?.trim()) {
        errors.push(`Ligne ignorée : code manquant`);
        continue;
      }

      const code = row.code.trim().toUpperCase();
      const data = {
        nom: row.nom?.trim() || code,
        tel1: row.tel1?.trim() || null,
        tel2: row.tel2?.trim() || null,
        tel3: row.tel3?.trim() || null,
      };

      try {
        const existing = await prisma.client.findUnique({ where: { code } });
        if (existing) {
          await prisma.client.update({
            where: { code },
            data,
          });
          updated++;
        } else {
          await prisma.client.create({
            // Par défaut : Lun→Sam (1,2,3,4,5,6), pas le dimanche
            data: { code, joursAppel: "1,2,3,4,5,6", ...data },
          });
          created++;
        }
      } catch {
        errors.push(`Erreur pour le code ${code}`);
      }
    }

    return NextResponse.json({
      created,
      updated,
      errors,
      total: created + updated,
    });
  } catch (error) {
    console.error("[POST /api/clients/import]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
