"use client";

import * as React from "react";
import { useEffect, useState, useCallback } from "react";
import {
  Phone, ShoppingCart, Clock, BellRing, ChevronRight, Loader2, Star, CheckCircle2,
} from "lucide-react";
import { displayKey, type ShortcutAction } from "@/lib/useConsoleShortcuts";
import { loadFavPhone, saveFavPhone, type PhoneKey } from "@/lib/favPhoneStorage";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatPhoneDisplay, standardizePhone } from "@/lib/phone";
import type { Client } from "./shared";

type Outcome = "NRP" | "REPONDEUR" | "REFUS" | "RAPPELE";

/** Étoile « favori » d'un numéro — bouton isolé (clic ≠ appel du lien tel:). */
function FavStar({
  active, onToggle, onYellow = false, className = "",
}: {
  active: boolean;
  onToggle: () => void;
  onYellow?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
      aria-pressed={active}
      title={active ? "Retirer des favoris" : "Définir comme numéro favori (affiché en jaune)"}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
        onYellow
          ? "text-primary-foreground/75 hover:text-primary-foreground hover:bg-black/10"
          : active
            ? "text-primary"
            : "text-muted-foreground/45 hover:text-primary hover:bg-secondary"
      } ${className}`}
    >
      <Star className={`h-4 w-4 ${active ? "fill-current" : ""}`} />
    </button>
  );
}

export function ActionPanel({
  client, onDemain, onOutcome, onRappel, onBL, onSkip, actionLoading,
  callNote, setCallNote, keymap,
}: {
  client: Client | null;
  onDemain: () => void;
  onOutcome: (o: Outcome) => void;
  onRappel: () => void;
  onBL: () => void;
  onSkip: () => void;
  actionLoading: string | null;
  callNote: string;
  setCallNote: (v: string) => void;
  keymap: Record<ShortcutAction, string>;
}) {
  // Numéro favori (mis en avant en jaune), persisté par client sur ce poste.
  const clientId = client?.id ?? null;
  const [favPhone, setFavPhone] = useState<PhoneKey | null>(null);
  useEffect(() => { setFavPhone(loadFavPhone(clientId)); }, [clientId]);
  const toggleFav = useCallback((k: PhoneKey) => {
    setFavPhone((cur) => {
      const next = cur === k ? null : k;
      saveFavPhone(clientId, next);
      return next;
    });
  }, [clientId]);

  if (!client) {
    // État calme « rien à traiter » — coche sobre, sans néon ni emoji.
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <CheckCircle2 className="h-6 w-6 text-muted-foreground/50" />
        <p className="text-body text-muted-foreground">Rien à traiter ici.</p>
      </div>
    );
  }

  const allTels = [
    { fav: "tel1" as PhoneKey, label: "Standard", value: client.tel1 },
    { fav: "tel2" as PhoneKey, label: "Direct 1", value: client.tel2 },
    { fav: "tel3" as PhoneKey, label: "Direct 2", value: client.tel3 },
  ].filter((t): t is { fav: PhoneKey; label: string; value: string } => !!t.value);
  // Le favori (s'il existe encore) passe en gros/jaune ; sinon le premier dispo.
  const primaryTel = allTels.find((t) => t.fav === favPhone) ?? allTels[0];
  const secondaryTels = allTels.filter((t) => t !== primaryTel);

  return (
    <div className="flex flex-col h-full animate-fade-in min-h-0">
      {/* ── Top zone (téléphones + note) — peut défiler si besoin ── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-6">
        {/* ── Téléphones — n°1 = CTA d'appel géant, les autres en compact ── */}
        <section>
          <p className="kicker mb-3">Appeler</p>
          {!primaryTel ? (
            <p className="text-caption italic text-muted-foreground py-2">Aucun numéro renseigné.</p>
          ) : (
            <div className="space-y-2">
              {/* Numéro principal (favori s'il existe) — gros, jaune (loi de Fitts).
                  L'étoile est un bouton SÉPARÉ du lien tel: (clic ≠ appel). */}
              <div className="relative">
                <a
                  href={`tel:${standardizePhone(primaryTel.value)}`}
                  className="group flex items-center gap-3 px-4 py-4 pr-12 rounded-2xl bg-primary text-primary-foreground shadow-[0_2px_14px_rgba(250,204,21,0.3)] hover:brightness-105 hover:shadow-[0_4px_22px_rgba(250,204,21,0.45)] transition-all active:scale-[0.99]"
                >
                  <Phone className="h-6 w-6 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-caption2 font-bold uppercase tracking-wider opacity-70">{primaryTel.label}</p>
                    <p className="text-title2 font-mono font-bold tnum leading-tight truncate">{formatPhoneDisplay(primaryTel.value)}</p>
                  </div>
                </a>
                <FavStar
                  active={favPhone === primaryTel.fav}
                  onToggle={() => toggleFav(primaryTel.fav)}
                  onYellow
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                />
              </div>
              {/* Numéros secondaires — compacts, chacun étoilable pour passer en jaune */}
              {secondaryTels.map((t) => (
                <div key={t.fav} className="flex items-center gap-1.5">
                  <a
                    href={`tel:${standardizePhone(t.value)}`}
                    className="group flex flex-1 min-w-0 items-center gap-2.5 px-3 py-2 rounded-lg bg-secondary/40 hover:bg-secondary border border-border transition-all"
                  >
                    <Phone className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="text-caption2 font-semibold uppercase tracking-wider text-muted-foreground w-16 shrink-0">{t.label}</span>
                    <span className="text-body font-mono font-semibold text-foreground tnum truncate">{formatPhoneDisplay(t.value)}</span>
                  </a>
                  <FavStar active={favPhone === t.fav} onToggle={() => toggleFav(t.fav)} />
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="hairline" />

        {/* ── Note de l'appel (CRM) ── */}
        <section>
          <p className="kicker mb-2.5">Note d&apos;appel</p>
          <Textarea
            value={callNote}
            onChange={(e) => setCallNote(e.target.value)}
            placeholder="Quantités, conditions, objection, remarque…"
            rows={3}
            className="text-body leading-relaxed resize-none"
          />
        </section>
      </div>

      {/* ── Verdict — barre fixe en bas, TOUJOURS visible (loi de Fitts) ── */}
      <div className="shrink-0 border-t border-border bg-card p-4 space-y-2">
        <p className="kicker mb-1">Résultat de l&apos;appel</p>

        {/* CTA principal — commande (BL) */}
        <VerdictButton
          onClick={onBL}
          icon={ShoppingCart}
          label="Commande (BL)"
          shortcut={displayKey(keymap.openBL)}
          variant="primary"
        />

        {/* Reports — boutons secondaires sobres (gris, sans bordure colorée) */}
        <div className="grid grid-cols-2 gap-1.5">
          <VerdictButton
            onClick={onDemain}
            loading={actionLoading === "DEMAIN"}
            icon={Clock}
            label="À demain"
            shortcut={displayKey(keymap.demain)}
            variant="secondary"
          />
          <VerdictButton
            onClick={onRappel}
            icon={BellRing}
            label="Rappel"
            shortcut={displayKey(keymap.rappel)}
            variant="secondary"
          />
        </div>

        {/* Motifs de non-vente — une rangée segmentée. Loguent l'appel (comptent
            dans la conversion, contrairement à « Passer ») et avancent la file. */}
        <div className={actionLoading != null ? "pointer-events-none opacity-50" : ""}>
          <SegmentedControl
            aria-label="Motif de non-vente"
            size="sm"
            value=""
            onChange={(v) => onOutcome(v as Outcome)}
            options={[
              { value: "NRP", label: "Sans réponse" },
              { value: "REPONDEUR", label: "Répondeur" },
              { value: "REFUS", label: "Refus" },
              { value: "RAPPELE", label: "Rappellera" },
            ]}
          />
        </div>

        <button
          type="button"
          onClick={onSkip}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-caption text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-all"
        >
          <span>Passer sans loguer</span>
          <kbd className="text-caption2 font-mono px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
            {displayKey(keymap.skip)}
          </kbd>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ── Bouton verdict — gros, plein largeur, raccourci kbd à droite ──
   "primary" = jaune brand (CTA principal) ; "secondary" = gris sobre (reports).
*/
function VerdictButton({
  onClick, loading, icon: Icon, label, shortcut, variant,
}: {
  onClick: () => void;
  loading?: boolean;
  icon: React.ElementType;
  label: string;
  shortcut: string;
  variant: "primary" | "secondary";
}) {
  const styles =
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:brightness-105 shadow-[0_2px_10px_rgba(250,204,21,0.28)] hover:shadow-[0_4px_16px_rgba(250,204,21,0.4)]"
      : "bg-secondary/60 hover:bg-secondary text-foreground";

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`w-full h-12 flex items-center gap-2.5 px-3.5 rounded-xl transition-all duration-150 active:scale-[0.98] disabled:opacity-60 ${styles}`}
    >
      <span className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
        variant === "primary" ? "bg-black/10" : "bg-card/70"
      }`}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="flex-1 text-left text-body font-semibold leading-tight">{label}</span>
      <kbd className={`text-caption2 font-mono px-1.5 py-0.5 rounded ${
        variant === "primary" ? "bg-black/15 text-primary-foreground/90" : "bg-card/70 text-muted-foreground"
      }`}>
        {shortcut}
      </kbd>
    </button>
  );
}
