"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import {
  BadgePercent, ChevronLeft, ChevronRight, Gift,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SETTING_KEYS, onSettingChange, readSetting } from "@/components/settings/app-settings";
import { PromoNotifications } from "@/components/promos/PromoNotifications";
import {
  ActivePromo, promoChip, promoTitre,
} from "@/components/promos/promo-utils";

/**
 * Bandeau promotions — opérations commerciales en cours, toujours sous les yeux
 * du vendeur (accueil + écrans de commande). 100 % autonome : fetch, réglages,
 * état — aucune prop requise.
 *
 *   <PromoBanner context="accueil" />   ← posé par l'agent Accueil (plus riche)
 *   <PromoBanner context="commande" />  ← posé par l'agent Console (plus dense)
 *
 * Comportement :
 *   - 1 promo affichée à la fois : chip type/prix (−10 % / 5+1 / 1,50 €),
 *     libellé et badge « NOUVEAU » tant que non consultée (PromoSeen).
 *     Bandeau volontairement compact : article, période et argumentaire retirés.
 *   - Rotation auto ~6 s (transition douce framer-motion), pause au survol,
 *     boutons ‹ › TOUJOURS présents.
 *   - Réglage televente:promoBannerAnim = "off" (page /parametres) ou
 *     prefers-reduced-motion → AUCUNE animation ni rotation auto, mais le
 *     bandeau RESTE VISIBLE (navigation manuelle ‹ ›). Jamais obligatoire.
 *   - Clic → /promos (fiche) ; consultation = le badge « NOUVEAU » tombe.
 *   - Monte la modale PromoNotifications (promos démarrées depuis la dernière
 *     visite) si televente:promoNotifs ≠ "off".
 *   - Aucune promo active → return null.
 */

const ROTATE_MS = 6000;

export function PromoBanner({
  context = "accueil",
  className,
}: { context?: "accueil" | "commande"; className?: string }) {
  const reduce = useReducedMotion();
  // null = chargement en cours (rien d'affiché — pas de saut de layout au retour vide)
  const [promos, setPromos] = useState<ActivePromo[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [animPref, setAnimPref] = useState(true);
  const [notifsPref, setNotifsPref] = useState(true);

  // Réglages locaux (page /parametres) + propagation immédiate inter-onglets.
  useEffect(() => {
    setAnimPref(readSetting(SETTING_KEYS.promoBannerAnim, "on") !== "off");
    setNotifsPref(readSetting(SETTING_KEYS.promoNotifs, "on") !== "off");
    return onSettingChange((key, value) => {
      if (key === SETTING_KEYS.promoBannerAnim) setAnimPref(value !== "off");
      if (key === SETTING_KEYS.promoNotifs) setNotifsPref(value !== "off");
    });
  }, []);

  // Chargement : promos actives (+ itemName/pitch) et statut « nouvelle ».
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [pRes, nRes] = await Promise.all([
          fetch("/api/promos?active=1", { cache: "no-store" }),
          fetch("/api/notifications", { cache: "no-store" }),
        ]);
        const pJson = await pRes.json().catch(() => ({}));
        const nJson = await nRes.json().catch(() => ({}));
        const newIds = new Set(
          ((nJson?.notifications ?? []) as { promoId?: string; isNew?: boolean }[])
            .filter((n) => n.isNew && typeof n.promoId === "string")
            .map((n) => n.promoId as string),
        );
        const list = ((pJson?.promos ?? []) as ActivePromo[]).map((p) => ({
          ...p,
          isNew: newIds.has(p.id),
        }));
        // Mise en avant : les nouvelles d'abord (tri stable, ordre createdAt DESC conservé).
        list.sort((a, b) => Number(b.isNew ?? false) - Number(a.isNew ?? false));
        if (alive) setPromos(list);
      } catch {
        if (alive) setPromos([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  const count = promos?.length ?? 0;
  // Animation effective : préférence ET reduced-motion respectés.
  const animOn = animPref && !reduce;

  // Rotation auto ~6 s — uniquement si animée, non survolée et > 1 promo.
  useEffect(() => {
    if (!animOn || paused || count <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % count), ROTATE_MS);
    return () => clearInterval(t);
  }, [animOn, paused, count]);

  // Index toujours dans les bornes si la liste évolue.
  useEffect(() => {
    if (idx >= count && count > 0) setIdx(0);
  }, [count, idx]);

  /** Fait tomber le badge « NOUVEAU » localement (après POST seen). */
  const clearNew = useCallback((ids: string[]) => {
    setPromos((cur) =>
      cur ? cur.map((p) => (ids.includes(p.id) ? { ...p, isNew: false } : p)) : cur,
    );
  }, []);

  /** Consultation par clic bandeau → marque vu côté serveur + badge tombé. */
  const consult = useCallback((p: ActivePromo) => {
    if (!p.isNew) return;
    clearNew([p.id]);
    fetch("/api/notifications/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promoId: p.id }),
    }).catch(() => { /* best-effort */ });
  }, [clearNew]);

  if (!promos || count === 0) return null;

  const current = promos[Math.min(idx, count - 1)];
  const compact = context === "commande";
  const titre = promoTitre(current);

  // Ticker BFM : on remplit une séquence assez large (≥ container même avec peu
  // de promos) puis on la duplique → boucle sans couture (translateX 0 → -50 %).
  // Vitesse ~constante via une durée proportionnelle au nombre d'items.
  const fill = Math.max(1, Math.ceil(6 / count));
  const seq = Array.from({ length: fill }, () => promos).flat();
  const marqueeDur = Math.max(18, seq.length * (compact ? 4.5 : 5.5));

  const contenu = (
    <Link
      href="/promos"
      onClick={() => consult(current)}
      title="Voir la fiche promo"
      className="group flex items-center gap-2 min-w-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-400 rounded-md"
    >
      {/* Chip type / prix — même signature visuelle que /promos et l'Écran 2 */}
      <span className={cn(
        "inline-flex justify-center items-center px-1.5 rounded-[5px] font-bold shrink-0 bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-400/70 dark:bg-rose-500/30 dark:text-rose-100 dark:ring-rose-400/60",
        compact ? "h-[20px] min-w-[52px] text-[11.5px]" : "h-[22px] min-w-[60px] text-[12.5px]",
      )}>
        {(current.kind === "X_PLUS_Y" || current.kind === "FREE") && <Gift className="h-3 w-3 mr-1" />}
        {promoChip(current)}
      </span>

      {current.isNew && (
        <span className={cn(
          "shrink-0 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-[0.08em] bg-amber-400 text-black",
          animOn && "animate-pulse",
        )}>
          Nouveau
        </span>
      )}

      {/* Libellé seul — article, période et argumentaire retirés */}
      <span className={cn(
        "min-w-0 flex-1 font-semibold text-foreground truncate group-hover:text-rose-400 transition-colors",
        compact ? "text-[13px]" : "text-[14px]",
      )}>
        {titre}
      </span>
    </Link>
  );

  return (
    <section
      role="region"
      aria-label="Promotions en cours"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
    >
      <div className={cn(
        "flex items-center gap-2",
        compact ? "px-2.5 py-1 min-h-[36px]" : "px-3 py-1.5 min-h-[44px]",
      )}>
        {/* Label « PROMOS » façon BFM — boîte rouge, cliquable → page Promotions */}
        <Link
          href="/promos"
          title="Voir les promotions"
          className={cn(
            "shrink-0 inline-flex items-center gap-1 rounded-md bg-rose-500 font-extrabold uppercase tracking-[0.1em] text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300",
            compact ? "px-1.5 py-0.5 text-[9.5px]" : "px-2 py-1 text-[10.5px]",
          )}
        >
          <BadgePercent className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} /> Promos
        </Link>

        {animOn ? (
          // ── Ticker défilant continu (crawl BFM) : boucle sans couture ──
          <div className="relative flex-1 min-w-0 overflow-hidden">
            {/* Fondus latéraux pour l'entrée/sortie douce du texte */}
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-card to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-card to-transparent" />
            <div
              className="promo-marquee-track flex w-max items-center will-change-transform"
              style={{
                animation: `promo-marquee ${marqueeDur}s linear infinite`,
                animationPlayState: paused ? "paused" : "running",
              }}
            >
              {[...seq, ...seq].map((p, i) => (
                <PromoTickerItem key={`${p.id}-${i}`} p={p} compact={compact} animOn onConsult={consult} />
              ))}
            </div>
          </div>
        ) : (
          // ── Animations coupées : 1 promo + navigation ‹ › (toujours visible) ──
          <>
            <div className="relative flex-1 min-w-0">
              <div key={current.id}>{contenu}</div>
            </div>
            {count > 1 && (
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  aria-label="Promo précédente"
                  onClick={() => setIdx((i) => (i - 1 + count) % count)}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-rose-400/60 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="tnum text-[11px] text-muted-foreground/70 min-w-[34px] text-center select-none">
                  {Math.min(idx, count - 1) + 1}/{count}
                </span>
                <button
                  type="button"
                  aria-label="Promo suivante"
                  onClick={() => setIdx((i) => (i + 1) % count)}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-rose-400/60 transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Notifications « nouvelles promotions » — présent accueil + commande */}
      {notifsPref && (
        <PromoNotifications
          promos={promos.filter((p) => p.isNew)}
          onSeen={clearNew}
        />
      )}
    </section>
  );
}

/** Une promo dans le ticker défilant (ligne unique, sans troncature — elle
 *  défile). Terminée par un séparateur losange façon BFM. */
function PromoTickerItem({
  p, compact, animOn, onConsult,
}: {
  p: ActivePromo;
  compact: boolean;
  animOn: boolean;
  onConsult: (p: ActivePromo) => void;
}) {
  const titre = promoTitre(p);
  return (
    <Link
      href="/promos"
      onClick={() => onConsult(p)}
      title="Voir la fiche promo"
      className="group inline-flex items-center gap-2 shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-400 rounded-md"
    >
      <span className={cn(
        "inline-flex justify-center items-center px-1.5 rounded-[5px] font-bold shrink-0 bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-400/70 dark:bg-rose-500/30 dark:text-rose-100 dark:ring-rose-400/60",
        compact ? "h-[19px] min-w-[50px] text-[11px]" : "h-[21px] min-w-[56px] text-[12px]",
      )}>
        {(p.kind === "X_PLUS_Y" || p.kind === "FREE") && <Gift className="h-3 w-3 mr-1" />}
        {promoChip(p)}
      </span>
      {p.isNew && (
        <span className={cn(
          "shrink-0 px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-[0.08em] bg-amber-400 text-black",
          animOn && "animate-pulse",
        )}>
          Nouveau
        </span>
      )}
      {/* Libellé seul — article, période et argumentaire retirés */}
      <span className={cn(
        "font-semibold text-foreground whitespace-nowrap group-hover:text-rose-400 transition-colors",
        compact ? "text-[12.5px]" : "text-[13.5px]",
      )}>
        {titre}
      </span>
      {/* Séparateur losange façon BFM */}
      <span aria-hidden className="mx-3 h-1.5 w-1.5 rotate-45 bg-rose-500/70 shrink-0" />
    </Link>
  );
}
