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
  /** Catégorie parente (rendu indenté) — absent/null = catégorie de 1er niveau. */
  parent?: string | null;
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
export interface NavEditGroup {
  label: string;
  rows: NavEditRow[];
  /** Catégorie parente (sous-catégorie, une seule profondeur) — absent = 1er niveau. */
  parent?: string | null;
  /** Catégorie CRÉÉE par l'admin (renommable / supprimable) vs. groupe d'origine. */
  custom?: boolean;
}

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

/* ── Réordonnancement glisser-déposer (pur) ──────────────────────────────
   Deux gestes : INSÉRER une ligne avant une autre (ou en fin d'un groupe), et
   ÉCHANGER deux lignes (« remplacer » une zone occupée). Clé = href (stable,
   robuste au décalage d'indices). */

/** Déplace la ligne `href` DANS le groupe `toGroup`, insérée AVANT `beforeHref`
 *  (ou en fin de groupe si `beforeHref` est null). Pur ; no-op si href absent,
 *  si le groupe cible n'existe pas, ou si on la lâche sur elle-même. */
export function moveNavRowBefore(
  state: NavEditGroup[], href: string, toGroup: string, beforeHref: string | null,
): NavEditGroup[] {
  if (href === beforeHref) return state;
  let row: NavEditRow | null = null;
  const without = state.map((g) => {
    const found = g.rows.find((r) => r.href === href);
    if (!found) return g;
    row = found;
    return { ...g, rows: g.rows.filter((r) => r.href !== href) };
  });
  if (!row || !state.some((g) => g.label === toGroup)) return state;
  return without.map((g) => {
    if (g.label !== toGroup) return g;
    const rows = g.rows.slice();
    const at = beforeHref ? rows.findIndex((r) => r.href === beforeHref) : -1;
    rows.splice(at < 0 ? rows.length : at, 0, row!);
    return { ...g, rows };
  });
}

/** Échange les positions de deux lignes (même groupe ou groupes différents).
 *  Pur ; no-op si l'une des deux est introuvable. « Remplace » = échange. */
export function swapNavRows(state: NavEditGroup[], aHref: string, bHref: string): NavEditGroup[] {
  if (aHref === bHref) return state;
  const locate = (href: string) => {
    for (let gi = 0; gi < state.length; gi++) {
      const ri = state[gi].rows.findIndex((r) => r.href === href);
      if (ri >= 0) return { gi, ri };
    }
    return null;
  };
  const a = locate(aHref), b = locate(bHref);
  if (!a || !b) return state;
  const next = state.map((g) => ({ ...g, rows: g.rows.slice() }));
  const tmp = next[a.gi].rows[a.ri];
  next[a.gi].rows[a.ri] = next[b.gi].rows[b.ri];
  next[b.gi].rows[b.ri] = tmp;
  return next;
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

/* ══ CATÉGORIES & SOUS-CATÉGORIES ═══════════════════════════════════════════
   En plus de renommer/déplacer les entrées, l'admin peut CRÉER ses propres
   catégories (groupes de 1er niveau) et sous-catégories (une seule profondeur).
   La config persistée devient { items, categories } — les catégories VIDES
   (fraîchement créées) doivent survivre, d'où une liste explicite (on ne peut
   pas la déduire des seules entrées). Rétrocompatible : l'ancien format (des
   surcharges d'items nues) est lu comme { items, categories: [] }.
   ─────────────────────────────────────────────────────────────────────────── */

export interface NavCategoryDef {
  label: string;
  /** Catégorie parente (une seule profondeur) — absent = catégorie de 1er niveau. */
  parent?: string;
  /** Position (croissant) parmi ses pairs. */
  order?: number;
}
export interface NavConfig {
  items: NavOverrides;
  categories: NavCategoryDef[];
}

/** Normalise la liste des catégories : libellés bornés & uniques, parent qui
 *  doit exister, une seule profondeur (parent d'un parent → aplati). */
export function sanitizeNavCategories(raw: unknown): NavCategoryDef[] {
  if (!Array.isArray(raw)) return [];
  const out: NavCategoryDef[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim().slice(0, 30) : "";
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const def: NavCategoryDef = { label };
    if (typeof o.parent === "string" && o.parent.trim() && o.parent.trim() !== label) def.parent = o.parent.trim().slice(0, 30);
    if (typeof o.order === "number" && Number.isFinite(o.order)) def.order = Math.max(0, Math.min(99, Math.round(o.order)));
    out.push(def);
  }
  const byLabel = new Map(out.map((c) => [c.label, c]));
  for (const c of out) if (c.parent && !byLabel.has(c.parent)) delete c.parent;      // parent inexistant
  for (const c of out) if (c.parent && byLabel.get(c.parent)!.parent) delete c.parent; // 1 seule profondeur
  return out;
}

/** Lit la valeur persistée (rétrocompat avec l'ancien format nu). Ne jette jamais. */
export function toNavConfig(raw: unknown): NavConfig {
  if (raw && typeof raw === "object" && "items" in (raw as Record<string, unknown>)) {
    const o = raw as { items?: unknown; categories?: unknown };
    return { items: sanitizeNavOverrides(o.items), categories: sanitizeNavCategories(o.categories) };
  }
  return { items: sanitizeNavOverrides(raw), categories: [] };
}

/** Sérialise pour la persistance (PUT) — mêmes garde-fous que les sanitizers. */
export function sanitizeNavConfig(raw: unknown): NavConfig {
  return toNavConfig(raw);
}

/* ── Construction interne : place les entrées dans leur catégorie, ordonne les
      catégories (1er niveau, chacune suivie de ses sous-catégories), en gardant
      les catégories VIDES. Base commune du rendu et de l'état d'édition. ── */
interface LayoutRow<T> { item: T; href: string; origLabel: string; origGroup: string; labelOverride: string }
interface BuiltCat<T> { label: string; parent: string | null; builtin: boolean; rows: LayoutRow<T>[] }

function buildNavLayout<T extends { href: string; label: string }>(
  groups: NavGroupLike<T>[], config: NavConfig,
): BuiltCat<T>[] {
  const overrides = config.items;
  const named = groups.filter((g): g is NavGroupLike<T> & { label: string } => !!g.label);
  const builtinLabels = new Set(named.map((g) => g.label));

  const buckets = new Map<string, LayoutRow<T>[]>();
  const ensure = (l: string) => { let b = buckets.get(l); if (!b) { b = []; buckets.set(l, b); } return b; };
  for (const g of named) ensure(g.label);                    // catégories d'origine (même vidées)
  for (const c of config.categories) ensure(c.label);        // catégories créées (même vides)

  // Placement des entrées (tri par order puis position d'origine).
  const placed: { row: LayoutRow<T>; target: string; order: number; idx: number }[] = [];
  let idx = 0;
  for (const g of named) {
    g.items.forEach((item, i) => {
      const ov = overrides[item.href];
      const labelOverride = ov?.label?.trim() ? ov.label!.trim() : "";
      const target = ov?.group?.trim() || g.label;
      const order = typeof ov?.order === "number" && Number.isFinite(ov.order) ? ov.order : i;
      placed.push({ row: { item, href: item.href, origLabel: item.label, origGroup: g.label, labelOverride }, target, order, idx: idx++ });
    });
  }
  placed.sort((a, b) => a.order - b.order || a.idx - b.idx);
  for (const p of placed) ensure(p.target).push(p.row);

  // Métadonnées de catégorie : parent + ordre (built-ins d'abord, puis config).
  const meta = new Map<string, { parent: string | null; order: number; seq: number }>();
  let seq = 0;
  named.forEach((g, i) => meta.set(g.label, { parent: null, order: i, seq: seq++ }));
  for (const c of config.categories) {
    const prev = meta.get(c.label);
    meta.set(c.label, { parent: c.parent ?? null, order: c.order ?? prev?.order ?? 999, seq: prev?.seq ?? seq++ });
  }
  for (const label of buckets.keys()) if (!meta.has(label)) meta.set(label, { parent: null, order: 999, seq: seq++ });
  // Parent doit exister & une seule profondeur.
  for (const [, m] of meta) {
    if (m.parent && !meta.has(m.parent)) m.parent = null;
    if (m.parent && meta.get(m.parent)!.parent) m.parent = null;
  }

  const cmp = (a: string, b: string) => (meta.get(a)!.order - meta.get(b)!.order) || (meta.get(a)!.seq - meta.get(b)!.seq);
  const topLevels = [...meta.keys()].filter((l) => !meta.get(l)!.parent).sort(cmp);
  const out: BuiltCat<T>[] = [];
  for (const top of topLevels) {
    out.push({ label: top, parent: null, builtin: builtinLabels.has(top), rows: buckets.get(top) ?? [] });
    const subs = [...meta.keys()].filter((l) => meta.get(l)!.parent === top).sort(cmp);
    for (const sub of subs) out.push({ label: sub, parent: top, builtin: builtinLabels.has(sub), rows: buckets.get(sub) ?? [] });
  }
  return out;
}

/** Applique la config (surcharges + catégories) pour le RENDU de la sidebar.
 *  Catégories vides retirées — mais une catégorie de 1er niveau reste si elle a
 *  au moins une sous-catégorie visible (elle sert d'en-tête). Le groupe Accueil
 *  (sans libellé) est intouché et reste en tête. */
export function applyNavConfig<T extends { href: string; label: string }>(
  groups: NavGroupLike<T>[], config: NavConfig,
): NavGroupLike<T>[] {
  const accueil = groups.filter((g) => !g.label);
  const collapsibleOf = new Map(groups.filter((g) => g.label).map((g) => [g.label as string, !!g.collapsible]));
  const layout = buildNavLayout(groups, config);
  const topRenders = new Map<string, boolean>();
  for (const c of layout) if (c.parent === null) topRenders.set(c.label, c.rows.length > 0);
  for (const c of layout) if (c.parent && c.rows.length > 0) topRenders.set(c.parent, true);

  const out: NavGroupLike<T>[] = [...accueil];
  for (const c of layout) {
    if (c.parent === null ? !topRenders.get(c.label) : c.rows.length === 0) continue;
    out.push({
      label: c.label,
      items: c.rows.map((r) => (r.labelOverride ? { ...r.item, label: r.labelOverride } : r.item)),
      collapsible: c.parent === null ? (collapsibleOf.get(c.label) || undefined) : undefined,
      parent: c.parent,
    });
  }
  return out;
}

/** État d'ÉDITION depuis la config — inclut les catégories VIDES (créées mais
 *  encore sans entrée) pour pouvoir y glisser des lignes. Accueil exclu. */
export function toNavEditState<T extends { href: string; label: string }>(
  groups: NavGroupLike<T>[], config: NavConfig,
): NavEditGroup[] {
  return buildNavLayout(groups, config).map((c) => ({
    label: c.label,
    parent: c.parent,
    custom: !c.builtin,
    rows: c.rows.map((r) => ({ href: r.href, defaultLabel: r.origLabel, defaultGroup: r.origGroup, label: r.labelOverride })),
  }));
}

/** Reconstruit la config depuis l'état d'édition : ordre EXPLICITE partout
 *  (catégories & entrées), parent conservé, libellé/groupe seulement si écart. */
export function fromNavEditState(state: NavEditGroup[]): NavConfig {
  const items: NavOverrides = {};
  const categories: NavCategoryDef[] = [];
  state.forEach((g, gi) => {
    const def: NavCategoryDef = { label: g.label, order: gi };
    if (g.parent) def.parent = g.parent;
    categories.push(def);
    g.rows.forEach((row, i) => {
      const ov: NavItemOverride = { order: i };
      if (row.label.trim() && row.label.trim() !== row.defaultLabel) ov.label = row.label.trim();
      if (g.label !== row.defaultGroup) ov.group = g.label;
      items[row.href] = ov;
    });
  });
  return { items, categories };
}

/* ── Opérations de catégorie (pures) sur l'état d'édition ─────────────────── */

function uniqueCatLabel(state: NavEditGroup[], base: string): string {
  const root = (base.trim().slice(0, 30) || "Catégorie");
  const has = (x: string) => state.some((g) => g.label === x);
  if (!has(root)) return root;
  for (let n = 2; n < 99; n++) { const c = `${root} ${n}`.slice(0, 30); if (!has(c)) return c; }
  return `${root}·${state.length}`.slice(0, 30);
}

/** Ajoute une catégorie de 1er niveau (vide) en fin de liste. */
export function addNavCategory(state: NavEditGroup[], label = "Nouvelle catégorie"): NavEditGroup[] {
  return [...state, { label: uniqueCatLabel(state, label), parent: null, custom: true, rows: [] }];
}

/** Ajoute une sous-catégorie (vide) sous `parentLabel`, juste après son bloc.
 *  No-op si le parent n'existe pas ou est déjà une sous-catégorie. */
export function addNavSubCategory(state: NavEditGroup[], parentLabel: string, label = "Nouvelle sous-catégorie"): NavEditGroup[] {
  const parent = state.find((g) => g.label === parentLabel);
  if (!parent || parent.parent) return state;
  const next = state.slice();
  let at = next.findIndex((g) => g.label === parentLabel) + 1;
  while (at < next.length && next[at].parent === parentLabel) at++;
  next.splice(at, 0, { label: uniqueCatLabel(state, label), parent: parentLabel, custom: true, rows: [] });
  return next;
}

/** Renomme une catégorie (met à jour le parent des sous-catégories). No-op sur
 *  libellé vide ou collision. */
export function renameNavCategory(state: NavEditGroup[], label: string, newLabel: string): NavEditGroup[] {
  const l = newLabel.trim().slice(0, 30);
  if (!l || l === label) return l ? state.map((g) => (g.label === label ? { ...g, label: l } : g.parent === label ? { ...g, parent: l } : g)) : state;
  if (state.some((g) => g.label !== label && g.label === l)) return state;
  return state.map((g) => (g.label === label ? { ...g, label: l } : g.parent === label ? { ...g, parent: l } : g));
}

/** Supprime une catégorie — uniquement si VIDE et sans sous-catégorie. */
export function deleteNavCategory(state: NavEditGroup[], label: string): NavEditGroup[] {
  const g = state.find((x) => x.label === label);
  if (!g || g.rows.length > 0 || state.some((x) => x.parent === label)) return state;
  return state.filter((x) => x.label !== label);
}

/** Réordonne une catégorie parmi ses pairs (1er niveau : déplace tout le bloc
 *  catégorie + ses sous-catégories ; sous-catégorie : parmi les sœurs). */
export function moveNavCategory(state: NavEditGroup[], label: string, dir: -1 | 1): NavEditGroup[] {
  const tops = state.filter((g) => !g.parent);
  const tree = tops.map((cat) => ({ cat, subs: state.filter((g) => g.parent === cat.label) }));
  const flatten = () => tree.flatMap((n) => [n.cat, ...n.subs]);
  const ti = tree.findIndex((n) => n.cat.label === label);
  if (ti >= 0) {
    const j = ti + dir;
    if (j < 0 || j >= tree.length) return state;
    [tree[ti], tree[j]] = [tree[j], tree[ti]];
    return flatten();
  }
  for (const n of tree) {
    const si = n.subs.findIndex((s) => s.label === label);
    if (si >= 0) {
      const j = si + dir;
      if (j < 0 || j >= n.subs.length) return state;
      [n.subs[si], n.subs[j]] = [n.subs[j], n.subs[si]];
      return flatten();
    }
  }
  return state;
}
