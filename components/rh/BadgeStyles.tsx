"use client";

import { LogIn, MapPin } from "lucide-react";
import { MovingBorderButton } from "@/components/ui/moving-border-button";

/**
 * COMPARATEUR de styles pour le bouton pointeuse (« J'arrive »). Le halo animé de
 * la bordure est d'autant plus visible que le fond INTÉRIEUR est sombre/contrasté
 * (comme le composant d'origine). 4 variantes côte à côte — à choisir en prod.
 */
const VARIANTS: {
  key: string; label: string; inner: string; halo: string; border?: string; radius?: string;
}[] = [
  {
    key: "verre",
    label: "A · Verre sombre (original)",
    inner: "bg-slate-900/80 border border-slate-700 text-white",
    halo: "bg-[radial-gradient(#34d399_40%,transparent_60%)]",
  },
  {
    key: "noir",
    label: "B · Fond noir + halo vif",
    inner: "bg-neutral-950 border border-neutral-800 text-white",
    halo: "bg-[radial-gradient(#10b981_45%,transparent_60%)] opacity-100",
  },
  {
    key: "degrade",
    label: "C · Dégradé émeraude→noir",
    inner: "bg-gradient-to-br from-emerald-900 via-emerald-950 to-neutral-950 text-white",
    halo: "bg-[radial-gradient(#6ee7b7_45%,transparent_60%)]",
  },
  {
    key: "profond",
    label: "D · Vert profond",
    inner: "bg-emerald-950 border border-emerald-800/60 text-white",
    halo: "bg-[radial-gradient(#a7f3d0_45%,transparent_60%)]",
  },
];

function DemoButton({ inner, halo, border, radius = "1.75rem" }: { inner: string; halo: string; border?: string; radius?: string }) {
  return (
    <MovingBorderButton
      as="div"
      borderRadius={radius}
      duration={2800}
      containerClassName={`w-full block shadow-lg ${border ?? ""}`}
      borderChildClassName={`h-28 w-28 ${halo}`}
      className={`flex-col gap-2 p-6 ${inner}`}
    >
      <span className="flex items-center justify-center gap-3 text-[22px] font-bold">
        <LogIn className="h-7 w-7" /> J&apos;arrive
      </span>
      <span className="flex items-center justify-center gap-1.5 text-[13px] text-white/80">
        <MapPin className="h-3.5 w-3.5" /> Pointage géolocalisé
      </span>
    </MovingBorderButton>
  );
}

export function BadgeStyles() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <p className="text-[13px] text-muted-foreground">
        Le halo tourne le long du contour — plus visible sur fond sombre. Choisis la
        variante que tu préfères, je l&apos;applique à la pointeuse.
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        {VARIANTS.map((v) => (
          <div key={v.key} className="space-y-2">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{v.label}</div>
            <DemoButton inner={v.inner} halo={v.halo} border={v.border} radius={v.radius} />
          </div>
        ))}
      </div>
      <p className="text-center text-[12px] text-muted-foreground">
        (Variante rouge « Je pars » = même style, halo rouge.)
      </p>
    </div>
  );
}
