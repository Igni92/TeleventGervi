"use client";

import { useEffect, useRef } from "react";
import { SETTING_KEYS, readSetting, onSettingChange } from "@/components/settings/app-settings";

/**
 * Effet au clic — micro-feedback ludique sur les zones NON interactives.
 *
 * Trois effets au choix (réglage `televente:clickSparks`) :
 *   - "sparks" : éclat de particules or + anneau de choc (défaut) ;
 *   - "ripple" : onde d'eau (anneaux concentriques bleutés qui s'étendent) ;
 *   - "rain"   : cascade — gouttes d'eau qui giclent puis tombent jusqu'en bas.
 *   - "off"    : aucun effet.
 *
 * Règles communes :
 *   - PC UNIQUEMENT : `pointerType === "mouse"` (une tape tactile / stylet ne
 *     déclenche jamais) ;
 *   - déclenché DÈS l'appui (`pointerdown`, pas `click`) → aucun délai, on peut
 *     spam-cliquer ; le double/triple-clic n'entraîne PAS de sélection de texte
 *     (preventDefault sur les clics multiples en zone morte) ;
 *   - jamais sur un élément interactif (bouton, lien, champ, ligne cliquable) —
 *     détection par ancêtre interactif ET par curseur calculé ;
 *   - coupé d'office si animations désactivées (data-reduce-anim) ou si le
 *     système demande prefers-reduced-motion (sauf animations forcées « on »).
 *
 * Canvas plein écran unique (pointer-events: none), boucle rAF active
 * SEULEMENT tant que des particules vivent — coût nul au repos.
 */

type Mode = "off" | "sparks" | "ripple" | "rain";

const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], ' +
  '[role="menuitem"], [role="option"], [role="tab"], [role="radio"], [role="checkbox"], ' +
  '[role="switch"], [role="slider"], [contenteditable="true"], [data-sonner-toast], [data-no-sparks]';

/** Curseurs considérés comme « zone morte » — tout le reste signale de l'interactif. */
const DEAD_CURSORS = new Set(["auto", "default"]);

/** Garde-fou anti-emballement (spam-clic de cascades) : plafond de particules. */
const MAX_PARTICLES = 1600;

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  hue: number; sat: number; light: number;
  alpha: number;                       // opacité de base
  born: number; delay: number; life: number;  // ms
  kind: "dot" | "ring" | "ripple" | "drop";
  maxR: number;                        // rayon final (ring / ripple)
}

/** Mode effectif : lit le réglage + respecte les garde-fous d'animation. */
function readMode(): Mode {
  const raw = readSetting(SETTING_KEYS.clickSparks, "sparks");
  const m: Mode =
    raw === "off" ? "off"
    : raw === "ripple" ? "ripple"
    : raw === "rain" ? "rain"
    : "sparks"; // "on" (valeur historique) ou "sparks"
  if (m === "off") return "off";
  const html = document.documentElement;
  if (html.getAttribute("data-reduce-anim") === "1") return "off";
  if (html.getAttribute("data-anim") !== "force" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "off";
  return m;
}

export function ClickSparks() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particles = useRef<Particle[]>([]);
  const raf = useRef<number | null>(null);
  const mode = useRef<Mode>("sparks");

  useEffect(() => {
    mode.current = readMode();
    const offSetting = onSettingChange((key) => {
      if (key === SETTING_KEYS.clickSparks || key === SETTING_KEYS.animations) {
        mode.current = readMode();
      }
    });

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const tick = () => {
      const now = performance.now();
      const vw = window.innerWidth, vh = window.innerHeight;
      ctx.clearRect(0, 0, vw, vh);
      const alive: Particle[] = [];
      for (const p of particles.current) {
        const age = now - p.born - p.delay;
        if (age < 0) { alive.push(p); continue; }   // pas encore démarré (stagger)
        const t = age / p.life;                     // 0 → 1
        if (t >= 1) continue;
        const fade = 1 - t * t;                     // ease-out sur l'alpha

        if (p.kind === "ring" || p.kind === "ripple") {
          const eased = 1 - Math.pow(1 - t, 3);     // ease-out cubique sur le rayon
          const r = 5 + eased * p.maxR;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = `hsl(${p.hue} ${p.sat}% ${p.light}% / ${p.alpha * fade})`;
          ctx.lineWidth = (p.kind === "ripple" ? 2.4 : 2) * (1 - t) + 0.4;
          ctx.stroke();
        } else if (p.kind === "drop") {
          p.vx *= 0.995;
          p.vy += 0.5;                              // gravité forte → ça tombe
          p.x += p.vx;
          p.y += p.vy;
          if (p.y > vh + 48) continue;              // sortie par le bas → recyclé
          const speed = Math.hypot(p.vx, p.vy);
          const len = p.size + Math.min(speed * 1.4, 16);   // s'étire en accélérant
          const a = p.alpha * (t < 0.86 ? 1 : 1 - (t - 0.86) / 0.14);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.atan2(p.vy, p.vx) - Math.PI / 2);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size * 0.72, len, 0, 0, Math.PI * 2);
          ctx.fillStyle = `hsl(${p.hue} ${p.sat}% ${p.light}% / ${a})`;
          ctx.fill();
          ctx.restore();
        } else {
          p.vx *= 0.94;                             // friction
          p.vy = p.vy * 0.94 + 0.11;                // + gravité légère
          p.x += p.vx;
          p.y += p.vy;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.4, p.size * (1 - t * 0.8)), 0, Math.PI * 2);
          ctx.fillStyle = `hsl(${p.hue} ${p.sat}% ${p.light}% / ${p.alpha * fade})`;
          ctx.fill();
        }
        alive.push(p);
      }
      particles.current = alive;
      if (alive.length > 0) raf.current = requestAnimationFrame(tick);
      else { raf.current = null; ctx.clearRect(0, 0, vw, vh); }
    };

    const start = () => { if (raf.current == null) raf.current = requestAnimationFrame(tick); };
    const dark = () => document.documentElement.classList.contains("dark");
    const push = (p: Particle) => {
      if (particles.current.length >= MAX_PARTICLES) return;
      particles.current.push(p);
    };

    /* ── Étincelles : éclat de particules or + anneau de choc ── */
    const burstSparks = (x: number, y: number) => {
      const now = performance.now();
      const d = dark();
      const count = 12 + Math.floor(Math.random() * 5);
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2.2 + Math.random() * 4.4;
        const gold = Math.random() < 0.72;
        push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.7,
          size: 1.7 + Math.random() * 2.5,
          hue: gold ? 44 + Math.random() * 8 : 32 + Math.random() * 10,
          sat: 92,
          light: d ? 58 + Math.random() * 18 : 42 + Math.random() * 14,
          alpha: 1,
          born: now, delay: 0, life: 420 + Math.random() * 260,
          kind: "dot", maxR: 0,
        });
      }
      push({
        x, y, vx: 0, vy: 0, size: 0,
        hue: 46, sat: 90, light: d ? 62 : 45, alpha: 0.65,
        born: now, delay: 0, life: 380, kind: "ring", maxR: 32,
      });
      start();
    };

    /* ── Onde d'eau : anneaux concentriques bleutés qui s'étendent ── */
    const burstRipple = (x: number, y: number) => {
      const now = performance.now();
      const d = dark();
      for (let i = 0; i < 3; i++) {
        push({
          x, y, vx: 0, vy: 0, size: 0,
          hue: 198, sat: 85, light: d ? 64 : 46,
          alpha: 0.5 - i * 0.13,
          born: now, delay: i * 95, life: 680 + i * 70,
          kind: "ripple", maxR: 78 + i * 26,
        });
      }
      start();
    };

    /* ── Cascade : gouttes d'eau qui giclent puis tombent jusqu'en bas ── */
    const burstRain = (x: number, y: number) => {
      const now = performance.now();
      const d = dark();
      const count = 16 + Math.floor(Math.random() * 6);
      for (let i = 0; i < count; i++) {
        push({
          x, y,
          vx: (Math.random() - 0.5) * 4.4,
          vy: -2 + Math.random() * 3,               // petit jet vers le haut puis chute
          size: 1.6 + Math.random() * 2.2,
          hue: 200 + Math.random() * 8,
          sat: 82,
          light: d ? 66 + Math.random() * 12 : 50 + Math.random() * 10,
          alpha: 0.72,
          born: now, delay: 0, life: 1700,
          kind: "drop", maxR: 0,
        });
      }
      // Petite onde d'impact (vend l'idée « eau »)
      push({
        x, y, vx: 0, vy: 0, size: 0,
        hue: 200, sat: 82, light: d ? 66 : 48, alpha: 0.4,
        born: now, delay: 0, life: 480, kind: "ripple", maxR: 40,
      });
      start();
    };

    /** Zone « morte » (non interactive) éligible à l'effet. */
    const isDeadZone = (target: EventTarget | null): target is Element => {
      if (!(target instanceof Element)) return false;
      if (target.closest(INTERACTIVE)) return false;
      return DEAD_CURSORS.has(getComputedStyle(target).cursor);
    };

    /* ── Déclenchement (pointerdown = zéro délai, mouse only) ── */
    const onPointerDown = (e: PointerEvent) => {
      const m = mode.current;
      if (m === "off") return;
      if (e.pointerType !== "mouse") return;        // PC uniquement
      if (e.button !== 0) return;                    // clic gauche
      if (!isDeadZone(e.target)) return;
      if (m === "sparks") burstSparks(e.clientX, e.clientY);
      else if (m === "ripple") burstRipple(e.clientX, e.clientY);
      else burstRain(e.clientX, e.clientY);
    };

    /* ── Anti-sélection : le double/triple-clic en zone morte ne doit PAS
       sélectionner de texte (sinon spam-clic impossible). preventDefault sur
       le mousedown des clics multiples = méthode fiable tous navigateurs. */
    const onMouseDown = (e: MouseEvent) => {
      if (mode.current === "off") return;
      if (e.button !== 0 || e.detail < 2) return;
      if (document.documentElement.getAttribute("data-ui") === "touch") return;
      if (isDeadZone(e.target)) e.preventDefault();
    };

    // Phase capture : on observe sans jamais interférer avec les handlers app.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mousedown", onMouseDown, true);
    return () => {
      offSetting();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("resize", resize);
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[95]"
    />
  );
}
