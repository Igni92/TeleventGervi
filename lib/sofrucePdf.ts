/**
 * ÉTAT DE COMPTE SOFRUCE — génération du VRAI PDF (jsPDF, CÔTÉ NAVIGATEUR).
 * Relevé des entrées marchandises (achats) du fournisseur Sofruce sur une
 * période : la pièce à leur remettre pour qu'ils sachent QUOI NOUS FACTURER.
 * Données : GET /api/sap/sofruce/statement. jsPDF en dynamic import → n'alourdit
 * que l'écran qui l'ouvre (console), pas le reste de l'app.
 */

export interface SofruceLine {
  itemCode: string; itemName: string;
  quantity: number; colis: number | null;
  price: number | null; lineTotal: number;
}
export interface SofruceDoc {
  docEntry: number; docNum: number; docDate: string;
  clientNote: string | null;
  lines: SofruceLine[];
  totalHT: number; totalTVA: number; totalTTC: number;
}
export interface SofruceStatementData {
  cardCode: string; from: string; to: string;
  docs: SofruceDoc[];
  totals: { docs: number; ht: number; tva: number; ttc: number };
}

/** jsPDF n'embarque que le Latin-1 « standard » : tirets/espaces typographiques
 *  remplacés par des caractères ASCII sûrs (même précaution que salairesPdfDoc). */
const ascii = (s: string) => s.replace(/−/g, "-").replace(/—/g, "-").replace(/[  ]/g, " ");

const eur = (n: number) =>
  ascii(`${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const qty = (n: number) =>
  ascii(n.toLocaleString("fr-FR", { maximumFractionDigits: 2 }));
const frDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/** Nom de fichier du PDF de l'état d'une période. */
export function sofrucePdfFilename(from: string, to: string): string {
  return `etat-compte-sofruce-${from}-au-${to}.pdf`;
}

/**
 * Construit le PDF de l'état de compte Sofruce. Retourne l'instance jsPDF
 * (le caller en tire un bloburl pour l'aperçu, ou .save() pour le fichier).
 */
export async function buildSofrucePdf(data: SofruceStatementData): Promise<import("jspdf").jsPDF> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const W = doc.internal.pageSize.getWidth();
  const M = 36;   // marge

  // ── En-tête ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(17, 24, 39);
  doc.text("GERVIFRAIS", M, 42);
  doc.setFontSize(11);
  doc.setTextColor(90, 90, 90);
  doc.text(ascii(`État de compte fournisseur — ${data.cardCode}`), M, 59);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(17, 24, 39);
  doc.text(ascii(`Période du ${frDate(data.from)} au ${frDate(data.to)}`), W - M, 42, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(120, 120, 120);
  doc.text(
    ascii(`Édité le ${new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })}`),
    W - M, 57, { align: "right" },
  );

  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);
  doc.text(
    ascii("Relevé des marchandises reçues (entrées marchandises SAP) sur la période - montants HT à nous facturer."),
    M, 78,
  );

  // ── Tableau — une ligne par article, date/EM/client répétés sur la 1re ligne
  //    de chaque bon (lecture par bon, comme un relevé bancaire). ──
  const head = [["Date", "EM n°", "Vente", "Article", "Colis", "Qté", "PU HT", "Total HT"]];
  const body: string[][] = [];
  for (const d of data.docs) {
    d.lines.forEach((l, i) => {
      body.push([
        i === 0 ? frDate(d.docDate) : "",
        i === 0 ? String(d.docNum) : "",
        i === 0 ? ascii(d.clientNote ?? "-") : "",
        ascii(l.itemName),
        l.colis != null ? qty(l.colis) : "-",
        qty(l.quantity),
        l.price != null ? eur(l.price) : "-",
        eur(l.lineTotal),
      ]);
    });
    if (d.lines.length === 0) {
      body.push([frDate(d.docDate), String(d.docNum), ascii(d.clientNote ?? "-"), "(aucune ligne)", "-", "-", "-", eur(d.totalHT)]);
    }
  }

  autoTable(doc, {
    startY: 90,
    margin: { left: M, right: M },
    head,
    body,
    foot: [[
      { content: ascii(`${data.totals.docs} entrée(s) marchandise`), colSpan: 6, styles: { halign: "left" as const } },
      "TOTAL HT", eur(data.totals.ht),
    ]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 4, textColor: [30, 30, 30], lineColor: [225, 225, 225] },
    headStyles: { fillColor: [17, 24, 39], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8, halign: "right" },
    footStyles: { fillColor: [240, 242, 245], textColor: [17, 24, 39], fontStyle: "bold", fontSize: 9, halign: "right" },
    columnStyles: {
      0: { halign: "left", cellWidth: 52 },
      1: { halign: "left", cellWidth: 44, fontStyle: "bold" },
      2: { halign: "left", cellWidth: 86 },
      3: { halign: "left" },
      4: { halign: "right", cellWidth: 34 },
      5: { halign: "right", cellWidth: 40 },
      6: { halign: "right", cellWidth: 50 },
      7: { halign: "right", cellWidth: 56, fontStyle: "bold" },
    },
    bodyStyles: { halign: "right" },
    alternateRowStyles: { fillColor: [247, 248, 250] },
    didDrawPage: () => {
      const H = doc.internal.pageSize.getHeight();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(140, 140, 140);
      doc.text(
        ascii(`Gervifrais - état de compte ${data.cardCode} - relevé de contrôle, ne vaut pas facture`),
        M, H - 18,
      );
      doc.text(`Page ${doc.getNumberOfPages()}`, W - M, H - 18, { align: "right" });
    },
  });

  // ── Récapitulatif — HT / TVA / TTC (chiffres SAP), sous le tableau ──
  const endY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  let y = endY + 24;
  if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = 60; }
  const line = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 11 : 9.5);
    doc.setTextColor(17, 24, 39);
    doc.text(ascii(label), W - M - 150, y);
    doc.text(value, W - M, y, { align: "right" });
    y += bold ? 20 : 16;
  };
  line("Total HT", eur(data.totals.ht));
  line("TVA", eur(data.totals.tva));
  line("Total TTC", eur(data.totals.ttc), true);

  return doc;
}
