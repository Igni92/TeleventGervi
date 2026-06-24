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

    // Borne la taille pour éviter une transaction démesurée / timeout.
    const MAX_ROWS = 10_000;
    if (rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: "Import trop volumineux, scindez le fichier (max 10000 lignes)" },
        { status: 413 },
      );
    }

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    // 1) Normalisation + filtrage des lignes invalides (code manquant).
    //    Dédoublonnage défensif par code (dernier gagne) : l'idempotence par
    //    `code` (MAJUSCULES) est ainsi garantie même si le client envoie des
    //    doublons.
    const byCode = new Map<string, { nom: string; tel1: string | null; tel2: string | null; tel3: string | null }>();
    for (const row of rows) {
      if (!row.code?.trim()) {
        errors.push("Ligne ignorée : code manquant");
        continue;
      }
      const code = row.code.trim().toUpperCase();
      byCode.set(code, {
        nom: row.nom?.trim() || code,
        tel1: row.tel1?.trim() || null,
        tel2: row.tel2?.trim() || null,
        tel3: row.tel3?.trim() || null,
      });
    }

    const entries = Array.from(byCode.entries());

    // 2) Détermine en une requête quels codes existent déjà (pour les compteurs
    //    created/updated) — évite une requête par ligne.
    const allCodes = entries.map(([code]) => code);
    const existingRows = await prisma.client.findMany({
      where: { code: { in: allCodes } },
      select: { code: true },
    });
    const existingSet = new Set(existingRows.map((r) => r.code));

    // 3) Upserts par LOTS dans des transactions (paquets de 500). Chaque upsert
    //    met à jour tel/nom si le code existe, crée sinon → idempotent par code.
    const BATCH_SIZE = 500;
    let processed = 0;
    for (let start = 0; start < entries.length; start += BATCH_SIZE) {
      const batch = entries.slice(start, start + BATCH_SIZE);
      try {
        await prisma.$transaction(
          batch.map(([code, data]) =>
            prisma.client.upsert({
              where: { code },
              update: data,
              // Par défaut à la création : commercial JMG (client sans commercial
              // → JMG), Lun→Sam (1,2,3,4,5,6), pas le dimanche.
              create: { code, commercial: "JMG", joursAppel: "1,2,3,4,5,6", ...data },
            }),
          ),
        );
        // Lot OK → comptabilise created/updated via l'état pré-import.
        for (const [code] of batch) {
          if (existingSet.has(code)) updated++;
          else created++;
        }
        processed += batch.length;
      } catch (e) {
        // Un lot a échoué : on renvoie ce qui a été traité + l'erreur, sans
        // laisser l'utilisateur sans information.
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Lot ${start + 1}-${start + batch.length} échoué : ${msg}`);
        return NextResponse.json(
          {
            created,
            updated,
            errors,
            total: created + updated,
            processed,
            partial: true,
          },
          { status: 207 },
        );
      }
    }

    return NextResponse.json({
      created,
      updated,
      errors,
      total: created + updated,
      processed,
    });
  } catch (error) {
    console.error("[POST /api/clients/import]", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
