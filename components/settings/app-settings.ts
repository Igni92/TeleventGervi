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
  /** colorimétrie Or/Agrume/Fraise — clé historique de ColorimetrieSwitcher */
  colorimetrie: "televent-theme",
  /**
   * Densité d'affichage GLOBALE de l'app : "compact" | "normal" | "aere".
   * Pilote l'attribut `data-density` sur <html> (échelle rem racine, cf.
   * globals.css). Clé localStorage HISTORIQUE conservée (`…:ecran2Density`)
   * pour ne pas perdre les valeurs déjà enregistrées : la Console Écran 2 lit
   * exactement la même clé/valeur, donc rien à migrer.
   */
  density: "televente:ecran2Density",
  /** animation/rotation auto du bandeau promos : "on" | "off" (défaut on) */
  promoBannerAnim: "televente:promoBannerAnim",
  /** modale « Nouvelles promotions » à l'ouverture : "on" | "off" (défaut on) */
  promoNotifs: "televente:promoNotifs",
  /**
   * Affichage des logos de marque (console, détail livraison, inventaire) :
   * "on" (défaut) → logos visibles · "off" → masqués partout.
   * Honoré par le hook useBrandLogos (map vide quand off → aucun logo rendu).
   */
  brandLogos: "televente:brandLogos",
  /**
   * Animations d'ambiance globales (aurora, anneaux radar du fond) :
   *   "on"   → animées
   *   "off"  → figées (fond statique)
   *   "auto" → suit prefers-reduced-motion du système (défaut)
   * Honoré par AmbientBackground (attribut `data-reduce-anim` sur <html>).
   */
  animations: "televente:animations",
  /**
   * Contraste de la surbrillance au survol des lignes (0–100). PROPRE À CHAQUE
   * UTILISATEUR : la clé réelle est suffixée par l'identité de session
   * (cf. hoverContrastKey) pour que jm/mm aient chacun leur réglage, même sur
   * un poste partagé. Honoré par HoverContrastGate (var `--hover-contrast` +
   * attribut `data-hover-contrast` sur <html>).
   */
  hoverContrast: "televente:hoverContrast",
} as const;

/** Valeur de contraste de survol par défaut (en %, 0–100). */
export const HOVER_CONTRAST_DEFAULT = 60;

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
  const clamped = Math.max(0, Math.min(100, pct));
  r.style.setProperty("--hover-contrast", String(clamped / 100));
  r.setAttribute("data-hover-contrast", "1");
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
