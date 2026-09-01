import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CANAL_LABEL, STATUT_LABEL } from "@/lib/transport";

export const dynamic = "force-dynamic";

function day(s: string | null, fallback: Date): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(s ?? "") ? new Date(`${s}T00:00:00.000Z`) : fallback;
}
function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * GET /api/transport/expeditions/export?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Export CSV (Excel-friendly, séparateur « ; ») des expéditions sur la période
 * (défaut : aujourd'hui). Phase 2 — historique / export.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const from = day(sp.get("from"), today);
  const to = new Date(day(sp.get("to"), from).getTime() + 86_400_000); // inclusif

  const rows = await prisma.transportExpedition.findMany({
    where: { date: { gte: from, lt: to } },
    include: { chauffeur: { select: { nom: true, societe: true } } },
    orderBy: [{ date: "asc" }, { canal: "asc" }, { ordre: "asc" }],
  });

  const header = ["Date", "Canal", "N° commande", "Réf. suivi", "Client", "Chauffeur", "Société", "Statut", "T°C", "Colis", "Poids (kg)", "Créneau", "Expédié le", "Livré le", "Observations"];
  const lines = [header.join(";")];
  for (const r of rows) {
    lines.push([
      r.date.toISOString().slice(0, 10),
      CANAL_LABEL[r.canal] ?? r.canal,
      r.numCommande, r.refSuivi, r.clientNom,
      r.chauffeur?.nom, r.chauffeur?.societe,
      STATUT_LABEL[r.statut] ?? r.statut,
      r.tempChargement, r.colis, r.poidsKg, r.creneau,
      r.expedieAt?.toISOString().slice(0, 16).replace("T", " "),
      r.livreeAt?.toISOString().slice(0, 16).replace("T", " "),
      r.observations,
    ].map(csvCell).join(";"));
  }
  const csv = "﻿" + lines.join("\r\n"); // BOM UTF-8 pour Excel
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="expeditions_${from.toISOString().slice(0, 10)}.csv"`,
    },
  });
}
