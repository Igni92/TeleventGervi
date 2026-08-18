/**
 * Bon de transport — récapitulatif de TOUTES les commandes (palettes) d'un
 * transporteur pour un jour de livraison, à faire signer au chauffeur.
 *
 * Module PARTAGÉ (pur, sans dépendance React/DOM) :
 *  - impression depuis le Détail livraison → 2 exemplaires (ORIGINAL + COPIE) ;
 *  - envoi par mail au transporteur (route /api/livraisons/bon-transport) →
 *    corps HTML (exemplaire unique).
 *
 * Les PALETTES sont un total de CHARGEMENT, pas une donnée de ligne : on charge
 * un camion, pas un bon de livraison. Une palette porte couramment plusieurs BL,
 * et un BL peut finir à cheval sur deux palettes — l'attribuer à une ligne
 * donnerait un chiffre faux, et leur somme ne voudrait rien dire. Le tableau des
 * commandes n'a donc PAS de colonne palettes : le comptage figure une seule
 * fois, en pied de document, par type.
 *
 * Le total vient des comptages saisis à la préparation (clic « fait »), cf.
 * lib/palettes.ts — le nombre de palettes n'existe pas dans SAP, il se constate
 * en entrepôt. Si rien n'a été compté, le bloc s'imprime avec des cases VIDES,
 * à remplir à la main au chargement comme avant : on ne fait jamais passer une
 * absence de saisie pour un zéro.
 */

import { isEmptyPalettes, sumPalettes, EMPTY_PALETTES, PALETTE_TYPES, type PaletteCounts } from "./palettes";

export interface BonTransportRow {
  tournee: string;      // libellé de tournée (IDF, NORD…) ou « Sans tournée »
  client: string;       // nom COMPLET du client
  docNum: number;       // n° de BL
  colis: number;
  weightKg: number;
  /** Comptage saisi à la préparation. `null`/absent = jamais compté → case vide
   *  à remplir à la main (comportement d'origine de ce document). */
  palettes?: PaletteCounts | null;
}

export interface BonTransportData {
  carrierName: string;
  dateLabel: string;    // date de livraison formatée (ex. « jeudi 2 juillet 2026 »)
  email?: string | null;
  phones?: { label: string; value: string }[];
  rows: BonTransportRow[];  // déjà triées par tournée
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (v: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v);

/** Corps d'UN exemplaire (page) du bon de transport. */
function renderCopy(data: BonTransportData, tag: string): string {
  const totals = {
    orders: data.rows.length,
    colis: data.rows.reduce((s, r) => s + r.colis, 0),
    weightKg: data.rows.reduce((s, r) => s + r.weightKg, 0),
    // Cumul des seuls BL RÉELLEMENT comptés : un BL non saisi ne compte pas pour
    // zéro, sinon le total afficherait un chiffre faux au chauffeur.
    // Somme des comptages saisis. Le total est GLOBAL : c'est le chargement qui
    // est palettisé, pas chaque bon de livraison pris isolément.
    palettes: sumPalettes(data.rows.map((r) => r.palettes ?? EMPTY_PALETTES)),
  };
  // Nombre de BL réellement comptés : à zéro, le bloc s'imprime VIDE plutôt que
  // d'afficher « 0 » partout, ce qui se lirait comme « aucune palette ».
  const counted = data.rows.filter((r) => r.palettes && !isEmptyPalettes(r.palettes)).length;

  // Lignes groupées par tournée : sous-en-tête par tournée puis ses commandes.
  let currentTournee: string | null = null;
  const bodyRows = data.rows
    .map((r) => {
      let sub = "";
      if (r.tournee !== currentTournee) {
        currentTournee = r.tournee;
        sub = `<tr class="tournee"><td colspan="4">Tournée — ${esc(r.tournee)}</td></tr>`;
      }
      return `${sub}
      <tr>
        <td class="client">${esc(r.client)}</td>
        <td class="num">${r.docNum}</td>
        <td class="num">${num(r.colis)}</td>
        <td class="num">${num(r.weightKg)}</td>
      </tr>`;
    })
    .join("");

  const contact = [
    data.email?.trim() ? `Email : ${esc(data.email.trim())}` : null,
    ...(data.phones ?? []).map((p) => `${p.label ? esc(p.label) + " : " : "Tél : "}${esc(p.value)}`),
  ].filter(Boolean);

  return `
  <section class="page">
    <header>
      <div class="title">
        <p>Gervifrais</p>
        <h1>Bon de transport</h1>
      </div>
      <div class="tag">${esc(tag)}</div>
    </header>

    <div class="meta">
      <div>
        <p class="k">Expéditeur</p>
        <p class="v">GERVIFRAIS</p>
      </div>
      <div>
        <p class="k">Transporteur</p>
        <p class="v">${esc(data.carrierName)}</p>
        ${contact.length ? `<p class="c">${contact.join(" · ")}</p>` : ""}
      </div>
      <div>
        <p class="k">Livraison du</p>
        <p class="v">${esc(data.dateLabel)}</p>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Client</th>
          <th class="num">BL n°</th>
          <th class="num">Colis</th>
          <th class="num">Poids (kg)</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
      <tfoot>
        <tr>
          <td class="label">Total — ${totals.orders} commande${totals.orders > 1 ? "s" : ""}</td>
          <td></td>
          <td class="num">${num(totals.colis)}</td>
          <td class="num">${num(totals.weightKg)}</td>
        </tr>
      </tfoot>
    </table>

    <!-- Comptage GLOBAL du chargement. Imprimé même vide : le chauffeur doit
         pouvoir l'écrire à la main si personne ne l'a saisi. -->
    <table class="pal-recap">
      <thead>
        <tr><th colspan="${PALETTE_TYPES.length}">Nombre de palette(s)</th></tr>
      </thead>
      <tbody>
        <tr>${PALETTE_TYPES.map((t) => `<td class="pal-n">${counted > 0 ? (totals.palettes[t.key] || 0) : "&nbsp;"}</td>`).join("")}</tr>
        <tr>${PALETTE_TYPES.map((t) => `<td class="pal-s">${esc(t.size)}</td>`).join("")}</tr>
        <tr>${PALETTE_TYPES.map((t) => `<td class="pal-l">${esc(t.label)}</td>`).join("")}</tr>
      </tbody>
    </table>

    <div class="sign">
      <div>
        <p class="k">L'expéditeur — Gervifrais</p>
        <p class="hint">Nom &amp; signature</p>
      </div>
      <div>
        <p class="k">Le transporteur — chauffeur</p>
        <p class="hint">Nom, date, heure &amp; signature</p>
      </div>
    </div>
  </section>`;
}

/**
 * Document HTML complet du bon de transport.
 *  - `copies` : exemplaires à rendre (défaut ORIGINAL + COPIE, un par page).
 *  - `autoPrint` : lance l'impression à l'ouverture (fenêtre dédiée).
 */
export function renderBonTransport(
  data: BonTransportData,
  opts?: { copies?: string[]; autoPrint?: boolean },
): string {
  const copies = opts?.copies ?? ["ORIGINAL", "COPIE"];
  const pages = copies.map((tag) => renderCopy(data, tag)).join("\n");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Bon de transport — ${esc(data.carrierName)} — ${esc(data.dateLabel)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 12mm; }
  body { font: 12px/1.45 "Segoe UI", Arial, sans-serif; color: #111; }
  @media print { .noprint { display: none !important; } }
  @media screen { body { padding: 16px; } .page { margin-bottom: 28px; } }

  .page { page-break-after: always; }
  .page:last-of-type { page-break-after: auto; }

  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2.5px solid #111; padding-bottom: 10px; margin-bottom: 12px; }
  header .title p { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #555; }
  header .title h1 { font-size: 21px; letter-spacing: -0.3px; }
  header .tag { border: 2px solid #111; border-radius: 5px; padding: 3px 12px;
                font-size: 13px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; }

  .meta { display: grid; grid-template-columns: 1fr 1.4fr 1fr; gap: 0;
          border: 1.5px solid #111; border-radius: 6px; overflow: hidden; margin-bottom: 14px; }
  .meta > div { padding: 7px 10px; border-left: 1px solid #bbb; }
  .meta > div:first-child { border-left: none; }
  .meta p.k { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #555; }
  .meta p.v { font-size: 13.5px; font-weight: 700; margin-top: 1px; }
  .meta p.c { font-size: 10.5px; color: #444; margin-top: 2px; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  thead th { font-size: 9.5px; text-transform: uppercase; letter-spacing: 1px; color: #333;
             border-bottom: 2px solid #111; padding: 5px 7px; text-align: left; }
  thead th.num, td.num { text-align: right; white-space: nowrap; }
  tbody td { border-bottom: 1px solid #ccc; padding: 6px 7px; vertical-align: middle; }
  td.client { font-weight: 600; }
  td.num { font-variant-numeric: tabular-nums; }
  tr.tournee td { background: #eee; border-bottom: 1.5px solid #111; padding: 4px 7px;
                  font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; }
  tfoot td { border-top: 2px solid #111; padding: 7px; font-weight: 700; }
  tfoot .label { text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }

  /* Récapitulatif des palettes — tuiles nombre / format / type, à la suite du
     tableau. Imprimé seulement si un comptage existe (sinon la colonne reste
     vide, à remplir à la main au chargement). */
  .pal-recap { width: auto; margin: 10px 0 14px; border: 1.5px solid #111;
               border-radius: 6px; border-collapse: collapse; overflow: hidden; }
  .pal-recap th { font-size: 9.5px; text-transform: uppercase; letter-spacing: 1px;
                  color: #555; font-weight: 700; text-align: center; padding: 5px 10px;
                  border-bottom: 1px solid #bbb; }
  .pal-recap td { text-align: center; padding: 2px 16px; border-left: 1px solid #ddd; }
  .pal-recap td:first-child { border-left: none; }
  .pal-recap td.pal-n { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums;
                        padding-top: 6px; }
  .pal-recap td.pal-s { font-size: 10px; color: #555; }
  .pal-recap td.pal-l { font-size: 11px; font-weight: 700; padding-bottom: 6px; }

  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 10px; }
  .sign > div { border: 1.5px solid #111; border-radius: 6px; height: 92px; padding: 7px 10px; }
  .sign p.k { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
  .sign p.hint { font-size: 9px; color: #777; margin-top: 1px; }

  .noprint { margin-bottom: 14px; }
  .noprint button { font: 600 13px "Segoe UI", Arial, sans-serif; padding: 8px 18px;
                    border: 1.5px solid #111; border-radius: 6px; background: #111;
                    color: #fff; cursor: pointer; }
</style>
</head>
<body>
  ${opts?.autoPrint ? `<div class="noprint"><button onclick="window.print()">🖨 Imprimer</button></div>` : ""}
  ${pages}
  ${opts?.autoPrint ? `<script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 150); });</script>` : ""}
</body>
</html>`;
}
