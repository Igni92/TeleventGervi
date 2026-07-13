"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CELEBRATION_EVENT, SETTING_KEYS, readSetting, readCelebrationStyle,
} from "@/components/settings/app-settings";

/**
 * Célébration « grosse marge » — pluie de billets / pièces + badge « +X € ».
 *
 * Déclenchée par l'évènement global `televente:celebration` (émis par
 * `celebrateSale(margeNette)` quand la marge nette d'une commande validée atteint
 * le seuil réglé). L'intensité (nombre de billets, mention) grimpe avec le ratio
 * marge/seuil. Trois styles au choix (réglage `celebrationStyle`) : billets,
 * confettis dorés, ou les deux.
 *
 * Overlay canvas unique (pointer-events: none), boucle rAF active SEULEMENT tant
 * que des particules vivent — coût nul au repos. Le badge est un élément DOM animé
 * (framer-motion). Entièrement désactivable via le réglage `celebration` (le gating
 * est fait en amont dans `celebrateSale`, reduced-motion compris).
 */

type CKind = "bill" | "coin" | "confetti" | "spark" | "ring";

interface CP {
  x: number; y: number;
  vx: number; vy: number;
  rot: number; vrot: number;
  phase: number; vphase: number;   // rotation « 3D » (flip)
  w: number; h: number;            // billet/confetti : dimensions ; pièce : rayon = w
  hue: number; sat: number; light: number;
  born: number; life: number;
  kind: CKind;
  maxR: number;                    // ring
  alpha: number;
}

const MAX = 260;

/** Couleurs de billets (euros stylisés) : vert 100 · orange 50 · bleu 20. */
const NOTES = [
  { hue: 146, sat: 42, light: 46 },
  { hue: 28,  sat: 72, light: 52 },
  { hue: 208, sat: 55, light: 52 },
];

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

interface Badge { id: number; amount: number; tier: number; }

export function SaleCelebration() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const parts = useRef<CP[]>([]);
  const raf = useRef<number | null>(null);
  const idRef = useRef(0);
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [badge, setBadge] = useState<Badge | null>(null);

  useEffect(() => {
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

    const dark = () => document.documentElement.classList.contains("dark");
    const push = (p: CP) => { if (parts.current.length < MAX) parts.current.push(p); };

    const tick = () => {
      const now = performance.now();
      const vw = window.innerWidth, vh = window.innerHeight;
      ctx.clearRect(0, 0, vw, vh);
      const alive: CP[] = [];
      for (const p of parts.current) {
        const age = now - p.born;
        const t = age / p.life;
        if (t >= 1) continue;

        if (p.kind === "ring") {
          const eased = 1 - Math.pow(1 - t, 3);
          const r = 6 + eased * p.maxR;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = `hsl(${p.hue} ${p.sat}% ${p.light}% / ${p.alpha * (1 - t)})`;
          ctx.lineWidth = 2.4 * (1 - t) + 0.4;
          ctx.stroke();
          alive.push(p);
          continue;
        }

        // Physique commune (chute + balancement + rotation).
        p.vy += 0.16;                         // gravité
        p.vx += Math.sin(now * 0.002 + p.phase) * 0.04;   // balancement latéral
        p.vx *= 0.995;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        p.phase += p.vphase;
        if (p.y > vh + 60) continue;          // sortie par le bas
        const fade = t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1;
        const a = p.alpha * fade;
        const sx = Math.max(0.16, Math.abs(Math.cos(p.phase)));   // flip « 3D »

        if (p.kind === "spark") {
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.5, p.w * (1 - t * 0.7)), 0, Math.PI * 2);
          ctx.fillStyle = `hsl(${p.hue} ${p.sat}% ${p.light}% / ${a})`;
          ctx.fill();
          alive.push(p);
          continue;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(sx, 1);
        ctx.globalAlpha = a;

        if (p.kind === "coin") {
          const r = p.w;
          const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
          g.addColorStop(0, `hsl(48 100% 82%)`);
          g.addColorStop(0.55, `hsl(${p.hue} 95% 55%)`);
          g.addColorStop(1, `hsl(${p.hue} 90% 40%)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = `hsl(${p.hue} 90% 34% / .8)`;
          ctx.stroke();
          ctx.fillStyle = `hsl(${p.hue} 90% 30% / .85)`;
          ctx.font = `bold ${Math.round(r * 1.1)}px system-ui, sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("€", 0, r * 0.06);
        } else if (p.kind === "confetti") {
          ctx.fillStyle = `hsl(${p.hue} ${p.sat}% ${p.light}%)`;
          roundRect(ctx, -p.w / 2, -p.h / 2, p.w, p.h, 1.5);
          ctx.fill();
        } else {
          // billet
          const w = p.w, h = p.h;
          const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
          g.addColorStop(0, `hsl(${p.hue} ${p.sat}% ${p.light + 8}%)`);
          g.addColorStop(1, `hsl(${p.hue} ${p.sat}% ${p.light - 6}%)`);
          roundRect(ctx, -w / 2, -h / 2, w, h, 3);
          ctx.fillStyle = g;
          ctx.fill();
          ctx.lineWidth = 0.8;
          ctx.strokeStyle = `hsl(${p.hue} ${p.sat}% ${p.light + 20}% / .8)`;
          roundRect(ctx, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 2);
          ctx.stroke();
          ctx.fillStyle = `hsl(${p.hue} ${p.sat}% ${p.light + 28}% / .95)`;
          ctx.font = `bold ${Math.round(h * 0.5)}px system-ui, sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("€", 0, h * 0.04);
        }
        ctx.restore();
        alive.push(p);
      }
      parts.current = alive;
      if (alive.length > 0) raf.current = requestAnimationFrame(tick);
      else { raf.current = null; ctx.clearRect(0, 0, vw, vh); }
    };
    const start = () => { if (raf.current == null) raf.current = requestAnimationFrame(tick); };

    const spawn = (margin: number, threshold: number) => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const now = performance.now();
      const d = dark();
      const ratio = threshold > 0 ? margin / threshold : 1;
      const intensity = Math.max(1, Math.min(ratio, 3));   // 1 → 3
      const tier = ratio >= 2 ? 2 : 1;
      const style = readCelebrationStyle(readSetting(SETTING_KEYS.celebrationStyle, "both"));
      const wantBills = style === "bills" || style === "both";
      const wantConfetti = style === "confetti" || style === "both";

      // Pluie de billets — répartis en largeur, démarrés AU-DESSUS de l'écran
      // (y négatifs échelonnés) → ils entrent progressivement, effet de pluie.
      if (wantBills) {
        const bills = Math.round(22 * intensity);
        for (let i = 0; i < bills; i++) {
          const note = NOTES[Math.floor(Math.random() * NOTES.length)];
          const w = 22 + Math.random() * 12;
          push({
            x: Math.random() * vw,
            y: -Math.random() * vh * 1.2 - 20,
            vx: (Math.random() - 0.5) * 1.6,
            vy: 1.6 + Math.random() * 2.4,
            rot: Math.random() * Math.PI, vrot: (Math.random() - 0.5) * 0.16,
            phase: Math.random() * Math.PI * 2, vphase: 0.05 + Math.random() * 0.08,
            w, h: w * 0.56,
            hue: note.hue, sat: note.sat, light: note.light,
            born: now, life: 2600 + Math.random() * 1200,
            kind: "bill", maxR: 0, alpha: 1,
          });
        }
        // Quelques pièces d'or intercalées.
        const coins = Math.round(8 * intensity);
        for (let i = 0; i < coins; i++) {
          push({
            x: Math.random() * vw,
            y: -Math.random() * vh - 20,
            vx: (Math.random() - 0.5) * 1.4,
            vy: 2 + Math.random() * 2.6,
            rot: 0, vrot: (Math.random() - 0.5) * 0.1,
            phase: Math.random() * Math.PI * 2, vphase: 0.09 + Math.random() * 0.1,
            w: 7 + Math.random() * 5, h: 0,
            hue: 44, sat: 95, light: 55,
            born: now, life: 2600 + Math.random() * 1000,
            kind: "coin", maxR: 0, alpha: 1,
          });
        }
      }

      // Confettis dorés / marque.
      if (wantConfetti) {
        const conf = Math.round(30 * intensity);
        const hues = [44, 46, 40, 210, 0];
        for (let i = 0; i < conf; i++) {
          const w = 5 + Math.random() * 6;
          push({
            x: Math.random() * vw,
            y: -Math.random() * vh - 20,
            vx: (Math.random() - 0.5) * 2.4,
            vy: 1.8 + Math.random() * 2.8,
            rot: Math.random() * Math.PI, vrot: (Math.random() - 0.5) * 0.24,
            phase: Math.random() * Math.PI * 2, vphase: 0.1 + Math.random() * 0.14,
            w, h: w * (0.4 + Math.random() * 0.5),
            hue: hues[i % hues.length],
            sat: i % 5 === 4 ? 0 : 90,
            light: i % 5 === 4 ? 100 : 55 + Math.random() * 12,
            born: now, life: 2400 + Math.random() * 1200,
            kind: "confetti", maxR: 0, alpha: 1,
          });
        }
      }

      // Éclat doré central (feedback immédiat) : anneau + gerbe d'étincelles.
      const cx = vw / 2, cy = vh * 0.4;
      push({
        x: cx, y: cy, vx: 0, vy: 0, rot: 0, vrot: 0, phase: 0, vphase: 0,
        w: 0, h: 0, hue: 46, sat: 95, light: d ? 62 : 48, alpha: 0.7,
        born: now, life: 520, kind: "ring", maxR: 70 * intensity,
      });
      const sparks = Math.round(18 * intensity);
      for (let i = 0; i < sparks; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 3 + Math.random() * 6;
        push({
          x: cx, y: cy,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 1,
          rot: 0, vrot: 0, phase: 0, vphase: 0,
          w: 1.6 + Math.random() * 2.2, h: 0,
          hue: 44 + Math.random() * 8, sat: 95, light: d ? 62 : 46, alpha: 1,
          born: now, life: 620 + Math.random() * 320, kind: "spark", maxR: 0,
        });
      }

      start();
      idRef.current += 1;
      setBadge({ id: idRef.current, amount: margin, tier });
      if (badgeTimer.current) clearTimeout(badgeTimer.current);
      badgeTimer.current = setTimeout(() => setBadge(null), 2000 + tier * 300);
    };

    const onCelebrate = (e: Event) => {
      const detail = (e as CustomEvent<{ margin?: number; threshold?: number }>).detail;
      const margin = Number(detail?.margin);
      if (!Number.isFinite(margin)) return;
      const threshold = Number(detail?.threshold) || margin;
      spawn(margin, threshold);
    };

    window.addEventListener(CELEBRATION_EVENT, onCelebrate as EventListener);
    return () => {
      window.removeEventListener(CELEBRATION_EVENT, onCelebrate as EventListener);
      window.removeEventListener("resize", resize);
      if (raf.current != null) cancelAnimationFrame(raf.current);
      if (badgeTimer.current) clearTimeout(badgeTimer.current);
    };
  }, []);

  const amountLabel = badge
    ? `+${Math.round(badge.amount).toLocaleString("fr-FR")} €`
    : "";

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[96]"
      />
      <AnimatePresence>
        {badge && (
          <motion.div
            key={badge.id}
            initial={{ opacity: 0, scale: 0.6, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -10 }}
            transition={{ type: "spring", stiffness: 420, damping: 22 }}
            className="pointer-events-none fixed inset-x-0 top-[32%] z-[97] flex justify-center px-4"
            aria-hidden
          >
            <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-brand-400/50 bg-background/85 px-6 py-3.5 shadow-[0_10px_40px_rgba(0,0,0,.45)] backdrop-blur-md">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-500 dark:text-brand-300">
                {badge.tier >= 2 ? "🔥 Grosse marge" : "🎉 Belle marge"}
              </span>
              <span className="bg-gradient-to-b from-brand-300 to-brand-600 bg-clip-text text-4xl font-extrabold tabular-nums tracking-tight text-transparent drop-shadow-sm sm:text-5xl">
                {amountLabel}
              </span>
              <span className="text-[12px] font-medium text-muted-foreground">
                de marge nette sur cette commande
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
