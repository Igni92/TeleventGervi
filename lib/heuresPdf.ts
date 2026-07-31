/**
 * ÉTAT MENSUEL DES HEURES imprimable (PDF via impression navigateur) — compta.
 *
 * Même mécanique que le bon de préparation (printRecap) : fenêtre dédiée,
 * document A4 autonome (styles inline), impression automatique. Une PAGE PAR
 * EMPLOYÉ (une ligne par semaine du mois + totaux + signatures) précédée,
 * quand il y a plusieurs employés, d'une PAGE DE SYNTHÈSE équipe.
 */
import {
  fmtHM, weekLabel, aggregateMonth, monthLabel,
  type HoursProfile, type WeekCalc, type HeuresOption,
} from "./heuresCalc";
import type { MonthRecap } from "./planning";


const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** « 33h00 à 25 % + 8h08 à 50 % » — n'affiche que les tranches non nulles. */
function fmtTranches(min25: number, min50: number): string {
  const parts: string[] = [];
  if (min25 > 0) parts.push(`${fmtHM(min25)} à 25 %`);
  if (min50 > 0) parts.push(`${fmtHM(min50)} à 50 %`);
  return parts.join(" + ");
}


/* ───────────────────────── État MENSUEL (compta / paie) ─────────────────────
 * Une page par employé : tableau des SEMAINES du mois (les majorations restent
 * calculées à la semaine — règle légale), totaux mensuels, signatures. Précédée
 * d'une page de synthèse équipe quand il y a plusieurs employés. */

export interface MoisEmploye {
  name: string;
  email: string;
  profile: HoursProfile;
  weeks: {
    week: string;
    calc: WeekCalc | null;
    option?: HeuresOption | null;   // choix compta reporté sur l'état
    paySuppMin?: number | null;     // part payée (option « mixte »)
    recupDates?: string[];          // dates de récup (options « recup »/« mixte »)
  }[];
  /** Compteurs à la FIN du mois (solde récup, plafond employeur, excédent « à
   *  payer sur le bulletin du mois suivant », solde CP) — reporté à la compta. */
  recap?: MonthRecap | null;
}

/** Bloc « compteurs CP » sous le tableau. Les CONGÉS PAYÉS sont un compteur à
 *  part, sans rapport avec les heures supp (désormais toutes payées ce mois —
 *  plus de solde récup ni de report M+1). null si CP non paramétrés. */
function recapBlock(recap: MonthRecap | null | undefined): string {
  if (!recap || recap.cpBalanceDays == null) return "";
  return `
    <div class="recap" style="grid-template-columns: repeat(2, 1fr)">
      <div><p class="k">CP pris (période)</p><p class="v">${recap.cpTakenDays} j</p></div>
      <div><p class="k">Solde CP</p><p class="v">${recap.cpBalanceDays} j</p></div>
    </div>`;
}

function moisRows(weeks: MoisEmploye["weeks"]): string {
  return weeks.map(({ week, calc }) => `
    <tr${calc ? "" : ' class="vide"'}>
      <td class="jour">${esc(weekLabel(week))}</td>
      <td class="num">${calc ? fmtHM(calc.contractMin) : "—"}</td>
      <td class="num">${calc ? fmtHM(calc.totalMin) : "non saisi"}</td>
      <td class="num">${calc ? fmtHM(calc.deltaMin) : "—"}</td>
      <td class="num">${calc && calc.sup25Min > 0 ? fmtHM(calc.sup25Min) : "—"}</td>
      <td class="num">${calc && calc.sup50Min > 0 ? fmtHM(calc.sup50Min) : "—"}</td>
      <td class="num total">${calc && calc.majEquivMin > 0 ? fmtHM(calc.majEquivMin) : "—"}</td>
      <td class="num">${calc && (calc.ferieMin ?? 0) > 0 ? fmtHM(calc.ferieMin) : "—"}</td>
    </tr>`).join("");
}

function moisEmployePage(f: MoisEmploye, monthId: string): string {
  const total = aggregateMonth(f.weeks.map((w) => w.calc));
  // « Tout payé » : TOUTES les heures supp du mois sont payées (plus de mise en
  // récup ni de report) → « à payer » = équivalent majoré total du mois.
  const pay = total.majEquivMin;
  // Détail PAR TRANCHE, en heures BRUTES : c'est ce qui se saisit sur le bulletin
  // de paie (les supp s'y déclarent par taux de majoration, pas en équivalent).
  // « Tout payé » rend le découpage direct : aucune part ne partant en récup, les
  // heures à payer SONT les heures supp du mois, tranche par tranche.
  // L'équivalent majoré reste rappelé dans le libellé pour le recoupement.
  const payLine = pay > 0
    ? `<div class="pay pay-ok"><span class="k">Heures supp À PAYER ce mois (toutes payées — équiv. majoré ${fmtHM(pay)})</span><span class="v">${fmtTranches(total.sup25Min, total.sup50Min)}</span></div>`
    : "";
  // Jours fériés : TOUJOURS payés (jamais en récup), détaillés à part pour la paie.
  const ferieLine = total.ferieMin > 0
    ? `<div class="pay pay-ok"><span class="k">Jours fériés — journée type due, TOUJOURS PAYÉE</span><span class="v">${fmtHM(total.ferieMin)}</span></div>`
    : "";
  return `
  <section class="page">
    <header>
      <div>
        <p class="kicker">Gervifrais · État mensuel des heures</p>
        <h1>${esc(f.name)}</h1>
        <p class="sub">${esc(f.email)} · contrat <b>${fmtHM(Math.round(f.profile.weeklyHours * 60))}</b> / semaine ·
          ${total.weeksWithData}/${f.weeks.length} semaine(s) saisie(s)</p>
      </div>
      <div class="bl"><p class="date-big">${esc(monthLabel(monthId))}</p></div>
    </header>

    <table>
      <thead>
        <tr>
          <th>Semaine</th><th class="num">Contrat</th><th class="num">Total</th><th class="num">Écart</th>
          <th class="num">Supp +25 %</th><th class="num">Supp +50 %</th><th class="num">À payer (équiv.)</th><th class="num">Férié</th>
        </tr>
      </thead>
      <tbody>${moisRows(f.weeks)}</tbody>
      <tfoot>
        <tr>
          <td class="label">Total du mois</td>
          <td class="num">${fmtHM(total.contractMin)}</td>
          <td class="num">${fmtHM(total.totalMin)}</td>
          <td class="num">${fmtHM(total.deltaMin)}</td>
          <td class="num">${fmtHM(total.sup25Min)}</td>
          <td class="num">${fmtHM(total.sup50Min)}</td>
          <td class="num total">${fmtHM(total.majEquivMin)}</td>
          <td class="num">${fmtHM(total.ferieMin)}</td>
        </tr>
      </tfoot>
    </table>

    ${ferieLine}
    ${payLine}
    ${recapBlock(f.recap)}

    <p class="legende">Les heures supplémentaires sont calculées PAR SEMAINE CIVILE (majorations légales :
    +25 % les 8 premières heures au-delà du contrat, +50 % ensuite) puis totalisées sur le mois.
    Une semaine à cheval sur deux mois est rattachée au mois où elle se termine (dimanche).
    « À payer (équiv.) » = TOUTES les heures supp du mois converties en heures payées (×1,25 / ×1,5) :
    elles sont INTÉGRALEMENT PAYÉES ce mois (plus de mise en récupération ni de report) — donnée paie.
    Un jour de CONGÉS validé est compté comme TRAVAILLÉ (journée type créditée — il ne crée jamais de
    déficit). Un JOUR FÉRIÉ chômé est DÛ : une journée type est créditée (colonne « Férié »), incluse
    dans le total et TOUJOURS PAYÉE ; les majorations d'heures supp ne portent que sur le dépassement
    réellement TRAVAILLÉ (hors crédit férié).</p>

    <div class="signatures">
      <div><p>Signature de l'employé</p></div>
      <div><p>Visa du responsable</p></div>
    </div>
  </section>`;
}

function moisSynthesePage(feuilles: MoisEmploye[], monthId: string): string {
  const rows = feuilles.map((f) => {
    const t = aggregateMonth(f.weeks.map((w) => w.calc));
    const pay = t.majEquivMin; // tout payé : équiv. majoré de TOUTES les heures supp
    return `
      <tr>
        <td>${esc(f.name)}</td>
        <td class="num">${t.weeksWithData}/${f.weeks.length}</td>
        <td class="num">${fmtHM(t.contractMin)}</td>
        <td class="num">${fmtHM(t.totalMin)}</td>
        <td class="num">${fmtHM(t.deltaMin)}</td>
        <td class="num">${fmtHM(t.sup25Min)}</td>
        <td class="num">${fmtHM(t.sup50Min)}</td>
        <td class="num total">${pay > 0 ? fmtHM(pay) : "—"}</td>
        <td class="num">${t.ferieMin > 0 ? fmtHM(t.ferieMin) : "—"}</td>
      </tr>`;
  }).join("");
  return `
  <section class="page">
    <header>
      <div>
        <p class="kicker">Gervifrais · Compta / paie</p>
        <h1>État mensuel des heures — équipe</h1>
      </div>
      <div class="bl"><p class="date-big">${esc(monthLabel(monthId))}</p></div>
    </header>
    <table>
      <thead>
        <tr>
          <th>Employé</th><th class="num">Semaines</th><th class="num">Contrat</th><th class="num">Total</th><th class="num">Écart</th>
          <th class="num">Supp +25 %</th><th class="num">Supp +50 %</th><th class="num">À payer (supp)</th><th class="num">Férié</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="legende">Heures supp calculées par semaine civile puis totalisées ; semaine à cheval rattachée au
    mois de son dimanche. « À payer (supp) » = équivalent MAJORÉ de TOUTES les heures supp du mois — elles sont
    intégralement payées ce mois (plus de mise en récupération ni de report). « Férié » = journées types créditées
    pour les jours fériés chômés — incluses dans le total et TOUJOURS payées (les majorations ne portent que sur
    le dépassement travaillé). Un état détaillé par employé suit (à signer).</p>
  </section>`;
}

/** Ouvre la fenêtre d'impression de l'ÉTAT MENSUEL. false = pop-up bloquée. */
export function printEtatMensuel(monthId: string, feuilles: MoisEmploye[]): boolean {
  if (feuilles.length === 0) return false;
  const pages = [
    ...(feuilles.length > 1 ? [moisSynthesePage(feuilles, monthId)] : []),
    ...feuilles.map((f) => moisEmployePage(f, monthId)),
  ].join("");
  return openPrintWindow(`Heures ${monthId} — ${feuilles.length > 1 ? "équipe" : feuilles[0].name}`, pages);
}

/** Document A4 autonome + impression auto (mécanique commune hebdo/mensuel —
 *  réutilisée par l'état des salaires, cf. lib/salairesPdf). */
export function openPrintWindow(title: string, pages: string): boolean {
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
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
  .opt { font-weight: 600; font-size: 11px; margin-top: 3px; }
  .opt.recup { color: #0369a1; }
  .opt.paie { color: #047857; }
  td.total { font-weight: 800; }
  td.note { font-size: 12px; color: #444; }
  tfoot td { border-top: 2px solid #111; padding: 8px; font-weight: 700; }
  tr.vide td { color: #999; font-style: italic; }
  tfoot .label { text-transform: uppercase; font-size: 11px; letter-spacing: 1px; }

  .recap { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0;
           border: 1.5px solid #111; border-radius: 6px; overflow: hidden; margin-bottom: 8px; }
  .recap.recap5 { grid-template-columns: repeat(5, 1fr); }
  .recap > div { padding: 7px 10px; border-left: 1px solid #bbb; }
  .recap > div:first-child { border-left: none; }
  .recap .k { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.8px; color: #555; }
  .recap .v { font-size: 15px; font-weight: 800; margin-top: 1px; }
  .v.alert, td.alert { color: #b91c1c; font-weight: 800; }
  .pay { display: flex; justify-content: space-between; align-items: center; gap: 10px;
         border: 2px solid #b91c1c; border-radius: 6px; padding: 7px 12px; margin-bottom: 8px;
         background: #fef2f2; }
  .pay .k { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #991b1b; font-weight: 700; }
  .pay .v { font-size: 16px; font-weight: 800; color: #b91c1c; }
  .pay.pay-ok { border-color: #047857; background: #ecfdf5; }
  .pay.pay-ok .k { color: #065f46; }
  .pay.pay-ok .v { color: #047857; }
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
