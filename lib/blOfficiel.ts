/**
 * ÉDITION BL — BON LIVRAISON officiel, réplique du layout SAP/coresuite
 * (Crystal) imprimé aujourd'hui depuis SAP. Reproduit « à la ligne près »
 * l'édition de référence (cf. docs : BL FANTASY n°24011987 du 10.07.2026) :
 *
 *   Pages LIGNES : en-tête (logo, référence rouge, PAGE n/m, email client,
 *   adresse de livraison, « BON LIVRAISON N° … - VEN. JJ.MM.AAAA »), tableau
 *   EAN 13 · Qté(colis) · Description (fruit, marque rouge, variété, calibre
 *   orange, pays, condt) · Lot (EM, rouge) · Qté (KG/pie) · PUHT · TVA · HT,
 *   « Livré par <transporteur> », pied de page société.
 *
 *   Page RÉCAP (dernière) : taxes parafiscales (INTERFEL, DROIT DE GARDE),
 *   escompte + mentions légales, Sous-total, Prestations, Total HT, TVA par
 *   code, Total TTC.
 *
 * Module PARTAGÉ PUR (zéro React/DOM — même règle que lib/bonTransport) :
 * renderBlOfficiel() renvoie le document HTML complet (styles inline, fenêtre
 * autonome) pour N BL — chaque BL enchaîne ses pages, l'impression sort tout
 * en UN SEUL job. Les particularités de format du Crystal d'origine sont
 * conservées volontairement (prix de ligne au point « 1 344.00 », totaux à la
 * virgule « 4 338,24 », sous-total sans séparateur de milliers).
 */

import { ean13Svg } from "./ean13";

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface BlLine {
  /** Code-barres article (EAN-13). Vide/invalide → « Code is empty ». */
  barcode: string | null;
  /** Nb de colis (1re colonne Qté, bleue). */
  colis: number;
  /** Nom de l'article (« Fraise », « Myrtille Bol »…). */
  fruit: string;
  marque: string | null;      // rouge brique
  variete: string | null;     // noir
  calibre: string | null;     // orange (« 2AE », « +30mm »)
  pays: string | null;        // « Belgique »
  condt: string | null;       // « 8x500g », « 2kg »
  lot: string | null;         // « EM23126 » (rouge)
  /** Quantité facturée (2e colonne Qté) dans l'unité de vente. */
  qty: number;
  unit: string;               // « KG » | « pie »…
  puht: number;               // prix unitaire HT
  tvaCode: string | null;     // « C1 »
  totalHt: number;            // total HT de la ligne
}

export interface BlExpense {
  name: string;               // « INTERFEL », « DROIT DE GARDE », « PAL. EUROPE », « FRAIS ADM. »
  taxCode: string | null;     // « C4 »
  amount: number;             // montant HT
  /** parafiscale → tableau de gauche (Base/Taux) ; prestation → tableau de droite. */
  kind: "parafiscale" | "prestation";
}

export interface BlVatRow {
  code: string;               // « C1 »
  ratePct: number;            // 0 → « (0,0%) »
  base: number;               // « de 4338,24 »
  amount: number;
}

export interface BlDoc {
  docNum: number;
  /** Référence rouge en haut à droite (ex. « FAN.GE.054.26-27 »). */
  ref: string | null;
  /** Date de livraison formatée « VEN. 10.07.2026 » (cf. blDateLabel). */
  dateLabel: string;
  clientEmail: string | null;
  clientName: string;
  /** Adresse de livraison, une entrée par ligne. */
  addressLines: string[];
  /** « SEA FRIGO / STM RUNGIS » — ligne « Livré par » + rappel pied de page. */
  carrierLabel: string | null;
  lines: BlLine[];
  totalColis: number;
  totalWeightKg: number;
  expenses: BlExpense[];
  /** Σ HT des lignes articles (avant frais). */
  sousTotal: number;
  /** Sous-total + frais additionnels. */
  totalHt: number;
  vatRows: BlVatRow[];
  totalTtc: number;
}

/* ── Constantes société (pied de page — mêmes mentions que le layout SAP) ── */

const SOCIETE = {
  email: "compta@gervifrais.com",
  tel: "01. 46.86.31.78",
  banque: "BQUE POP.  RUNGIS",
  adresse1: "77 Rue de Carpentras - CP 92380",
  adresse2: "94 592 RUNGIS CEDEX",
  naf: "NAF 46.31Z SIRET 399035849 CRETEIL",
  cgv: "CGV  sur   gervifrais.com",
  escompte: "Escompte pour Règlement Comptant : 0.00%",
  legal1: "Toute facture impayée après échéance sera majorée de 5 fois le taux d'interêt légal.",
  legal2: "( Art. 441-3 et Art 443-1 du code du commerce)",
  legal3: "Tribunal de commerce de Créteil (94) seul compétent.",
} as const;

/** Nb max de lignes articles par page (au-delà : page suivante, PAGE n/m). */
const LINES_PER_PAGE = 12;

/* ── Formats — quirks du Crystal d'origine conservés ───────────────────── */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Prix de LIGNE : point décimal, espace de milliers — « 1 344.00 ». */
const fmtDot = (v: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(v).replace(/,/g, " ");

/** Quantité : une décimale, point — « 192.0 », « 434.1 ». */
const fmtQty = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/** Totaux : virgule, espace de milliers — « 4 338,24 » (espace NORMALE, comme
 *  l'édition d'origine — Intl fr-FR sort une fine insécable U+202F). */
const fmtFr = (v: number) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(v).replace(/[  ]/g, " ");

/** Sous-total / base TVA : virgule SANS séparateur de milliers — « 4325,60 ». */
const fmtFrPlain = (v: number) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(v);

/** Taux TVA : une décimale forcée, virgule — « 0,0 » / « 5,5 ». */
const fmtRate1 = (v: number) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);

/** Taux parafiscal : TROIS décimales forcées — « 0,210 » / « 0,020 ». */
const fmtRate3 = (v: number) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: false }).format(v);

/** Colis : entier si rond, sinon une décimale — « 178 ». */
const fmtColis = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v);

/** Valeur BRUTE de la désignation : l'édition SAP imprime le champ tel quel
 *  (y compris les « - » saisis en base) — aucun placeholder ajouté. */
const raw = (s: string | null | undefined) => (s ?? "").trim();

/** Date « VEN. 10.07.2026 » depuis un ISO « 2026-07-10 » (fuseau-safe). */
export function blDateLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = d.toLocaleDateString("fr-FR", { weekday: "short", timeZone: "UTC" })
    .replace(".", "").toUpperCase();
  const dmy = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })
    .replace(/\//g, ".");
  return `${day}. ${dmy}`;
}

/** Pages d'un BL : lignes découpées par LINES_PER_PAGE + 1 page récap. */
export function blPageCount(nLines: number): number {
  return Math.max(1, Math.ceil(nLines / LINES_PER_PAGE)) + 1;
}

/* ── Icônes (SVG inline — équivalents sobres des cliparts du layout) ───── */

const ICON_MAIL =
  `<svg width="30" height="22" viewBox="0 0 30 22"><rect x="1" y="1" width="28" height="20" rx="2" fill="#3aaa35" stroke="#1c7a18"/><path d="M2 3l13 9L28 3" fill="none" stroke="#fff" stroke-width="2"/></svg>`;
const ICON_PHONE =
  `<svg width="16" height="24" viewBox="0 0 16 24"><rect x="1" y="1" width="14" height="22" rx="2.5" fill="#3aaa35" stroke="#1c7a18"/><rect x="3" y="4" width="10" height="12" fill="#eaf7e8"/><circle cx="8" cy="19.5" r="1.6" fill="#eaf7e8"/></svg>`;
const ICON_GLOBE =
  `<svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="11" fill="#eaf7e8" stroke="#3aaa35" stroke-width="1.5"/><ellipse cx="13" cy="13" rx="5" ry="11" fill="none" stroke="#3aaa35"/><path d="M2 13h22M4 7h18M4 19h18" stroke="#3aaa35" fill="none"/></svg>`;

/* ── Rendu ─────────────────────────────────────────────────────────────── */

/** En-tête commun à TOUTES les pages d'un BL (logo, réf, pagination, client). */
function renderHeader(doc: BlDoc, page: number, pages: number, logoUrl: string): string {
  return `
  <div class="head">
    <div class="head-top">
      <div class="brandcol">
        <img class="logo" src="${esc(logoUrl)}" alt="Gervifrais" />
        <p class="wordmark">gerv<span class="wm-i">i</span>frais</p>
      </div>
      <div class="head-globe">${ICON_GLOBE}</div>
      <div class="head-ref">
        <div class="rule"></div>
        ${doc.ref ? `<p class="ref">${esc(doc.ref)}</p>` : ""}
        <p class="pageno">PAGE ${page} / ${pages}</p>
      </div>
    </div>
    <div class="head-mid">
      <p class="mail">${doc.clientEmail ? `Email : ${esc(doc.clientEmail)}` : ""}</p>
      <div class="dest">
        <p class="name">${esc(doc.clientName)}</p>
        ${doc.addressLines.map((l) => `<p>${esc(l)}</p>`).join("")}
      </div>
    </div>
    <div class="doctitle">
      <h1>BON LIVRAISON</h1>
      <h1>N° ${doc.docNum} - ${esc(doc.dateLabel)}</h1>
    </div>
  </div>`;
}

/** Pied de page société — identique sur toutes les pages. */
function renderFooter(doc: BlDoc, logoUrl: string): string {
  return `
  <div class="foot">
    <div class="foot-cols">
      <div class="f-left">
        ${ICON_MAIL}
        <p class="f-mail">${esc(SOCIETE.email)}</p>
        <p class="f-colis"><b class="n">${fmtColis(doc.totalColis)}</b> <b>Colis pour&nbsp;&nbsp;&nbsp;${fmtQty(doc.totalWeightKg)} KG</b></p>
        ${doc.carrierLabel ? `<p class="f-carrier">${esc(doc.carrierLabel)}</p>` : ""}
      </div>
      <div class="f-mid">
        ${ICON_PHONE}
        <p class="f-tel">${esc(SOCIETE.tel)}</p>
        <p class="f-bank">${esc(SOCIETE.banque)}</p>
      </div>
      <div class="f-right">
        <p class="f-brand"><img class="logo-sm" src="${esc(logoUrl)}" alt="" /><span class="f-word">gerv<span class="wm-i">i</span>frais</span></p>
        <p>${esc(SOCIETE.adresse1)}</p>
        <p>${esc(SOCIETE.adresse2)}</p>
        <p class="f-naf">${esc(SOCIETE.naf)}</p>
      </div>
    </div>
  </div>`;
}

/** Une ligne article du tableau. */
function renderLine(l: BlLine): string {
  const bc = ean13Svg(l.barcode, { height: 24 });
  return `
  <tr>
    <td class="ean">${bc ?? `<span class="noean">Code is empty</span>`}</td>
    <td class="colis">${fmtColis(l.colis)}</td>
    <td class="fruit">${esc(l.fruit)}</td>
    <td class="marque">${esc(raw(l.marque))}</td>
    <td class="variete">${esc(raw(l.variete))}${raw(l.calibre) ? ` <span class="calibre">${esc(raw(l.calibre))}</span>` : ""}</td>
    <td class="pays">${esc(raw(l.pays))}</td>
    <td class="condt">${esc(raw(l.condt))}</td>
    <td class="lot">${esc(raw(l.lot))}</td>
    <td class="qty">${fmtQty(l.qty)} <span class="unit">${esc(l.unit)}</span></td>
    <td class="puht">${fmtDot(l.puht)} €</td>
    <td class="tva">${esc((l.tvaCode ?? "").trim())}</td>
    <td class="ht">${fmtDot(l.totalHt)} €</td>
  </tr>`;
}

/** Page de LIGNES (tableau articles + « Livré par »). */
function renderLinesPage(doc: BlDoc, pageLines: BlLine[], page: number, pages: number, isLastLinesPage: boolean, logoUrl: string): string {
  return `
  <section class="page">
    ${renderHeader(doc, page, pages, logoUrl)}
    <table class="lines">
      <thead>
        <tr>
          <th class="ean">EAN 13</th>
          <th class="colis">Qté</th>
          <th class="desc" colspan="4">Description</th>
          <th class="condt">Condt</th>
          <th class="lot">Lot</th>
          <th class="qty">Qté</th>
          <th class="puht">PUHT</th>
          <th class="tva">TVA</th>
          <th class="ht">HT</th>
        </tr>
      </thead>
      <tbody>${pageLines.map(renderLine).join("")}</tbody>
    </table>
    ${isLastLinesPage && doc.carrierLabel ? `<p class="livrepar">Livré par ${esc(doc.carrierLabel)}</p>` : ""}
    ${renderFooter(doc, logoUrl)}
  </section>`;
}

/** Dernière page : taxes parafiscales, mentions, totaux. */
function renderTotalsPage(doc: BlDoc, page: number, pages: number, logoUrl: string): string {
  const parafiscales = doc.expenses.filter((e) => e.kind === "parafiscale");
  const prestations = doc.expenses.filter((e) => e.kind === "prestation");

  // Base/Taux du tableau parafiscal, reconstitués comme sur l'édition SAP :
  // INTERFEL = % du sous-total marchandises ; DROIT DE GARDE = € par colis.
  const paraRow = (e: BlExpense) => {
    const isDdg = /GARDE/i.test(e.name);
    const base = isDdg ? `${fmtColis(doc.totalColis)} Colis` : fmtFr(doc.sousTotal);
    const rate = isDdg
      ? (doc.totalColis > 0 ? `${fmtRate3(e.amount / doc.totalColis)}€` : "")
      : (doc.sousTotal > 0 ? `${fmtRate3((e.amount / doc.sousTotal) * 100)}%` : "");
    return `
    <tr>
      <td class="pn">${esc(e.name)}</td>
      <td class="pc"><b>${esc(e.taxCode ?? "")}</b></td>
      <td class="pb">${base}</td>
      <td class="pt">${rate}</td>
      <td class="pm"><b>${fmtFr(e.amount)} €</b></td>
    </tr>`;
  };

  return `
  <section class="page">
    ${renderHeader(doc, page, pages, logoUrl)}
    <div class="totals-zone">
      <div class="t-left">
        <p class="cgv">${esc(SOCIETE.cgv)}</p>
        <table class="para">
          <thead>
            <tr><th class="pn">Taxes parafiscales</th><th class="pc">Code TVA</th><th class="pb">Base</th><th class="pt">Taux</th><th class="pm">Montant</th></tr>
          </thead>
          <tbody>${parafiscales.map(paraRow).join("")}</tbody>
        </table>
        <p class="escompte">${esc(SOCIETE.escompte)}</p>
        <p class="legal">${esc(SOCIETE.legal1)}</p>
        <p class="legal">${esc(SOCIETE.legal2)}</p>
        <p class="legal">${esc(SOCIETE.legal3)}</p>
      </div>
      <div class="t-right">
        <div class="soustotal"><span>Sous-total</span><b>${fmtFrPlain(doc.sousTotal)} €</b></div>
        <table class="presta">
          <thead><tr><th class="pn">Prestations</th><th class="pc">Code TVA</th><th class="pm">Montant</th></tr></thead>
          <tbody>
            ${prestations.map((e) => `<tr><td class="pn">${esc(e.name)}</td><td class="pc"><b>${esc(e.taxCode ?? "")}</b></td><td class="pm"><b>${fmtFr(e.amount)} €</b></td></tr>`).join("")}
          </tbody>
        </table>
        <div class="totalht"><span>Total HT</span><b>${fmtFr(doc.totalHt)} €</b></div>
        ${doc.vatRows.map((v) => `<div class="tvarow"><span>TVA ${esc(v.code)} (${fmtRate1(v.ratePct)}%) de ${fmtFrPlain(v.base)}</span><span class="amt">${fmtFr(v.amount)} €</span></div>`).join("")}
        <div class="totalttc"><span>Total TTC</span><b>${fmtFr(doc.totalTtc)} €</b></div>
      </div>
    </div>
    ${renderFooter(doc, logoUrl)}
  </section>`;
}

/** Pages d'UN BL (n pages de lignes + 1 page récap). */
function renderDoc(doc: BlDoc, logoUrl: string): string {
  const pages = blPageCount(doc.lines.length);
  const chunks: BlLine[][] = [];
  for (let i = 0; i < doc.lines.length; i += LINES_PER_PAGE) chunks.push(doc.lines.slice(i, i + LINES_PER_PAGE));
  if (chunks.length === 0) chunks.push([]);
  const linesPages = chunks
    .map((chunk, i) => renderLinesPage(doc, chunk, i + 1, pages, i === chunks.length - 1, logoUrl))
    .join("");
  return linesPages + renderTotalsPage(doc, pages, pages, logoUrl);
}

/**
 * Document HTML COMPLET (fenêtre autonome, impression auto) pour N BL.
 * `logoUrl` : URL absolue du logo (ex. `${window.location.origin}/LogoSansFond.png`).
 */
export function renderBlOfficiel(docs: BlDoc[], opts: { logoUrl: string; title?: string; autoPrint?: boolean }): string {
  const title = opts.title ?? (docs.length === 1 ? `BL n°${docs[0].docNum}` : `Édition BL — ${docs.length} bons`);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 10mm 12mm; }
  body { font: 13px/1.35 Arial, Helvetica, sans-serif; color: #111; background: #fff; }
  @media print { .noprint { display: none !important; } }
  @media screen { body { background: #777; padding: 16px; }
    .page { background: #fff; margin: 0 auto 16px; box-shadow: 0 2px 10px rgba(0,0,0,.35); padding: 10mm 12mm; } }

  .page { position: relative; width: 186mm; height: 277mm; overflow: hidden; page-break-after: always; }
  .page:last-child { page-break-after: auto; }

  /* ── En-tête ── */
  .head-top { display: flex; align-items: flex-start; justify-content: space-between; }
  .brandcol { width: 34mm; }
  .logo { width: 26mm; height: 26mm; object-fit: contain; display: block; margin: 0 auto; }
  .wordmark { text-align: center; font-size: 24px; font-weight: 700; letter-spacing: -0.8px;
              color: #3d3d4a; line-height: 1.1; }
  .wm-i { color: #e6007e; }
  .head-globe { align-self: flex-end; margin: 0 auto; padding-left: 34mm; }
  .head-ref { width: 62mm; text-align: right; padding-top: 9mm; }
  .head-ref .rule { border-top: 1px solid #111; margin-bottom: 2.5mm; }
  .head-ref .ref { color: #e01000; font-weight: bold; font-size: 14px; }
  .head-ref .pageno { color: #e01000; font-weight: bold; font-size: 13px; }
  .head-mid { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 4mm; }
  .head-mid .mail { font-size: 13px; padding-top: 1mm; }
  .head-mid .dest { width: 78mm; font-size: 13px; line-height: 1.45; }
  .head-mid .dest .name { font-weight: bold; }
  .doctitle { margin-top: 5mm; }
  .doctitle h1 { font-size: 21px; letter-spacing: 0.2px; }

  /* ── Tableau des lignes ── */
  table.lines { width: 100%; border-collapse: collapse; margin-top: 3mm; }
  table.lines thead th { color: #2020c0; font-weight: normal; font-size: 11.5px; text-align: left;
    border-top: 1px solid #444; border-bottom: 1px solid #444; padding: 1px 3px; }
  table.lines thead th.condt, table.lines thead th.lot, table.lines thead th.qty,
  table.lines thead th.puht { border-left: 1px solid #99b; }
  table.lines thead th.colis, table.lines thead th.qty, table.lines thead th.puht,
  table.lines thead th.tva, table.lines thead th.ht { text-align: right; }
  table.lines thead th.tva, table.lines thead th.ht { text-align: right; }
  /* Une ligne article = UNE ligne imprimée (aucun retour), comme l'original. */
  table.lines td { padding: 5px 2px 3px; vertical-align: middle; font-size: 12px; white-space: nowrap; }
  td.ean { width: 25mm; }
  td.ean .noean { font-size: 8px; color: #777; }
  td.colis { text-align: right; color: #2020c0; font-weight: bold; font-size: 13.5px; }
  td.fruit { padding-left: 5px; font-size: 12.5px; }
  td.marque { color: #c0504d; }
  td.variete .calibre { color: #e36c0a; }
  td.condt { text-align: right; }
  td.lot { color: #e01000; padding-left: 5px; }
  td.qty { text-align: right; }
  td.qty .unit { font-size: 10px; }
  td.puht { text-align: right; color: #2020c0; }
  td.tva { text-align: right; color: #2020c0; font-size: 11px; }
  td.ht { text-align: right; color: #2020c0; }

  .livrepar { margin-top: 2mm; color: #2020c0; font-weight: bold; text-decoration: underline; font-size: 13.5px; }

  /* ── Page récap ── */
  .totals-zone { position: absolute; left: 0; right: 0; bottom: 52mm; display: flex;
    justify-content: space-between; align-items: flex-end; gap: 8mm; }
  .t-left { width: 96mm; }
  .cgv { font-size: 11.5px; margin-bottom: 6mm; }
  table.para { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
  table.para th { font-size: 11.5px; text-align: left; border-top: 1px solid #444;
    border-bottom: 1px solid #444; padding: 2px 3px; }
  table.para td { font-size: 12px; padding: 2px 3px; }
  table.para .pb, table.para .pt, table.para .pm { text-align: right; }
  table.para td.pb, table.para td.pt { border-left: 1px solid #99b; }
  .escompte { font-weight: bold; font-size: 12px; margin-bottom: 1mm; }
  .legal { font-size: 10.5px; }
  .t-right { width: 74mm; font-size: 13px; }
  .soustotal { display: flex; justify-content: space-between; align-items: baseline;
    border-bottom: 2px solid #999; padding-bottom: 1mm; margin-bottom: 2mm; }
  .soustotal span { color: #666; font-weight: bold; font-size: 14px; }
  .soustotal b { font-size: 14px; }
  table.presta { width: 100%; border-collapse: collapse; margin-bottom: 2mm; }
  table.presta th { font-size: 11.5px; text-align: left; border-bottom: 1px solid #444; padding: 2px 3px; }
  table.presta th.pm, table.presta td.pm { text-align: right; }
  table.presta td { font-size: 12px; padding: 2px 3px; }
  table.presta td.pc { text-align: center; }
  .totalht { display: flex; justify-content: space-between; border-top: 1px solid #444;
    padding-top: 1mm; font-size: 14px; }
  .totalht span { color: #666; font-weight: bold; }
  .tvarow { display: flex; justify-content: space-between; font-size: 12px;
    border-bottom: 1px solid #999; padding: 0.5mm 0 1mm; }
  .totalttc { display: flex; justify-content: space-between; font-size: 14.5px; padding-top: 1.5mm; }
  .totalttc span { color: #666; font-weight: bold; }

  /* ── Pied de page ── */
  .foot { position: absolute; left: 0; right: 0; bottom: 0; }
  .foot-cols { display: flex; justify-content: space-between; align-items: flex-start; }
  .f-left { width: 62mm; text-align: center; }
  .f-left .f-mail { color: #2020c0; font-weight: bold; text-decoration: underline; font-size: 13px; margin-top: 1mm; }
  .f-left .f-colis { text-align: left; font-size: 12px; margin-top: 3mm; }
  .f-left .f-colis .n { font-size: 12px; }
  .f-left .f-carrier { text-align: left; font-weight: bold; font-size: 12px; padding-left: 7mm; }
  .f-mid { width: 40mm; text-align: center; }
  .f-mid .f-tel { color: #2020c0; font-weight: bold; font-size: 14px; margin-top: 1mm; }
  .f-mid .f-bank { color: #1a1a6e; font-weight: bold; font-size: 10.5px; margin-top: 2mm; }
  .f-right { width: 60mm; font-size: 11px; color: #7a2020; line-height: 1.5; }
  .f-right .f-brand { display: flex; align-items: center; gap: 1.5mm; margin-bottom: 1mm; }
  .f-right .logo-sm { width: 9mm; height: 9mm; object-fit: contain; }
  .f-right .f-word { font-size: 17px; font-weight: 700; letter-spacing: -0.5px; color: #3d3d4a; }
  .f-right .f-naf { color: #111; margin-top: 4mm; }

  .noprint { max-width: 186mm; margin: 0 auto 14px; }
  .noprint button { font: 600 13px Arial, sans-serif; padding: 8px 18px; border: 1.5px solid #111;
    border-radius: 6px; background: #111; color: #fff; cursor: pointer; }
</style>
</head>
<body>
  <div class="noprint"><button onclick="window.print()">🖨 Imprimer ${docs.length > 1 ? `les ${docs.length} BL` : "le BL"}</button></div>
  ${docs.map((d) => renderDoc(d, opts.logoUrl)).join("")}
  ${opts.autoPrint === false ? "" : `<script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 250); });</script>`}
</body>
</html>`;
}
