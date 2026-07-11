"use client";

import Link from "next/link";
import { ArrowRight, BadgePercent, Sparkles } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { useJson } from "./use-json";

/**
 * Promotions — opérations actives (GET /api/promos?active=1) + « récemment
 * démarrées » (GET /api/notifications, badge NOUVEAU sur isNew).
 *
 * Les deux endpoints sont construits/évolutifs en parallèle → lecture 100 %
 * défensive : champs optionnels, états vides élégants, jamais d'écran cassé.
 */

interface Promo {
  id?: string;
  itemCode?: string;
  kind?: string; // PERCENT | X_PLUS_Y
  value?: number | null;
  buyQty?: number | null;
  freeQty?: number | null;
  label?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
}
interface PromosResponse {
  promos?: Promo[];
}

interface Notification {
  id?: string;
  kind?: string;
  promoId?: string;
  label?: string | null;
  itemCode?: string | null;
  startsAt?: string | null;
  isNew?: boolean;
}
interface NotificationsResponse {
  notifications?: Notification[];
}

/** Mécanique lisible : « −15 % », « 2,80 € » (tarif) ou « 5+1 ». */
function mecanique(p: Promo): string | null {
  if (p.kind === "PERCENT" && p.value != null) return `−${p.value} %`;
  if (p.kind === "PRICE" && p.value != null) return `${p.value.toFixed(2).replace(".", ",")} €`;
  if (p.kind === "X_PLUS_Y" && p.buyQty != null && p.freeQty != null) return `${p.buyQty}+${p.freeQty}`;
  return null;
}

const dateCourt = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
};

export function PromosAccueil() {
  const promosQ = useJson<PromosResponse>("/api/promos?active=1", 300_000);
  const notifsQ = useJson<NotificationsResponse>("/api/notifications", 60_000);

  const promos = (promosQ.data?.promos ?? []).slice(0, 5);
  const recentes = (notifsQ.data?.notifications ?? []).slice(0, 3);

  return (
    <SurfaceCard
      title="Promotions"
      icon={<BadgePercent className="h-3.5 w-3.5" />}
      accent="amber"
      delay={170}
      action={
        promos.length > 0 ? (
          <span className="inline-flex items-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 h-5 text-[10.5px] font-bold tnum">
            {promos.length} active{promos.length > 1 ? "s" : ""}
          </span>
        ) : undefined
      }
    >
      {/* ── Récemment démarrées (notifications) ───────────── */}
      {recentes.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/80 mb-1.5">
            Récemment démarrées
          </p>
          <ul className="space-y-1">
            {recentes.map((n, i) => (
              <li
                key={n.id ?? i}
                className="flex items-center gap-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/15 px-2.5 py-1.5"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                  {n.label || n.itemCode || "Nouvelle promotion"}
                </span>
                {dateCourt(n.startsAt) && (
                  <span className="shrink-0 text-[10px] text-muted-foreground tnum">
                    {dateCourt(n.startsAt)}
                  </span>
                )}
                {n.isNew && (
                  <span className="shrink-0 rounded-full bg-amber-500 text-[#0b1018] px-1.5 h-4 inline-flex items-center text-[9px] font-bold tracking-wide">
                    NOUVEAU
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Promos actives ─────────────────────────────────── */}
      {promosQ.state === "loading" && (
        <ul className="space-y-1.5">
          {[0, 1].map((i) => (
            <li key={i} className="h-7 rounded-lg bg-secondary/60 animate-pulse" />
          ))}
        </ul>
      )}

      {promosQ.state === "error" && (
        <p className="text-[12px] text-muted-foreground py-2 text-center">
          Promotions indisponibles pour le moment.
        </p>
      )}

      {promosQ.state === "ok" && promos.length === 0 && recentes.length === 0 && (
        <p className="text-[12px] text-muted-foreground py-2 text-center">
          Aucune promotion en cours — lancez-en une depuis la page Promos.
        </p>
      )}

      {promosQ.state === "ok" && promos.length > 0 && (
        <ul className="divide-y divide-border/60">
          {promos.map((p, i) => (
            <li key={p.id ?? i} className="flex items-center gap-2.5 py-1.5">
              {mecanique(p) && (
                <span className="shrink-0 inline-flex items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 h-5 min-w-[44px] text-[11px] font-bold tnum">
                  {mecanique(p)}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                {p.label || p.itemCode || "Promotion"}
              </span>
              {p.label && p.itemCode && (
                <span className="shrink-0 text-[10px] text-muted-foreground font-mono">
                  {p.itemCode}
                </span>
              )}
              {dateCourt(p.endsAt) && (
                <span className="shrink-0 text-[10px] text-muted-foreground tnum">
                  jusqu&apos;au {dateCourt(p.endsAt)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/promos"
        className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-500 hover:text-brand-400 transition-colors"
      >
        Gérer les promotions
        <ArrowRight className="h-3 w-3" aria-hidden />
      </Link>
    </SurfaceCard>
  );
}
