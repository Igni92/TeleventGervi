/**
 * ÉLÉMENTS DES SALAIRES — logique PURE (testée hors React/Prisma).
 *
 * Chaque FIN DE MOIS, l'admin complète les éléments de paie de chaque salarié
 * (primes, 13e mois, avantages en nature, remboursements de frais) puis envoie
 * le RÉCAPITULATIF par email au cabinet comptable — ce récap REMPLACE l'envoi
 * du PDF des heures : heures travaillées, supp payées / laissées en récup
 * (décision employeur), CP, absences, fériés, primes, AN, frais.
 *
 *   • PRIMES : motif, montant, « sur bulletin de », note. Prime exceptionnelle
 *     libre ; la prime commerciale mensuelle (ventes vs objectifs) se saisit au
 *     même endroit (marquée `auto` quand elle sera préremplie automatiquement).
 *   • 13e MOIS : versé en DEUX moitiés (juin + décembre), PRORATISÉ selon la
 *     date d'entrée en CDI (présence dans le semestre de chaque moitié).
 *   • AVANTAGE EN NATURE véhicule : barème FORFAITAIRE annuel (arrêté du
 *     25/02/2025, mises à disposition ≥ 01/02/2025) sur la valeur d'achat TTC :
 *     15 % (10 % si véhicule de plus de 5 ans), 20 % (15 %) si l'employeur
 *     prend aussi le carburant en charge. Véhicule 100 % électrique :
 *     abattement de 70 %, plafonné (4 582 €/an en 2025). Mensuel = annuel/12.
 */

/* ────────────────────────────── Types stockés ─────────────────────────────── */

export type VehiculeEnergie = "essence" | "diesel" | "hybride" | "electrique";

export interface VehiculeAN {
  /** Type / modèle du véhicule (« Clio V », « Kangoo »…). */
  type: string;
  energie: VehiculeEnergie;
  immatriculation: string;
  /** Valeur d'achat TTC (€) — base du forfait annuel. */
  valeurAchat: number;
  /** Véhicule de PLUS de 5 ans à la mise à disposition (forfait réduit). */
  plusDe5Ans: boolean;
  /** L'employeur prend AUSSI le carburant / l'énergie en charge. */
  carburantRembourse: boolean;
  /** Usage (« permanent pro + perso », « semaine seule »…) — information. */
  usage: string;
}

export interface SalaryPrime {
  id: string;
  motif: string;
  montant: number;          // €
  /** Mois du bulletin qui porte la prime (« sur bulletin de »), YYYY-MM. */
  bulletinDe: string;
  note?: string;
  /** Préremplie automatiquement (13e mois, prime commerciale) — reste éditable. */
  auto?: boolean;
}

/** id RÉSERVÉ de la ligne « Commissions ventes » AUTOMATIQUE des éléments du
 *  mois : recalculée à chaque lecture depuis le moteur de commissions
 *  (lib/commissions), jamais persistée, VERROUILLÉE dans l'UI. */
export const COMMISSION_PRIME_ID = "commission-auto";

/** Détail des heures d'UNE semaine d'un salarié (pour la page par personne). */
export interface SalaryWeek {
  week: string;        // "2026-W30"
  label: string;       // "S30"
  from: string;        // ISO date (lundi)
  to: string;          // ISO date (dimanche)
  totalMin: number;    // heures travaillées
  contractMin: number; // dont contractuelles
  suppMin: number;     // dont majorées (25/50 %) brutes
  ferieMin: number;
  congesMin: number;
  hasData: boolean;    // false = semaine sans saisie
}

/** Une commission versée à UN commercial sur UNE paie — figée à l'envoi. */
export interface CommissionPaidEntry {
  slp: string;
  email: string;
  name: string;
  rate: number;
  /** Bornes de la période réglée sur cette paie (YYYY-MM). */
  fromMonth: string;
  toMonth: string;
  base: number;
  amount: number;
  /** Détail mois par mois figé au moment du versement. */
  months: { month: string; base: number; prime: number; invoices: number; avoirs: number }[];
}

/** Snapshot IMMUABLE des commissions payées sur la paie d'UN mois (trace). */
export interface CommissionPaidSnapshot {
  /** Mois de la PAIE qui a réglé ces commissions (YYYY-MM). */
  payslipMonth: string;
  /** Curseur AVANT ce versement (null = tout l'arriéré) — pour rejouer une rectif. */
  cursorBefore: string | null;
  sentAt: string;
  sentBy: string;
  total: number;
  entries: CommissionPaidEntry[];
}

export interface SalaryFrais {
  id: string;
  motif: string;
  montant: number;          // €
  note?: string;
}

/** Éléments d'UN salarié pour UN mois (saisis par l'admin). */
export interface SalaryMonthData {
  primes: SalaryPrime[];
  frais: SalaryFrais[];
  note?: string;
  updatedAt: string;
  updatedBy: string;
}

/** Fiche PAIE d'un salarié (stable dans le temps, hors saisie mensuelle). */
export interface SalaryProfile {
  /** Date d'entrée en CDI (ISO) — base du prorata du 13e mois. */
  cdiDate?: string | null;
  /** 13e mois actif (½ juin + ½ décembre). */
  treizieme?: boolean;
  /** Véhicule mis à disposition (avantage en nature), null si aucun. */
  vehicule?: VehiculeAN | null;
}

export const VEHICULE_ENERGIES: VehiculeEnergie[] = ["essence", "diesel", "hybride", "electrique"];

export const VEHICULE_ENERGIE_LABEL: Record<VehiculeEnergie, string> = {
  essence: "Essence",
  diesel: "Diesel",
  hybride: "Hybride",
  electrique: "Électrique",
};

/* ─────────────────── Avantage en nature véhicule (forfait) ────────────────── */

/** Plafond annuel de l'abattement « véhicule électrique » (2025). */
export const AN_ELECTRIQUE_ABATTEMENT = 0.7;
export const AN_ELECTRIQUE_PLAFOND_ANNUEL = 4582;

/** Forfait ANNUEL de l'avantage en nature (€) — barème achat (arrêté 25/02/2025) :
 *  15 % de la valeur d'achat (10 % si plus de 5 ans), 20 % (15 %) carburant
 *  compris. Électrique : abattement 70 % plafonné. 0 si valeur invalide. */
export function avantageNatureAnnuel(v: VehiculeAN | null | undefined): number {
  if (!v || !Number.isFinite(v.valeurAchat) || v.valeurAchat <= 0) return 0;
  const taux = v.carburantRembourse
    ? (v.plusDe5Ans ? 0.15 : 0.20)
    : (v.plusDe5Ans ? 0.10 : 0.15);
  let annuel = v.valeurAchat * taux;
  if (v.energie === "electrique") {
    annuel -= Math.min(annuel * AN_ELECTRIQUE_ABATTEMENT, AN_ELECTRIQUE_PLAFOND_ANNUEL);
  }
  return Math.round(annuel * 100) / 100;
}

/** Forfait MENSUEL de l'avantage en nature (€) = annuel / 12, arrondi au centime. */
export function avantageNatureMensuel(v: VehiculeAN | null | undefined): number {
  return Math.round((avantageNatureAnnuel(v) / 12) * 100) / 100;
}

/* ─────────────────────────── 13e mois (½ juin, ½ déc) ─────────────────────── */

/** Le mois est-il un mois de versement du 13e (juin / décembre) ? */
export function isTreiziemeMonth(monthId: string): boolean {
  const mm = monthId.slice(5, 7);
  return mm === "06" || mm === "12";
}

/**
 * PRORATA de la MOITIÉ de 13e mois versée sur `monthId` (juin ou décembre) en
 * fonction de la date d'entrée en CDI : chaque moitié couvre SON semestre
 * (janv→juin pour juin, juil→déc pour décembre) ; on compte les mois de
 * présence entiers ou entamés dans ce semestre / 6.
 *   • CDI avant le semestre  → 1 (moitié pleine)
 *   • CDI en cours de semestre → n mois de présence / 6
 *   • CDI après le semestre  → 0
 *   • mois hors juin/décembre OU date absente → null (rien à verser / inconnu)
 */
export function prorata13e(cdiDateISO: string | null | undefined, monthId: string): number | null {
  if (!isTreiziemeMonth(monthId) || !cdiDateISO) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(monthId);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cdiDateISO);
  if (!m || !d) return null;
  const year = Number(m[1]);
  const semStartMonth = m[2] === "06" ? 1 : 7;        // janv ou juil
  const cdiYear = Number(d[1]), cdiMonth = Number(d[2]);
  const cdiIndex = cdiYear * 12 + (cdiMonth - 1);
  const semStartIndex = year * 12 + (semStartMonth - 1);
  const semEndIndex = semStartIndex + 5;              // 6 mois
  if (cdiIndex <= semStartIndex) return 1;
  if (cdiIndex > semEndIndex) return 0;
  const monthsPresent = semEndIndex - cdiIndex + 1;   // mois d'entrée compté entier
  return Math.round((monthsPresent / 6) * 100) / 100;
}

/* ──────────────── Données manquantes (rappel avant transmission) ──────────── */

/** Résumé HEURES d'un salarié pour le récap (calculé côté serveur depuis les
 *  saisies — mêmes règles que l'état mensuel). Tous les champs en minutes sauf
 *  mention contraire. */
export interface SalaryHeures {
  totalMin: number;          // heures travaillées (crédits congés/fériés inclus)
  contractMin: number;
  suppTotalMin: number;      // total des heures supp BRUTES du mois (à arbitrer)
  suppPayEquivMin: number;   // supp À PAYER (équiv. majoré, décision employeur)
  suppRecupEquivMin: number; // supp laissées en RÉCUP (équiv. majoré, décision)
  suppSansDecisionMin: number; // supp SANS décision (bloquant avant envoi)
  ferieMin: number;          // journées types de fériés (toujours payées)
  congesMin: number;         // journées types créditées (CP validés)
  cpJours: number;           // jours ouvrables de CP validés dans le mois
  maladieJours: number;      // jours taggés maladie
  absentJours: number;       // jours taggés absent
  recupJours: number;        // jours taggés récup (repos pris)
  weeksWithData: number;
  weeksTotal: number;
}

/** Une TRACE d'envoi du document (PDF) au cabinet — la « liste des envois » de
 *  l'état comptable. `kind` distingue un premier envoi d'une RECTIFICATION. */
export interface SalaryEnvoi {
  id: string;
  monthId: string;         // « YYYY-MM » du document envoyé
  sentAt: string;          // ISO
  sentBy: string;          // email de l'expéditeur (admin)
  to: string[];            // destinataires
  kind: "normal" | "rectif";
  filename: string;        // nom du PDF joint
}

/** Éléments MANQUANTS à compléter avant transmission au cabinet comptable. */
export function missingElements(
  monthId: string,
  profile: SalaryProfile | null | undefined,
  data: SalaryMonthData | null | undefined,
  heures: SalaryHeures | null | undefined,
): string[] {
  const out: string[] = [];
  if (heures && heures.weeksWithData < heures.weeksTotal) {
    out.push(`Heures incomplètes (${heures.weeksWithData}/${heures.weeksTotal} semaines saisies)`);
  }
  if (heures && heures.suppSansDecisionMin > 0) {
    out.push("Heures supp sans décision (payer / récup) — à trancher dans l'état mensuel");
  }
  if (profile?.treizieme && isTreiziemeMonth(monthId)) {
    const has13e = (data?.primes ?? []).some((p) => /13e|13è|treizi/i.test(p.motif));
    if (!has13e) out.push("13e mois à saisir (½ sur ce bulletin)");
    if (!profile.cdiDate) out.push("Date d'entrée CDI manquante (prorata du 13e mois)");
  }
  if (profile?.vehicule && !(profile.vehicule.valeurAchat > 0)) {
    out.push("Valeur d'achat du véhicule manquante (avantage en nature non calculable)");
  }
  return out;
}

/* ─────────────────────── Récapitulatif mensuel (email) ────────────────────── */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);

/** Minutes → « 38h30 » (récap email — même convention que l'app). */
function hm(min: number): string {
  const abs = Math.abs(Math.round(min));
  return `${min < 0 ? "−" : ""}${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, "0")}`;
}

/** Une ligne du récap comptable (un salarié). */
export interface RecapRow {
  name: string;
  email: string;
  heures: SalaryHeures;
  anMensuel: number;                 // avantage en nature véhicule (€ / mois)
  vehicule?: VehiculeAN | null;
  primes: SalaryPrime[];
  frais: SalaryFrais[];
  note?: string;
  missing: string[];
}

/** « 2026-07 » → « juillet 2026 » (indépendant de lib/heuresCalc — email pur). */
export function salaireMonthLabel(monthId: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthId);
  if (!m) return monthId;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15)).toLocaleDateString("fr-FR", {
    timeZone: "UTC", month: "long", year: "numeric",
  });
}

/** EMAIL HTML du récapitulatif mensuel envoyé au cabinet comptable. */
export function recapMailHtml(monthId: string, rows: RecapRow[], appUrl: string): string {
  const td = `padding:6px 9px;border:1px solid #ddd;white-space:nowrap`;
  const tdNum = `${td};text-align:right`;
  const header = (l: string) => `<th style="${td};background:#f4f4f5;font-size:11px;text-transform:uppercase;letter-spacing:0.6px">${l}</th>`;
  const bodyRows = rows.map((r) => {
    const primesTotal = r.primes.reduce((s, p) => s + p.montant, 0);
    const fraisTotal = r.frais.reduce((s, f) => s + f.montant, 0);
    const details: string[] = [
      ...r.primes.map((p) => `Prime — ${esc(p.motif)} : <b>${eur(p.montant)}</b>${p.bulletinDe !== monthId ? ` (bulletin de ${esc(salaireMonthLabel(p.bulletinDe))})` : ""}${p.note ? ` — ${esc(p.note)}` : ""}`),
      ...r.frais.map((f) => `Frais — ${esc(f.motif)} : <b>${eur(f.montant)}</b>${f.note ? ` — ${esc(f.note)}` : ""}`),
      ...(r.vehicule ? [`AN véhicule — ${esc(r.vehicule.type)} (${esc(r.vehicule.immatriculation)})${r.vehicule.carburantRembourse ? ", carburant pris en charge" : ""} : <b>${eur(r.anMensuel)}</b> / mois`] : []),
      ...(r.note ? [`Note : ${esc(r.note)}`] : []),
      ...r.missing.map((x) => `⚠️ ${esc(x)}`),
    ];
    return `
      <tr>
        <td style="${td};font-weight:700">${esc(r.name)}</td>
        <td style="${tdNum}">${hm(r.heures.totalMin)}</td>
        <td style="${tdNum}">${r.heures.suppPayEquivMin > 0 ? `<b>${hm(r.heures.suppPayEquivMin)}</b>` : "—"}</td>
        <td style="${tdNum}">${r.heures.ferieMin > 0 ? hm(r.heures.ferieMin) : "—"}</td>
        <td style="${tdNum}">${r.heures.cpJours > 0 ? `${r.heures.cpJours} j` : "—"}</td>
        <td style="${tdNum}">${r.heures.maladieJours > 0 ? `${r.heures.maladieJours} j` : "—"}</td>
        <td style="${tdNum}">${r.heures.absentJours > 0 ? `${r.heures.absentJours} j` : "—"}</td>
        <td style="${tdNum}">${primesTotal > 0 ? `<b>${eur(primesTotal)}</b>` : "—"}</td>
        <td style="${tdNum}">${r.anMensuel > 0 ? eur(r.anMensuel) : "—"}</td>
        <td style="${tdNum}">${fraisTotal > 0 ? eur(fraisTotal) : "—"}</td>
      </tr>
      ${details.length ? `<tr><td colspan="10" style="padding:4px 9px 10px;border:1px solid #ddd;border-top:none;font-size:12px;color:#444">${details.join("<br/>")}</td></tr>` : ""}`;
  }).join("");

  return `
  <div style="font:14px/1.6 'Segoe UI',Arial,sans-serif;color:#111">
    <p style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#666;margin:0 0 4px">Gervifrais · Éléments des salaires</p>
    <h2 style="margin:0 0 12px;font-size:19px">Récapitulatif paie — ${esc(salaireMonthLabel(monthId))}</h2>
    <table style="border-collapse:collapse;width:100%;margin-bottom:12px">
      <tr>
        ${header("Salarié")}${header("Heures")}${header("Supp payées")}${header("Férié")}
        ${header("CP")}${header("Maladie")}${header("Absence")}${header("Primes")}${header("AN")}${header("Frais")}
      </tr>
      ${bodyRows}
    </table>
    <p style="font-size:12px;color:#555;margin:0 0 6px">
      « Supp payées » = équivalent MAJORÉ (+25 %/+50 %) des heures supp dont le paiement a été décidé. Les jours
      FÉRIÉS chômés sont crédités en journée type et TOUJOURS payés. « AN » = avantage en nature véhicule (forfait mensuel).
    </p>
    <p style="font-size:12px;color:#555;margin:0 0 14px">Détail et historique dans TeleVent : <a href="${esc(appUrl)}/salaires">${esc(appUrl)}/salaires</a></p>
  </div>`;
}
