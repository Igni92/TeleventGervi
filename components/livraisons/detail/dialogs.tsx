"use client";

/* ═════════════════════════════════════════════════════════════
   « Fait par… » — équipe + dialog de choix de la personne.
   Partagés entre la ligne (OrderRow) et le groupe transporteur (CarrierGroup).
   Restyle refonte : Dialog du système (size sm), échelle typo fermée, couleur
   d'état via tokens (--success) — comportement inchangé.
═════════════════════════════════════════════════════════════ */
import { useEffect, useState, type ReactNode } from "react";
import { UserCog, Loader2, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { displayPersonName } from "@/lib/userNames";

/** Équipe de l'app (/api/users) — chargée à la PREMIÈRE activation, puis cachée. */
function useTeam(active: boolean) {
  const [team, setTeam] = useState<{ name: string | null; email: string | null }[] | null>(null);
  useEffect(() => {
    if (!active || team) return;
    let cancelled = false;
    fetch("/api/users")
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setTeam(j?.users ?? []); })
      .catch(() => { if (!cancelled) setTeam([]); });
    return () => { cancelled = true; };
  }, [active, team]);
  return team;
}

/** Dialog « Qui a fait cette commande ? » — liste l'équipe, un clic ré-attribue. */
export function PreparedByDialog({
  open, onOpenChange, subtitle, currentBy, saving, onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subtitle: ReactNode;
  /** Personne actuellement créditée (surlignée) — null si mixte / inconnue. */
  currentBy: string | null;
  saving: boolean;
  onPick: (person: string) => void;
}) {
  const team = useTeam(open);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent size="sm">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2 pr-8">
            <UserCog className="h-5 w-5 text-success shrink-0" />
            Qui a fait cette commande ?
          </DialogTitle>
          <DialogDescription className="text-caption">{subtitle}</DialogDescription>
        </DialogHeader>
        {team === null ? (
          <div className="flex items-center gap-2 py-3 text-body text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement de l&apos;équipe…
          </div>
        ) : team.length === 0 ? (
          <p className="text-caption text-muted-foreground py-2">Aucun utilisateur trouvé.</p>
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto divide-y divide-border rounded-lg ring-1 ring-border">
            {team.map((u) => {
              const value = (u.name?.trim() || u.email || "").trim();
              if (!value) return null;
              const current = value === (currentBy ?? "").trim();
              return (
                <li key={u.email ?? value}>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => onPick(value)}
                    className={`flex min-h-11 w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-body font-medium transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)] disabled:opacity-60 ${
                      current
                        ? "bg-success/10 text-success"
                        : "text-foreground hover:bg-secondary/60"
                    }`}
                  >
                    <span className="truncate">
                      {displayPersonName(value)}
                      <span className="ml-1.5 text-caption2 text-muted-foreground font-normal">{value}</span>
                    </span>
                    {current && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
