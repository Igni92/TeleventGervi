/**
 * ÉTAT MENSUEL DES HEURES imprimable (PDF via impression navigateur) — compta.
 *
 * Même mécanique que le bon de préparation (printRecap) : fenêtre dédiée,
 * document A4 autonome (styles inline), impression automatique. Une PAGE PAR
 * EMPLOYÉ (une ligne par semaine du mois + totaux + signatures) précédée,
 * quand il y a plusieurs employés, d'une PAGE DE SYNTHÈSE équipe.
 */
import {
  fmtHM, weekLabel, aggregateMonth, monthLabel, weekDates, dayMinutes,
  JOURS_SEMAINE, DAY_TAG_LABEL,
  type HoursProfile, type WeekCalc, type HeuresOption, type DayHours,
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
    /** Saisie BRUTE Lun→Dim — alimente le DÉTAIL JOUR PAR JOUR de l'état. */
    days?: DayHours[] | null;
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

/* ─────────────────────── DÉTAIL JOUR PAR JOUR du mois ──────────────────────
 * Le tableau des semaines dit COMBIEN ; il ne dit pas QUELS JOURS. Pour la
 * compta comme pour le salarié qui signe, c'est le jour qui fait foi : quel
 * jour a été travaillé, lequel était en récup, en CP, en maladie, férié.
 * D'où ce second tableau, une ligne par jour du mois, sous le récapitulatif
 * hebdomadaire. */

const dJour = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });

/** Plage horaire lisible : « 04:45 → 12:00 », les deux demi-journées si saisies. */
function plage(d: DayHours | undefined): string {
  if (!d) return "";
  const parts: string[] = [];
  if (d.m1 && d.m2) parts.push(`${d.m1} → ${d.m2}`);
  if (d.a1 && d.a2) parts.push(`${d.a1} → ${d.a2}`);
  return parts.join("  ·  ");
}

/** Teinte du tag — récup en bleu, absence/maladie en rouge, comme à l'écran. */
function tagClass(tag: string | undefined): string {
  if (tag === "recup") return "opt recup";
  if (tag === "conges" || tag === "ferie") return "opt paie";
  if (tag === "absent" || tag === "maladie") return "opt";
  return "opt";
}

/**
 * Une ligne par JOUR du mois, toutes semaines confondues, triées par date.
 * On ne garde QUE les jours réellement rattachés au `monthId` : une semaine à
 * cheval sur deux mois est rattachée en entier à un mois pour les majorations
 * (règle légale, calcul hebdomadaire), mais imprimer ici les jours de l'autre
 * mois ferait un état qui ne correspond à aucun bulletin.
 */
function detailJoursRows(weeks: MoisEmploye["weeks"], monthId: string): string {
  type Ligne = { date: string; d: DayHours | undefined; min: number };
  const lignes: Ligne[] = [];
  for (const w of weeks) {
    const dates = weekDates(w.week);
    for (let i = 0; i < 7; i++) {
      const date = dates[i];
      if (!date || !date.startsWith(monthId)) continue;
      const d = w.days?.[i];
      // `calc.dayMin` inclut les CRÉDITS (congé, férié, récup posée) ; la saisie
      // brute ne les connaît pas. On prend le calcul quand il existe.
      const min = w.calc?.dayMin?.[i] ?? dayMinutes(d);
      lignes.push({ date, d, min });
    }
  }
  lignes.sort((a, b) => a.date.localeCompare(b.date));
  if (lignes.length === 0) return "";

  return lignes.map(({ date, d, min }) => {
    const jourIdx = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7; // Lun=0
    const tag = d?.tag;
    const h = plage(d);
    const credit = !h && min > 0; // journée créditée (CP / férié / récup posée)
    return `
    <tr${min === 0 && !tag ? ' class="vide"' : ""}>
      <td class="jour">${esc(JOURS_SEMAINE[jourIdx] ?? "")}<span class="date">${dJour(date)}</span></td>
      <td>${h ? esc(h) : (credit ? "<i>journée créditée</i>" : "—")}</td>
      <td class="num total">${min > 0 ? fmtHM(min) : "—"}</td>
      <td>${tag ? `<span class="${tagClass(tag)}">${esc(DAY_TAG_LABEL[tag] ?? tag)}</span>` : "—"}</td>
      <td class="note">${d?.note ? esc(d.note) : ""}</td>
    </tr>`;
  }).join("");
}

/** Compte les jours du mois par TAG (jours travaillés, récup, CP, maladie…) —
 *  le résumé que cherche la compta avant même de lire le détail. */
function compteJours(weeks: MoisEmploye["weeks"], monthId: string): {
  travailles: number; recup: number; conges: number; maladie: number; absent: number; ferie: number;
} {
  const out = { travailles: 0, recup: 0, conges: 0, maladie: 0, absent: 0, ferie: 0 };
  for (const w of weeks) {
    const dates = weekDates(w.week);
    for (let i = 0; i < 7; i++) {
      const date = dates[i];
      if (!date || !date.startsWith(monthId)) continue;
      const d = w.days?.[i];
      const worked = dayMinutes(d) > 0;
      // Un jour AVEC heures saisies est travaillé, quel que soit son tag : le
      // tag « Présent » n'est pas toujours posé, et une demi-journée de récup
      // suivie d'une matinée travaillée reste du temps de travail.
      if (worked) out.travailles++;
      else if (d?.tag === "recup") out.recup++;
      else if (d?.tag === "conges") out.conges++;
      else if (d?.tag === "maladie") out.maladie++;
      else if (d?.tag === "ferie") out.ferie++;
      else if (d?.tag === "absent") out.absent++;
    }
  }
  return out;
}

/** Bloc « jours du mois » — n'affiche que les catégories non vides (hors jours
 *  travaillés, toujours montrés). */
function joursBlock(weeks: MoisEmploye["weeks"], monthId: string): string {
  const c = compteJours(weeks, monthId);
  const cases: string[] = [`<div><p class="k">Jours travaillés</p><p class="v">${c.travailles} j</p></div>`];
  if (c.recup > 0)   cases.push(`<div><p class="k">Récupération</p><p class="v">${c.recup} j</p></div>`);
  if (c.conges > 0)  cases.push(`<div><p class="k">Congés payés</p><p class="v">${c.conges} j</p></div>`);
  if (c.ferie > 0)   cases.push(`<div><p class="k">Fériés chômés</p><p class="v">${c.ferie} j</p></div>`);
  if (c.maladie > 0) cases.push(`<div><p class="k">Maladie</p><p class="v">${c.maladie} j</p></div>`);
  if (c.absent > 0)  cases.push(`<div><p class="k">Absence</p><p class="v alert">${c.absent} j</p></div>`);
  return `<div class="recap" style="grid-template-columns: repeat(${cases.length}, 1fr)">${cases.join("")}</div>`;
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
  // Détail jour par jour — vide si aucune saisie brute n'est remontée (états
  // anciens, ou employé sans semaine saisie) : on n'imprime pas un tableau creux.
  const detailJours = detailJoursRows(f.weeks, monthId);
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
    ${joursBlock(f.weeks, monthId)}
    ${recapBlock(f.recap)}

    ${detailJours ? `
    <h2 style="font-size:13px;text-transform:uppercase;letter-spacing:1.2px;margin:16px 0 8px">
      Détail jour par jour — ${esc(monthLabel(monthId))}
    </h2>
    <table>
      <thead>
        <tr>
          <th>Jour</th><th>Horaires</th><th class="num">Total</th><th>Nature</th><th>Note</th>
        </tr>
      </thead>
      <tbody>${detailJours}</tbody>
    </table>` : ""}

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
