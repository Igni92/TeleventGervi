/**
 * ÉTAT COMPTABLE — génération du VRAI PDF (jsPDF, CÔTÉ NAVIGATEUR). Le document
 * mensuel (heures de l'équipe + éléments de paie) est produit en A4 paysage,
 * puis soit prévisualisé (blob), soit envoyé en pièce jointe au cabinet (base64
 * posté au serveur, cf. app/api/salaires « send »). jsPDF est importé en dynamic
 * import → il n'alourdit QUE la page /salaires, pas le reste de l'app.
 */
import { fmtHM } from "./heuresCalc";
import { salaireMonthLabel, type SalaryFrais, type SalaryHeures, type SalaryPrime, type VehiculeAN } from "./salaires";

export interface PdfEmploye {
  name: string;
  heures: SalaryHeures;
  anMensuel: number;
  vehicule: VehiculeAN | null;
  primes: SalaryPrime[];
  frais: SalaryFrais[];
  note?: string;
}

const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
const jours = (n: number) => (n > 0 ? `${n} j` : "—");
const hm = (m: number) => (m > 0 ? fmtHM(m) : "—");
/** jsPDF n'embarque que le Latin-1 « standard » : le « − » (U+2212) de fmtHM et
 *  les fines/insécables passent mal → on retombe sur des caractères ASCII sûrs. */
const ascii = (s: string) => s.replace(/−/g, "-").replace(/[  ]/g, " ");

/** Lignes de détail (primes / frais / AN / note) d'un salarié, ou []. */
function detailLines(monthId: string, e: PdfEmploye): string[] {
  return [
    ...e.primes.map((p: SalaryPrime) =>
      `Prime — ${p.motif} : ${eur(p.montant)}${p.bulletinDe && p.bulletinDe !== monthId ? ` (bulletin de ${salaireMonthLabel(p.bulletinDe)})` : ""}${p.note ? ` — ${p.note}` : ""}`),
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

  // ── Détails (primes / frais / AN / notes) ──
  const detailed = employes.map((e) => ({ name: e.name, lines: detailLines(monthId, e) })).filter((d) => d.lines.length > 0);
  if (detailed.length > 0) {
    let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22;
    const bottom = doc.internal.pageSize.getHeight() - M;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(17, 24, 39);
    doc.text("Détails", M, y);
    y += 14;
    for (const d of detailed) {
      if (y > bottom - 24) { doc.addPage(); y = M + 10; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(40, 40, 40);
      doc.text(ascii(d.name), M, y);
      y += 12;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(90, 90, 90);
      for (const line of d.lines) {
        if (y > bottom - 14) { doc.addPage(); y = M + 10; }
        for (const wrapped of doc.splitTextToSize(ascii(line), W - 2 * M - 12) as string[]) {
          doc.text(wrapped, M + 12, y);
          y += 11;
        }
      }
      y += 6;
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
