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
  /** densité de la liste stock Écran 2 : "compact" | "normal" | "aere" */
  ecran2Density: "televente:ecran2Density",
  /** animation/rotation auto du bandeau promos : "on" | "off" (défaut on) */
  promoBannerAnim: "televente:promoBannerAnim",
  /** modale « Nouvelles promotions » à l'ouverture : "on" | "off" (défaut on) */
  promoNotifs: "televente:promoNotifs",
  /**
   * Animations d'ambiance globales (aurora, anneaux radar du fond) :
   *   "on"   → animées
   *   "off"  → figées (fond statique)
   *   "auto" → suit prefers-reduced-motion du système (défaut)
   * Honoré par AmbientBackground (attribut `data-reduce-anim` sur <html>).
   */
  animations: "televente:animations",
} as const;

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
