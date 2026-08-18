/**
 * Récap imprimable d'une commande (bon de préparation) — « Détail livraison ».
 *
 * Ouvre une fenêtre dédiée avec un document A4 sobre (noir & blanc, gros
 * colisage) puis lance l'impression. Tout est inline (styles compris) : la
 * fenêtre est autonome, aucune dépendance au CSS de l'app. Les articles
 * signalés MANQUANTS sont barrés et rappelés dans un encart dédié.
 */

// Import RELATIF (et non alias @/) : ce module est couvert par vitest, dont la
// résolution ne connaît pas les alias TS — cf. les autres modules purs testés.
import { PALETTE_TYPES, type PaletteCounts } from "../../lib/palettes";

export interface PrintLine {
  itemCode: string;
  itemName: string;
  quantity: number;
  unit?: string | null;   // unité de vente (PIE, KG, COLIS…) affichée après la quantité
  colis: number;
  weightKg: number;
  marque?: string | null;
  condt?: string | null;
  pays?: string | null;
  /** Lot à préparer (bon de commande) — « EM<n> » affiché, sinon « lot à affecter ». */
  lot?: string | null;
  /** Codes article fusionnés dans cette ligne d'affichage (racheté après manquant).
   *  Défaut : [itemCode]. Sert à retrouver le statut « manquant » après fusion. */
  mergedCodes?: string[];
}

export interface PrintDoc {
  /** Palettes comptées à la préparation (cf. lib/palettes.ts). Absent = pas
   *  encore compté : le bloc s'imprime alors VIDE, à remplir à la main. */
  palettes?: PaletteCounts | null;
  docNum: number;
  cardCode: string;
  cardName: string;
  clientType?: string | null;
  colis: number;
  weightKg: number;
  lines: PrintLine[];
}

export interface PrintContext {
  /** Date de livraison déjà formatée (ex. « jeudi 2 juillet 2026 »). */
  dateLabel: string;
  carrierName?: string | null;
  tourneeLabel?: string | null;
  /** Heure d'enlèvement / de départ (« HH:MM » ou déjà formatée) — colonne dédiée. */
  pickupTime?: string | null;
  /** Préparateur (déjà formaté pour l'affichage). */
  preparedBy?: string | null;
  /** Codes articles manquants (stock SAP négatif) sur ce BL. */
  missingCodes?: Set<string>;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (v: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v);
/** « 08:00 » → « 8H00 » (heure d'enlèvement). Laisse la valeur telle quelle si
 *  elle n'est pas au format HH:MM. */
const fmtHeure = (h?: string | null): string | null => {
  const s = (h ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m ? `${Number(m[1])}H${m[2]}` : (s || null);
};

/**
 * Construit le document HTML du bon de préparation (PUR — testable, sans DOM).
 * `origin` = base d'URL pour le logo (window.location.origin à l'impression).
 */
export function renderOrderRecapHtml(doc: PrintDoc, ctx: PrintContext, origin = ""): string {
  const missing = ctx.missingCodes ?? new Set<string>();
  const isMissingLine = (l: PrintLine) => (l.mergedCodes ?? [l.itemCode]).some((c) => missing.has(c));
  const missingLines = doc.lines.filter(isMissingLine);

  // Détails de désignation en TEXTE BRUT (marque · conditionnement · origine) —
  // plus lisible à l'impression que les tags encadrés de l'app.
  const details = (l: PrintLine) =>
    [l.marque, l.condt, l.pays].map((t) => (t ?? "").trim()).filter((t) => t && t !== "—" && t !== "-");

  // Case « Fait » à GAUCHE (première colonne cochée par le préparateur). L'icône
  // MANQUANT (⚠) est dans une COLONNE dédiée à position FIXE (avant le poids), et
  // la ligne manquante est ENCADRÉE légèrement (classe .missing) — pas barrée.
  // Le nombre de PIÈCES (Qté) n'est plus affiché : colis + poids suffisent.
  const rows = doc.lines
    .map((l) => {
      const isMissing = isMissingLine(l);
      return `
      <tr class="${isMissing ? "missing" : ""}">
        <td class="check"></td>
        <td class="colis">${num(l.colis)}</td>
        <td class="art">
          <span class="name">${esc(l.itemName)}</span>
          ${details(l).length ? `<span class="det">— ${details(l).map(esc).join(" · ")}</span>` : ""}
        </td>
        <td class="lotcell">${l.lot != null ? (/^EM\d+$/.test(l.lot) ? `<span class="lot">${esc(l.lot)}</span>` : `<span class="lot pending">lot à affecter</span>`) : ""}</td>
        <td class="warn">${isMissing ? "⚠" : ""}</td>
        <td class="num">${num(l.weightKg)} <span class="unit">kg</span></td>
      </tr>`;
    })
    .join("");

  // En-tête d'infos : CLIENT (avec le n° de BL SOUS le nom), TYPE, TRANSPORTEUR,
  // TOURNÉE, HEURE D'ENLÈVEMENT, PRÉPARÉE PAR. Chaque case peut porter une
  // sous-ligne (`sub`) — le BL sous le client, la case SMS sous l'heure.
  const heure = fmtHeure(ctx.pickupTime);
  const infos: { k: string; v: string; sub?: string; smsBox?: boolean }[] = [
    { k: "Client", v: doc.cardName, sub: `BL n°${doc.docNum}` },
    { k: "Type", v: (doc.clientType ?? "").trim() || "—" },
    { k: "Transporteur", v: ctx.carrierName?.trim() || "Non affecté" },
    { k: "Tournée", v: ctx.tourneeLabel?.trim() || "—" },
    { k: "Heure enlèvt", v: heure ?? "—", smsBox: !!heure },
    { k: "Préparée par", v: ctx.preparedBy?.trim() || "—" },
  ];

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Bon de préparation</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 12mm; }
  /* Police CONVENTIONNELLE (serif Times New Roman) — document formel. */
  body { font: 14px/1.5 "Times New Roman", Times, Georgia, serif; color: #111; padding: 16px; }
  @media print { body { padding: 0; } .noprint { display: none !important; } }

  header { display: flex; justify-content: space-between; align-items: center; gap: 12px;
           border-bottom: 2.5px solid #111; padding-bottom: 10px; margin-bottom: 12px; }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .brand img.logo { height: 52px; width: auto; object-fit: contain; }
  header .title p { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #555; }
  header .title h1 { font-size: 22px; letter-spacing: -0.3px; }
  /* Plus de BL au-dessus de la date (dupliqué dans la case Client) : date seule. */
  header .bl { text-align: right; }
  header .bl .date { font-size: 19px; }
  header .bl .date b { font-weight: 900; }

  /* Géométrie PARTAGÉE avec le tableau : la case « Transporteur » commence à
     30% + 18% = 48%, exactement où démarre la colonne « Lot (EM) » ci-dessous.
     Les EM se lisent ainsi dans l'axe du transporteur, en une colonne franche
     au lieu de flotter après des désignations de longueur variable. */
  .infos { display: grid; grid-template-columns: 30% 18% 16% 12% 14% 10%; gap: 0;
           border: 1.5px solid #111; border-radius: 6px; overflow: hidden; margin-bottom: 14px; }
  .infos > div { padding: 7px 10px; border-left: 1px solid #bbb; }
  .infos > div:first-child { border-left: none; }
  .infos p.k { font-size: 9.5px; text-transform: uppercase; letter-spacing: 1px; color: #555; }
  .infos p.v { font-size: 14px; font-weight: 700; margin-top: 1px; }
  .infos p.sub { font-size: 11.5px; font-weight: 700; color: #333; margin-top: 2px;
                 font-variant-numeric: tabular-nums; }
  .infos p.sms { font-size: 10px; color: #444; margin-top: 3px; }
  .infos p.sms .box { display: inline-block; width: 10px; height: 10px; border: 1.2px solid #111;
                      border-radius: 2px; vertical-align: -1px; margin-right: 3px; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #333;
             border-bottom: 2px solid #111; padding: 6px 8px; text-align: left; }
  thead th.num, td.num { text-align: right; white-space: nowrap; }
  thead th.warn, td.warn { text-align: center; width: 40px; }
  /* Largeurs FIXES, posées APRÈS les règles ci-dessus pour l'emporter sur la
     largeur fixe de td.warn (même spécificité → la dernière déclarée gagne).
     Pas d'accent grave dans ce commentaire : tout ce bloc vit DANS un littéral
     gabarit, un backtick y fermerait la chaîne.
     table-layout: fixed rend les pourcentages effectifs : sans lui le
     navigateur redistribue selon le contenu et l'alignement saute.
     6 + 8 + 34 = 48 → la colonne « Lot (EM) » démarre exactement sous la case
     « Transporteur » de la grille d'infos (30% + 18% = 48%). */
  table { table-layout: fixed; }
  thead th:nth-child(1), tbody td:nth-child(1), tfoot td:nth-child(1) { width: 6%; }
  thead th:nth-child(2), tbody td:nth-child(2), tfoot td:nth-child(2) { width: 8%; }
  thead th:nth-child(3), tbody td:nth-child(3), tfoot td:nth-child(3) { width: 34%; }
  thead th:nth-child(4), tbody td:nth-child(4), tfoot td:nth-child(4) { width: 16%; }
  thead th:nth-child(5), tbody td:nth-child(5), tfoot td:nth-child(5) { width: 4%; }
  thead th:nth-child(6), tbody td:nth-child(6), tfoot td:nth-child(6) { width: 32%; }
  td.lotcell { vertical-align: top; padding-top: 7px; }
  tbody td { border-bottom: 1px solid #ccc; padding: 7px 8px; vertical-align: middle; }
  td.colis { font-size: 19px; font-weight: 800; text-align: center; width: 62px;
             font-variant-numeric: tabular-nums; }
  td.art .name { font-weight: 800; font-size: 15px; }
  td.art .det { font-size: 13px; color: #333; margin-left: 6px; }
  td.check { width: 46px; }
  td.check::after { content: ""; display: block; width: 17px; height: 17px;
                    border: 1.5px solid #111; border-radius: 3px; margin: 0 auto; }
  /* Icône MANQUANT à position fixe (colonne dédiée). */
  td.warn { font-size: 17px; line-height: 1; }
  /* Ligne d'article MANQUANT : encadrée légèrement (pas barrée, texte lisible). */
  tr.missing td { border-top: 1.3px solid #111; border-bottom: 1.3px solid #111; background: #f6f6f6; }
  tr.missing td:first-child { border-left: 1.3px solid #111; }
  tr.missing td:last-child { border-right: 1.3px solid #111; }
  td.lotcell .lot { display: inline-block; border: 1.5px solid #111;
                border-radius: 3px; padding: 0 5px; font-size: 12px; font-weight: 800;
                font-variant-numeric: tabular-nums; color: #111; }
  td.lotcell .lot.pending { border-style: dashed; font-weight: 700; color: #555; }
  .unit { font-size: 11px; font-weight: 600; color: #555; }
  tfoot td { border-top: 2px solid #111; padding: 8px; font-weight: 700; font-size: 14px; }
  tfoot .label { text-transform: uppercase; font-size: 11px; letter-spacing: 1px; }

  .manquants { border: 2px solid #111; border-radius: 6px; padding: 9px 12px; margin-bottom: 12px; }
  .manquants h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 4px; }
  .manquants li { margin-left: 16px; font-size: 14px; }

  /* Cartouche d'impression aligné à DROITE : il ne masque plus le début du
     document et tombe sous la main, du côté des actions. */
  /* Palettes — tuiles nombre / format / type. Les cases restent VIDES quand
     rien n'a été compté : on écrit alors le chiffre à la main au chargement. */
  .pal-recap { width: auto; margin: 12px 0 4px; border: 1.5px solid #111;
               border-radius: 6px; border-collapse: collapse; }
  .pal-recap th { font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px;
                  color: #555; font-weight: 700; text-align: center; padding: 5px 10px;
                  border-bottom: 1px solid #bbb; }
  .pal-recap td { text-align: center; padding: 2px 18px; border-left: 1px solid #ddd; }
  .pal-recap td:first-child { border-left: none; }
  .pal-recap td.pal-n { font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums;
                        padding-top: 6px; min-width: 34px; }
  .pal-recap td.pal-s { font-size: 10px; color: #555; }
  .pal-recap td.pal-l { font-size: 11.5px; font-weight: 700; padding-bottom: 6px; }

  .noprint { margin-bottom: 14px; display: flex; justify-content: flex-end; }
  .noprint button { font: 600 13px "Times New Roman", Times, serif; padding: 8px 18px;
                    border: 1.5px solid #111; border-radius: 6px; background: #111;
                    color: #fff; cursor: pointer; }
</style>
</head>
<body>
  <div class="noprint"><button onclick="window.print()">🖨 Imprimer</button></div>

  <header>
    <div class="brand">
      <img class="logo" src="${esc(`${origin}/logo-mark.png`)}" alt="Gervifrais" />
      <div class="title">
        <p>Gervifrais · Détail livraison</p>
        <h1>Bon de préparation</h1>
      </div>
    </div>
    <div class="bl">
      <p class="date">Livraison du <b>${esc(ctx.dateLabel)}</b></p>
    </div>
  </header>

  <div class="infos">
    ${infos.map((i) => `<div>
      <p class="k">${esc(i.k)}</p>
      <p class="v">${esc(i.v)}</p>
      ${i.sub ? `<p class="sub">${esc(i.sub)}</p>` : ""}
      ${i.smsBox ? `<p class="sms"><span class="box"></span>SMS transporteur</p>` : ""}
    </div>`).join("")}
  </div>

  <table>
    <thead>
      <tr>
        <th style="text-align:center">Fait</th>
        <th style="text-align:center">Colis</th>
        <th>Article</th>
        <th>Lot (EM)</th>
        <th class="warn"></th>
        <th class="num">Poids (kg)</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td></td>
        <td style="text-align:center">${num(doc.colis)} <span class="unit">colis</span></td>
        <td class="label">Total — ${doc.lines.length} article${doc.lines.length > 1 ? "s" : ""}</td>
        <td></td>
        <td class="warn"></td>
        <td class="num">${num(doc.weightKg)} <span class="unit">kg</span></td>
      </tr>
    </tfoot>
  </table>

  <!-- Palettes : rempli si le comptage a été saisi au passage en « fait »,
       sinon cases VIDES à remplir à la main au chargement. -->
  <table class="pal-recap">
    <thead>
      <tr><th colspan="${PALETTE_TYPES.length}">Nombre de palette(s)</th></tr>
    </thead>
    <tbody>
      <tr>${PALETTE_TYPES.map((t) => `<td class="pal-n">${doc.palettes ? (doc.palettes[t.key] || 0) : "&nbsp;"}</td>`).join("")}</tr>
      <tr>${PALETTE_TYPES.map((t) => `<td class="pal-s">${esc(t.size)}</td>`).join("")}</tr>
      <tr>${PALETTE_TYPES.map((t) => `<td class="pal-l">${esc(t.label)}</td>`).join("")}</tr>
    </tbody>
  </table>

  ${missingLines.length ? `
  <div class="manquants">
    <h2>⚠ Articles manquants (${missingLines.length})</h2>
    <ul>
      ${missingLines.map((l) => `<li><b>${esc(l.itemName)}</b> — ${num(l.colis)} colis</li>`).join("")}
    </ul>
  </div>` : ""}

  <script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 150); });</script>
</body>
</html>`;

  return html;
}

/** Ouvre la fenêtre d'impression du bon de préparation d'UN BL. */
export function printOrderRecap(doc: PrintDoc, ctx: PrintContext): boolean {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const html = renderOrderRecapHtml(doc, ctx, origin);
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Récap PAR ARTICLE imprimable (« Détails livraison ») — tout ce qui part le
   jour J, ventilé GMS / CHR / Export, dans l'unité choisie (colis ou kg).
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PrintArticleRow {
  itemName: string;
  tags: string[];
  gms: number;
  chr: number;
  exp: number;
  total: number;
}

/** Ouvre la fenêtre d'impression du récap articles (Détails livraison). */
export function printArticlesRecap(opts: {
  dateLabel: string;
  unit: "colis" | "kg";
  rows: PrintArticleRow[];
  totals: { gms: number; chr: number; exp: number; all: number };
}): boolean {
  const fmt = (v: number) =>
    v <= 0 ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: opts.unit === "kg" ? 0 : 1 }).format(v);
  const detailsOf = (tags: string[]) => tags.map((t) => (t ?? "").trim()).filter(Boolean);

  const rows = opts.rows
    .map((r) => `
      <tr>
        <td class="art">
          <span class="name">${esc(r.itemName)}</span>
          ${detailsOf(r.tags).length ? `<span class="det">— ${detailsOf(r.tags).map(esc).join(" · ")}</span>` : ""}
        </td>
        <td class="num">${fmt(r.gms)}</td>
        <td class="num">${fmt(r.chr)}</td>
        <td class="num">${fmt(r.exp)}</td>
        <td class="num tot">${fmt(r.total)}</td>
      </tr>`)
    .join("");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Détails livraison — ${esc(opts.dateLabel)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 12mm; }
  body { font: 13px/1.45 "Segoe UI", Arial, sans-serif; color: #111; padding: 16px; }
  @media print { body { padding: 0; } .noprint { display: none !important; } }
  header { display: flex; justify-content: space-between; align-items: center; gap: 12px;
           border-bottom: 2.5px solid #111; padding-bottom: 10px; margin-bottom: 12px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand img.logo { height: 46px; width: auto; object-fit: contain; }
  header .title p { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #555; }
  header .title h1 { font-size: 21px; letter-spacing: -0.3px; }
  header .date { text-align: right; font-size: 18px; }
  header .date b { font-weight: 900; }
  header .date .unit { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #555; }
  table { width: 100%; border-collapse: collapse; }
  thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #333;
             border-bottom: 2px solid #111; padding: 6px 8px; text-align: right; }
  thead th.art { text-align: left; }
  tbody td { border-bottom: 1px solid #ccc; padding: 6px 8px; vertical-align: baseline; }
  td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.art .name { font-weight: 800; font-size: 14px; }
  td.art .det { font-size: 12px; color: #333; margin-left: 6px; }
  td.tot { font-weight: 800; }
  tfoot td { border-top: 2px solid #111; padding: 8px; font-weight: 800; font-size: 14px;
             text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td.label { text-align: left; text-transform: uppercase; font-size: 11px; letter-spacing: 1px; }
  .noprint { margin-bottom: 14px; }
  .noprint button { font: 600 13px "Segoe UI", Arial, sans-serif; padding: 8px 18px;
                    border: 1.5px solid #111; border-radius: 6px; background: #111; color: #fff; cursor: pointer; }
</style>
</head>
<body>
  <div class="noprint"><button onclick="window.print()">🖨 Imprimer</button></div>
  <header>
    <div class="brand">
      <img class="logo" src="${esc(`${window.location.origin}/logo-mark.png`)}" alt="Gervifrais" />
      <div class="title">
        <p>Gervifrais · Détails livraison</p>
        <h1>Livraison par article</h1>
      </div>
    </div>
    <div class="date">
      Livraison du <b>${esc(opts.dateLabel)}</b>
      <span class="unit">Quantités en ${esc(opts.unit)} · ${opts.rows.length} article${opts.rows.length > 1 ? "s" : ""}</span>
    </div>
  </header>
  <table>
    <thead>
      <tr>
        <th class="art">Article</th>
        <th>GMS</th>
        <th>CHR</th>
        <th>Export</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td class="label">Total (${esc(opts.unit)})</td>
        <td>${fmt(opts.totals.gms)}</td>
        <td>${fmt(opts.totals.chr)}</td>
        <td>${fmt(opts.totals.exp)}</td>
        <td>${fmt(opts.totals.all)}</td>
      </tr>
    </tfoot>
  </table>
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
