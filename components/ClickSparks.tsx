"use client";

import { useEffect, useRef } from "react";
import { SETTING_KEYS, readSetting, onSettingChange } from "@/components/settings/app-settings";

/**
 * Étincelles au clic — micro-feedback ludique sur les zones NON interactives.
 *
 * Un clic « dans le vide » (fond, marges, texte statique) fait éclater une
 * poignée de particules or + un anneau, au point de clic. Purement décoratif :
 *   - ne se déclenche JAMAIS sur un élément interactif (bouton, lien, champ,
 *     ligne cliquable…) — détection par ancêtre interactif ET par curseur
 *     calculé (tout ce qui affiche `cursor: pointer/text/grab…` est exclu) ;
 *   - désactivable dans /parametres (clé televente:clickSparks) ;
 *   - coupé d'office si animations désactivées (data-reduce-anim) ou si le
 *     système demande prefers-reduced-motion (sauf animations forcées « on »).
 *
 * Canvas plein écran unique (pointer-events: none), boucle rAF active
 * SEULEMENT tant que des particules vivent — coût nul au repos.
 */

const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], ' +
  '[role="menuitem"], [role="option"], [role="tab"], [role="radio"], [role="checkbox"], ' +
  '[role="switch"], [role="slider"], [contenteditable="true"], [data-sonner-toast], [data-no-sparks]';

/** Curseurs considérés comme « zone morte » — tout le reste signale de l'interactif. */
const DEAD_CURSORS = new Set(["auto", "default"]);

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  hue: number; sat: number; light: number;
  born: number; life: number;      // ms
  kind: "dot" | "ring";
}

function sparksEnabled(): boolean {
  if (readSetting(SETTING_KEYS.clickSparks, "on") === "off") return false;
  const html = document.documentElement;
  if (html.getAttribute("data-reduce-anim") === "1") return false;
  if (html.getAttribute("data-anim") !== "force" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return true;
}

export function ClickSparks() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particles = useRef<Particle[]>([]);
  const raf = useRef<number | null>(null);
  const enabled = useRef(true);

  useEffect(() => {
    enabled.current = sparksEnabled();
    const offSetting = onSettingChange((key) => {
      if (key === SETTING_KEYS.clickSparks || key === SETTING_KEYS.animations) {
        enabled.current = sparksEnabled();
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
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const alive: Particle[] = [];
      for (const p of particles.current) {
        const t = (now - p.born) / p.life;          // 0 → 1
        if (t >= 1) continue;
        const fade = 1 - t * t;                     // ease-out sur l'alpha
        if (p.kind === "ring") {
          const r = 5 + t * 32;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = `hsl(${p.hue} ${p.sat}% ${p.light}% / ${0.65 * fade})`;
          ctx.lineWidth = 2 * (1 - t) + 0.4;
          ctx.stroke();
        } else {
          p.vx *= 0.94;                             // friction
          p.vy = p.vy * 0.94 + 0.11;                // + gravité légère
          p.x += p.vx;
          p.y += p.vy;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.4, p.size * (1 - t * 0.8)), 0, Math.PI * 2);
          ctx.fillStyle = `hsl(${p.hue} ${p.sat}% ${p.light}% / ${fade})`;
          ctx.fill();
        }
        alive.push(p);
      }
      particles.current = alive;
      if (alive.length > 0) raf.current = requestAnimationFrame(tick);
      else { raf.current = null; ctx.clearRect(0, 0, window.innerWidth, window.innerHeight); }
    };

    const burst = (x: number, y: number) => {
      const now = performance.now();
      const dark = document.documentElement.classList.contains("dark");
      const count = 12 + Math.floor(Math.random() * 5);
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2.2 + Math.random() * 4.4;
        // Palette or (marque) avec un peu d'ambre/blanc chaud pour scintiller
        const gold = Math.random() < 0.72;
        particles.current.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.7,
          size: 1.7 + Math.random() * 2.5,
          hue: gold ? 44 + Math.random() * 8 : 32 + Math.random() * 10,
          sat: 92,
          light: dark ? 58 + Math.random() * 18 : 42 + Math.random() * 14,
          born: now,
          life: 420 + Math.random() * 260,
          kind: "dot",
        });
      }
      // Anneau de choc discret
      particles.current.push({
        x, y, vx: 0, vy: 0, size: 0,
        hue: 46, sat: 90, light: dark ? 62 : 45,
        born: now, life: 380, kind: "ring",
      });
      if (raf.current == null) raf.current = requestAnimationFrame(tick);
    };

    const onClick = (e: MouseEvent) => {
      if (!enabled.current) return;
      if (e.button !== 0 || e.detail === 0) return;  // clic gauche « vrai » uniquement (pas clavier)
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest(INTERACTIVE)) return;
      // Élément custom cliquable (div onClick…) : le curseur le trahit.
      if (!DEAD_CURSORS.has(getComputedStyle(target).cursor)) return;
      // Clic de sélection de texte : on laisse faire sans étincelles.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      burst(e.clientX, e.clientY);
    };

    // Phase capture : on observe sans jamais interférer avec les handlers app.
    document.addEventListener("click", onClick, true);
    return () => {
      offSetting();
      document.removeEventListener("click", onClick, true);
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
