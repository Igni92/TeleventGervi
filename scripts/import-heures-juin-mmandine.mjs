#!/usr/bin/env node
/**
 * Import ponctuel des heures de JUIN 2026 de m.mandine@gervifrais.com depuis le
 * relevé SAP (Saisie des Temps), écrit dans AppSetting au format
 * /api/effectif/heures (clé `rhsem:<email>:<W>`).
 *
 * FUSION jour-par-jour : on ne pose QUE les journées de juin listées ci-dessous,
 * sans jamais écraser une journée déjà saisie (ex. la semaine W27, à cheval
 * juin/juillet, conserve ses jours de juillet et son éventuelle récup). L'option
 * compta (paiement/récup/mixte) et les dates de récup existantes sont préservées.
 *
 *   node --env-file=.env scripts/import-heures-juin-mmandine.mjs           # dry-run (n'écrit rien)
 *   node --env-file=.env scripts/import-heures-juin-mmandine.mjs --apply   # écrit réellement
 */
import { PrismaClient } from "@prisma/client";

const EMAIL = "m.mandine@gervifrais.com";
const APPLY = process.argv.includes("--apply");

// ── Relevé SAP juin 2026 (date ISO → [début, fin], un seul bloc) ──
const RAW = {
  "2026-06-01": ["04:45", "12:00"], "2026-06-02": ["04:45", "12:00"], "2026-06-03": ["04:45", "12:00"],
  "2026-06-04": ["04:45", "12:00"], "2026-06-05": ["04:45", "12:00"], "2026-06-06": ["04:45", "12:00"],
  "2026-06-08": ["04:45", "12:00"], "2026-06-09": ["04:45", "12:00"], "2026-06-10": ["04:45", "12:00"],
  "2026-06-11": ["04:45", "12:00"], "2026-06-12": ["04:45", "12:00"], "2026-06-13": ["04:45", "12:00"],
  "2026-06-15": ["04:45", "12:00"], "2026-06-16": ["04:45", "12:00"], "2026-06-17": ["04:45", "12:30"],
  "2026-06-18": ["04:45", "12:00"], "2026-06-19": ["04:45", "12:30"], "2026-06-20": ["04:45", "12:30"],
  "2026-06-23": ["04:45", "12:00"], "2026-06-24": ["04:45", "12:15"], "2026-06-25": ["04:45", "13:00"],
  "2026-06-26": ["04:45", "12:00"], "2026-06-30": ["04:45", "12:00"],
};

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

const byWeek = new Map();
for (const [dateISO, hours] of Object.entries(RAW)) {
  const [y, mo, da] = dateISO.split("-").map(Number);
  const weekId = isoWeekId(new Date(Date.UTC(y, mo - 1, da)));
  if (!byWeek.has(weekId)) byWeek.set(weekId, {});
  byWeek.get(weekId)[dateISO] = hours;
}

console.log(`Employé : ${EMAIL}`);
console.log(`Mode : ${APPLY ? "ÉCRITURE réelle (--apply)" : "dry-run (rien écrit — relancer avec --apply)"}\n`);

const prisma = new PrismaClient();
try {
  for (const [weekId, entries] of [...byWeek].sort()) {
    const dates = weekDates(weekId);
    const key = `rhsem:${EMAIL}:${weekId}`;
    const existingRow = await prisma.appSetting.findUnique({ where: { key } });
    const existing = existingRow ? JSON.parse(existingRow.value) : null;
    const base = (existing?.days && Array.isArray(existing.days) && existing.days.length === 7)
      ? existing.days.map((d) => ({ ...(d || {}) }))
      : Array.from({ length: 7 }, () => ({}));

    console.log(`${weekId} (${dates[0]} → ${dates[6]})${existing ? "  [semaine EXISTANTE — fusion, jours conservés]" : "  [nouvelle]"}`);
    let changed = false;
    for (const dateISO of Object.keys(entries)) {
      const idx = dates.indexOf(dateISO);
      if (idx < 0) continue;
      const [m1, m2] = entries[dateISO];
      const before = base[idx];
      const already = before?.m1 === m1 && before?.m2 === m2;
      base[idx] = { ...before, m1, m2 };
      changed = changed || !already;
      console.log(`   ${dateISO} : ${m1}–${m2}${already ? "  (déjà présent, inchangé)" : (before?.m1 || before?.tag) ? "  (⚠ jour existant COMPLÉTÉ)" : ""}`);
    }
    // Jours conservés (hors juin) pour info.
    const kept = dates.filter((d, i) => !entries[d] && (base[i]?.m1 || base[i]?.tag)).map((d, i) => d);
    if (kept.length) console.log(`   ↪ conservés : ${dates.filter((d, i) => !entries[d] && (base[i]?.m1 || base[i]?.tag)).map((d) => d).join(", ")}`);

    if (APPLY) {
      const value = JSON.stringify({
        days: base,
        option: existing?.option ?? null,
        paySuppMin: existing?.paySuppMin,
        recupDates: existing?.recupDates,
        updatedAt: new Date().toISOString(),
        updatedBy: EMAIL,
      });
      await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
      console.log(`   ✅ ${changed ? "écrit" : "écrit (inchangé)"} (${key})`);
    }
    console.log("");
  }
} finally {
  await prisma.$disconnect();
}
