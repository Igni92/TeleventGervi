/**
 * Heure de PRISE d'une commande SAP → ISO local SANS fuseau
 * ("YYYY-MM-DDTHH:MM:00"), pour l'affichage « Prise · HH:MM » de l'écran
 * Expéditions. L'heure SAP est locale (entrepôt) : on la garde telle quelle,
 * `new Date()` la relit sans décalage.
 *
 * Partagé entre l'API livraisons (chemin live) ET le miroir (lib/sapMirror
 * précalcule `takenAt`) : les deux DOIVENT produire des chaînes identiques au
 * caractère près, sinon le miroir divergerait de la lecture live.
 *
 * `time` accepte "HH:MM…" (string) ou HHMM (number, ex. 932 = 09:32).
 */
export function sapCreationISO(date?: string, time?: string | number | null): string | null {
  const day = (date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  let hh: number, mm: number;
  const t = time ?? "";
  if (typeof t === "string" && /^\d{1,2}:\d{2}/.test(t)) {
    const [h, m] = t.split(":");
    hh = Number(h); mm = Number(m);
  } else if (String(t).trim() !== "" && Number.isFinite(Number(t))) {
    const n = Number(t);
    hh = Math.floor(n / 100); mm = n % 100;
  } else {
    return null;
  }
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh > 23 || mm > 59) return null;
  const p = (x: number) => String(x).padStart(2, "0");
  return `${day}T${p(hh)}:${p(mm)}:00`;
}
