"use client";

import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * TextShimmerWave — texte de chargement animé (vague lettre à lettre) inspiré de
 * motion-primitives. Chaque caractère ondule (translateZ / scale / rotateY) et
 * sa couleur passe de `--shimmer-base` à `--shimmer-hi`. Les couleurs sont des
 * hex (via classes utilitaires) pour une interpolation fiable par framer, et un
 * couple `dark:` assure la lisibilité dans les deux thèmes. Surcharge possible
 * par `className` (ex. teinte marque pour les loaders).
 */
export type TextShimmerWaveProps = {
  children: string;
  as?: React.ElementType;
  className?: string;
  duration?: number;
  zDistance?: number;
  xDistance?: number;
  yDistance?: number;
  spread?: number;
  scaleDistance?: number;
  rotateYDistance?: number;
};

export function TextShimmerWave({
  children,
  as: Component = "span",
  className,
  duration = 1,
  zDistance = 10,
  xDistance = 2,
  yDistance = -2,
  spread = 1,
  scaleDistance = 1.1,
  rotateYDistance = 10,
}: TextShimmerWaveProps) {
  const MotionComponent = motion.create(Component);

  return (
    <MotionComponent
      className={cn(
        "relative inline-block [perspective:500px] [transform-style:preserve-3d]",
        "[--shimmer-base:#a1a1aa] [--shimmer-hi:#3f3f46]",
        "dark:[--shimmer-base:#3f3f46] dark:[--shimmer-hi:#f4f4f5]",
        className,
      )}
      style={{ color: "var(--shimmer-base)" } as CSSProperties}
    >
      {children.split("").map((char, i) => {
        const delay = (i * duration * (1 / spread)) / children.length;
        return (
          <motion.span
            key={i}
            className="inline-block whitespace-pre [transform-style:preserve-3d]"
            initial={{ scale: 1, rotateY: 0, color: "var(--shimmer-base)" }}
            animate={{
              translateZ: [0, zDistance, 0],
              translateX: [0, xDistance, 0],
              translateY: [0, yDistance, 0],
              scale: [1, scaleDistance, 1],
              rotateY: [0, rotateYDistance, 0],
              color: ["var(--shimmer-base)", "var(--shimmer-hi)", "var(--shimmer-base)"],
            }}
            transition={{
              duration,
              repeat: Infinity,
              repeatDelay: (children.length * 0.05) / spread,
              delay,
              ease: "easeInOut",
            }}
          >
            {char}
          </motion.span>
        );
      })}
    </MotionComponent>
  );
}
