"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown, Mail, ArrowRight, Loader2, Users,
  Building2, Globe, Store, Check, X, Percent, Lock, Eye, Trash2, UserMinus, ArrowLeftRight,
} from "lucide-react";
import { TransferClientsDialog } from "@/components/commerciaux/TransferClientsDialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRolePreview } from "@/components/role-preview/RolePreviewProvider";
import { previewHomeForRoles, PREVIEW_ROLE_LABELS, type PreviewRole } from "@/lib/rolePreview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, useContextMenu,
} from "@/components/ui/context-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";

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
  /** Trigramme de l'utilisateur CONNECTÉ (destination des bascules « chez moi »). */
  myTrigramme?: string | null;
  /** Nom de l'utilisateur connecté (libellés de la popup de transfert). */
  myName?: string | null;
  /** Le spectateur peut-il transférer des clients (réaffectation) ? = admin. */
  canTransfer?: boolean;
  /** Trigramme FIABLE de CETTE carte (vendeur A), pour la bascule. */
  transferTrig?: string | null;
  /** Retire la carte de la liste après suppression du compte. */
  onDeleted?: (userId: string) => void;
}

export function CommercialCard({ userId, name, commercialKey, email, counts, isMe, present = true, stockSharePct = 100, isAdmin = false, isBootstrapAdmin = false, isPreparateur = false, isCommercial = true, isDirection = false, isLivreur = false, isAgreeur = false, canEditAdmin = false, myTrigramme, myName, canTransfer = false, transferTrig, onDeleted }: Props) {
  const [transferOpen, setTransferOpen] = useState(false);
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
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Clic droit sur la carte → mêmes actions que le menu « ... ».
  const { menu, openAt, close } = useContextMenu(240, 200);
  // Nom affiché sans le suffixe société (« … - Gervifrais ») qui tronque sur mobile.
  const displayName = name.split(/\s+[-–]\s+/)[0].trim() || name;

  // « Voir comme » ce membre (aperçu chrome) — réservé admin/direction (canPreview).
  const router = useRouter();
  const { canPreview, setPreview } = useRolePreview();
  const firstName = displayName.split(/\s+/)[0] || displayName;
  // « Voir comme {personne} » = aperçu avec TOUS ses rôles (vue globale), pas
  // un rôle dominant. Défaut « commercial » si aucun rôle terrain coché.
  const memberRoles: PreviewRole[] = [
    comm && "commercial", prep && "preparateur", livreur && "livreur",
    agreeur && "agreeur", direction && "direction",
  ].filter(Boolean) as PreviewRole[];
  function viewAsMember() {
    const roles = memberRoles.length ? memberRoles : (["commercial"] as PreviewRole[]);
    // Libellé : « Hugo · Commercial, Livreur » (banner d'aperçu).
    setPreview(roles, `${firstName} · ${roles.map((r) => PREVIEW_ROLE_LABELS[r]).join(", ")}`);
    router.push(previewHomeForRoles(roles));
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

  /** Suppression du compte — irréversible : confirmation EXPLICITE via
   *  ConfirmDialog (nom à l'appui), jamais un window.confirm. Les garde-fous
   *  réels (admin strict, pas soi-même, pas un admin bootstrap) sont côté API :
   *  le menu ne fait que les refléter. */
  async function removeMember() {
    setDeleting(true);
    try {
      const res = await fetch("/api/commerciaux", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Échec de la suppression");
      toast.success(`Compte de ${displayName} supprimé`);
      onDeleted?.(userId);
      // La liste est rendue côté SERVEUR (app/commerciaux/page.tsx) : sans ce
      // refresh la carte resterait affichée jusqu'au prochain chargement.
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la suppression");
      setDeleting(false);
      throw e; // laisse le ConfirmDialog ouvert pour retenter
    }
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

  // Supprimable ? Mêmes règles que l'API — un admin bootstrap et soi-même sont
  // intouchables, et seul un admin strict peut supprimer.
  const canDelete = canEditAdmin && !isBootstrapAdmin && !isMe;

  return (
    <div
      onContextMenu={canDelete ? openAt : undefined}
      className={`bg-card rounded-xl border border-border p-4 flex items-start justify-between gap-3 hover:border-foreground/20 transition-colors ${deleting ? "opacity-50 pointer-events-none" : ""}`}
    >
      {canDelete && (
        <ContextMenu menu={menu} onClose={close} header={<ContextMenuLabel>{displayName}</ContextMenuLabel>}>
          <ContextMenuItem icon={Eye} onClick={() => { close(); viewAsMember(); }}>
            Voir comme {firstName}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon={Trash2} accent="danger" onClick={() => { close(); setConfirmDelete(true); }}>
            Supprimer ce membre
          </ContextMenuItem>
        </ContextMenu>
      )}
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {/* Avatar — monogramme neutre (plus de dégradé de marque) */}
        <div className="flex-shrink-0 grid h-10 w-10 place-items-center rounded-full bg-secondary text-foreground font-semibold text-body">
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-foreground truncate text-callout">{displayName}</p>
            {isMe && <Badge>vous</Badge>}
          </div>
          {email && (
            <p className="text-caption text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
              <Mail className="h-3 w-3 flex-shrink-0" />
              {email}
            </p>
          )}

          {/* Type breakdown */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-caption text-muted-foreground tnum">
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
                className={`inline-flex items-center gap-1 h-6 px-2 rounded-md text-caption font-semibold transition-colors disabled:opacity-60 ${
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
                <label className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-secondary/60 text-caption text-muted-foreground" title="% du stock total attribué à ce commercial">
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
              <span className="mr-0.5 select-none text-caption2 font-medium uppercase tracking-wide text-muted-foreground">Rôles</span>
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
                title={`Voir l'application comme ${displayName} — vue globale de tous ses rôles`}
                className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-caption font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
              >
                <Eye className="h-3.5 w-3.5" /> Voir comme {firstName}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <Link
          href={`/clients?commercial=${encodeURIComponent(name)}`}
          className="text-caption text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 border-b border-border hover:border-foreground pb-0.5"
        >
          Voir clients
          <ArrowRight className="h-3 w-3" />
        </Link>

        {!isMe && canTransfer && myTrigramme && transferTrig && myTrigramme !== transferTrig && (
          <button
            type="button"
            onClick={() => setTransferOpen(true)}
            title={`Transférer des clients (vendeur télévente) entre ${displayName} et vous`}
            className="hidden md:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-caption font-medium border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
          >
            <ArrowLeftRight className="h-3 w-3" />
            Transférer
          </button>
        )}

        {!isMe && counts.ALL > 0 && (
          <div className="hidden md:block">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={!!claiming}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-caption font-medium bg-primary hover:bg-primary/90 text-primary-foreground transition-colors active:scale-[0.97] disabled:opacity-60"
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
              <DropdownMenuLabel className="text-caption2 uppercase tracking-wider text-muted-foreground font-semibold">
                Récupérer pour aujourd&apos;hui
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => claim("ALL")}
                className="cursor-pointer flex items-center gap-2 text-body"
              >
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                Tous les clients
                <span className="ml-auto tnum text-muted-foreground text-caption">{counts.ALL}</span>
              </DropdownMenuItem>

              {counts.CHR > 0 && (
                <DropdownMenuItem
                  onClick={() => claim("CHR")}
                  className="cursor-pointer flex items-center gap-2 text-body"
                >
                  <Store className="h-3.5 w-3.5 text-muted-foreground" />
                  Uniquement CHR
                  <span className="ml-auto tnum text-muted-foreground text-caption">{counts.CHR}</span>
                </DropdownMenuItem>
              )}
              {counts.GMS > 0 && (
                <DropdownMenuItem
                  onClick={() => claim("GMS")}
                  className="cursor-pointer flex items-center gap-2 text-body"
                >
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Uniquement GMS
                  <span className="ml-auto tnum text-muted-foreground text-caption">{counts.GMS}</span>
                </DropdownMenuItem>
              )}
              {counts.EXPORT > 0 && (
                <DropdownMenuItem
                  onClick={() => claim("EXPORT")}
                  className="cursor-pointer flex items-center gap-2 text-body"
                >
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                  Uniquement EXPORT
                  <span className="ml-auto tnum text-muted-foreground text-caption">{counts.EXPORT}</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-caption2 text-muted-foreground leading-tight">
                Les clients récupérés apparaîtront dans votre console jusqu&apos;à minuit.
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        )}

        {/* Retrait du membre — bouton discret, en bas de la colonne d'actions.
            L'action est destructive : elle n'a pas à disputer l'attention aux
            gestes du quotidien (présence, récupération). */}
        {canDelete && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
            title={`Supprimer le compte de ${displayName}`}
            className="hidden md:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-caption font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-60"
          >
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserMinus className="h-3 w-3" />}
            Supprimer
          </button>
        )}
      </div>

      {canTransfer && myTrigramme && transferTrig && (
        <TransferClientsDialog
          open={transferOpen}
          onOpenChange={setTransferOpen}
          aTrig={transferTrig}
          aName={displayName}
          bTrig={myTrigramme}
          bName={myName || "Moi"}
        />
      )}

      {canDelete && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          tone="destructive"
          title={`Supprimer le compte de ${displayName} ?`}
          description={
            <>
              Ses accès sont retirés immédiatement et sa session est fermée. S&apos;il se
              reconnecte, il repartira d&apos;un compte vierge, sans aucun rôle. Son historique
              (heures, salaires, commissions) est conservé.
            </>
          }
          confirmLabel="Supprimer"
          onConfirm={removeMember}
        />
      )}
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
      className={`inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-caption transition-colors focus-visible:ring-2 focus-visible:ring-ring focus:outline-none ${
        disabled ? "cursor-not-allowed" : locked ? "cursor-default" : "hover:bg-secondary/60"
      }`}
    >
      <span
        className={`grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[4px] border transition-colors ${
          active
            ? "border-primary bg-primary text-primary-foreground"
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
      {note && <span className="text-caption2 font-medium uppercase tracking-wide text-muted-foreground">{note}</span>}
    </button>
  );
}
