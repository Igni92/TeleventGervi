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
  unit?: string | null;   // unité de vente (PIE, KG, COLIS…) affichée après la quantité
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
  colis: number;
  weightKg: number;
  lines: PrintLine[];
}

export interface PrintContext {
  /** Date de livraison déjà formatée (ex. « jeudi 2 juillet 2026 »). */
  dateLabel: string;
  carrierName?: string | null;
  tourneeLabel?: string | null;
  /** Codes articles manquants (stock SAP négatif) sur ce BL. */
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

  // Détails de désignation en TEXTE BRUT (marque · conditionnement · origine) —
  // plus lisible à l'impression que les tags encadrés de l'app.
  const details = (l: PrintLine) =>
    [l.marque, l.condt, l.pays].map((t) => (t ?? "").trim()).filter((t) => t && t !== "—" && t !== "-");

  // Case « Fait » à GAUCHE (première colonne cochée par le préparateur).
  // Article : nom en GRAS, sans code, détails en texte brut à la suite.
  const rows = doc.lines
    .map((l) => {
      const isMissing = missing.has(l.itemCode);
      return `
      <tr class="${isMissing ? "missing" : ""}">
        <td class="check"></td>
        <td class="colis">${num(l.colis)}</td>
        <td class="art">
          <span class="name">${esc(l.itemName)}</span>
          ${details(l).length ? `<span class="det">— ${details(l).map(esc).join(" · ")}</span>` : ""}
          ${isMissing ? `<span class="flag">MANQUANT</span>` : ""}
        </td>
        <td class="num">${num(l.quantity)}${l.unit?.trim() ? ` <span class="unit">${esc(l.unit.trim().toLowerCase())}</span>` : ""}</td>
        <td class="num">${num(l.weightKg)} <span class="unit">kg</span></td>
      </tr>`;
    })
    .join("");

  // Le CLIENT a sa propre case, aux côtés du transporteur et de la tournée.
  const infos: [string, string][] = [
    ["Client", `${doc.cardName}${doc.clientType ? ` (${doc.clientType})` : ""}`],
    ["Transporteur", ctx.carrierName?.trim() || "Non affecté"],
    ["Tournée", ctx.tourneeLabel?.trim() || "—"],
  ];

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>BL n°${doc.docNum} — ${esc(doc.cardName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 12mm; }
  /* Police GLOBALE augmentée (12 → 14px) : bon lu debout, en entrepôt. */
  body { font: 14px/1.5 "Segoe UI", Arial, sans-serif; color: #111; padding: 16px; }
  @media print { body { padding: 0; } .noprint { display: none !important; } }

  header { display: flex; justify-content: space-between; align-items: center; gap: 12px;
           border-bottom: 2.5px solid #111; padding-bottom: 10px; margin-bottom: 12px; }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .brand img.logo { height: 52px; width: auto; object-fit: contain; }
  header .title p { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #555; }
  header .title h1 { font-size: 22px; letter-spacing: -0.3px; }
  /* BL en PETIT, date de livraison en GRAND (jour en surgras) — repère n°1 du bon. */
  header .bl { text-align: right; }
  header .bl .num { font-size: 13px; font-weight: 600; color: #333; }
  header .bl .date { font-size: 19px; margin-top: 1px; }
  header .bl .date b { font-weight: 900; }

  .infos { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 0;
           border: 1.5px solid #111; border-radius: 6px; overflow: hidden; margin-bottom: 14px; }
  .infos > div { padding: 7px 10px; border-left: 1px solid #bbb; }
  .infos > div:first-child { border-left: none; }
  .infos p.k { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #555; }
  .infos p.v { font-size: 15px; font-weight: 700; margin-top: 1px; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #333;
             border-bottom: 2px solid #111; padding: 6px 8px; text-align: left; }
  thead th.num, td.num { text-align: right; white-space: nowrap; }
  tbody td { border-bottom: 1px solid #ccc; padding: 7px 8px; vertical-align: middle; }
  td.colis { font-size: 19px; font-weight: 800; text-align: center; width: 62px;
             font-variant-numeric: tabular-nums; }
  td.art .name { font-weight: 800; font-size: 15px; }
  td.art .det { font-size: 13px; color: #333; margin-left: 6px; }
  td.check { width: 46px; }
  td.check::after { content: ""; display: block; width: 17px; height: 17px;
                    border: 1.5px solid #111; border-radius: 3px; margin: 0 auto; }
  tr.missing td { color: #999; }
  tr.missing td.art .name { text-decoration: line-through; }
  td.art .flag { display: inline-block; margin-left: 8px; border: 1.5px solid #111;
                 border-radius: 3px; padding: 0 5px; font-size: 11px; font-weight: 800;
                 letter-spacing: 0.8px; color: #111; }
  .unit { font-size: 11px; font-weight: 600; color: #555; }
  tfoot td { border-top: 2px solid #111; padding: 8px; font-weight: 700; font-size: 14px; }
  tfoot .label { text-transform: uppercase; font-size: 11px; letter-spacing: 1px; }

  .manquants { border: 2px solid #111; border-radius: 6px; padding: 9px 12px; margin-bottom: 12px; }
  .manquants h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 4px; }
  .manquants li { margin-left: 16px; font-size: 14px; }

  .noprint { margin-bottom: 14px; }
  .noprint button { font: 600 13px "Segoe UI", Arial, sans-serif; padding: 8px 18px;
                    border: 1.5px solid #111; border-radius: 6px; background: #111;
                    color: #fff; cursor: pointer; }
</style>
</head>
<body>
  <div class="noprint"><button onclick="window.print()">🖨 Imprimer</button></div>

  <header>
    <div class="brand">
      <img class="logo" src="${esc(`${window.location.origin}/logo-mark.png`)}" alt="Gervifrais" />
      <div class="title">
        <p>Gervifrais · Détail livraison</p>
        <h1>Bon de préparation</h1>
      </div>
    </div>
    <div class="bl">
      <p class="num">BL n°${doc.docNum}</p>
      <p class="date">Livraison du <b>${esc(ctx.dateLabel)}</b></p>
    </div>
  </header>

  <div class="infos">
    ${infos.map(([k, v]) => `<div><p class="k">${esc(k)}</p><p class="v">${esc(v)}</p></div>`).join("")}
  </div>

  <table>
    <thead>
      <tr>
        <th style="text-align:center">Fait</th>
        <th style="text-align:center">Colis</th>
        <th>Article</th>
        <th class="num">Qté</th>
        <th class="num">Poids (kg)</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td></td>
        <td style="text-align:center">${num(doc.colis)} <span class="unit">colis</span></td>
        <td class="label">Total — ${doc.lines.length} article${doc.lines.length > 1 ? "s" : ""}</td>
        <td class="num">${num(doc.lines.reduce((s, l) => s + l.quantity, 0))}</td>
        <td class="num">${num(doc.weightKg)} <span class="unit">kg</span></td>
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
