/**
 * ÉTAT COMPTABLE — génération du VRAI PDF (jsPDF, CÔTÉ NAVIGATEUR). Le document
 * mensuel (heures de l'équipe + éléments de paie) est produit en A4 paysage,
 * puis soit prévisualisé (blob), soit envoyé en pièce jointe au cabinet (base64
 * posté au serveur, cf. app/api/salaires « send »). jsPDF est importé en dynamic
 * import → il n'alourdit QUE la page /salaires, pas le reste de l'app.
 */
import { fmtHM } from "./heuresCalc";
import {
  salaireMonthLabel, COMMISSION_PRIME_ID,
  type SalaryFrais, type SalaryHeures, type SalaryPrime, type SalaryWeek, type VehiculeAN,
} from "./salaires";

export interface PdfEmploye {
  name: string;
  heures: SalaryHeures;
  anMensuel: number;
  vehicule: VehiculeAN | null;
  primes: SalaryPrime[];
  frais: SalaryFrais[];
  note?: string;
  /** Détail hebdomadaire — page par personne. */
  weeks?: SalaryWeek[];
}

const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
const jours = (n: number) => (n > 0 ? `${n} j` : "—");
const hm = (m: number) => (m > 0 ? fmtHM(m) : "—");
/** jsPDF n'embarque que le Latin-1 « standard » : le « − » (U+2212) de fmtHM et
 *  les fines/insécables passent mal → on retombe sur des caractères ASCII sûrs. */
const ascii = (s: string) => s.replace(/−/g, "-").replace(/→/g, "-").replace(/[  ]/g, " ");

/** Période courte d'une semaine, ex. « 21-27 juil. ». */
function weekRange(w: SalaryWeek): string {
  if (!w.from || !w.to) return "";
  const a = new Date(`${w.from}T12:00:00Z`), b = new Date(`${w.to}T12:00:00Z`);
  const day = (x: Date) => x.getUTCDate();
  const mon = (x: Date) => x.toLocaleDateString("fr-FR", { month: "short", timeZone: "UTC" });
  return mon(a) === mon(b) ? `${day(a)}-${day(b)} ${mon(b)}` : `${day(a)} ${mon(a)} - ${day(b)} ${mon(b)}`;
}

/** Lignes des ÉLÉMENTS DE PAIE (primes / frais / AN / note). La ligne
 *  commission auto est présentée sans préfixe « Prime — » (déjà explicite),
 *  sa note (période / base) entre parenthèses — courte et lisible. */
function payLines(monthId: string, e: PdfEmploye): string[] {
  return [
    ...e.primes.map((p: SalaryPrime) =>
      p.id === COMMISSION_PRIME_ID
        ? `${p.motif} : ${eur(p.montant)}${p.note ? `  (${p.note})` : ""}`
        : `Prime — ${p.motif} : ${eur(p.montant)}${p.bulletinDe && p.bulletinDe !== monthId ? ` (bulletin de ${salaireMonthLabel(p.bulletinDe)})` : ""}${p.note ? ` — ${p.note}` : ""}`),
    ...e.frais.map((f: SalaryFrais) => `Frais — ${f.motif} : ${eur(f.montant)}${f.note ? ` — ${f.note}` : ""}`),
    ...(e.vehicule ? [`Avantage en nature — ${e.vehicule.type} : ${eur(e.anMensuel)} / mois`] : []),
    ...(e.note ? [`Note : ${e.note}`] : []),
  ];
}

/** Nom de fichier du PDF de l'état d'un mois. */
export function salairesPdfFilename(monthId: string): string {
  return `elements-salaires-${monthId}.pdf`;
}

/**
 * Construit le PDF de l'état comptable d'un mois. Retourne l'instance jsPDF
 * (le caller en tire un blob pour l'aperçu, ou un base64 pour l'email).
 */
export async function buildSalairesPdf(monthId: string, employes: PdfEmploye[]): Promise<import("jspdf").jsPDF> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const W = doc.internal.pageSize.getWidth();
  const M = 32;   // marge

  // ── En-tête ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(17, 24, 39);
  doc.text("GERVIFRAIS", M, 40);
  doc.setFontSize(11);
  doc.setTextColor(90, 90, 90);
  doc.text("Éléments des salaires", M, 57);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(17, 24, 39);
  const label = ascii(salaireMonthLabel(monthId));
  doc.text(label.charAt(0).toUpperCase() + label.slice(1), W - M, 40, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(120, 120, 120);
  doc.text(`Document transmis au cabinet comptable`, W - M, 55, { align: "right" });

  // ── Tableau équipe ──
  // La compta voit le RÉSULTAT FINAL : ni la récup (payée-neutre, interne RH),
  // ni les échanges récup↔CP — juste ce qui pèse sur la paie.
  const head = [[
    "Salarié", "Heures", "Supp payées", "Férié",
    "CP", "Maladie", "Absence", "Primes", "AN", "Frais",
  ]];
  const body = employes.map((e) => {
    const h = e.heures;
    const primesTotal = e.primes.reduce((s, p) => s + p.montant, 0);
    const fraisTotal = e.frais.reduce((s, f) => s + f.montant, 0);
    return [
      ascii(e.name),
      ascii(hm(h.totalMin)),
      ascii(hm(h.suppPayEquivMin)),
      ascii(hm(h.ferieMin)),
      jours(h.cpJours),
      jours(h.maladieJours),
      jours(h.absentJours),
      primesTotal > 0 ? ascii(eur(primesTotal)) : "—",
      e.anMensuel > 0 ? ascii(eur(e.anMensuel)) : "—",
      fraisTotal > 0 ? ascii(eur(fraisTotal)) : "—",
    ];
  });

  autoTable(doc, {
    startY: 74,
    margin: { left: M, right: M },
    head,
    body,
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 4, textColor: [30, 30, 30], lineColor: [225, 225, 225] },
    headStyles: { fillColor: [17, 24, 39], textColor: [255, 255, 255], fontStyle: "bold", halign: "right", fontSize: 8 },
    columnStyles: { 0: { halign: "left", fontStyle: "bold", cellWidth: 120 } },
    bodyStyles: { halign: "right" },
    alternateRowStyles: { fillColor: [247, 248, 250] },
  });

  // ── UNE PAGE PAR PERSONNE : détail des heures par semaine + éléments de paie ──
  const bottom = doc.internal.pageSize.getHeight() - M;
  for (const e of employes) {
    doc.addPage();
    // En-tête de la page personne.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(17, 24, 39);
    doc.text(ascii(e.name), M, 42);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(`${ascii(label.charAt(0).toUpperCase() + label.slice(1))} — detail des heures par semaine`, M, 57);

    // Tableau HEBDO — une ligne par semaine + total.
    const weeks = (e.weeks ?? []).filter((w) => w.hasData || w.totalMin > 0 || w.ferieMin > 0 || w.congesMin > 0);
    const wBody = weeks.map((w) => [
      ascii(w.label),
      ascii(weekRange(w)),
      hm(w.totalMin),
      hm(w.contractMin),
      hm(w.suppMin),
      hm(w.ferieMin),
      hm(w.congesMin),
    ]);
    const sum = (pick: (w: SalaryWeek) => number) => (e.weeks ?? []).reduce((s, w) => s + pick(w), 0);
    const totalRow = [
      "Total", "",
      hm(sum((w) => w.totalMin)), hm(sum((w) => w.contractMin)),
      hm(sum((w) => w.suppMin)), hm(sum((w) => w.ferieMin)), hm(sum((w) => w.congesMin)),
    ];

    autoTable(doc, {
      startY: 70,
      margin: { left: M, right: M },
      head: [["Semaine", "Periode", "Travaillees", "dont contrat", "dont majorees", "Ferie", "Conges"]],
      body: wBody.length > 0 ? wBody : [["—", "Aucune heure saisie ce mois-ci", "—", "—", "—", "—", "—"]],
      foot: wBody.length > 0 ? [totalRow] : undefined,
      theme: "grid",
      styles: { font: "helvetica", fontSize: 9, cellPadding: 5, textColor: [30, 30, 30], lineColor: [225, 225, 225] },
      headStyles: { fillColor: [17, 24, 39], textColor: [255, 255, 255], fontStyle: "bold", halign: "right", fontSize: 8.5 },
      footStyles: { fillColor: [235, 238, 242], textColor: [17, 24, 39], fontStyle: "bold", halign: "right" },
      columnStyles: { 0: { halign: "left", fontStyle: "bold", cellWidth: 60 }, 1: { halign: "left", cellWidth: 130 } },
      bodyStyles: { halign: "right" },
      alternateRowStyles: { fillColor: [247, 248, 250] },
    });

    // Éléments de paie de la personne (primes / frais / AN / note).
    const lines = payLines(monthId, e);
    if (lines.length > 0) {
      let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(17, 24, 39);
      doc.text("Elements de paie", M, y);
      y += 15;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(70, 70, 70);
      for (const line of lines) {
        if (y > bottom - 14) { doc.addPage(); y = M + 10; }
        for (const wrapped of doc.splitTextToSize(ascii(line), W - 2 * M - 12) as string[]) {
          doc.text(wrapped, M + 12, y);
          y += 12;
        }
        y += 2;
      }
    }
  }

  // ── Pied de page (mentions) ──
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(
      "Supp payées = équivalent majoré décidé (+25/+50 %) · fériés toujours payés · AN = forfait mensuel véhicule",
      M, doc.internal.pageSize.getHeight() - 16,
    );
    doc.text(`${i} / ${pageCount}`, W - M, doc.internal.pageSize.getHeight() - 16, { align: "right" });
  }

  return doc;
}
