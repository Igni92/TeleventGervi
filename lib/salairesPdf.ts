/**
 * ÉTAT DES SALAIRES imprimable (A4, impression navigateur) — la version
 * « document » de la vue comptable : une page sobre par mois, tableau des
 * heures de l'équipe + éléments de paie (primes, AN, frais) par salarié.
 * Même mécanique que l'état mensuel des heures (openPrintWindow).
 */
import { fmtHM } from "./heuresCalc";
import { openPrintWindow } from "./heuresPdf";
import { salaireMonthLabel, type SalaryFrais, type SalaryHeures, type SalaryPrime, type VehiculeAN } from "./salaires";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);

export interface EtatSalaireRow {
  name: string;
  heures: SalaryHeures;
  anMensuel: number;
  vehicule?: VehiculeAN | null;
  primes: SalaryPrime[];
  frais: SalaryFrais[];
  note?: string;
}

function row(r: EtatSalaireRow, monthId: string): string {
  const h = r.heures;
  const primesTotal = r.primes.reduce((s, p) => s + p.montant, 0);
  const fraisTotal = r.frais.reduce((s, f) => s + f.montant, 0);
  const details: string[] = [
    ...r.primes.map((p) => `Prime — ${esc(p.motif)} : <b>${eur(p.montant)}</b>${p.bulletinDe !== monthId ? ` (bulletin de ${esc(salaireMonthLabel(p.bulletinDe))})` : ""}${p.note ? ` — ${esc(p.note)}` : ""}`),
    ...r.frais.map((f) => `Frais — ${esc(f.motif)} : <b>${eur(f.montant)}</b>${f.note ? ` — ${esc(f.note)}` : ""}`),
    ...(r.vehicule ? [`Avantage en nature — ${esc(r.vehicule.type)}${r.vehicule.immatriculation ? ` (${esc(r.vehicule.immatriculation)})` : ""}${r.vehicule.carburantRembourse ? ", carburant pris en charge" : ""} : <b>${eur(r.anMensuel)}</b> / mois`] : []),
    ...(r.note ? [`Note : ${esc(r.note)}`] : []),
  ];
  const num = (v: string, strong = false) => `<td class="num${strong ? " total" : ""}">${v}</td>`;
  return `
    <tr>
      <td class="jour">${esc(r.name)}</td>
      ${num(fmtHM(h.totalMin))}
      ${num(h.suppPayEquivMin > 0 ? fmtHM(h.suppPayEquivMin) : "—", h.suppPayEquivMin > 0)}
      ${num(h.suppRecupEquivMin > 0 ? fmtHM(h.suppRecupEquivMin) : "—")}
      ${num(h.ferieMin > 0 ? fmtHM(h.ferieMin) : "—")}
      ${num(h.cpJours > 0 ? `${h.cpJours} j` : "—")}
      ${num(h.maladieJours > 0 ? `${h.maladieJours} j` : "—")}
      ${num(h.absentJours > 0 ? `${h.absentJours} j` : "—")}
      ${num(primesTotal > 0 ? eur(primesTotal) : "—", primesTotal > 0)}
      ${num(r.anMensuel > 0 ? eur(r.anMensuel) : "—")}
      ${num(fraisTotal > 0 ? eur(fraisTotal) : "—")}
    </tr>
    ${details.length ? `<tr class="vide"><td colspan="11" class="note" style="border-bottom:1px solid #ccc">${details.join("<br/>")}</td></tr>` : ""}`;
}

/** Ouvre la fenêtre d'impression de l'ÉTAT DES SALAIRES. false = pop-up bloquée. */
export function printEtatSalaires(monthId: string, rows: EtatSalaireRow[]): boolean {
  if (rows.length === 0) return false;
  const page = `
  <section class="page">
    <header>
      <div>
        <p class="kicker">Gervifrais · Compta / paie</p>
        <h1>Éléments des salaires</h1>
      </div>
      <div class="bl"><p class="date-big">${esc(salaireMonthLabel(monthId))}</p></div>
    </header>
    <table>
      <thead>
        <tr>
          <th>Salarié</th><th class="num">Heures</th><th class="num">Supp payées</th><th class="num">Supp → récup</th>
          <th class="num">Férié</th><th class="num">CP</th><th class="num">Maladie</th><th class="num">Absence</th>
          <th class="num">Primes</th><th class="num">AN</th><th class="num">Frais</th>
        </tr>
      </thead>
      <tbody>${rows.map((r) => row(r, monthId)).join("")}</tbody>
    </table>
    <p class="legende">« Supp payées » = équivalent MAJORÉ (+25 %/+50 %) des heures supplémentaires dont le paiement
    a été décidé par l'employeur ; « Supp → récup » = équivalent majoré crédité au compteur de récupération.
    Les jours FÉRIÉS chômés sont crédités en journée type et TOUJOURS payés (inclus dans les heures).
    « AN » = avantage en nature véhicule (forfait mensuel). Les primes et frais sont détaillés sous chaque salarié.</p>
  </section>`;
  return openPrintWindow(`Salaires ${monthId} — Gervifrais`, page);
}
