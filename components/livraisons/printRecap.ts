/**
 * Récap imprimable d'une commande (bon de préparation) — « Détail livraison ».
 *
 * Ouvre une fenêtre dédiée avec un document A4 sobre (noir & blanc, gros
 * colisage) puis lance l'impression. Tout est inline (styles compris) : la
 * fenêtre est autonome, aucune dépendance au CSS de l'app. Les articles
 * signalés MANQUANTS sont barrés et rappelés dans un encart dédié.
 */

export interface PrintLine {
  itemCode: string;
  itemName: string;
  quantity: number;
  colis: number;
  weightKg: number;
  marque?: string | null;
  condt?: string | null;
  pays?: string | null;
}

export interface PrintDoc {
  docNum: number;
  cardCode: string;
  cardName: string;
  clientType?: string | null;
  numAtCard?: string | null;
  comments?: string | null;
  colis: number;
  weightKg: number;
  lines: PrintLine[];
}

export interface PrintContext {
  /** Date de livraison déjà formatée (ex. « jeudi 2 juillet 2026 »). */
  dateLabel: string;
  carrierName?: string | null;
  tourneeLabel?: string | null;
  preparer?: string | null;
  /** Libellé d'état courant (À préparer / Fait / Départ). */
  statusLabel?: string;
  /** Codes articles signalés manquants sur ce BL. */
  missingCodes?: Set<string>;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (v: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v);

/** Ouvre la fenêtre d'impression du bon de préparation d'UN BL. */
export function printOrderRecap(doc: PrintDoc, ctx: PrintContext): boolean {
  const missing = ctx.missingCodes ?? new Set<string>();
  const missingLines = doc.lines.filter((l) => missing.has(l.itemCode));

  const tags = (l: PrintLine) =>
    [l.marque, l.condt, l.pays].map((t) => (t ?? "").trim()).filter((t) => t && t !== "—" && t !== "-");

  const rows = doc.lines
    .map((l) => {
      const isMissing = missing.has(l.itemCode);
      return `
      <tr class="${isMissing ? "missing" : ""}">
        <td class="colis">${num(l.colis)}</td>
        <td class="art">
          <span class="name">${esc(l.itemName)}</span>
          <span class="code">${esc(l.itemCode)}</span>
          ${tags(l).length ? `<span class="tags">${tags(l).map((t) => `<span>${esc(t)}</span>`).join("")}</span>` : ""}
          ${isMissing ? `<span class="flag">MANQUANT</span>` : ""}
        </td>
        <td class="num">${num(l.quantity)}</td>
        <td class="num">${num(l.weightKg)}</td>
        <td class="check"></td>
      </tr>`;
    })
    .join("");

  const infos: [string, string][] = [
    ["Transporteur", ctx.carrierName?.trim() || "Non affecté"],
    ["Tournée", ctx.tourneeLabel?.trim() || "—"],
    ["Réf. client", doc.numAtCard?.trim() || "—"],
    ["Préparateur", ctx.preparer?.trim() || "—"],
    ["État", ctx.statusLabel ?? "À préparer"],
  ];

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>BL n°${doc.docNum} — ${esc(doc.cardName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 12mm; }
  body { font: 12px/1.45 "Segoe UI", Arial, sans-serif; color: #111; padding: 16px; }
  @media print { body { padding: 0; } .noprint { display: none !important; } }

  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2.5px solid #111; padding-bottom: 10px; margin-bottom: 12px; }
  header .title p { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #555; }
  header .title h1 { font-size: 21px; letter-spacing: -0.3px; }
  header .bl { text-align: right; }
  header .bl .num { font-size: 19px; font-weight: 700; }
  header .bl .date { font-size: 12px; color: #333; }

  .client { display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
            margin-bottom: 10px; }
  .client .name { font-size: 17px; font-weight: 700; }
  .client .code { font-family: monospace; font-size: 12px; color: #444; }
  .client .type { display: inline-block; border: 1.5px solid #111; border-radius: 4px;
                  padding: 1px 7px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.6px; }

  .infos { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0;
           border: 1.5px solid #111; border-radius: 6px; overflow: hidden; margin-bottom: 14px; }
  .infos > div { padding: 6px 9px; border-left: 1px solid #bbb; }
  .infos > div:first-child { border-left: none; }
  .infos p.k { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #555; }
  .infos p.v { font-size: 12.5px; font-weight: 600; margin-top: 1px; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  thead th { font-size: 9.5px; text-transform: uppercase; letter-spacing: 1px; color: #333;
             border-bottom: 2px solid #111; padding: 5px 7px; text-align: left; }
  thead th.num, td.num { text-align: right; white-space: nowrap; }
  tbody td { border-bottom: 1px solid #ccc; padding: 6px 7px; vertical-align: middle; }
  td.colis { font-size: 17px; font-weight: 800; text-align: center; width: 58px;
             font-variant-numeric: tabular-nums; }
  td.art .name { font-weight: 600; }
  td.art .code { font-family: monospace; font-size: 10px; color: #666; margin-left: 6px; }
  td.art .tags { display: inline-flex; gap: 4px; margin-left: 8px; }
  td.art .tags span { border: 1px solid #999; border-radius: 3px; padding: 0 4px;
                      font-size: 9.5px; color: #444; }
  td.check { width: 40px; }
  td.check::after { content: ""; display: block; width: 15px; height: 15px;
                    border: 1.5px solid #111; border-radius: 3px; margin: 0 auto; }
  tr.missing td { color: #999; }
  tr.missing td.art .name { text-decoration: line-through; }
  td.art .flag { display: inline-block; margin-left: 8px; border: 1.5px solid #111;
                 border-radius: 3px; padding: 0 5px; font-size: 9.5px; font-weight: 800;
                 letter-spacing: 0.8px; color: #111; }
  tfoot td { border-top: 2px solid #111; padding: 7px; font-weight: 700; }
  tfoot .label { text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }

  .manquants { border: 2px solid #111; border-radius: 6px; padding: 9px 12px; margin-bottom: 12px; }
  .manquants h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 4px; }
  .manquants li { margin-left: 16px; font-size: 12px; }

  .comments { border-left: 3px solid #111; padding: 4px 10px; font-style: italic;
              color: #333; margin-bottom: 14px; }

  .sign { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 18px; }
  .sign > div { border: 1px solid #999; border-radius: 6px; height: 64px; padding: 5px 8px; }
  .sign p { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #555; }

  footer { margin-top: 12px; display: flex; justify-content: space-between;
           font-size: 9.5px; color: #777; }

  .noprint { margin-bottom: 14px; }
  .noprint button { font: 600 13px "Segoe UI", Arial, sans-serif; padding: 8px 18px;
                    border: 1.5px solid #111; border-radius: 6px; background: #111;
                    color: #fff; cursor: pointer; }
</style>
</head>
<body>
  <div class="noprint"><button onclick="window.print()">🖨 Imprimer</button></div>

  <header>
    <div class="title">
      <p>Gervi · Détail livraison</p>
      <h1>Bon de préparation</h1>
    </div>
    <div class="bl">
      <p class="num">BL n°${doc.docNum}</p>
      <p class="date">Livraison du ${esc(ctx.dateLabel)}</p>
    </div>
  </header>

  <div class="client">
    <div>
      <span class="name">${esc(doc.cardName)}</span>
      <span class="code">${esc(doc.cardCode)}</span>
    </div>
    ${doc.clientType ? `<span class="type">${esc(doc.clientType)}</span>` : ""}
  </div>

  <div class="infos">
    ${infos.map(([k, v]) => `<div><p class="k">${esc(k)}</p><p class="v">${esc(v)}</p></div>`).join("")}
  </div>

  ${doc.comments?.trim() ? `<p class="comments">« ${esc(doc.comments.trim())} »</p>` : ""}

  <table>
    <thead>
      <tr>
        <th style="text-align:center">Colis</th>
        <th>Article</th>
        <th class="num">Qté</th>
        <th class="num">Poids (kg)</th>
        <th style="text-align:center">Fait</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td style="text-align:center">${num(doc.colis)}</td>
        <td class="label">Total — ${doc.lines.length} article${doc.lines.length > 1 ? "s" : ""}</td>
        <td class="num">${num(doc.lines.reduce((s, l) => s + l.quantity, 0))}</td>
        <td class="num">${num(doc.weightKg)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  ${missingLines.length ? `
  <div class="manquants">
    <h2>⚠ Articles manquants (${missingLines.length})</h2>
    <ul>
      ${missingLines.map((l) => `<li><b>${esc(l.itemName)}</b> — ${num(l.colis)} colis (${num(l.quantity)} un.)</li>`).join("")}
    </ul>
  </div>` : ""}

  <div class="sign">
    <div><p>Préparé par</p></div>
    <div><p>Contrôlé par</p></div>
    <div><p>Chauffeur</p></div>
  </div>

  <footer>
    <span>SAP fait foi — document de préparation interne.</span>
    <span>Imprimé le ${new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
  </footer>

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
