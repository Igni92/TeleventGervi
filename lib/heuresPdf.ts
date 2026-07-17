/**
 * ÉTAT MENSUEL DES HEURES imprimable (PDF via impression navigateur) — compta.
 *
 * Même mécanique que le bon de préparation (printRecap) : fenêtre dédiée,
 * document A4 autonome (styles inline), impression automatique. Une PAGE PAR
 * EMPLOYÉ (une ligne par semaine du mois + totaux + signatures) précédée,
 * quand il y a plusieurs employés, d'une PAGE DE SYNTHÈSE équipe.
 */
import {
  fmtHM, weekLabel, aggregateMonth, monthLabel, splitSupp, effectivePaySuppMin,
  type HoursProfile, type WeekCalc, type HeuresOption,
} from "./heuresCalc";
import type { MonthRecap } from "./planning";


const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** « 2026-07-08 » → « 08/07 » (état imprimé, compact). */
const fmtDateShort = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", day: "2-digit", month: "2-digit" });

/** Ligne « option retenue » placée sous le libellé de semaine sur l'état
 *  (récupération + dates posées, paiement des heures supp, ou partage mixte
 *  « X payées / Y en récup » posé depuis le détail compta pré-PDF). */
function optionLine(
  option: HeuresOption | null | undefined,
  recupDates: string[] | undefined,
  calc?: WeekCalc | null,
  paySuppMin?: number | null,
): string {
  const ds = (recupDates ?? []).filter(Boolean);
  const dsSuffix = ds.length ? ` — ${esc(ds.map(fmtDateShort).join(", "))}` : "";
  if (option === "recup") {
    return `<div class="opt recup">▪ Récupération${dsSuffix || " (jours à poser)"}</div>`;
  }
  if (option === "paiement") return `<div class="opt paie">▪ Paiement des heures supp.</div>`;
  if (option === "mixte" && calc) {
    const split = splitSupp(calc.sup25Min, calc.sup50Min,
      effectivePaySuppMin("mixte", paySuppMin, calc.sup25Min + calc.sup50Min));
    return `<div class="opt paie">▪ Paiement partiel : ${fmtHM(split.payMin)} payées (équiv. ${fmtHM(split.payEquivMin)})</div>`
      + `<div class="opt recup">▪ ${fmtHM(split.recupMin)} en récup (équiv. ${fmtHM(split.recupEquivMin)})${dsSuffix}</div>`;
  }
  return "";
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

/** Bloc « compteurs » sous le tableau : la donnée que la compta attend pour le
 *  bulletin du mois SUIVANT (heures supp au-delà du plafond de récup → payées). */
function recapBlock(recap: MonthRecap | null | undefined): string {
  if (!recap) return "";
  const cap = recap.recupCapMin == null ? "—" : fmtHM(recap.recupCapMin);
  const cp = recap.cpBalanceDays == null
    ? "—"
    : `${recap.cpBalanceDays} j`;
  const excess = recap.excessMin > 0
    ? `<div class="pay"><span class="k">À PAYER sur le bulletin du mois suivant</span><span class="v">${fmtHM(recap.excessMin)}</span></div>`
    : "";
  return `
    <div class="recap recap5">
      <div><p class="k">Solde récup (fin de mois)</p><p class="v">${fmtHM(recap.recupBalanceMin)}</p></div>
      <div><p class="k">Plafond récup</p><p class="v">${cap}</p></div>
      <div><p class="k">Au-delà du plafond → payé M+1</p><p class="v${recap.excessMin > 0 ? " alert" : ""}">${fmtHM(recap.excessMin)}</p></div>
      <div><p class="k">CP pris (période)</p><p class="v">${recap.cpTakenDays} j</p></div>
      <div><p class="k">Solde CP</p><p class="v">${cp}</p></div>
    </div>
    ${excess}`;
}

function moisRows(weeks: MoisEmploye["weeks"]): string {
  return weeks.map(({ week, calc, option, paySuppMin, recupDates }) => `
    <tr${calc ? "" : ' class="vide"'}>
      <td class="jour">${esc(weekLabel(week))}${calc && calc.sup25Min + calc.sup50Min > 0 ? optionLine(option, recupDates, calc, paySuppMin) : ""}</td>
      <td class="num">${calc ? fmtHM(calc.contractMin) : "—"}</td>
      <td class="num">${calc ? fmtHM(calc.totalMin) : "non saisi"}</td>
      <td class="num">${calc ? fmtHM(calc.deltaMin) : "—"}</td>
      <td class="num">${calc && calc.sup25Min > 0 ? fmtHM(calc.sup25Min) : "—"}</td>
      <td class="num">${calc && calc.sup50Min > 0 ? fmtHM(calc.sup50Min) : "—"}</td>
      <td class="num total">${calc && calc.majEquivMin > 0 ? fmtHM(calc.majEquivMin) : "—"}</td>
      <td class="num">${calc && (calc.ferieMin ?? 0) > 0 ? fmtHM(calc.ferieMin) : "—"}</td>
      <td class="num">${calc && calc.recupMin > 0 ? fmtHM(calc.recupMin) : "—"}</td>
    </tr>`).join("");
}

function moisEmployePage(f: MoisEmploye, monthId: string): string {
  const total = aggregateMonth(f.weeks.map((w) => w.calc));
  const pay = payEquivDecided(f.weeks);
  const payLine = pay > 0
    ? `<div class="pay pay-ok"><span class="k">Heures supp À PAYER ce mois (équiv. majoré, décision employeur)</span><span class="v">${fmtHM(pay)}</span></div>`
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
          <th class="num">Supp +25 %</th><th class="num">Supp +50 %</th><th class="num">Équiv. payé</th><th class="num">Férié</th><th class="num">Récup</th>
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
          <td class="num">${fmtHM(total.recupMin)}</td>
        </tr>
      </tfoot>
    </table>

    ${ferieLine}
    ${payLine}
    ${recapBlock(f.recap)}

    <p class="legende">Les heures supplémentaires sont calculées PAR SEMAINE CIVILE (majorations légales :
    +25 % les 8 premières heures au-delà du contrat, +50 % ensuite) puis totalisées sur le mois.
    Une semaine à cheval sur deux mois est rattachée au mois où elle se termine (dimanche).
    « Équiv. payé » = heures supp converties en heures payées (×1,25 / ×1,5) — donnée paie.
    Un jour de CONGÉS validé est compté comme TRAVAILLÉ (journée type créditée — il ne crée jamais de
    déficit). Un JOUR FÉRIÉ chômé est DÛ : une journée type est créditée (colonne « Férié »), incluse
    dans le total et TOUJOURS PAYÉE — jamais transformée en récup ; les majorations d'heures supp ne
    portent que sur le dépassement réellement TRAVAILLÉ (hors crédit férié).
    La récup posée n'est déduite du compteur qu'au passage de la semaine, et seulement si le
    contrat n'y est pas atteint. Les heures de récup AU-DELÀ du plafond fixé par l'employeur partent au
    PAIEMENT sur le bulletin du mois suivant (ligne « payé M+1 » ci-dessus).
    L'option retenue pour les heures supp (récupération en jours, paiement, ou partage « paiement
    partiel + récup » posé depuis le détail compta) est indiquée sous chaque semaine concernée —
    seule la part « payées » part sur le bulletin, le reste crédite le compteur de récup.</p>

    <div class="signatures">
      <div><p>Signature de l'employé</p></div>
      <div><p>Visa du responsable</p></div>
    </div>
  </section>`;
}

/** Équivalent majoré des heures supp À PAYER ce mois, d'après les décisions
 *  posées semaine par semaine (paiement intégral, ou part payée du mixte). */
function payEquivDecided(weeks: MoisEmploye["weeks"]): number {
  let out = 0;
  for (const { calc, option, paySuppMin } of weeks) {
    if (!calc) continue;
    const supp = calc.sup25Min + calc.sup50Min;
    if (supp <= 0 || (option !== "paiement" && option !== "mixte")) continue;
    out += splitSupp(calc.sup25Min, calc.sup50Min, effectivePaySuppMin(option, paySuppMin, supp)).payEquivMin;
  }
  return out;
}

function moisSynthesePage(feuilles: MoisEmploye[], monthId: string): string {
  const rows = feuilles.map((f) => {
    const t = aggregateMonth(f.weeks.map((w) => w.calc));
    const excess = f.recap?.excessMin ?? 0;
    const pay = payEquivDecided(f.weeks);
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
        <td class="num">${fmtHM(t.recupMin)}</td>
        <td class="num">${f.recap ? fmtHM(f.recap.recupBalanceMin) : "—"}</td>
        <td class="num${excess > 0 ? " alert" : ""}">${excess > 0 ? fmtHM(excess) : "—"}</td>
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
          <th class="num">Supp +25 %</th><th class="num">Supp +50 %</th><th class="num">À payer (supp)</th><th class="num">Férié</th><th class="num">Récup</th>
          <th class="num">Solde récup</th><th class="num">Payé M+1</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="legende">Heures supp calculées par semaine civile puis totalisées ; semaine à cheval rattachée au
    mois de son dimanche. « À payer (supp) » = équivalent MAJORÉ des heures supp dont le paiement a été décidé
    (paiement intégral ou part payée d'un partage « mixte ») — le reste crédite le compteur de récup.
    « Férié » = journées types créditées pour les jours fériés chômés — incluses dans le total et TOUJOURS
    payées (jamais en récup ; les majorations ne portent que sur le dépassement travaillé). « Payé M+1 » = heures de récup AU-DELÀ du plafond fixé par l'employeur, à payer
    sur le bulletin du mois suivant. Un état détaillé par employé suit (à signer).</p>
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
