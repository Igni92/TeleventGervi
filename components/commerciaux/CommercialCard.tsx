"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown, Mail, ArrowRight, Loader2, Users,
  Building2, Globe, Store, Check, X, Percent, Lock, Eye,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRolePreview } from "@/components/role-preview/RolePreviewProvider";
import { previewHome, PREVIEW_ROLE_LABELS, type PreviewRole } from "@/lib/rolePreview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Counts { ALL: number; CHR: number; GMS: number; EXPORT: number; OTHER: number; }

interface Props {
  userId: string;
  name: string;
  /** Clé de rattachement des clients (trigramme, ex. JMG/MM). Défaut : name. */
  commercialKey?: string;
  email: string | null;
  counts: Counts;
  isMe?: boolean;
  present?: boolean;
  stockSharePct?: number;
  /** Rôle admin (accès global) — promu en base. */
  isAdmin?: boolean;
  /** Admin « bootstrap » (codé en dur, lib/permissions.ts) → non rétrogradable ici. */
  isBootstrapAdmin?: boolean;
  /** Rôle préparateur (« en charge du stock ») — peut repasser sur les inventaires. */
  isPreparateur?: boolean;
  /** Rôle commercial (force de vente) — indépendant des autres rôles. */
  isCommercial?: boolean;
  /** Rôle direction — accès global ; gère tous les rôles SAUF admin. */
  isDirection?: boolean;
  /** Rôle livreur — accès restreint (livraison + fiche client logistique). */
  isLivreur?: boolean;
  /** Rôle agréeur — passe une commande fournisseur en entrée marchandise (sans créer). */
  isAgreeur?: boolean;
  /** Le SPECTATEUR est-il admin strict ? Seul lui peut (dé)cocher le rôle Admin. */
  canEditAdmin?: boolean;
}

export function CommercialCard({ userId, name, commercialKey, email, counts, isMe, present = true, stockSharePct = 100, isAdmin = false, isBootstrapAdmin = false, isPreparateur = false, isCommercial = true, isDirection = false, isLivreur = false, isAgreeur = false, canEditAdmin = false }: Props) {
  const [claiming, setClaiming] = useState<string | null>(null);
  const [isPresent, setIsPresent] = useState(present);
  const [share, setShare] = useState(stockSharePct);
  const [savingPresence, setSavingPresence] = useState(false);
  const [admin, setAdmin] = useState(isAdmin);
  const [savingAdmin, setSavingAdmin] = useState(false);
  const [prep, setPrep] = useState(isPreparateur);
  const [savingPrep, setSavingPrep] = useState(false);
  const [comm, setComm] = useState(isCommercial);
  const [savingComm, setSavingComm] = useState(false);
  const [direction, setDirection] = useState(isDirection);
  const [savingDir, setSavingDir] = useState(false);
  const [livreur, setLivreur] = useState(isLivreur);
  const [savingLiv, setSavingLiv] = useState(false);
  const [agreeur, setAgreeur] = useState(isAgreeur);
  const [savingAgr, setSavingAgr] = useState(false);
  // Nom affiché sans le suffixe société (« … - Gervifrais ») qui tronque sur mobile.
  const displayName = name.split(/\s+[-–]\s+/)[0].trim() || name;

  // « Voir comme » ce membre (aperçu chrome) — réservé admin/direction (canPreview).
  const router = useRouter();
  const { canPreview, setPreviewRole } = useRolePreview();
  const memberRole: PreviewRole = livreur ? "livreur" : prep ? "preparateur" : direction ? "direction" : "commercial";
  function viewAsMember() {
    setPreviewRole(memberRole);
    router.push(previewHome(memberRole));
  }

  async function toggleAdmin() {
    if (isBootstrapAdmin) return; // admin système : non modifiable depuis l'UI
    const next = !admin;
    setAdmin(next); setSavingAdmin(true);
    try { await patch({ isAdmin: next }); toast.success(next ? `${name} est désormais admin` : `${name} repassé en commercial`); }
    catch { setAdmin(!next); toast.error("Erreur changement de rôle"); }
    finally { setSavingAdmin(false); }
  }

  async function togglePrep() {
    const next = !prep;
    setPrep(next); setSavingPrep(true);
    try { await patch({ isPreparateur: next }); toast.success(next ? `${name} est désormais préparateur (stock)` : `${name} n'est plus préparateur`); }
    catch { setPrep(!next); toast.error("Erreur changement de rôle"); }
    finally { setSavingPrep(false); }
  }

  async function toggleDirection() {
    const next = !direction;
    setDirection(next); setSavingDir(true);
    try { await patch({ isDirection: next }); toast.success(next ? `${name} est désormais direction` : `${name} n'est plus direction`); }
    catch { setDirection(!next); toast.error("Erreur changement de rôle"); }
    finally { setSavingDir(false); }
  }

  async function toggleCommercial() {
    const next = !comm;
    setComm(next); setSavingComm(true);
    try { await patch({ isCommercial: next }); toast.success(next ? `${name} est désormais commercial` : `${name} n'est plus commercial`); }
    catch { setComm(!next); toast.error("Erreur changement de rôle"); }
    finally { setSavingComm(false); }
  }

  async function toggleLivreur() {
    const next = !livreur;
    setLivreur(next); setSavingLiv(true);
    try { await patch({ isLivreur: next }); toast.success(next ? `${name} est désormais livreur` : `${name} n'est plus livreur`); }
    catch { setLivreur(!next); toast.error("Erreur changement de rôle"); }
    finally { setSavingLiv(false); }
  }

  async function toggleAgreeur() {
    const next = !agreeur;
    setAgreeur(next); setSavingAgr(true);
    try { await patch({ isAgreeur: next }); toast.success(next ? `${name} est désormais agréeur (réception des commandes)` : `${name} n'est plus agréeur`); }
    catch { setAgreeur(!next); toast.error("Erreur changement de rôle"); }
    finally { setSavingAgr(false); }
  }

  async function patch(payload: Record<string, unknown>) {
    const res = await fetch("/api/commerciaux", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, ...payload }),
    });
    if (!res.ok) throw new Error();
  }
  async function togglePresence() {
    const next = !isPresent;
    setIsPresent(next); setSavingPresence(true);
    try { await patch({ present: next }); toast.success(next ? `${name} présent(e)` : `${name} absent(e) — clients à couvrir`); }
    catch { setIsPresent(!next); toast.error("Erreur présence"); }
    finally { setSavingPresence(false); }
  }
  async function saveShare(v: number) {
    const pct = Math.max(0, Math.min(100, v));
    setShare(pct);
    try { await patch({ stockSharePct: pct }); } catch { toast.error("Erreur % stock"); }
  }

  async function claim(type: "ALL" | "CHR" | "GMS" | "EXPORT") {
    setClaiming(type);
    try {
      const res = await fetch("/api/temp-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commercial: commercialKey ?? name, type }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const created = data.created ?? 0;
      const skipped = data.skipped ?? 0;
      if (created === 0 && skipped === 0) {
        toast("Aucun client à récupérer", { description: `${name} n'a pas de clients ${type === "ALL" ? "" : type}.` });
      } else {
        toast.success(
          `${created} client${created > 1 ? "s" : ""} récupéré${created > 1 ? "s" : ""}`,
          { description: skipped > 0 ? `${skipped} déjà couvert${skipped > 1 ? "s" : ""}` : `Visible dans ta console aujourd'hui` },
        );
      }
    } catch {
      toast.error("Erreur lors de la récupération");
    } finally {
      setClaiming(null);
    }
  }

  return (
    <div className="bg-card rounded-xl border border-border p-4 flex items-start justify-between gap-3 hover:border-foreground/20 transition-colors">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {/* Avatar */}
        <div className="flex-shrink-0 h-10 w-10 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-white font-bold text-[13px] shadow-[0_0_0_2px_hsl(var(--brand-500)_/_0.18)]">
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-foreground truncate text-[14px]">{displayName}</p>
            {isMe && (
              <span className="text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-brand-600 text-white">
                vous
              </span>
            )}
          </div>
          {email && (
            <p className="text-[11.5px] text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
              <Mail className="h-3 w-3 flex-shrink-0" />
              {email}
            </p>
          )}

          {/* Type breakdown */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-muted-foreground tnum">
            <span className="font-semibold text-foreground">{counts.ALL}</span>
            <span>clients</span>
            <span className="opacity-30">·</span>
            {counts.CHR > 0 && <span><span className="font-medium text-foreground/80 tnum">{counts.CHR}</span> CHR</span>}
            {counts.GMS > 0 && <span><span className="font-medium text-foreground/80 tnum">{counts.GMS}</span> GMS</span>}
            {counts.EXPORT > 0 && <span><span className="font-medium text-foreground/80 tnum">{counts.EXPORT}</span> EXPORT</span>}
          </div>

          {/* Présence + % stock + RÔLES (multi-sélection) — outils admin, masqués sur mobile */}
          <div className="hidden md:block mt-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={togglePresence}
                disabled={savingPresence}
                className={`inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-60 ${
                  isPresent
                    ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                    : "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300"
                }`}
              >
                {savingPresence ? <Loader2 className="h-3 w-3 animate-spin" /> : isPresent ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                {isPresent ? "Présent" : "Absent"}
              </button>
              {/* % stock attribué — n'a de sens que pour un commercial (force de vente) */}
              {comm && (
                <label className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-secondary/60 text-[11px] text-muted-foreground" title="% du stock total attribué à ce commercial">
                  <Percent className="h-3 w-3" />
                  <input
                    type="number" min={0} max={100} step={5}
                    value={share}
                    onChange={(e) => setShare(parseFloat(e.target.value) || 0)}
                    onBlur={(e) => saveShare(parseFloat(e.target.value) || 0)}
                    className="w-10 bg-transparent text-right tnum text-foreground focus:outline-none"
                  />
                  <span>stock</span>
                </label>
              )}
            </div>

            {/* RÔLES — cases à cocher indépendantes : un compte peut en cumuler plusieurs */}
            <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
              <span className="mr-0.5 select-none text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Rôles</span>
              <RoleCheck label="Commercial" active={comm} saving={savingComm} onToggle={toggleCommercial}
                title={comm ? "Retirer le rôle commercial" : "Désigner commercial (force de vente)"} />
              <RoleCheck label="Préparateur" active={prep} saving={savingPrep} onToggle={togglePrep}
                title={prep ? "Retirer le rôle préparateur (stock)" : "Désigner préparateur (en charge du stock)"} />
              <RoleCheck label="Direction" active={direction} saving={savingDir} onToggle={toggleDirection}
                title={direction ? "Retirer le rôle direction" : "Désigner direction (gère les rôles sauf admin)"} />
              <RoleCheck label="Admin" active={admin}
                locked={isBootstrapAdmin}
                disabled={!isBootstrapAdmin && !canEditAdmin}
                saving={savingAdmin}
                onToggle={canEditAdmin ? toggleAdmin : undefined}
                note={isBootstrapAdmin ? "système" : undefined}
                title={isBootstrapAdmin
                  ? "Admin système (défini dans le code) — non modifiable ici"
                  : canEditAdmin
                    ? (admin ? "Retirer les droits administrateur" : "Promouvoir administrateur")
                    : "Rôle admin — réservé aux administrateurs"} />
              <RoleCheck label="Livreur" active={livreur} saving={savingLiv} onToggle={toggleLivreur}
                title={livreur ? "Retirer le rôle livreur" : "Désigner livreur (livraison + fiche client)"} />
              <RoleCheck label="Agréeur" active={agreeur} saving={savingAgr} onToggle={toggleAgreeur}
                title={agreeur ? "Retirer le rôle agréeur" : "Désigner agréeur (passe une commande fournisseur en entrée marchandise, sans pouvoir créer)"} />
            </div>

            {/* « Voir comme ce membre » — aperçu de l'app (admin/direction) */}
            {canPreview && (
              <button
                type="button"
                onClick={viewAsMember}
                title={`Voir l'application comme ${displayName} (aperçu ${PREVIEW_ROLE_LABELS[memberRole]})`}
                className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
              >
                <Eye className="h-3.5 w-3.5" /> Voir comme {PREVIEW_ROLE_LABELS[memberRole]}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <Link
          href={`/clients?commercial=${encodeURIComponent(name)}`}
          className="text-[11.5px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 border-b border-border hover:border-foreground pb-0.5"
        >
          Voir clients
          <ArrowRight className="h-3 w-3" />
        </Link>

        {!isMe && counts.ALL > 0 && (
          <div className="hidden md:block">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={!!claiming}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium bg-brand-600 hover:bg-brand-700 text-white transition-colors active:scale-[0.97] disabled:opacity-60"
              >
                {claiming ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    Récupérer
                    <ChevronDown className="h-3 w-3" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">
                Récupérer pour aujourd&apos;hui
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => claim("ALL")}
                className="cursor-pointer flex items-center gap-2 text-[13px]"
              >
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                Tous les clients
                <span className="ml-auto tnum text-muted-foreground text-[11.5px]">{counts.ALL}</span>
              </DropdownMenuItem>

              {counts.CHR > 0 && (
                <DropdownMenuItem
                  onClick={() => claim("CHR")}
                  className="cursor-pointer flex items-center gap-2 text-[13px]"
                >
                  <Store className="h-3.5 w-3.5 text-muted-foreground" />
                  Uniquement CHR
                  <span className="ml-auto tnum text-muted-foreground text-[11.5px]">{counts.CHR}</span>
                </DropdownMenuItem>
              )}
              {counts.GMS > 0 && (
                <DropdownMenuItem
                  onClick={() => claim("GMS")}
                  className="cursor-pointer flex items-center gap-2 text-[13px]"
                >
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Uniquement GMS
                  <span className="ml-auto tnum text-muted-foreground text-[11.5px]">{counts.GMS}</span>
                </DropdownMenuItem>
              )}
              {counts.EXPORT > 0 && (
                <DropdownMenuItem
                  onClick={() => claim("EXPORT")}
                  className="cursor-pointer flex items-center gap-2 text-[13px]"
                >
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                  Uniquement EXPORT
                  <span className="ml-auto tnum text-muted-foreground text-[11.5px]">{counts.EXPORT}</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-[10.5px] text-muted-foreground leading-tight">
                Les clients récupérés apparaîtront dans votre console jusqu&apos;à minuit.
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Case à cocher de rôle (multi-sélection). Chaque rôle est INDÉPENDANT : un
 * compte peut cumuler Commercial + Préparateur + Admin (+ Livreur à venir).
 *   - cochée         → rôle actif (clic = décocher)
 *   - locked         → rôle « système » (bootstrap code/env), coché et figé (cadenas)
 *   - disabled       → rôle pas encore disponible (Livreur), grisé
 * Présentation case à cocher (et non pastille colorée) pour la lisibilité.
 * ------------------------------------------------------------------------- */
function RoleCheck({
  label, active = false, locked = false, disabled = false, saving = false, onToggle, title, note,
}: {
  label: string;
  active?: boolean;
  locked?: boolean;
  disabled?: boolean;
  saving?: boolean;
  onToggle?: () => void;
  title?: string;
  note?: string;
}) {
  const interactive = !locked && !disabled;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      aria-disabled={!interactive}
      onClick={interactive ? onToggle : undefined}
      disabled={saving || disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12.5px] transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus:outline-none ${
        disabled ? "cursor-not-allowed" : locked ? "cursor-default" : "hover:bg-secondary/60"
      }`}
    >
      <span
        className={`grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[4px] border transition-colors ${
          active
            ? "border-brand-600 bg-brand-600 text-white"
            : disabled
              ? "border-dashed border-border bg-muted"
              : "border-border bg-background"
        }`}
      >
        {saving ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        ) : locked ? (
          <Lock className="h-2.5 w-2.5" />
        ) : active ? (
          <Check className="h-3 w-3" strokeWidth={3} />
        ) : null}
      </span>
      <span className={`font-medium ${disabled ? "text-muted-foreground/60" : "text-foreground"}`}>{label}</span>
      {note && <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{note}</span>}
    </button>
  );
}
