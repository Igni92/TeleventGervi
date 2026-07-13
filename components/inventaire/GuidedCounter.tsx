"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Check, Minus, Plus, X, ListChecks, Flag } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { DesignationChips } from "@/components/entrees/DesignationChips";
import { BrandLogo } from "@/components/BrandLogo";
import { designationProduit } from "@/lib/produit-designation";
import { fmt, sapInfo, ecartOf, productTile, type Product } from "./inv-utils";

export function GuidedCounter({
  products,
  scopeLabel,
  counts,
  setCount,
  brandLogos,
  startIndex = 0,
  onExit,
  onFinish,
}: {
  products: Product[];
  scopeLabel: string;
  counts: Record<string, number | null>;
  setCount: (itemCode: string, n: number | null) => void;
  brandLogos?: Map<string, string>;
  startIndex?: number;
  onExit: () => void;
  onFinish: () => void;
}) {
  const N = products.length;
  const [cursor, setCursor] = useState(Math.min(Math.max(0, startIndex), Math.max(0, N - 1)));
  const [dir, setDir] = useState(1);
  const reduce = useReducedMotion();

  const countedInScope = useMemo(
    () => products.filter((p) => counts[p.itemCode] != null && Number.isFinite(counts[p.itemCode] as number)).length,
    [products, counts],
  );

  if (N === 0) return null;
  const p = products[cursor];
  const sap = sapInfo(p);                       // stock attendu, en COLIS
  const real = counts[p.itemCode] ?? null;
  const ecart = ecartOf(real, sap.qty);
  const isLast = cursor >= N - 1;
  const isFirst = cursor <= 0;
  const hasModif = real != null;                // une valeur réelle a été notifiée

  const move = (d: number) => {
    setDir(d);
    setCursor((c) => Math.min(Math.max(0, c + d), N - 1));
  };
  const next = () => (isLast ? onFinish() : move(1));
  const conforme = () => { setCount(p.itemCode, sap.qty); next(); };
  const bump = (d: number) => setCount(p.itemCode, Math.max(0, (real ?? 0) + d));

  return (
    <div className="space-y-4">
      {/* Barre supérieure : sortir · périmètre · progression */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onExit} aria-label="Retour">
          <ChevronLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-foreground">{scopeLabel}</div>
          <div className="text-[11.5px] text-muted-foreground tnum">
            {cursor + 1} / {N} · {countedInScope} compté{countedInScope > 1 ? "s" : ""}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onFinish} className="gap-1.5">
          <Flag className="!size-3.5" /> Terminer
        </Button>
      </div>

      {/* Progression */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-brand-500 transition-[width] duration-300 ease-smooth"
          style={{ width: `${((cursor + 1) / N) * 100}%` }}
        />
      </div>

      {/* Carte produit (une à la fois) */}
      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={p.id}
            custom={dir}
            initial={reduce ? false : { opacity: 0, x: dir > 0 ? 40 : -40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir > 0 ? -40 : 40 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <SurfaceCard accent="sky" animate={false} className="p-5 sm:p-6">
              {/* Identité produit */}
              <div className="flex items-start gap-4">
                <div className={`grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-[30px] font-bold leading-none ${productTile(p).color}`}>
                  {productTile(p).initial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[22px] font-bold leading-tight text-foreground">{p.itemName}</div>
                  {(() => {
                    const dz = designationProduit({
                      itemName: p.itemName, uPays: p.uPays, uMarque: p.uMarque,
                      uCondi: p.uCondi ?? p.uUvc, frgnName: p.frgnName,
                    });
                    return <DesignationChips marque={dz.marque} condt={dz.condt} variete={dz.variete} pays={dz.pays} className="mt-1.5" />;
                  })()}
                  <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">{p.itemCode}</div>
                </div>
                <BrandLogo marque={p.uMarque} logos={brandLogos} size="lg" className="ml-auto self-start" zoomable />
              </div>

              {/* Stock attendu SAP (en colis) */}
              <div className="mt-5 rounded-2xl bg-muted/60 p-4 text-center">
                <div className="kicker !block">Stock attendu · SAP</div>
                <div className="mt-1 text-[34px] font-bold leading-none tnum text-foreground">
                  {fmt(sap.qty)} <span className="text-[16px] font-semibold text-muted-foreground">colis</span>
                </div>
              </div>

              {/* ① Le stock est bon → Conforme */}
              <Button variant="success" size="lg" className="mt-4 h-14 w-full text-[16px]" onClick={conforme}>
                <Check className="!size-5" /> Conforme — {fmt(sap.qty)} colis
              </Button>

              {/* ② Sinon : notifier la quantité réelle (en colis) */}
              <div className="mt-4">
                <label className="mb-1.5 block text-[12px] font-semibold text-muted-foreground">
                  Sinon, saisis le stock réel (colis) puis « Suivant »
                </label>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" className="h-14 w-14 shrink-0" onClick={() => bump(-1)} aria-label="−1 colis">
                    <Minus className="!size-5" />
                  </Button>
                  <NumberInput
                    value={real}
                    onValueChange={(n) => setCount(p.itemCode, n)}
                    min={0}
                    step={1}
                    allowEmpty
                    placeholder="—"
                    aria-label="Stock compté (en colis)"
                    className="h-14 flex-1 text-center text-[28px] font-bold"
                  />
                  <Button variant="outline" size="icon" className="h-14 w-14 shrink-0" onClick={() => bump(1)} aria-label="+1 colis">
                    <Plus className="!size-5" />
                  </Button>
                </div>

                {/* Écart en direct (colis) */}
                <div className="mt-2 flex h-6 items-center justify-center">
                  {ecart != null && (
                    ecart === 0 ? (
                      <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <Check className="h-4 w-4" /> Identique au stock SAP
                      </span>
                    ) : (
                      <span className={`inline-flex items-center gap-1 text-[13px] font-bold tnum ${ecart > 0 ? "text-sky-600 dark:text-sky-400" : "text-amber-600 dark:text-amber-400"}`}>
                        Écart {ecart > 0 ? `+${fmt(ecart)}` : fmt(ecart)} colis
                      </span>
                    )
                  )}
                  {hasModif && (
                    <button
                      type="button"
                      onClick={() => setCount(p.itemCode, null)}
                      className="ml-3 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" /> Effacer
                    </button>
                  )}
                </div>
              </div>
            </SurfaceCard>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation bas (sticky sur mobile) — Suivant validant la modif saisie */}
      <div className="sticky bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t from-background via-background/95 to-transparent pb-1 pt-2">
        <Button variant="outline" size="lg" className="h-12 px-4" onClick={() => move(-1)} disabled={isFirst} aria-label="Précédent">
          <ChevronLeft />
        </Button>
        <Button size="lg" className="h-12 flex-1 text-[15px]" onClick={next} disabled={!hasModif} title={hasModif ? undefined : "Saisis le stock réel, ou utilise « Conforme »"}>
          {isLast ? (
            <><ListChecks className="!size-5" /> Voir le récap</>
          ) : (
            <>Suivant (modif) <ChevronRight className="!size-5" /></>
          )}
        </Button>
      </div>
    </div>
  );
}
