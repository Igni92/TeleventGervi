/**
 * FEUILLES D'HEURES imprimables (PDF via impression navigateur) — compta/paie.
 *
 * Même mécanique que le bon de préparation (printRecap) : fenêtre dédiée,
 * document A4 autonome (styles inline), impression automatique. Une PAGE PAR
 * EMPLOYÉ (tableau des jours + totaux + majorations + signatures) précédée,
 * quand il y a plusieurs employés, d'une PAGE DE SYNTHÈSE équipe.
 */
import {
  JOURS_SEMAINE, computeWeek, fmtHM, weekDates, weekLabel,
  type DayHours, type HoursProfile,
} from "./heuresCalc";

export interface FeuilleEmploye {
  name: string;
  email: string;
  days: DayHours[];               // 7 (Lun→Dim)
  profile: HoursProfile;
  updatedAt?: string | null;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const hm = (s: string | undefined) => (s && s.trim() ? esc(s.trim()) : "—");

function dayDateLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit" });
}

function employePage(f: FeuilleEmploye, weekId: string, dates: string[]): string {
  const calc = computeWeek(f.days, f.profile.weeklyHours);
  const rows = JOURS_SEMAINE.map((jour, i) => {
    const d = f.days[i] ?? {};
    return `
      <tr>
        <td class="jour">${jour}<span class="date">${dates[i] ? dayDateLabel(dates[i]) : ""}</span></td>
        <td class="num">${hm(d.m1)}</td><td class="num">${hm(d.m2)}</td>
        <td class="num">${hm(d.a1)}</td><td class="num">${hm(d.a2)}</td>
        <td class="num total">${calc.dayMin[i] > 0 ? fmtHM(calc.dayMin[i]) : "—"}</td>
        <td class="note">${d.note ? esc(d.note) : ""}</td>
      </tr>`;
  }).join("");

  return `
  <section class="page">
    <header>
      <div>
        <p class="kicker">Gervifrais · Feuille d'heures</p>
        <h1>${esc(f.name)}</h1>
        <p class="sub">${esc(f.email)} · contrat <b>${fmtHM(calc.contractMin)}</b> / semaine</p>
      </div>
      <div class="bl">
        <p class="date-big">${esc(weekLabel(weekId))}</p>
        ${f.updatedAt ? `<p class="maj">Saisie du ${new Date(f.updatedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</p>` : ""}
      </div>
    </header>

    <table>
      <thead>
        <tr>
          <th>Jour</th>
          <th class="num">Matin début</th><th class="num">Matin fin</th>
          <th class="num">A-midi début</th><th class="num">A-midi fin</th>
          <th class="num">Total</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td class="label">Total semaine</td>
          <td colspan="4"></td>
          <td class="num total">${fmtHM(calc.totalMin)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>

    <div class="recap">
      <div><p class="k">Contrat</p><p class="v">${fmtHM(calc.contractMin)}</p></div>
      <div><p class="k">Écart</p><p class="v">${fmtHM(calc.deltaMin)}</p></div>
      <div><p class="k">H. supp +25 %</p><p class="v">${fmtHM(calc.sup25Min)}</p></div>
      <div><p class="k">H. supp +50 %</p><p class="v">${fmtHM(calc.sup50Min)}</p></div>
      <div><p class="k">Équiv. payé (majoré)</p><p class="v">${fmtHM(calc.majEquivMin)}</p></div>
      <div><p class="k">Récupération</p><p class="v">${fmtHM(calc.recupMin)}</p></div>
    </div>
    <p class="legende">Majorations légales : les 8 premières heures au-delà du contrat à +25 %, les suivantes à +50 %.
    « Équiv. payé » = heures supp converties en heures payées (×1,25 / ×1,5) — donnée paie.</p>

    <div class="signatures">
      <div><p>Signature de l'employé</p></div>
      <div><p>Visa du responsable</p></div>
    </div>
  </section>`;
}

function synthesePage(feuilles: FeuilleEmploye[], weekId: string): string {
  const rows = feuilles.map((f) => {
    const c = computeWeek(f.days, f.profile.weeklyHours);
    return `
      <tr>
        <td>${esc(f.name)}</td>
        <td class="num">${fmtHM(c.contractMin)}</td>
        <td class="num">${fmtHM(c.totalMin)}</td>
        <td class="num">${fmtHM(c.deltaMin)}</td>
        <td class="num">${fmtHM(c.sup25Min)}</td>
        <td class="num">${fmtHM(c.sup50Min)}</td>
        <td class="num total">${fmtHM(c.majEquivMin)}</td>
        <td class="num">${fmtHM(c.recupMin)}</td>
      </tr>`;
  }).join("");
  return `
  <section class="page">
    <header>
      <div>
        <p class="kicker">Gervifrais · Compta / paie</p>
        <h1>Synthèse des heures — équipe</h1>
      </div>
      <div class="bl"><p class="date-big">${esc(weekLabel(weekId))}</p></div>
    </header>
    <table>
      <thead>
        <tr>
          <th>Employé</th><th class="num">Contrat</th><th class="num">Total</th><th class="num">Écart</th>
          <th class="num">Supp +25 %</th><th class="num">Supp +50 %</th><th class="num">Équiv. payé</th><th class="num">Récup</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="legende">Une feuille détaillée par employé suit (à signer). Majorations : +25 % (8 premières heures supp), +50 % au-delà.</p>
  </section>`;
}

/** Ouvre la fenêtre d'impression des feuilles d'heures. false = pop-up bloquée. */
export function printFeuillesHeures(weekId: string, feuilles: FeuilleEmploye[]): boolean {
  if (feuilles.length === 0) return false;
  const dates = weekDates(weekId);
  const pages = [
    ...(feuilles.length > 1 ? [synthesePage(feuilles, weekId)] : []),
    ...feuilles.map((f) => employePage(f, weekId, dates)),
  ].join("");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Heures ${esc(weekId)} — ${feuilles.length > 1 ? "équipe" : esc(feuilles[0].name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 12mm; }
  body { font: 14px/1.5 "Segoe UI", Arial, sans-serif; color: #111; padding: 16px; }
  @media print { body { padding: 0; } .noprint { display: none !important; } }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }

  header { display: flex; justify-content: space-between; align-items: center; gap: 12px;
           border-bottom: 2.5px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
  .kicker { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #555; }
  h1 { font-size: 21px; letter-spacing: -0.3px; }
  .sub { font-size: 12.5px; color: #333; margin-top: 2px; }
  .bl { text-align: right; }
  .date-big { font-size: 16px; font-weight: 800; }
  .maj { font-size: 11px; color: #555; margin-top: 2px; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  thead th { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.8px; color: #333;
             border-bottom: 2px solid #111; padding: 6px 8px; text-align: left; }
  thead th.num, td.num { text-align: right; white-space: nowrap; }
  tbody td { border-bottom: 1px solid #ccc; padding: 7px 8px; }
  td.jour { font-weight: 700; }
  td.jour .date { font-weight: 400; color: #555; margin-left: 6px; font-size: 12px; }
  td.total { font-weight: 800; }
  td.note { font-size: 12px; color: #444; }
  tfoot td { border-top: 2px solid #111; padding: 8px; font-weight: 700; }
  tfoot .label { text-transform: uppercase; font-size: 11px; letter-spacing: 1px; }

  .recap { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0;
           border: 1.5px solid #111; border-radius: 6px; overflow: hidden; margin-bottom: 8px; }
  .recap > div { padding: 7px 10px; border-left: 1px solid #bbb; }
  .recap > div:first-child { border-left: none; }
  .recap .k { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.8px; color: #555; }
  .recap .v { font-size: 15px; font-weight: 800; margin-top: 1px; }
  .legende { font-size: 10.5px; color: #555; margin-bottom: 18px; }

  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 26px; }
  .signatures > div { border-top: 1.5px solid #111; padding-top: 6px; }
  .signatures p { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #333; }

  .noprint { margin-bottom: 14px; }
  .noprint button { font: 600 13px "Segoe UI", Arial, sans-serif; padding: 8px 18px;
                    border: 1.5px solid #111; border-radius: 6px; background: #111; color: #fff; cursor: pointer; }
</style>
</head>
<body>
  <div class="noprint"><button onclick="window.print()">🖨 Imprimer / PDF</button></div>
  ${pages}
  <script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 150); });</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
