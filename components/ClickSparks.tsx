"use client";

import { useEffect, useRef } from "react";
import { SETTING_KEYS, readSetting, onSettingChange } from "@/components/settings/app-settings";

/**
 * Effet au clic — micro-feedback ludique sur les zones NON interactives.
 *
 * Six effets au choix (réglage `televente:clickSparks`) :
 *   - "sparks" : éclat de particules or + anneau de choc (défaut) ;
 *   - "nova"   : supernova — cœur incandescent, éclat en croix (lens-flare) et
 *                constellation (les éclats se relient par de fines lignes) ;
 *   - "radar"  : ping sonar — réticule, anneaux de scan, balayage rotatif + échos ;
 *   - "ripple" : onde d'eau (anneaux concentriques bleutés qui s'étendent) ;
 *   - "bloom"  : aurore — halos lumineux diffus teintés marque qui dérivent ;
 *   - "rain"   : cascade — gouttes d'eau qui giclent puis tombent jusqu'en bas ;
 *   - "off"    : aucun effet.
 *
 * Les effets « signal » (nova / radar / bloom) LISENT la colorimétrie de marque
 * à chaud (`--brand-500`) → ils suivent Or / Agrume / Fraise selon le thème.
 *
 * Règles communes :
 *   - PC UNIQUEMENT : `pointerType === "mouse"` (une tape tactile / stylet ne
 *     déclenche jamais) ;
 *   - déclenché sur un VRAI clic (pointeur quasi immobile entre l'appui et le
 *     relâché, et aucune sélection de texte) : rester appuyé pour sélectionner
 *     n'active jamais l'effet ; le spam-clic reste possible ; un cooldown réglable
 *     (`televente:clickSparksDelay`) peut espacer les effets ; le double/triple-clic
 *     n'entraîne PAS de sélection de texte (preventDefault en zone morte) ;
 *   - jamais sur un élément interactif (bouton, lien, champ, ligne cliquable) —
 *     détection par ancêtre interactif ET par curseur calculé ;
 *   - coupé d'office si animations désactivées (data-reduce-anim) ou si le
 *     système demande prefers-reduced-motion (sauf animations forcées « on »).
 *
 * Canvas plein écran unique (pointer-events: none), boucle rAF active
 * SEULEMENT tant que des particules vivent — coût nul au repos.
 */

type Mode = "off" | "sparks" | "nova" | "radar" | "ripple" | "bloom" | "rain";

const INTERACTIVE =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], ' +
  '[role="menuitem"], [role="option"], [role="tab"], [role="radio"], [role="checkbox"], ' +
  '[role="switch"], [role="slider"], [contenteditable="true"], [data-sonner-toast], [data-no-sparks]';

/** Curseurs considérés comme « zone morte » — tout le reste signale de l'interactif. */
const DEAD_CURSORS = new Set(["auto", "default"]);

/** Garde-fou anti-emballement (spam-clic de cascades) : plafond de particules. */
const MAX_PARTICLES = 1600;

type Kind =
  | "dot" | "ring" | "ripple" | "disc" | "drop"  // effets historiques
  | "core" | "flare" | "star"               // supernova
  | "reticle" | "sweep" | "blip"            // radar
  | "bloom";                                // aurore

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  hue: number; sat: number; light: number;
  alpha: number;                       // opacité de base
  born: number; delay: number; life: number;  // ms
  kind: Kind;
  maxR: number;                        // rayon final (ring / ripple / core / sweep / bloom / reticle)
  angle?: number;                      // orientation (flare / sweep) — rad
  spin?: number;                       // amplitude de rotation du balayage — rad
  len?: number;                        // demi-longueur d'une branche de flare — px
  phase?: number;                      // déphasage du scintillement (star)
  z?: number;                          // profondeur 0(loin)→1(près) pour la parallaxe (drop)
}

/** Mode effectif : lit le réglage + respecte les garde-fous d'animation. */
function readMode(): Mode {
  const raw = readSetting(SETTING_KEYS.clickSparks, "sparks");
  const m: Mode =
    raw === "off" ? "off"
    : raw === "nova" ? "nova"
    : raw === "radar" ? "radar"
    : raw === "ripple" ? "ripple"
    : raw === "bloom" ? "bloom"
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
  const delay = useRef<number>(0);   // cooldown (ms) entre deux effets — réglable
  const lastBurst = useRef<number>(0);

  useEffect(() => {
    mode.current = readMode();
    const readDelay = () => {
      const v = Number(readSetting(SETTING_KEYS.clickSparksDelay, "0"));
      delay.current = Number.isFinite(v) && v > 0 ? Math.min(v, 5000) : 0;
    };
    readDelay();
    const offSetting = onSettingChange((key) => {
      if (key === SETTING_KEYS.clickSparks || key === SETTING_KEYS.animations) {
        mode.current = readMode();
      }
      if (key === SETTING_KEYS.clickSparksDelay) readDelay();
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
      const d = dark();
      ctx.clearRect(0, 0, vw, vh);
      const alive: Particle[] = [];
      // Points « étoile » vivants de la frame → tracé des liens (constellation) après coup.
      const stars: { x: number; y: number; a: number; hue: number; sat: number; light: number }[] = [];

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

        /* ── Corps d'eau translucide qui s'étend sous les anneaux (onde) ── */
        } else if (p.kind === "disc") {
          const eased = 1 - Math.pow(1 - t, 2);
          const r = 4 + eased * p.maxR;
          const a = p.alpha * (1 - t);
          ctx.save();
          if (d) ctx.globalCompositeOperation = "lighter";
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0,   `hsl(${p.hue} ${p.sat}% ${p.light}% / ${a * 0.5})`);
          g.addColorStop(0.7, `hsl(${p.hue} ${p.sat}% ${p.light}% / ${a * 0.12})`);
          g.addColorStop(1,   `hsl(${p.hue} ${p.sat}% ${p.light}% / 0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        } else if (p.kind === "drop") {
          // Goutte d'eau « 3D » : bille vitreuse ombrée + reflet spéculaire, avec
          // PARALLAXE DE PROFONDEUR (z) — les gouttes proches sont plus grosses et
          // accélèrent davantage, les lointaines restent petites et atmosphériques.
          const z = p.z ?? 0.6;
          p.vx *= 0.995;
          p.vy += 0.42 + z * 0.5;                   // gravité modulée par la profondeur
          p.x += p.vx;
          p.y += p.vy;
          if (p.y > vh + 60) continue;              // sortie par le bas → recyclé
          const a = p.alpha * (t < 0.86 ? 1 : 1 - (t - 0.86) / 0.14);
          const speed = Math.hypot(p.vx, p.vy);
          const rBody = p.size;
          const stretch = 1 + Math.min(speed * 0.05, 1.8);   // tension de surface → s'étire
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.atan2(p.vy, p.vx) - Math.PI / 2);  // grand axe = sens de chute
          // Filament de traîne (motion-blur) derrière la goutte.
          const tail = rBody * stretch * 2.4;
          const gt = ctx.createLinearGradient(0, 0, 0, -tail);
          gt.addColorStop(0, `hsl(${p.hue} ${p.sat}% ${p.light}% / ${a * 0.45})`);
          gt.addColorStop(1, `hsl(${p.hue} ${p.sat}% ${p.light}% / 0)`);
          ctx.fillStyle = gt;
          ctx.beginPath();
          ctx.ellipse(0, -tail * 0.5, rBody * 0.34, tail * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          // Corps — dégradé radial DÉCENTRÉ = volume (point chaud → corps → bord/ombre).
          const grad = ctx.createRadialGradient(
            -rBody * 0.34, -rBody * 0.4, rBody * 0.1,
            0, 0, rBody * 1.35,
          );
          grad.addColorStop(0,    `hsl(${p.hue} 92% 94% / ${a})`);
          grad.addColorStop(0.42, `hsl(${p.hue} ${p.sat}% ${p.light}% / ${a * 0.92})`);
          grad.addColorStop(1,    `hsl(${p.hue} ${p.sat}% ${d ? 34 : 58}% / ${a * 0.12})`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(0, 0, rBody * 0.72, rBody * stretch, 0, 0, Math.PI * 2);
          ctx.fill();
          // Reflet spéculaire (petit éclat blanc décentré) — vend la surface bombée.
          ctx.fillStyle = `hsl(0 0% 100% / ${a * 0.85})`;
          ctx.beginPath();
          ctx.ellipse(-rBody * 0.28, -rBody * 0.42, rBody * 0.17, rBody * 0.26, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

        /* ── Supernova : cœur incandescent ─────────────────────── */
        } else if (p.kind === "core") {
          const eased = 1 - Math.pow(1 - t, 3);
          const r = p.maxR * (0.28 + 0.72 * eased);
          ctx.save();
          if (d) ctx.globalCompositeOperation = "lighter";
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0,    `hsl(48 100% 97% / ${0.95 * fade})`);         // blanc chaud
          g.addColorStop(0.35, `hsl(${p.hue} 100% 72% / ${0.85 * fade})`);
          g.addColorStop(1,    `hsl(${p.hue} 100% 55% / 0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.restore();

        /* ── Supernova : branches en croix (lens-flare) ────────── */
        } else if (p.kind === "flare") {
          const half = (p.len ?? 40) * Math.sin(Math.PI * Math.min(t, 0.999));
          const ca = Math.cos(p.angle ?? 0), sa = Math.sin(p.angle ?? 0);
          const x0 = p.x - ca * half, y0 = p.y - sa * half;
          const x1 = p.x + ca * half, y1 = p.y + sa * half;
          ctx.save();
          if (d) ctx.globalCompositeOperation = "lighter";
          const g = ctx.createLinearGradient(x0, y0, x1, y1);
          g.addColorStop(0,   `hsl(${p.hue} 100% 70% / 0)`);
          g.addColorStop(0.5, `hsl(48 100% 94% / ${0.9 * fade})`);
          g.addColorStop(1,   `hsl(${p.hue} 100% 70% / 0)`);
          ctx.strokeStyle = g;
          ctx.lineWidth = p.size * (1 - t) + 0.5;
          ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          ctx.restore();

        /* ── Supernova : éclats qui scintillent puis se relient ── */
        } else if (p.kind === "star") {
          p.vx *= 0.93;
          p.vy = p.vy * 0.93 + 0.03;                // dérive très légère
          p.x += p.vx;
          p.y += p.vy;
          const twinkle = 0.55 + 0.45 * Math.sin((p.phase ?? 0) + age * 0.018);
          const a = p.alpha * fade * twinkle;
          const r = Math.max(0.5, p.size * (1 - t * 0.4));
          ctx.save();
          if (d) ctx.globalCompositeOperation = "lighter";
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.5);
          g.addColorStop(0, `hsl(${p.hue} ${p.sat}% ${p.light}% / ${a})`);
          g.addColorStop(1, `hsl(${p.hue} ${p.sat}% ${p.light}% / 0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `hsl(${p.hue} ${Math.min(p.sat + 6, 100)}% ${Math.min(p.light + 22, 96)}% / ${a})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          stars.push({ x: p.x, y: p.y, a, hue: p.hue, sat: p.sat, light: p.light });

        /* ── Radar : réticule / crosshair ──────────────────────── */
        } else if (p.kind === "reticle") {
          const r = p.maxR * (0.6 + 0.4 * (1 - Math.pow(1 - t, 2)));
          const gap = r * 0.34;
          const a = p.alpha * fade;
          ctx.save();
          ctx.strokeStyle = `hsl(${p.hue} ${p.sat}% ${p.light}% / ${a})`;
          ctx.lineWidth = 1.4;
          ctx.lineCap = "round";
          for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
            ctx.beginPath();
            ctx.moveTo(p.x + dx * gap, p.y + dy * gap);
            ctx.lineTo(p.x + dx * r, p.y + dy * r);
            ctx.stroke();
          }
          ctx.fillStyle = `hsl(${p.hue} ${p.sat}% ${p.light}% / ${a})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2); ctx.fill();
          ctx.restore();

        /* ── Radar : balayage rotatif avec traîne en éventail ──── */
        } else if (p.kind === "sweep") {
          const eased = 1 - Math.pow(1 - t, 2);
          const ang = (p.angle ?? 0) + eased * (p.spin ?? Math.PI * 2.4);
          const R = p.maxR;
          const a = p.alpha * (1 - t);
          ctx.save();
          if (d) ctx.globalCompositeOperation = "lighter";
          ctx.lineWidth = 1.2;
          const TAIL = 16;
          for (let k = TAIL; k >= 1; k--) {
            const f = k / TAIL;
            const aa = a * (1 - f) * 0.16;
            if (aa <= 0.002) continue;
            const ta = ang - f * 0.55;              // traîne ~0.55 rad
            ctx.strokeStyle = `hsl(${p.hue} ${p.sat}% ${p.light}% / ${aa})`;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + Math.cos(ta) * R, p.y + Math.sin(ta) * R);
            ctx.stroke();
          }
          ctx.strokeStyle = `hsl(${p.hue} ${Math.min(p.sat + 5, 100)}% ${Math.min(p.light + 18, 92)}% / ${a})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + Math.cos(ang) * R, p.y + Math.sin(ang) * R);
          ctx.stroke();
          ctx.restore();

        /* ── Radar : échos (blips) qui pulsent ─────────────────── */
        } else if (p.kind === "blip") {
          const s = Math.sin(Math.PI * Math.min(t, 0.999));
          const r = p.size * (0.4 + 1.1 * s);
          const a = p.alpha * s;
          ctx.save();
          if (d) ctx.globalCompositeOperation = "lighter";
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4);
          g.addColorStop(0, `hsl(${p.hue} ${p.sat}% ${Math.min(p.light + 18, 92)}% / ${a})`);
          g.addColorStop(1, `hsl(${p.hue} ${p.sat}% ${p.light}% / 0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2); ctx.fill();
          ctx.restore();

        /* ── Aurore : halos radiaux diffus qui dérivent ────────── */
        } else if (p.kind === "bloom") {
          p.x += p.vx; p.y += p.vy;
          p.vx *= 0.98; p.vy *= 0.98;
          const eased = 1 - Math.pow(1 - t, 2.2);
          const r = 6 + eased * p.maxR;
          const a = p.alpha * (t < 0.22 ? t / 0.22 : 1 - (t - 0.22) / 0.78);  // fondu entrée + sortie
          ctx.save();
          if (d) ctx.globalCompositeOperation = "lighter";
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0,   `hsl(${p.hue} ${p.sat}% ${p.light}% / ${a})`);
          g.addColorStop(0.5, `hsl(${p.hue} ${p.sat}% ${p.light}% / ${a * 0.35})`);
          g.addColorStop(1,   `hsl(${p.hue} ${p.sat}% ${p.light}% / 0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.restore();

        } else {
          // Étincelle : point avec halo additif (nuit) + cœur clair — plus « braise ».
          p.vx *= 0.94;                             // friction
          p.vy = p.vy * 0.94 + 0.11;                // + gravité légère
          p.x += p.vx;
          p.y += p.vy;
          const r = Math.max(0.4, p.size * (1 - t * 0.8));
          const a = p.alpha * fade;
          if (d) {
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
            g.addColorStop(0, `hsl(${p.hue} ${p.sat}% ${Math.min(p.light + 8, 88)}% / ${a * 0.6})`);
            g.addColorStop(1, `hsl(${p.hue} ${p.sat}% ${p.light}% / 0)`);
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          }
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = `hsl(${p.hue} ${Math.min(p.sat + 4, 100)}% ${Math.min(p.light + 14, 92)}% / ${a})`;
          ctx.fill();
        }
        alive.push(p);
      }

      // Constellation : relie les éclats proches par de fines lignes lumineuses.
      if (stars.length > 1) {
        const LINK = 118;
        ctx.save();
        if (d) ctx.globalCompositeOperation = "lighter";
        ctx.lineWidth = 0.9;
        for (let i = 0; i < stars.length; i++) {
          const a = stars[i];
          for (let j = i + 1; j < stars.length; j++) {
            const b = stars[j];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            if (dist >= LINK) continue;
            const la = Math.min(a.a, b.a) * (1 - dist / LINK) * 0.5;
            if (la <= 0.01) continue;
            ctx.strokeStyle = `hsl(${a.hue} ${a.sat}% ${a.light}% / ${la})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        ctx.restore();
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
    /** Teinte de marque courante (Or / Agrume / Fraise…) lue à chaud sur --brand-500. */
    const brandHue = (): number => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--brand-500");
      const h = parseFloat(raw);
      return Number.isFinite(h) ? h : 45;
    };

    /* ── Étincelles : éclat de braises (teinte marque) + double anneau de choc ── */
    const burstSparks = (x: number, y: number) => {
      const now = performance.now();
      const d = dark();
      const hue = brandHue();
      // Flash de cœur blanc-chaud (donne le « pop » lumineux de départ).
      push({
        x, y, vx: 0, vy: 0, size: 0, hue, sat: 100, light: 80, alpha: 0.85,
        born: now, delay: 0, life: 220, kind: "core", maxR: 15,
      });
      // Gerbe de particules — teintées marque avec légère variance chaude.
      const count = 14 + Math.floor(Math.random() * 6);
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2.2 + Math.random() * 5.0;
        const warm = Math.random() < 0.7;
        push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.7,
          size: 1.6 + Math.random() * 2.6,
          hue: warm ? hue + (Math.random() * 10 - 3) : hue - 10 + Math.random() * 6,
          sat: 94,
          light: d ? 56 + Math.random() * 20 : 42 + Math.random() * 14,
          alpha: 1,
          born: now, delay: 0, life: 440 + Math.random() * 300,
          kind: "dot", maxR: 0,
        });
      }
      // Braises qui s'attardent et scintillent (réutilise « star »).
      const embers = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < embers; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * 2.4;
        push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.5,
          size: 1.3 + Math.random() * 1.4,
          hue, sat: 92, light: d ? 66 + Math.random() * 14 : 48 + Math.random() * 10,
          alpha: 0.9,
          born: now, delay: 40, life: 780 + Math.random() * 360,
          kind: "star", maxR: 0, phase: Math.random() * Math.PI * 2,
        });
      }
      // Double anneau de choc (le 2e, décalé et plus large, donne du relief).
      push({
        x, y, vx: 0, vy: 0, size: 0, hue, sat: 92, light: d ? 64 : 45, alpha: 0.7,
        born: now, delay: 0, life: 360, kind: "ring", maxR: 30,
      });
      push({
        x, y, vx: 0, vy: 0, size: 0, hue, sat: 88, light: d ? 60 : 48, alpha: 0.4,
        born: now, delay: 70, life: 460, kind: "ring", maxR: 52,
      });
      start();
    };

    /* ── Supernova : cœur incandescent + croix lens-flare + constellation ── */
    const burstNova = (x: number, y: number) => {
      const now = performance.now();
      const d = dark();
      const hue = brandHue();
      // Cœur incandescent + onde de choc.
      push({
        x, y, vx: 0, vy: 0, size: 0, hue, sat: 100, light: 70, alpha: 1,
        born: now, delay: 0, life: 360, kind: "core", maxR: 26,
      });
      push({
        x, y, vx: 0, vy: 0, size: 0, hue, sat: 95, light: d ? 64 : 46, alpha: 0.7,
        born: now, delay: 0, life: 440, kind: "ring", maxR: 46,
      });
      // Éclat en croix (2 branches longues + 2 diagonales → étoile 8 branches).
      for (const [ang, len] of [[0, 56], [Math.PI / 2, 56], [Math.PI / 4, 32], [-Math.PI / 4, 32]] as const) {
        push({
          x, y, vx: 0, vy: 0, size: 2.4, hue, sat: 100, light: 80, alpha: 1,
          born: now, delay: 0, life: 340, kind: "flare", maxR: 0, angle: ang, len,
        });
      }
      // Éclats projetés (scintillent + se relient).
      const count = 12 + Math.floor(Math.random() * 4);
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2.6 + Math.random() * 4.2;
        push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 1.5 + Math.random() * 1.8,
          hue,
          sat: 92,
          light: d ? 62 + Math.random() * 16 : 44 + Math.random() * 12,
          alpha: 1,
          born: now, delay: 0, life: 620 + Math.random() * 380,
          kind: "star", maxR: 0, phase: Math.random() * Math.PI * 2,
        });
      }
      start();
    };

    /* ── Radar : réticule + anneaux de scan + balayage + échos ── */
    const burstRadar = (x: number, y: number) => {
      const now = performance.now();
      const d = dark();
      const hue = brandHue();
      push({
        x, y, vx: 0, vy: 0, size: 0, hue, sat: d ? 85 : 80, light: d ? 66 : 46, alpha: 0.9,
        born: now, delay: 0, life: 520, kind: "reticle", maxR: 26,
      });
      for (let i = 0; i < 3; i++) {
        push({
          x, y, vx: 0, vy: 0, size: 0, hue, sat: 80, light: d ? 64 : 46,
          alpha: 0.5 - i * 0.13,
          born: now, delay: i * 120, life: 820 + i * 80,
          kind: "ripple", maxR: 70 + i * 34,
        });
      }
      push({
        x, y, vx: 0, vy: 0, size: 0, hue, sat: 82, light: d ? 66 : 48, alpha: 0.5,
        born: now, delay: 0, life: 900, kind: "sweep", maxR: 96,
        angle: Math.random() * Math.PI * 2, spin: Math.PI * 2.4,
      });
      const blips = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < blips; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = 24 + Math.random() * 64;
        push({
          x: x + Math.cos(ang) * rad, y: y + Math.sin(ang) * rad,
          vx: 0, vy: 0, size: 2.2 + Math.random() * 1.6,
          hue, sat: 88, light: d ? 70 : 50, alpha: 0.9,
          born: now, delay: 120 + Math.random() * 520, life: 360,
          kind: "blip", maxR: 0,
        });
      }
      start();
    };

    /* ── Aurore : halos diffus qui dérivent + scintillements ── */
    const burstBloom = (x: number, y: number) => {
      const now = performance.now();
      const d = dark();
      const hue = brandHue();
      for (let i = 0; i < 3; i++) {
        const angle = Math.random() * Math.PI * 2;
        const drift = 0.2 + Math.random() * 0.5;
        push({
          x, y,
          vx: Math.cos(angle) * drift,
          vy: Math.sin(angle) * drift - 0.12,
          size: 0,
          hue, sat: d ? 70 : 78, light: d ? 60 : 52,
          alpha: d ? 0.5 : 0.42,
          born: now, delay: i * 70, life: 1000 + i * 180,
          kind: "bloom", maxR: 70 + i * 40,
        });
      }
      // Quelques scintillements espacés DANS le halo (vend l'idée « aurore »).
      for (let i = 0; i < 5; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = 6 + Math.random() * 44;
        push({
          x: x + Math.cos(ang) * rad, y: y + Math.sin(ang) * rad,
          vx: 0, vy: 0, size: 1.6 + Math.random() * 1.4,
          hue, sat: 90, light: d ? 82 : 62, alpha: 0.85,
          born: now, delay: Math.random() * 500, life: 520,
          kind: "blip", maxR: 0,
        });
      }
      start();
    };

    /* ── Onde d'eau : impact lumineux + corps d'eau + anneaux + gouttelettes ── */
    const burstRipple = (x: number, y: number) => {
      const now = performance.now();
      const d = dark();
      const hue = 198;
      // Corps d'eau translucide qui monte sous les anneaux (donne du volume).
      push({
        x, y, vx: 0, vy: 0, size: 0, hue, sat: 82, light: d ? 62 : 48, alpha: 0.5,
        born: now, delay: 0, life: 560, kind: "disc", maxR: 58,
      });
      // Point d'impact lumineux (le « plop »).
      push({
        x, y, vx: 0, vy: 0, size: 0, hue, sat: 90, light: d ? 78 : 58, alpha: 0.8,
        born: now, delay: 0, life: 260, kind: "core", maxR: 12,
      });
      // Anneaux concentriques qui s'étendent.
      for (let i = 0; i < 3; i++) {
        push({
          x, y, vx: 0, vy: 0, size: 0,
          hue, sat: 85, light: d ? 64 : 46,
          alpha: 0.5 - i * 0.13,
          born: now, delay: i * 95, life: 680 + i * 70,
          kind: "ripple", maxR: 78 + i * 26,
        });
      }
      // Gouttelettes de couronne qui giclent puis retombent.
      const flecks = 5 + Math.floor(Math.random() * 3);
      for (let i = 0; i < flecks; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
        const speed = 2.4 + Math.random() * 2.6;
        push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 1.2 + Math.random() * 1.2,
          hue: hue + Math.random() * 8, sat: 80,
          light: d ? 72 + Math.random() * 10 : 54 + Math.random() * 8,
          alpha: 0.7,
          born: now, delay: 0, life: 620 + Math.random() * 240,
          kind: "drop", maxR: 0, z: 0.5 + Math.random() * 0.4,
        });
      }
      start();
    };

    /* ── Cascade : éclaboussure 3D — couronne + nappe de gouttes en profondeur ── */
    const burstRain = (x: number, y: number) => {
      const now = performance.now();
      const d = dark();
      const arr: Particle[] = [];

      // Couronne d'éclaboussure (surface-tension) — gicle en éventail vers le haut.
      const crown = 9 + Math.floor(Math.random() * 4);
      for (let i = 0; i < crown; i++) {
        const spread = crown > 1 ? i / (crown - 1) - 0.5 : 0;   // -0.5 … 0.5
        const ang = -Math.PI / 2 + spread * Math.PI * 0.9;      // éventail vers le haut
        const speed = 3.2 + Math.random() * 3.4;
        const z = 0.55 + Math.random() * 0.4;
        arr.push({
          x, y,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,                // négatif → vers le haut
          size: (1.1 + Math.random() * 1.3) * (0.7 + z * 0.6),
          hue: 202 + Math.random() * 8, sat: 78,
          light: d ? 70 + Math.random() * 10 : 54 + Math.random() * 8,
          alpha: 0.55 + z * 0.35,
          born: now, delay: 0, life: 780 + Math.random() * 260,
          kind: "drop", maxR: 0, z,
        });
      }

      // Nappe principale — gouttes réparties en PROFONDEUR (parallaxe).
      const count = 18 + Math.floor(Math.random() * 8);
      for (let i = 0; i < count; i++) {
        const z = Math.random();                    // 0 (loin) … 1 (près)
        arr.push({
          x: x + (Math.random() - 0.5) * 10,
          y: y + (Math.random() - 0.5) * 6,
          vx: (Math.random() - 0.5) * 3.4 * (0.4 + z),
          vy: -1.4 + Math.random() * 2.4,           // léger jet, puis la gravité prend le relais
          size: 1.3 + z * 2.7,                       // près = grosse bille
          hue: 200 + Math.random() * 10,
          sat: 70 + z * 15,                          // près = plus saturé
          light: d ? 58 + z * 14 : 48 + z * 10,
          alpha: 0.42 + z * 0.5,                     // loin = plus transparent (atmosphérique)
          born: now, delay: Math.random() * 60, life: 1900,
          kind: "drop", maxR: 0, z,
        });
      }

      // Rendu du plus LOIN au plus PRÈS → occlusion de profondeur correcte.
      arr.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
      for (const p of arr) push(p);

      // Onde d'impact (vend l'idée « eau »).
      push({
        x, y, vx: 0, vy: 0, size: 0,
        hue: 202, sat: 80, light: d ? 66 : 48, alpha: 0.4,
        born: now, delay: 0, life: 520, kind: "ripple", maxR: 44,
      });
      start();
    };

    /** Zone « morte » (non interactive) éligible à l'effet. */
    const isDeadZone = (target: EventTarget | null): target is Element => {
      if (!(target instanceof Element)) return false;
      if (target.closest(INTERACTIVE)) return false;
      return DEAD_CURSORS.has(getComputedStyle(target).cursor);
    };

    /* ── Déclenchement — on ARME au pointerdown, mais on ne tire qu'au pointerup
       SI c'est un vrai clic : pointeur quasi immobile ET aucune sélection de texte.
       Un press-drag (rester appuyé pour sélectionner) n'active donc JAMAIS l'effet.
       Le spam-clic reste possible (chaque down→up rapide tire), et un cooldown
       réglable (delay) peut espacer les effets. ── */
    const CLICK_MOVE_TOL = 6;   // px : au-delà, on considère un « glisser » (sélection)
    let pending: { x: number; y: number; mode: Mode } | null = null;

    const fire = (m: Mode, x: number, y: number) => {
      if (delay.current > 0) {
        const now = performance.now();
        if (now - lastBurst.current < delay.current) return;
        lastBurst.current = now;
      }
      if (m === "sparks") burstSparks(x, y);
      else if (m === "nova") burstNova(x, y);
      else if (m === "radar") burstRadar(x, y);
      else if (m === "ripple") burstRipple(x, y);
      else if (m === "bloom") burstBloom(x, y);
      else if (m === "rain") burstRain(x, y);
    };

    const onPointerDown = (e: PointerEvent) => {
      pending = null;
      const m = mode.current;
      if (m === "off") return;
      if (e.pointerType !== "mouse") return;        // PC uniquement
      if (e.button !== 0) return;                    // clic gauche
      if (!isDeadZone(e.target)) return;
      pending = { x: e.clientX, y: e.clientY, mode: m };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pending) return;
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > CLICK_MOVE_TOL) {
        pending = null;                              // c'est devenu un glisser → on annule
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const p = pending;
      pending = null;
      if (!p || e.button !== 0) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_MOVE_TOL) return;
      const sel = window.getSelection?.();
      if (sel && !sel.isCollapsed) return;           // du texte a été sélectionné → pas d'effet
      fire(p.mode, e.clientX, e.clientY);
    };

    const onPointerCancel = () => { pending = null; };

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
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
    document.addEventListener("mousedown", onMouseDown, true);
    return () => {
      offSetting();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
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
