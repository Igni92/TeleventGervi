/**
 * ÉTAT DES COMMISSIONS imprimable (PDF via impression navigateur).
 *
 * Modèle « BANQUE » (relevé de compte) : une PAGE PAR COMMERCIAL affichant
 *   • Dû cumulé  = Σ des primes mensuelles RECALCULÉES en direct depuis SAP
 *                  (base = marge nette de transport, cadeaux neutralisés, plancher
 *                  0/facture, seuil de poids livré par client — cf. lib/commissions) ;
 *   • Déjà versé = Σ des versements en euros enregistrés (relevé direction) ;
 *   • Solde      = Dû − Versé : un trop-payé (négatif) se DÉDUIT du prochain
 *                  versement, un reste à payer (positif) s'y ajoute. Tout écart
 *                  est reporté d'une échéance à l'autre, comme un compte bancaire.
 *
 * Le détail mois par mois n'est plus « figé au versement » (plus de curseur) :
 * c'est le recalcul du jour, puisque le solde absorbe automatiquement les écarts.
 *
 * Réutilise `openPrintWindow` de lib/heuresPdf (mécanique et styles communs).
 */
import { openPrintWindow } from "./heuresPdf";

export interface CommissionPdfLine {
  month: string;
  invoices: number;
  creditNotes: number;
  base: number;
  avoirs: number;
  prime: number;
}

/** Un versement en euros noté par la direction (le « on note ce qui est payé »). */
export interface CommissionPdfPayout {
  amount: number;
  date: string;
  note: string;
  by: string;
}

export interface CommissionPdfCommercial {
  slp: string;
  name: string;
  rate: number;
  since: string;
  lines: CommissionPdfLine[];
  /** Modèle banque : dû cumulé recalculé, total versé, solde reporté. */
  dueCumul: number;
  paidLedger: number;
  solde: number;
  payouts: CommissionPdfPayout[];
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

const SUBTITLE =
  "margin:16px 0 4px;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:1.1px;color:#555";

/** Ligne « versement enregistré » (relevé des paiements). */
function ligneVersement(p: CommissionPdfPayout): string {
  return `
    <tr>
      <td class="jour">${dateFr(p.date)}</td>
      <td class="num total">${eur2(p.amount)}</td>
      <td class="note">${esc(p.note || "—")}</td>
      <td class="note">${esc(p.by || "")}</td>
    </tr>`;
}

/** Ligne du détail mensuel du dû (recalcul du jour, sans curseur). */
function ligneDetail(l: CommissionPdfLine): string {
  return `
    <tr>
      <td class="jour">${cap(monthLabelFr(l.month))}</td>
      <td class="num">${l.invoices}${l.avoirs > 0 ? `<span class="date"> · avoirs −${eur2(l.avoirs)}</span>` : ""}</td>
      <td class="num">${eur2(l.base)}</td>
      <td class="num total">${eur2(l.prime)}</td>
    </tr>`;
}

function pageCommercial(c: CommissionPdfCommercial, editedAt: Date): string {
  const versements = [...c.payouts]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(ligneVersement)
    .join("");
  const detail = c.lines.map(ligneDetail).join("");

  const reste = c.solde; // > 0 : reste à régler ; < 0 : trop-payé reporté
  const aJour = Math.abs(reste) < 0.01;
  const soldeLabel = aJour ? "à jour" : reste > 0 ? "solde à régler" : "trop-payé — reporté";
  const soldeTile = aJour ? "Solde" : reste > 0 ? "Solde à régler" : "Trop-payé (à déduire)";

  return `
  <section class="page">
    <header>
      <div>
        <p class="kicker">Gervifrais · Relevé de commissions</p>
        <h1>${esc(c.name)}</h1>
        <p class="sub">prime <b>${(c.rate * 100).toFixed(0)} %</b> de la base retenue ·
          depuis le ${dateFr(c.since)} · ${c.lines.length} mois commissionné(s)</p>
      </div>
      <div class="bl">
        <p class="date-big">${eur2(aJour ? 0 : reste)}</p>
        <p class="maj">${soldeLabel}</p>
      </div>
    </header>

    <div class="recap" style="grid-template-columns:repeat(3,1fr)">
      <div><p class="k">Dû cumulé</p><p class="v">${eur2(c.dueCumul)}</p></div>
      <div><p class="k">Déjà versé</p><p class="v">${eur2(c.paidLedger)}</p></div>
      <div><p class="k">${soldeTile}</p><p class="v${reste > 0.01 ? " alert" : ""}">${eur2(c.solde)}</p></div>
    </div>

    <p style="${SUBTITLE}">Versements enregistrés</p>
    <table>
      <thead>
        <tr><th>Date</th><th class="num">Montant versé</th><th>Note</th><th>Saisi par</th></tr>
      </thead>
      <tbody>
        ${versements || `<tr class="vide"><td colspan="4">Aucun versement enregistré à ce jour.</td></tr>`}
      </tbody>
    </table>

    <p style="${SUBTITLE}">Détail du dû — recalculé, mois par mois</p>
    <table>
      <thead>
        <tr>
          <th>Mois</th>
          <th class="num">Factures</th>
          <th class="num">Base retenue</th>
          <th class="num">Commission</th>
        </tr>
      </thead>
      <tbody>
        ${detail || `<tr class="vide"><td colspan="4">Aucun mois commissionné.</td></tr>`}
      </tbody>
    </table>

    <p class="legende">
      Fonctionnement <b>« banque »</b> : le <b>dû cumulé</b> est recalculé en direct depuis les
      factures SAP (base retenue = marge nette de transport, cadeaux neutralisés, plancher 0 par
      facture ; un client n'est commissionné qu'une fois son <b>seuil de poids livré</b> franchi,
      rétroactivement). On en soustrait les <b>versements</b> déjà faits : le <b>solde</b> reporte
      tout écart d'une échéance à l'autre — un trop-payé se déduit du prochain versement, un reste à
      payer s'y ajoute. Édité le ${dateFr(editedAt.toISOString())}.
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
  editedAt: Date,
): boolean {
  if (commerciaux.length === 0) return false;
  const pages = commerciaux.map((c) => pageCommercial(c, editedAt)).join("");
  const titre = commerciaux.length > 1
    ? "Commissions — équipe"
    : `Commissions — ${commerciaux[0].name}`;
  return openPrintWindow(titre, pages);
}

/* ───────────── État DÉTAILLÉ ligne à ligne (par facture/BL, par mois) ─────── */

export interface CommissionDetailLine {
  date: string;        // YYYY-MM-DD
  month: string;       // YYYY-MM
  docNum: number | null;
  cardName: string | null;
  caHt: number;
  margeNette: number;
  rule: string;
  commission: number;
}

export interface CommissionDetail {
  name: string;
  from: string;
  to: string;
  total: number;
  lines: CommissionDetailLine[];
}

/**
 * État imprimable DÉTAILLÉ : une ligne = une facture/BL avec son euro de commission,
 * regroupé par mois (sous-total par mois), sur la plage `du … au …`.
 */
function pageDetail(d: CommissionDetail): string {
  const byMonth = new Map<string, CommissionDetailLine[]>();
  for (const l of d.lines) {
    const arr = byMonth.get(l.month);
    if (arr) arr.push(l); else byMonth.set(l.month, [l]);
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const rows = months
    .map(([month, lines]) => {
      const sub = lines.reduce((s, l) => s + l.commission, 0);
      const body = lines
        .map(
          (l) => `
        <tr>
          <td class="jour">${dateFr(l.date)}</td>
          <td class="num">${l.docNum ?? "<span class=\"date\">prime fixe</span>"}</td>
          <td class="note">${esc(l.cardName ?? "")}</td>
          <td class="num">${eur2(l.caHt)}</td>
          <td class="num">${eur2(l.margeNette)}</td>
          <td class="num total">${eur2(l.commission)}</td>
        </tr>`,
        )
        .join("");
      return `
        <tr><td colspan="6" style="padding:10px 8px 3px;font-size:10.5px;text-transform:uppercase;
              letter-spacing:1.1px;font-weight:800;color:#555">${cap(monthLabelFr(month))} — ${lines.length} BL</td></tr>
        ${body}
        <tr><td colspan="5" class="num" style="font-weight:700;border-top:1px solid #ccc">Sous-total ${cap(monthLabelFr(month))}</td>
            <td class="num total" style="border-top:1px solid #ccc">${eur2(sub)}</td></tr>`;
    })
    .join("");

  const page = `
  <section class="page">
    <header>
      <div>
        <p class="kicker">Gervifrais · Commissions — détail par BL</p>
        <h1>${esc(d.name)}</h1>
        <p class="sub">du <b>${dateFr(d.from)}</b> au <b>${dateFr(d.to)}</b> · ${d.lines.length} ligne(s)</p>
      </div>
      <div class="bl">
        <p class="date-big">${eur2(d.total)}</p>
        <p class="maj">commission sur la période</p>
      </div>
    </header>

    <table>
      <thead>
        <tr>
          <th>Date</th><th class="num">BL n°</th><th>Client</th>
          <th class="num">CA HT</th><th class="num">Marge nette</th><th class="num">Commission</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr class="vide"><td colspan="6">Aucune facture sur la période.</td></tr>`}
      </tbody>
    </table>

    <p class="legende">
      Une ligne = une facture (BL). La commission de chaque BL suit la <b>règle</b> du client
      (recalcul du jour). Une « prime fixe » apparaît en une ligne par client qualifié.
    </p>
  </section>`;
  return page;
}

/** État détaillé par BL d'UN commercial (une facture = une ligne). */
export function printDetailCommissions(d: CommissionDetail): boolean {
  return openPrintWindow(`Commissions détail — ${d.name}`, pageDetail(d));
}

/** Détail par BL de PLUSIEURS commerciaux, en un seul document (une page/commercial). */
export function printDetailCommissionsMulti(details: CommissionDetail[]): boolean {
  const withLines = details.filter((d) => d.lines.length > 0);
  if (withLines.length === 0) return false;
  return openPrintWindow("Commissions — détail factures (équipe)", withLines.map(pageDetail).join(""));
}
