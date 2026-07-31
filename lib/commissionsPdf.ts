/**
 * ÉTAT DES COMMISSIONS imprimable (PDF via impression navigateur).
 *
 * Une PAGE PAR COMMERCIAL : le détail MOIS PAR MOIS de sa prime — le mois est
 * l'unité de paie, la commission tombe sur le bulletin au fur et à mesure
 * (cf. lib/commissions) — du plus récent au plus ancien, coupé par un TRAIT à
 * la dernière échéance réglée : au-dessus le reste à verser, en dessous
 * l'historique payé (date d'envoi au cabinet + auteur).
 *
 * Un mois payé porte le montant FIGÉ au versement, pas le recalcul du jour : un
 * document antidaté ne doit pas réécrire l'histoire de la paie. Quand les deux
 * diffèrent, l'écart est imprimé « à régulariser » — c'est la seule trace qui
 * en resterait, le curseur ayant déjà fermé le mois.
 *
 * Réutilise `openPrintWindow` de lib/heuresPdf (mécanique et styles communs).
 */
import { openPrintWindow } from "./heuresPdf";

export interface CommissionPdfPaid {
  payslipMonth: string;
  sentAt: string;
  sentBy: string;
  prime: number;
}

export interface CommissionPdfLine {
  month: string;
  invoices: number;
  creditNotes: number;
  base: number;
  avoirs: number;
  prime: number;
  settled: boolean;
  paid: CommissionPdfPaid | null;
  drift: number;
}

export interface CommissionPdfCommercial {
  slp: string;
  name: string;
  rate: number;
  since: string;
  lines: CommissionPdfLine[];
  totals: { paid: number; due: number; drift: number };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const eur2 = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
/** « 2025-11 » → « novembre 2025 ». */
const monthLabelFr = (m: string) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const dateFr = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function ligne(l: CommissionPdfLine): string {
  // Montant retenu : le VERSÉ pour un mois réglé, le recalcul pour un mois à venir.
  const montant = l.settled && l.paid ? l.paid.prime : l.prime;
  const statut = l.settled
    ? (l.paid
        ? `Payé le ${dateFr(l.paid.sentAt)} · paie ${monthLabelFr(l.paid.payslipMonth)}`
        : "Réglé — sans trace détaillée")
    : "<b>À payer</b>";
  const ecart = l.settled && Math.abs(l.drift) >= 0.01
    ? `<div class="opt" style="color:#b45309">${l.drift > 0 ? "+" : "−"}${eur2(Math.abs(l.drift))} depuis le versement — à régulariser</div>`
    : "";
  return `
    <tr${l.settled ? "" : ' style="background:#fffbeb"'}>
      <td class="jour">${cap(monthLabelFr(l.month))}</td>
      <td class="num">${l.invoices}${l.avoirs > 0 ? `<span class="date"> · avoirs −${eur2(l.avoirs)}</span>` : ""}</td>
      <td class="num">${eur2(l.base)}</td>
      <td class="num total">${eur2(montant)}</td>
      <td class="note">${statut}${ecart}</td>
    </tr>`;
}

function pageCommercial(c: CommissionPdfCommercial, paidThrough: string | null, editedAt: Date): string {
  // Lignes du plus récent au plus ancien : le trait se pose juste AVANT le
  // premier mois réglé — tout ce qui suit est de l'historique.
  const firstSettled = c.lines.findIndex((l) => l.settled);
  const corps = c.lines
    .map((l, i) => (i === firstSettled && paidThrough
      ? `<tr><td colspan="5" style="border-bottom:2px solid #111;padding:10px 8px 4px;
             font-size:10.5px;text-transform:uppercase;letter-spacing:1.2px;font-weight:800">
           Payé jusqu'à ${esc(monthLabelFr(paidThrough))}
         </td></tr>${ligne(l)}`
      : ligne(l)))
    .join("");

  const totalGeneral = c.totals.paid + c.totals.due;

  return `
  <section class="page">
    <header>
      <div>
        <p class="kicker">Gervifrais · État des commissions</p>
        <h1>${esc(c.name)}</h1>
        <p class="sub">prime <b>${(c.rate * 100).toFixed(0)} %</b> de la base retenue ·
          depuis le ${dateFr(c.since)} · ${c.lines.length} mois commissionné(s)</p>
      </div>
      <div class="bl">
        <p class="date-big">${eur2(c.totals.due)}</p>
        <p class="maj">reste à payer</p>
      </div>
    </header>

    <div class="recap recap5" style="grid-template-columns:repeat(4,1fr)">
      <div><p class="k">Déjà payé</p><p class="v">${eur2(c.totals.paid)}</p></div>
      <div><p class="k">Reste à payer</p><p class="v">${eur2(c.totals.due)}</p></div>
      <div><p class="k">Total commissions</p><p class="v">${eur2(totalGeneral)}</p></div>
      <div><p class="k">À régulariser</p><p class="v${Math.abs(c.totals.drift) >= 0.01 ? " alert" : ""}">${eur2(c.totals.drift)}</p></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Mois</th>
          <th class="num">Factures</th>
          <th class="num">Base retenue</th>
          <th class="num">Commission</th>
          <th>Statut</th>
        </tr>
      </thead>
      <tbody>
        ${corps || `<tr class="vide"><td colspan="5">Aucun mois commissionné.</td></tr>`}
      </tbody>
    </table>

    ${firstSettled === -1 && c.lines.length > 0
      ? `<p class="legende">Aucune échéance réglée à ce jour — l'intégralité reste à verser.</p>`
      : ""}

    <p class="legende">
      La commission est payée <b>tous les mois</b>, sur le bulletin : une ligne = un mois.
      Un mois déjà réglé porte le montant <b>figé au versement</b>, pas le montant recalculé
      aujourd'hui. Base retenue = marge nette de transport, cadeaux neutralisés, plancher 0 par
      facture, avoirs repris sans jamais passer sous 0.
      Édité le ${dateFr(editedAt.toISOString())}.
    </p>

    <div class="signatures">
      <div><p>Le salarié</p></div>
      <div><p>La direction</p></div>
    </div>
  </section>`;
}

/**
 * Ouvre l'état imprimable. Renvoie false si la fenêtre a été bloquée par le
 * navigateur (l'appelant prévient l'utilisateur — sinon le clic ne fait « rien »).
 */
export function printEtatCommissions(
  commerciaux: CommissionPdfCommercial[],
  paidThrough: string | null,
  editedAt: Date,
): boolean {
  if (commerciaux.length === 0) return false;
  const pages = commerciaux.map((c) => pageCommercial(c, paidThrough, editedAt)).join("");
  const titre = commerciaux.length > 1
    ? "Commissions — équipe"
    : `Commissions — ${commerciaux[0].name}`;
  return openPrintWindow(titre, pages);
}
