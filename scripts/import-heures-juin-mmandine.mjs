#!/usr/bin/env node
/**
 * Import ponctuel des heures de JUIN 2026 de m.mandine@gervifrais.com depuis
 * le relevé SAP (Saisie des Temps, saisie n°52, total 169h30) — écrit dans
 * AppSetting au même format que /api/effectif/heures (clé `rhsem:<email>:<W>`).
 * L'option compta (paiement / récup / mixte) des semaines en heures supp N'EST
 * PAS posée ici : c'est une décision employeur à prendre depuis l'onglet
 * Effectifs (le calcul des heures supp, lui, se fait automatiquement à partir
 * des heures réelles saisies ci-dessous — rien à "incrémenter" à la main).
 *
 *   node --env-file=.env scripts/import-heures-juin-mmandine.mjs           # dry-run (affiche, n'écrit rien)
 *   node --env-file=.env scripts/import-heures-juin-mmandine.mjs --apply   # écrit réellement
 */
import { PrismaClient } from "@prisma/client";

const EMAIL = "m.mandine@gervifrais.com";
const APPLY = process.argv.includes("--apply");

// ── Relevé SAP juin 2026 (date ISO → [heure début, heure fin], un seul bloc) ──
const RAW = {
  "2026-06-01": ["04:45", "12:00"],
  "2026-06-02": ["04:45", "12:00"],
  "2026-06-03": ["04:45", "12:00"],
  "2026-06-04": ["04:45", "12:00"],
  "2026-06-05": ["04:45", "12:00"],
  "2026-06-06": ["04:45", "12:00"],
  "2026-06-08": ["04:45", "12:00"],
  "2026-06-09": ["04:45", "12:00"],
  "2026-06-10": ["04:45", "12:00"],
  "2026-06-11": ["04:45", "12:00"],
  "2026-06-12": ["04:45", "12:00"],
  "2026-06-13": ["04:45", "12:00"],
  "2026-06-15": ["04:45", "12:00"],
  "2026-06-16": ["04:45", "12:00"],
  "2026-06-17": ["04:45", "12:30"],
  "2026-06-18": ["04:45", "12:00"],
  "2026-06-19": ["04:45", "12:30"],
  "2026-06-20": ["04:45", "12:30"],
  "2026-06-23": ["04:45", "12:00"],
  "2026-06-24": ["04:45", "12:15"],
  "2026-06-25": ["04:45", "13:00"],
  "2026-06-26": ["04:45", "12:00"],
  "2026-06-30": ["04:45", "12:00"],
};

// ── Semaines ISO Lun→Dim (portage exact de lib/heuresCalc.ts, pour ne pas
//    dépendre d'un import "@/lib/..." depuis un script autonome) ──
function isoWeekId(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function weekDates(weekId) {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekId);
  const year = Number(m[1]), week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (week - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

// ── Regroupement par semaine ISO ──
const byWeek = new Map(); // weekId -> { dateISO: [start, end] }
for (const [dateISO, hours] of Object.entries(RAW)) {
  const [y, mo, da] = dateISO.split("-").map(Number);
  const weekId = isoWeekId(new Date(Date.UTC(y, mo - 1, da)));
  if (!byWeek.has(weekId)) byWeek.set(weekId, {});
  byWeek.get(weekId)[dateISO] = hours;
}

console.log(`Employé : ${EMAIL}`);
console.log(`Mode : ${APPLY ? "ÉCRITURE réelle (--apply)" : "dry-run (rien n'est écrit — relancer avec --apply)"}\n`);

const prisma = APPLY ? new PrismaClient() : null;

try {
  for (const [weekId, entries] of [...byWeek].sort()) {
    const dates = weekDates(weekId);
    const days = dates.map((dateISO) => {
      const h = entries[dateISO];
      return h ? { m1: h[0], m2: h[1] } : {};
    });
    const worked = dates.filter((d) => entries[d]).length;
    console.log(`${weekId} (${dates[0]} → ${dates[6]}) — ${worked} jour(s) saisis :`);
    dates.forEach((d, i) => {
      if (entries[d]) console.log(`   ${d} : ${entries[d][0]}–${entries[d][1]}`);
    });

    if (APPLY) {
      const key = `rhsem:${EMAIL}:${weekId}`;
      // Ne PAS écraser une décision compta déjà posée sur cette semaine si elle
      // existe déjà (option/paySuppMin/recupDates) — on ne touche qu'aux heures.
      const existingRow = await prisma.appSetting.findUnique({ where: { key } });
      const existing = existingRow ? JSON.parse(existingRow.value) : null;
      const value = JSON.stringify({
        days,
        option: existing?.option ?? null,
        paySuppMin: existing?.paySuppMin,
        recupDates: existing?.recupDates,
        updatedAt: new Date().toISOString(),
        updatedBy: EMAIL,
      });
      await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
      console.log(`   ✅ écrit (${key})`);
    }
    console.log("");
  }
} finally {
  if (prisma) await prisma.$disconnect();
}

console.log(APPLY
  ? "Terminé. Les heures supp. de chaque semaine sont désormais calculées automatiquement\n" +
    "par l'app à partir de ces horaires réels — rien à incrémenter à la main. Pour décider\n" +
    "paiement / récupération sur les semaines en dépassement, utilisez l'onglet Effectifs."
  : "Dry-run terminé — vérifiez le détail ci-dessus, puis relancez avec --apply pour écrire.");
