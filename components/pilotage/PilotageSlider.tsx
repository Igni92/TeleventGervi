"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, TrendingUp, FileText, Map as MapIcon, ArrowLeft, Eye, X, Home } from "lucide-react";
import { PilotageScreen1 } from "./PilotageScreen1";
import { PilotageScreen2 } from "./PilotageScreen2";
import { PilotageScreen3 } from "./PilotageScreen3";
import { SignalLoader } from "@/components/ui/page-loader";
import { KpiStrip } from "@/components/accueil/KpiStrip";

function SlidePlaceholder() {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <SignalLoader />
    </div>
  );
}

type SlideIndex = 0 | 1 | 2;
const LAST_SLIDE: SlideIndex = 2;

const SLIDES = [
  { key: "commercial", label: "Commercial · BL",       icon: TrendingUp },
  { key: "comptable",  label: "Comptable · Annuel",    icon: FileText },
  { key: "carte",      label: "Carte · Géo",           icon: MapIcon },
] as const;

/**
 * Slider plein écran qui héberge les deux cockpits sur la même URL.
 * - Slide 0 = PilotageScreen1 (Commercial / BL), visible par défaut.
 * - Slide 1 = PilotageScreen2 (Comptable / Annuel).
 *
 * Navigation :
 *   • Scroll horizontal natif + scroll-snap (souris, touch, trackpad).
 *   • Boutons chevron gauche/droite flottants.
 *   • Flèches clavier ←/→ (sauf quand un input est focus).
 *   • Dots indicateurs en bas (cliquables).
 *
 * `/dashboard/ecran2` reste accessible comme page autonome (utile pour le mode
 * dual-écran physique — le `sisterHref` interne du Header continue de
 * l'ouvrir dans un nouvel onglet).
 */
export function PilotageSlider({ viewAs = null }: { viewAs?: string | null } = {}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [slide, setSlide] = useState<SlideIndex>(0);

  // On ne monte un écran (Screen2 = annuel, Screen3 = 2 cartes WebGL) qu'à sa
  // PREMIÈRE visite — puis on le garde monté (pas de re-fetch ni de re-création
  // du contexte WebGL au retour). Évite de charger 2 cartes MapLibre + 3 fetchs
  // dès l'ouverture du dashboard.
  const [mounted, setMounted] = useState<Set<number>>(() => new Set([0]));
  useEffect(() => {
    setMounted((m) => (m.has(slide) ? m : new Set(m).add(slide)));
  }, [slide]);

  const goTo = useCallback((i: SlideIndex) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
    setSlide(i);
  }, []);

  // Détecte la slide courante au scroll (snap + drag manuel)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timeoutId: number | undefined;
    const onScroll = () => {
      // Debounce pour ne mettre à jour qu'à la fin du snap.
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        const i = Math.round(el.scrollLeft / el.clientWidth);
        setSlide(Math.max(0, Math.min(LAST_SLIDE, i)) as SlideIndex);
      }, 80);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Navigation clavier ←/→ — ignorée si un input/textarea/select est focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
        return;
      }
      if (e.key === "ArrowRight") { e.preventDefault(); goTo(Math.min(LAST_SLIDE, slide + 1) as SlideIndex); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(Math.max(0, slide - 1) as SlideIndex); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, slide]);

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Retour au site — le mode cockpit masque la Navbar, ce bouton est la seule
          porte de sortie vers le reste de l'app. */}
      <Link
        href="/console"
        aria-label="Retour au site"
        title="Retour au site"
        className="absolute left-3 top-2.5 z-40 hidden md:inline-flex items-center gap-1.5 h-8 pl-2 pr-3 rounded-full bg-background/85 backdrop-blur-md border border-border shadow-modal text-[11px] font-semibold text-foreground/80 hover:text-foreground hover:bg-background transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Retour au site
      </Link>

      {/* ── MOBILE : « chiffres clés du jour » — le bento desktop (grille 12×6 +
           cartes WebGL) est illisible sur téléphone, on sert une vue allégée. ── */}
      <div className="md:hidden h-full overflow-y-auto px-4 py-4 space-y-4">
        <div className="flex items-center gap-2.5">
          <Link href="/accueil" aria-label="Accueil" className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border text-foreground/70 shrink-0">
            <Home className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <p className="kicker">Pilotage</p>
            <h1 className="text-[20px] font-semibold leading-none text-foreground">Chiffres clés du jour</h1>
          </div>
        </div>
        <KpiStrip />
        <div className="rounded-2xl border border-border bg-card p-4 text-[14px] leading-relaxed text-muted-foreground">
          📊 La vue complète — cockpit commercial, rapport annuel et carte géographique —
          est optimisée pour <b className="text-foreground">grand écran</b>. Ouvrez le tableau de bord
          sur ordinateur pour les graphes et la carte.
        </div>
      </div>

      {/* Conteneur scrollable horizontal — snap-mandatory pour caler net sur une slide */}
      <div
        ref={scrollRef}
        className="hidden md:flex h-full w-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory scroll-smooth [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        <section className="w-screen h-screen shrink-0 snap-start" aria-label="Cockpit commercial — BL">
          {mounted.has(0) ? <PilotageScreen1 viewAs={viewAs} /> : <SlidePlaceholder />}
        </section>
        <section className="w-screen h-screen shrink-0 snap-start" aria-label="Rapport annuel — comptable">
          {mounted.has(1) ? <PilotageScreen2 viewAs={viewAs} /> : <SlidePlaceholder />}
        </section>
        <section className="w-screen h-screen shrink-0 snap-start" aria-label="Carte — distribution géographique">
          {mounted.has(2) ? <PilotageScreen3 viewAs={viewAs} /> : <SlidePlaceholder />}
        </section>
      </div>

      {/* Bannière « voir comme » — aperçu admin du cockpit d'un commercial. */}
      {viewAs && (
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-2 h-8 pl-3 pr-1.5 rounded-full bg-violet-600/95 backdrop-blur-md shadow-modal text-[11.5px] font-semibold text-white">
          <Eye className="h-3.5 w-3.5" />
          Vue de&nbsp;<span className="font-bold">{viewAs}</span>&nbsp;· lecture seule
          <Link
            href="/dashboard"
            aria-label="Revenir à ma vue"
            title="Revenir à ma vue"
            className="ml-1 inline-flex items-center gap-1 h-6 px-2 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
          >
            <X className="h-3 w-3" /> Quitter
          </Link>
        </div>
      )}

      {/* Chevron gauche — caché sur la 1ʳᵉ slide */}
      {slide > 0 && (
        <button
          type="button"
          onClick={() => goTo(Math.max(0, slide - 1) as SlideIndex)}
          aria-label="Écran précédent"
          title="← Écran précédent"
          className="absolute left-3 top-1/2 -translate-y-1/2 z-30 h-10 w-10 rounded-full bg-background/85 backdrop-blur-md border border-border shadow-modal hidden md:flex items-center justify-center text-foreground/80 hover:text-foreground hover:bg-background transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}

      {/* Chevron droit — caché sur la dernière slide */}
      {slide < LAST_SLIDE && (
        <button
          type="button"
          onClick={() => goTo(Math.min(LAST_SLIDE, slide + 1) as SlideIndex)}
          aria-label="Écran suivant"
          title="Écran suivant →"
          className="absolute right-3 top-1/2 -translate-y-1/2 z-30 h-10 w-10 rounded-full bg-background/85 backdrop-blur-md border border-border shadow-modal hidden md:flex items-center justify-center text-foreground/80 hover:text-foreground hover:bg-background transition-colors"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}

      {/* Dots indicateurs en bas — pill allongée pour le courant, dot court pour l'autre */}
      <nav
        aria-label="Navigation entre les écrans"
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-background/80 backdrop-blur-md border border-border shadow-modal"
      >
        {SLIDES.map((s, i) => {
          const Icon = s.icon;
          const active = slide === i;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => goTo(i as SlideIndex)}
              aria-label={s.label}
              aria-current={active ? "true" : undefined}
              title={s.label}
              className={`group inline-flex items-center gap-1.5 h-6 rounded-full transition-all ${
                active
                  ? "px-2.5 bg-primary text-primary-foreground shadow-[0_0_12px_rgba(250,204,21,0.45)]"
                  : "px-2 text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`}
            >
              <Icon className="h-3 w-3" />
              <span className={`text-[10.5px] font-semibold uppercase tracking-[0.08em] ${active ? "inline" : "hidden sm:inline"}`}>
                {s.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
