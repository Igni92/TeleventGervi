/* ─────────────────────────────────────────────────────────────
   Utilitaires PARTAGÉS du détail livraison — types, formatters et repères de
   segment, extraits de LivraisonDetail.tsx (découpage en modules, zéro
   changement de comportement).
───────────────────────────────────────────────────────────── */
// Couleurs de segment : source unique du design system (GMS teal · CHR amber · EXPORT violet).
import { SEGMENT_BADGE } from "@/lib/segments";
import type { StatusTab } from "@/lib/livraisonView";

export interface CarrierOption { name: string; sapValue: string }

/** Fiche transporteur (coordonnées) — miroir de /api/transporteurs/fiche. */
export interface CarrierFiche { emails: string[]; phones: { label: string; value: string }[] }

/* ─────────────────────────────────────────────────────────────
   Formatters — instances Intl créées UNE fois (module) : réinstancier un
   NumberFormat à chaque appel coûtait des milliers d'objets par rendu.
───────────────────────────────────────────────────────────── */
const NF_INT = new Intl.NumberFormat("fr-FR");
const NF_NUM = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const NF_EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const fmtInt = (v: number) => NF_INT.format(Math.round(v));
export const fmtNum = (v: number) => NF_NUM.format(v);
export const fmtKg = (v: number) => `${fmtNum(v)} kg`;
export const fmtEur = (v: number) => NF_EUR.format(v);
export const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Normalisation pour la recherche : minuscules, sans accents. */
export const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Heure d'un clic d'état (« fait » / « départ ») — « 14:32 », préfixée du
 *  jour (« 01/07 14:32 ») si le clic date d'un autre jour. */
export const fmtClock = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const now = new Date();
  const sameDay = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  return sameDay ? time : `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${time}`;
};

/** Onglets de la vue : « Ventes » (BL pas encore mis en préparation — réservé au
 *  dispatch) + les 3 états d'avancement (StatusTab, cf. lib/livraisonView).
 *  Les manquants ont leur propre état complet : /manquants. */
export type ViewTab = "VENTES" | StatusTab;

/** Badge de ligne par segment client (CHR / EXPORT / GMS) — repère visuel du
 *  segment, en cohérence avec le filtre Tout / CHR / Export / GMS. Les
 *  couleurs viennent de la source unique du design system (lib/segments). */
export const SEG_UI: Record<"CHR" | "EXPORT" | "GMS", { label: string; badge: string }> = {
  CHR:    { label: "CHR",    badge: SEGMENT_BADGE.CHR },
  EXPORT: { label: "Export", badge: SEGMENT_BADGE.EXPORT },
  GMS:    { label: "GMS",    badge: SEGMENT_BADGE.GMS },
};
