/** Libellés + rendu de gabarit pour les documents archivés (partagé cron/UI/envoi). */

export function docTypeLabel(t: string): string {
  switch (t) {
    case "BL": return "Bon de livraison";
    case "FACTURE": return "Facture";
    case "AVOIR": return "Avoir";
    default: return "Document";
  }
}

/** Remplace {{cle}} par vars[cle] (vide si absent). */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return (tpl || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}
