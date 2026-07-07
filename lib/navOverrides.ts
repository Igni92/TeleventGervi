/**
 * PERSONNALISATION de la navigation (sidebar bureau) — renommer une entrée et
 * changer son EMPLACEMENT (groupe + position). Réglage GLOBAL décidé par un
 * admin (poste partagé : pas de personnalisation par utilisateur, cf. charte),
 * persisté en AppSetting (clé `nav:overrides`), consommé par la Sidebar.
 *
 * Fonctions PURES (testables hors React) — l'I/O vit dans
 * app/api/nav-overrides/route.ts et components/settings/NavCustomizer.tsx.
 */

export interface NavItemOverride {
  /** Libellé personnalisé — vide/absent = libellé d'origine. */
  label?: string;
  /** Groupe cible (libellé EXACT d'un groupe existant) — absent = groupe d'origine. */
  group?: string;
  /** Position dans le groupe (croissant) — absent = ordre d'origine. */
  order?: number;
}

/** Surcharges par route (clé = href de l'entrée). */
export type NavOverrides = Record<string, NavItemOverride>;

export const NAV_OVERRIDES_KEY = "nav:overrides";

export interface NavGroupLike<T extends { href: string; label: string }> {
  label: string | null;
  items: T[];
  collapsible?: boolean;
}

/**
 * Applique les surcharges à la structure de navigation par défaut :
 *   • libellé remplacé si `label` non vide ;
 *   • entrée déplacée si `group` correspond à un groupe existant ;
 *   • tri par `order` (repli : position d'origine) dans chaque groupe.
 * Le groupe SANS libellé (Accueil) n'est jamais touché ; un groupe vidé
 * disparaît. Pure : ne mute ni les groupes ni les items d'entrée.
 */
export function applyNavOverrides<T extends { href: string; label: string }>(
  groups: NavGroupLike<T>[],
  overrides: NavOverrides,
): NavGroupLike<T>[] {
  const groupLabels = new Set(groups.map((g) => g.label).filter((l): l is string => !!l));
  const buckets = new Map<string | null, { item: T; order: number; idx: number }[]>();
  for (const g of groups) buckets.set(g.label, []);
  let idx = 0;
  for (const g of groups) {
    g.items.forEach((item, i) => {
      const ov = g.label ? overrides[item.href] : undefined;   // groupe Accueil : intouchable
      const label = ov?.label?.trim() || item.label;
      const target = ov?.group && groupLabels.has(ov.group) ? ov.group : g.label;
      const order = typeof ov?.order === "number" && Number.isFinite(ov.order) ? ov.order : i;
      buckets.get(target)!.push({ item: label === item.label ? item : { ...item, label }, order, idx: idx++ });
    });
  }
  return groups
    .map((g) => ({
      ...g,
      items: (buckets.get(g.label) ?? [])
        .sort((a, b) => a.order - b.order || a.idx - b.idx)
        .map((e) => e.item),
    }))
    .filter((g) => g.items.length > 0);
}

/* ── État d'ÉDITION (mode modification de la sidebar) ─────────────────────
   Représentation éditable de la nav : groupes nommés + lignes { libellé
   saisi, libellé/groupe d'origine }. Pures et symétriques :
   toEditState(overrides) ⇄ fromEditState(state). */

export interface NavEditRow {
  href: string;
  defaultLabel: string;
  defaultGroup: string;
  /** Libellé SAISI ("" = libellé d'origine). */
  label: string;
}
export interface NavEditGroup { label: string; rows: NavEditRow[] }

/** Construit l'état d'édition depuis la structure par défaut + surcharges.
 *  Le groupe sans libellé (Accueil) est exclu (non personnalisable). */
export function toEditState<T extends { href: string; label: string }>(
  groups: NavGroupLike<T>[],
  overrides: NavOverrides,
): NavEditGroup[] {
  const defaultGroupByHref = new Map<string, string>();
  const defaultLabelByHref = new Map<string, string>();
  for (const g of groups) {
    if (!g.label) continue;
    for (const it of g.items) {
      defaultGroupByHref.set(it.href, g.label);
      defaultLabelByHref.set(it.href, it.label);
    }
  }
  return applyNavOverrides(groups, overrides)
    .filter((g): g is NavGroupLike<T> & { label: string } => !!g.label)
    .map((g) => ({
      label: g.label,
      rows: g.items.map((it) => ({
        href: it.href,
        defaultLabel: defaultLabelByHref.get(it.href) ?? it.label,
        defaultGroup: defaultGroupByHref.get(it.href) ?? g.label,
        label: overrides[it.href]?.label ?? "",
      })),
    }));
}

/** Reconstruit les surcharges depuis l'état d'édition : ordre EXPLICITE pour
 *  toutes les entrées (déterministe), libellé/groupe seulement s'ils diffèrent. */
export function fromEditState(state: NavEditGroup[]): NavOverrides {
  const out: NavOverrides = {};
  for (const g of state) {
    g.rows.forEach((row, i) => {
      const ov: NavItemOverride = { order: i };
      if (row.label.trim() && row.label.trim() !== row.defaultLabel) ov.label = row.label.trim();
      if (g.label !== row.defaultGroup) ov.group = g.label;
      out[row.href] = ov;
    });
  }
  return out;
}

/** Valide/normalise un payload de surcharges (PUT) — champs inconnus ignorés,
 *  chaînes bornées, entrées vides retirées. Ne jette jamais. */
export function sanitizeNavOverrides(raw: unknown): NavOverrides {
  const out: NavOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [href, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!href.startsWith("/") || href.length > 64 || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const ov: NavItemOverride = {};
    if (typeof o.label === "string" && o.label.trim()) ov.label = o.label.trim().slice(0, 40);
    if (typeof o.group === "string" && o.group.trim()) ov.group = o.group.trim().slice(0, 30);
    if (typeof o.order === "number" && Number.isFinite(o.order)) ov.order = Math.max(0, Math.min(99, Math.round(o.order)));
    if (Object.keys(ov).length) out[href] = ov;
  }
  return out;
}
