"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { Gift } from "lucide-react";
import { cn } from "@/lib/utils";
import { sharedFetchJson, invalidateSharedFetch } from "@/lib/sharedFetch";
import { SETTING_KEYS, onSettingChange, readSetting } from "@/components/settings/app-settings";
import { ActivePromo, promoChip, promoTitre } from "@/components/promos/promo-utils";

/**
 * Ruban promotions « en biais » — bandeau d'angle (corner ribbon) à 45° fixé
 * dans le coin haut-droit de l'application (monté globalement par AppLayout).
 *
 *   - Les promos actives y défilent en continu (crawl façon BFM), pause au
 *     survol. Pastilles courtes (chip + nom) — le texte incliné reste lisible.
 *   - Réglage televente:promoBannerAnim = "off" (/parametres) ou
 *     prefers-reduced-motion → fige le défilement (reste visible, statique).
 *     La piste partage la classe `.promo-marquee-track` → gelée aussi par le
 *     réglage global d'animations (html[data-reduce-anim], cf. globals.css).
 *   - Clic → /promos ; aucune promo active → null (pas de coin vide).
 *
 * pointer-events : seul le ruban capte la souris ; le reste du coin laisse
 * passer les clics (overlay non bloquant). z-40 = sous les modales (z-50).
 */
export function PromoRibbon() {
  const reduce = useReducedMotion();
  const [promos, setPromos] = useState<ActivePromo[] | null>(null);
  const [paused, setPaused] = useState(false);
  const [animPref, setAnimPref] = useState(true);

  useEffect(() => {
    setAnimPref(readSetting(SETTING_KEYS.promoBannerAnim, "on") !== "off");
    return onSettingChange((key, value) => {
      if (key === SETTING_KEYS.promoBannerAnim) setAnimPref(value !== "off");
    });
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [pJson, nJson] = await Promise.all([
          sharedFetchJson<{ promos?: ActivePromo[] }>("/api/promos?active=1", 60_000).catch(() => ({}) as { promos?: ActivePromo[] }),
          sharedFetchJson<{ notifications?: { promoId?: string; isNew?: boolean }[] }>("/api/notifications", 60_000).catch(() => ({}) as { notifications?: { promoId?: string; isNew?: boolean }[] }),
        ]);
        const newIds = new Set(
          ((nJson?.notifications ?? []) as { promoId?: string; isNew?: boolean }[])
            .filter((n) => n.isNew && typeof n.promoId === "string")
            .map((n) => n.promoId as string),
        );
        const list = ((pJson?.promos ?? []) as ActivePromo[]).map((p) => ({ ...p, isNew: newIds.has(p.id) }));
        // Nouvelles d'abord (tri stable).
        list.sort((a, b) => Number(b.isNew ?? false) - Number(a.isNew ?? false));
        if (alive) setPromos(list);
      } catch {
        if (alive) setPromos([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  const count = promos?.length ?? 0;
  const animOn = animPref && !reduce;
  if (!promos || count === 0) return null;

  // Remplissage pour une bande assez large même avec peu de promos, puis
  // duplication → boucle sans couture (translateX 0 → -50 %).
  const fill = Math.max(2, Math.ceil(8 / count));
  const seq = Array.from({ length: fill }, () => promos).flat();
  const dur = Math.max(14, seq.length * 3.5);
  const items = animOn ? [...seq, ...seq] : seq;

  return (
    <div
      role="region"
      aria-label="Promotions en cours"
      className="fixed top-0 right-0 z-40 h-[150px] w-[150px] overflow-hidden pointer-events-none print:hidden hidden md:block"
    >
      <div
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="absolute flex items-center overflow-hidden bg-rose-500 text-white shadow-lg shadow-rose-900/30 ring-1 ring-rose-300/30 pointer-events-auto"
        style={{ top: 30, right: -54, width: 220, height: 30, transform: "rotate(45deg)" }}
      >
        <div
          className={cn("promo-marquee-track flex w-max items-center will-change-transform", !animOn && "justify-center mx-auto")}
          style={animOn
            ? { animation: `promo-marquee ${dur}s linear infinite`, animationPlayState: paused ? "paused" : "running" }
            : undefined}
        >
          {items.map((p, i) => (
            <Link
              key={`${p.id}-${i}`}
              href="/promos"
              title="Voir les promotions en cours"
              onClick={() => {
                if (!p.isNew) return;
                fetch("/api/notifications/seen", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ promoId: p.id }),
                })
                  .then(() => invalidateSharedFetch("/api/notifications"))
                  .catch(() => { /* best-effort */ });
              }}
              className="group inline-flex items-center gap-1.5 shrink-0 px-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/70 rounded"
            >
              <span className="inline-flex items-center justify-center h-[16px] px-1 rounded-[3px] bg-white text-rose-700 text-[10px] font-extrabold shrink-0">
                {p.kind === "X_PLUS_Y" && <Gift className="h-2.5 w-2.5 mr-0.5" />}
                {promoChip(p)}
              </span>
              <span className="text-[11px] font-semibold whitespace-nowrap">{promoTitre(p)}</span>
              {p.isNew && (
                <span className="text-[8px] font-extrabold uppercase tracking-wide bg-amber-400 text-black px-1 rounded-[2px] shrink-0">
                  New
                </span>
              )}
              <span aria-hidden className="mx-2 h-1 w-1 rotate-45 bg-white/70 shrink-0" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
