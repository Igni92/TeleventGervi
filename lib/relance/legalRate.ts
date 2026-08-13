/**
 * TAUX D'INTÉRÊT LÉGAL (créances professionnelles / « autres cas ») — sélection
 * AUTOMATIQUE par SEMESTRE.
 *
 * Le taux légal est recalculé chaque semestre par la Banque de France et publié
 * par arrêté au Journal officiel. Il n'existe PAS d'API libre exploitable (les
 * pages officielles bloquent les requêtes automatiques, la Banque de France
 * exige une clé) → plutôt qu'un scraper fragile, on maintient ici la table des
 * taux officiels par semestre. `legalRateForDate` renvoie le taux en vigueur à
 * une date donnée, sans redéploiement possible via la clé AppSetting
 * `relance_taux_interet_legal` (cf. lib/relance/params) qui prime sur la table.
 *
 * ⚠️ À COMPLÉTER à chaque nouveau semestre (source : economie.gouv.fr / JO), OU
 * simplement fixer la clé `relance_taux_interet_legal` le jour de la publication.
 */

/** Taux LÉGAL annuel (fraction) pour « autres cas » (entreprises), par semestre.
 *  REPLI codé en dur : la source de vérité est désormais l'API Banque de France
 *  (cf. lib/relance/bdfLegalRate), fusionnée PAR-DESSUS cette table. Ces valeurs
 *  ne servent que si l'API est indisponible ET qu'aucun cache n'existe. */
export const LEGAL_RATE_BY_SEMESTER: Record<string, number> = {
  "2025-S1": 0.0761,
  "2025-S2": 0.0654,
  "2026-S1": 0.0262,
  "2026-S2": 0.0275,
};

/** Clé de semestre « YYYY-S1 | YYYY-S2 » d'une date, calculée en Europe/Paris. */
export function semesterKey(d: Date): string {
  // Audit 2026-08-13 (#21) : getUTCFullYear/getUTCMonth plaçaient une pénalité
  // émise entre minuit et 02h (heure de Paris) les 1er janv. / 1er juil. sur le
  // MAUVAIS semestre — encore l'UTC de la veille, donc l'ancien taux légal. On
  // lit l'année et le mois CIVILS français.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" })
      .formatToParts(d).map((p) => [p.type, p.value]),
  );
  const y = Number(parts.year);
  const month = Number(parts.month); // 1–12 (heure française)
  const s = month <= 6 ? "S1" : "S2";
  return `${y}-${s}`;
}

/**
 * Taux légal en vigueur à `d` selon une table semestre → fraction donnée : la
 * valeur du semestre de `d`, sinon le dernier semestre connu ANTÉRIEUR (repli si
 * la table n'a pas encore le semestre courant). `null` si la table est vide.
 * PURE (testable) — la table vient de l'API BdF (cache) fusionnée sur le repli.
 */
export function legalRateFromTable(d: Date, table: Record<string, number>): number | null {
  const key = semesterKey(d);
  if (table[key] != null) return table[key];
  const known = Object.keys(table).filter((k) => k <= key).sort();
  const last = known[known.length - 1];
  return last ? table[last] : null;
}

/** Taux légal en vigueur à `d` d'après la table de REPLI codée en dur (sans API).
 *  Conservé pour compat/tests ; le flux réel passe par legalRateFromTable +
 *  getLegalRateTable (API BdF). */
export function legalRateForDate(d: Date): number | null {
  return legalRateFromTable(d, LEGAL_RATE_BY_SEMESTER);
}
