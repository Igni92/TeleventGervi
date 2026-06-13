"use client";

import { useTheme } from "@/components/ThemeProvider";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
      className="
        relative h-8 w-8 rounded-lg flex items-center justify-center
        text-white/40 hover:text-white/70 hover:bg-white/[0.06]
        transition-all duration-200
        focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-500
      "
    >
      <span
        className="absolute inset-0 flex items-center justify-center transition-all duration-300"
        style={{ opacity: theme === "dark" ? 1 : 0, transform: theme === "dark" ? "scale(1) rotate(0deg)" : "scale(0.5) rotate(-90deg)" }}
      >
        <Moon className="h-3.5 w-3.5" />
      </span>
      <span
        className="absolute inset-0 flex items-center justify-center transition-all duration-300"
        style={{ opacity: theme === "light" ? 1 : 0, transform: theme === "light" ? "scale(1) rotate(0deg)" : "scale(0.5) rotate(90deg)" }}
      >
        <Sun className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}
