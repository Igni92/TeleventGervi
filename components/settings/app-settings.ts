/**
 * Réglages locaux du poste (localStorage) — source unique des CLÉS et de la
 * mécanique de propagation entre la page /parametres (qui ÉCRIT) et les
 * composants consommateurs (qui LISENT) : PromoBanner, Console Écran 2…
 *
 * Propagation immédiate :
 *   - même onglet  → CustomEvent `televente:setting` (detail { key, value })
 *   - autres onglets → évènement natif `storage` (émis par le navigateur)
 * `onSettingChange` abonne aux deux.
 *
 * NB : la colorimétrie (`televent-theme`) et le mode clair/sombre (`tv-theme`)
 * conservent leur stockage HISTORIQUE (ColorimetrieSwitcher / ThemeProvider) —
 * on ne casse pas les valeurs existantes des postes.
 */

export const SETTING_KEYS = {
  /**
   * Densité d'affichage GLOBALE de l'app : "compact" | "normal" | "aere".
   * Pilote l'attribut `data-density` sur <html> (échelle rem racine, cf.
   * globals.css). Clé localStorage HISTORIQUE conservée (`…:ecran2Density`)
   * pour ne pas perdre les valeurs déjà enregistrées : la Console Écran 2 lit
   * exactement la même clé/valeur, donc rien à migrer.
   */
  density: "televente:ecran2Density",
  /**
   * Zoom d'affichage GLOBAL de l'app — CONFORT VISUEL (accessibilité Direction).
   * Valeurs : "100" | "110" | "125" | "140" (pourcentage). Pilote la variable CSS
   * `--app-zoom` sur <html>, consommée par `.app-zoom-root` (cf. globals.css +
   * app/layout.tsx). "100" = défaut, aucun zoom. Contrairement à la densité (qui
   * ne joue que sur l'air/rem), le zoom agrandit TOUT — texte figé en px compris —
   * exactement comme un zoom navigateur : c'est le levier « je n'y vois rien ».
   */
  uiZoom: "televente:uiZoom",
  /** animation/rotation auto du bandeau promos : "on" | "off" (défaut on) */
  promoBannerAnim: "televente:promoBannerAnim",
  /** modale « Nouvelles promotions » à l'ouverture : "on" | "off" (défaut on) */
  promoNotifs: "televente:promoNotifs",
  /**
   * Affichage des logos de marque, RÉGLABLE PAR ZONE ("on" défaut · "off" masqué).
   * Chacune est indépendante → on peut couper les logos dans la console mais les
   * garder dans l'inventaire, etc. Honoré par useBrandLogos(zone) (map vide → rien).
   */
  brandLogosConsole: "televente:brandLogos:console",
  brandLogosLivraison: "televente:brandLogos:livraison",
  brandLogosInventaire: "televente:brandLogos:inventaire",
  /**
   * Animations d'ambiance globales (aurora, anneaux radar du fond) :
   *   "on"   → animées
   *   "off"  → figées (fond statique)
   *   "auto" → suit prefers-reduced-motion du système (défaut)
   * Honoré par AmbientBackground (attribut `data-reduce-anim` sur <html>).
   */
  animations: "televente:animations",
  /**
   * Effet au clic sur une zone NON interactive (PC uniquement) — feedback
   * ludique, purement décoratif. Valeurs :
   *   "sparks" (défaut) → éclat de particules or ;
   *   "nova"            → supernova (cœur incandescent, croix lens-flare, constellation) ;
   *   "radar"           → ping sonar (réticule, anneaux de scan, balayage rotatif, échos) ;
   *   "ripple"          → onde d'eau (anneaux concentriques) ;
   *   "bloom"           → aurore (halos lumineux diffus teintés marque) ;
   *   "rain"            → cascade 3D (gouttes vitreuses en profondeur qui tombent) ;
   *   "off"             → aucun effet.
   * Les effets "signal" (nova / radar / bloom) suivent la colorimétrie de marque
   * (Or / Agrume / Fraise) via --brand-500. (La valeur historique "on" est traitée
   * comme "sparks".) Honoré par ClickSparks ; coupé d'office par animations=off
   * (data-reduce-anim) et prefers-reduced-motion.
   */
  clickSparks: "televente:clickSparks",
  /**
   * Délai (cooldown) minimal en millisecondes entre deux effets au clic. "0"
   * (défaut) = instantané, spam-clic possible. Une valeur > 0 espace les effets
   * (le clic reste actif, seul l'effet visuel est throttlé). Honoré par ClickSparks.
   */
  clickSparksDelay: "televente:clickSparksDelay",
  /**
   * Célébration « grosse marge » : ON/OFF maître (défaut "on"). Quand une commande
   * est validée avec une marge nette ≥ seuil (cf. celebrationMargin), une pluie de
   * billets / pièces s'abat sur l'écran. Entièrement désactivable ici. Honoré par
   * SaleCelebration + le helper celebrateSale.
   */
  celebration: "televente:celebration",
  /** Seuil de marge nette (en €) déclenchant la célébration. Défaut "200", éditable. */
  celebrationMargin: "televente:celebrationMargin",
  /** Style de la célébration : "bills" | "confetti" | "both" (défaut "both"). */
  celebrationStyle: "televente:celebrationStyle",
  /**
   * Contraste de la surbrillance au survol des lignes (0–100). PROPRE À CHAQUE
   * UTILISATEUR : la clé réelle est suffixée par l'identité de session
   * (cf. hoverContrastKey) pour que jm/mm aient chacun leur réglage, même sur
   * un poste partagé. Honoré par HoverContrastGate (var `--hover-contrast` +
   * attribut `data-hover-contrast` sur <html>).
   */
  hoverContrast: "televente:hoverContrast",
} as const;

/** Valeur de contraste de survol par défaut (en %). */
export const HOVER_CONTRAST_DEFAULT = 60;
/**
 * Plafond du contraste de survol (en %). Relevé de 100 → 200 : la surbrillance
 * est désormais TEINTÉE MARQUE (cf. globals.css) et non plus une simple opacité
 * du gris `--secondary` quasi invisible — au-delà de 100 % elle continue de se
 * renforcer, pour les postes/utilisateurs à faible acuité visuelle (Direction).
 */
export const HOVER_CONTRAST_MAX = 200;

/** Paliers de zoom d'interface proposés (en %). "100" = aucun zoom (défaut). */
export const UI_ZOOM_VALUES = ["100", "110", "125", "140"] as const;
export type UiZoomValue = (typeof UI_ZOOM_VALUES)[number];
export const UI_ZOOM_DEFAULT: UiZoomValue = "100";

/**
 * Applique le zoom d'interface : pose (ou retire) la variable CSS `--app-zoom`
 * sur <html>, consommée par `.app-zoom-root`. Une valeur inconnue retombe sur
 * 100 % (aucun zoom). Robuste côté serveur (no-op si `document` absent).
 */
export function applyUiZoom(pct: string | null): void {
  if (typeof document === "undefined") return;
  const r = document.documentElement;
  const v: UiZoomValue = UI_ZOOM_VALUES.includes(pct as UiZoomValue)
    ? (pct as UiZoomValue)
    : UI_ZOOM_DEFAULT;
  if (v === UI_ZOOM_DEFAULT) r.style.removeProperty("--app-zoom");
  else r.style.setProperty("--app-zoom", String(Number(v) / 100));
}

/**
 * Clé localStorage du contraste de survol POUR UN UTILISATEUR donné. On
 * suffixe par l'e-mail (ou un id) de session : le réglage suit la personne,
 * pas le poste — deux commerciaux sur la même machine gardent chacun le leur.
 */
export function hoverContrastKey(user: string | null | undefined): string {
  const id = (user ?? "").trim().toLowerCase() || "anon";
  return `${SETTING_KEYS.hoverContrast}:${id}`;
}

/**
 * Applique le contraste de survol sur <html> : pose `--hover-contrast` (0–1) et
 * l'attribut `data-hover-contrast` qui active les règles CSS. `null` retire le
 * réglage (retour au rendu Tailwind d'origine).
 */
export function applyHoverContrast(pct: number | null): void {
  if (typeof document === "undefined") return;
  const r = document.documentElement;
  if (pct == null) {
    r.removeAttribute("data-hover-contrast");
    r.style.removeProperty("--hover-contrast");
    return;
  }
  const clamped = Math.max(0, Math.min(HOVER_CONTRAST_MAX, pct));
  r.style.setProperty("--hover-contrast", String(clamped / 100));
  r.setAttribute("data-hover-contrast", "1");
}

/** Seuil de marge nette (en €) par défaut déclenchant la célébration. */
export const CELEBRATION_MARGIN_DEFAULT = 200;

/** Styles de célébration proposés. */
export const CELEBRATION_STYLES = ["bills", "confetti", "both"] as const;
export type CelebrationStyle = (typeof CELEBRATION_STYLES)[number];
export const CELEBRATION_STYLE_DEFAULT: CelebrationStyle = "both";

/** Évènement global émis quand une vente franchit le seuil de marge. */
export const CELEBRATION_EVENT = "televente:celebration";

/** Style de célébration effectif (valeur stockée normalisée). */
export function readCelebrationStyle(v: string | null | undefined): CelebrationStyle {
  return CELEBRATION_STYLES.includes(v as CelebrationStyle)
    ? (v as CelebrationStyle)
    : CELEBRATION_STYLE_DEFAULT;
}

/**
 * Déclenche la célébration « grosse marge » SI :
 *   - la fonction est activée (réglage `celebration` ≠ "off") ;
 *   - la marge nette atteint le seuil (`celebrationMargin`, défaut 200 €) ;
 *   - les animations ne sont pas coupées (data-reduce-anim) ni le système en
 *     prefers-reduced-motion (sauf animations forcées « on »).
 * Émet l'évènement `televente:celebration` (detail { margin, threshold }) consommé
 * par le composant SaleCelebration. No-op côté serveur.
 */
export function celebrateSale(netMargin: number): void {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(netMargin)) return;
  if (readSetting(SETTING_KEYS.celebration, "on") === "off") return;
  const raw = Number(readSetting(SETTING_KEYS.celebrationMargin, String(CELEBRATION_MARGIN_DEFAULT)));
  const threshold = Number.isFinite(raw) ? raw : CELEBRATION_MARGIN_DEFAULT;
  if (netMargin < threshold) return;
  const html = document.documentElement;
  if (html.getAttribute("data-reduce-anim") === "1") return;
  if (html.getAttribute("data-anim") !== "force" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    window.dispatchEvent(
      new CustomEvent(CELEBRATION_EVENT, { detail: { margin: netMargin, threshold } }),
    );
  } catch { /* ignore */ }
}

/** Évènement same-tab émis après chaque écriture via writeSetting. */
export const SETTINGS_EVENT = "televente:setting";

export function readSetting(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Écrit le réglage et notifie l'onglet courant (les autres reçoivent `storage`). */
export function writeSetting(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
  try {
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { key, value } }));
  } catch { /* ignore */ }
}

/**
 * Abonne aux changements de réglages (même onglet + autres onglets).
 * Retourne la fonction de désabonnement.
 */
export function onSettingChange(cb: (key: string, value: string | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onCustom = (e: Event) => {
    const d = (e as CustomEvent<{ key?: string; value?: string }>).detail;
    if (d?.key) cb(d.key, d.value ?? null);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key) cb(e.key, e.newValue);
  };
  window.addEventListener(SETTINGS_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SETTINGS_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}
