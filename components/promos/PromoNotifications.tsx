"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgePercent, Check, ExternalLink, Gift, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  ActivePromo, formatPeriode, promoArticle, promoChip, promoTitre,
} from "@/components/promos/promo-utils";

/**
 * Modale prioritaire « Nouvelles promotions » — montée DANS PromoBanner
 * (donc présente sur l'accueil ET les écrans de commande sans dépendre
 * d'autres agents).
 *
 * À l'ouverture de l'app : liste toutes les promos démarrées depuis la
 * dernière consultation (isNew côté /api/notifications). « J'ai vu » →
 * POST /api/notifications/seen pour chacune, le badge « NOUVEAU » du
 * bandeau tombe (callback onSeen). Fermer sans confirmer (X / overlay)
 * laisse les badges et ne ré-affiche pas la modale pendant la session
 * navigateur (garde sessionStorage) — elle reviendra à la prochaine
 * ouverture de l'app tant que les promos ne sont pas consultées.
 *
 * Le parent ne monte ce composant QUE si televente:promoNotifs ≠ "off".
 */

/** Garde session : modale fermée sans « J'ai vu » → on ne la repropose pas. */
const DISMISS_KEY = "televente:promoNotifsDismissed";

export function PromoNotifications({
  promos,
  onSeen,
}: {
  /** promos actives NON consultées (isNew) — déjà filtrées par le parent */
  promos: ActivePromo[];
  /** appelé après « J'ai vu » pour faire tomber les badges du bandeau */
  onSeen: (promoIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);

  // Ouverture au mount — sauf si déjà écartée pendant cette session.
  useEffect(() => {
    if (promos.length === 0) return;
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { /* ignore */ }
    if (!dismissed) setOpen(true);
    // volontairement non ré-déclenché quand promos évolue : une seule modale par chargement
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = (confirmed: boolean) => {
    if (!confirmed) {
      try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    }
    setOpen(false);
  };

  const markAllSeen = async () => {
    setMarking(true);
    const ids = promos.map((p) => p.id);
    try {
      await Promise.allSettled(
        ids.map((promoId) =>
          fetch("/api/notifications/seen", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ promoId }),
          }),
        ),
      );
      onSeen(ids);
      close(true);
    } finally {
      setMarking(false);
    }
  };

  if (promos.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(false); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-rose-500" />
            Nouvelles promotions
            <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-bold">
              {promos.length}
            </span>
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Démarrées depuis ta dernière visite — à connaître avant tes appels.
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-[52vh] overflow-y-auto divide-y divide-border/50 -mx-1 px-1">
          {promos.map((p) => (
            <li key={p.id} className="py-3 flex items-start gap-3">
              <span className="inline-flex h-[24px] min-w-[64px] justify-center items-center px-2 rounded-[5px] text-[13px] font-bold shrink-0 mt-0.5 bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-400/70 dark:bg-rose-500/30 dark:text-rose-100 dark:ring-rose-400/60">
                {p.kind === "X_PLUS_Y" ? <Gift className="h-3 w-3 mr-1" /> : <BadgePercent className="h-3 w-3 mr-1" />}
                {promoChip(p)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold text-foreground leading-tight truncate">
                  {promoTitre(p)}
                </p>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  <span className="font-medium text-foreground/80">{promoArticle(p)}</span>
                  <span className="font-mono text-[10.5px] text-muted-foreground/70"> · {p.itemCode}</span>
                  <span> · {formatPeriode(p.startsAt, p.endsAt)}</span>
                </p>
                {p.pitch?.trim() && (
                  <p className="text-[12.5px] text-foreground/85 italic mt-1 leading-snug">
                    « {p.pitch.trim()} »
                  </p>
                )}
                <div className="flex items-center gap-3 mt-1.5">
                  <Link
                    href="/promos"
                    onClick={() => close(false)}
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-rose-500 hover:text-rose-400"
                  >
                    Voir la promo <ExternalLink className="h-3 w-3" />
                  </Link>
                  <Link
                    href="/products"
                    onClick={() => close(false)}
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
                  >
                    Voir l&apos;article <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => close(false)}>Plus tard</Button>
          <Button onClick={markAllSeen} disabled={marking}>
            {marking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            J&apos;ai vu
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
