"use client";

// Groupe transporteur (en-tête + sous-groupes tournée + actions groupées) et
// bon de transport (impression ORIGINAL+COPIE, envoi mail, fiche transporteur).
// Restyle refonte : liste groupée style Réglages (bg-card + hairline + rayon xl),
// en-tête sobre (nom callout semibold + métriques tabulaires muted — sans tuile
// ni kicker), actions regroupées dans un menu « ⋯ » visible. Le clic droit sur
// l'en-tête reste le raccourci power-user de l'état groupé — comportement métier
// inchangé.
import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  Truck, ChevronDown, CheckCircle2, Clock, UserCheck, Printer, Send, Phone,
  Plus, Trash2, Loader2, AlertTriangle, MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { displayPersonName } from "@/lib/userNames";
import { formatDeliveryDate } from "@/lib/livraison";
import {
  docTourneeKeyLabel, STATUS_LABEL,
  type StatusTab, type Tournee, type Doc, type Carrier,
} from "@/lib/livraisonView";
import { renderBonTransport } from "@/lib/bonTransport";
import { fmtInt, fmtNum, type ViewTab, type CarrierOption, type CarrierFiche } from "./shared";
import { OrderRow } from "./OrderRow";
import { PreparedByDialog } from "./dialogs";
import { useContextMenu, ContextMenu, MenuItem } from "./menus";

/** Poids compact des en-têtes : « 1,2 t » dès 1000 kg, sinon « 740 kg ». */
const fmtWeight = (kg: number) => (kg >= 1000 ? `${fmtNum(kg / 1000)} t` : `${fmtNum(kg)} kg`);

/* ═════════════════════════════════════════════════════════════
   Groupe transporteur — en-tête + lignes commandes
═════════════════════════════════════════════════════════════ */
export function CarrierGroup({
  carrier, carrierKey, date, fullDocs, carriers, onCarrierChange, onDateChange,
  tourneesByCode, onLoadTournees, onTourneeChange,
  expanded, onToggle, onPatchDoc, onReload, canDispatch,
  statusTab, onBulkStatus, gen, autoOpen,
}: {
  carrier: Carrier;
  carrierKey: string;
  date: string;
  fullDocs: Doc[];
  carriers: CarrierOption[];
  onCarrierChange: (docEntry: number, sapValue: string) => Promise<boolean>;
  onDateChange: (docEntry: number, dueDate: string) => Promise<boolean>;
  tourneesByCode: Record<string, Tournee[]>;
  onLoadTournees: (code: string) => void;
  onTourneeChange: (docEntry: number, trspCode: string, tournee: Tournee | null) => Promise<boolean>;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onPatchDoc: (docEntry: number, patch: Partial<Doc>) => void;
  onReload: () => void;
  canDispatch: boolean;
  statusTab: ViewTab;
  onBulkStatus: (docEntries: number[], target: StatusTab) => void;
  gen: number;
  autoOpen: { docEntry: number; nonce: string } | null;
}) {
  const unassigned = !carrier.code;
  const collapsed = !expanded.has(carrierKey);
  const docEntries = carrier.docs.map((d) => d.docEntry);

  // ── Ré-attribution GROUPÉE du « Fait par » : toutes les commandes du groupe
  //    (onglet courant) déjà marquées « faites » — menu « ⋯ » ou clic droit. ──
  const preparedEntries = carrier.docs.filter((d) => d.prepared || d.departed).map((d) => d.docEntry);
  const [bulkByOpen, setBulkByOpen] = useState(false);
  const [bulkBySaving, setBulkBySaving] = useState(false);
  async function bulkChangePreparedBy(person: string) {
    if (preparedEntries.length === 0) return;
    setBulkBySaving(true);
    try {
      // { docEntry, by } sans `prepared` = ré-attribution (heure du clic conservée).
      const oks = await Promise.all(preparedEntries.map((de) =>
        fetch("/api/livraisons/prepared", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docEntry: de, by: person }),
        })
          .then(async (r) => {
            const j = await r.json().catch(() => null);
            return r.ok && j?.ok !== false;
          })
          .catch(() => false),
      ));
      const failed = oks.filter((ok) => !ok).length;
      if (failed) toast.error(`${failed} commande(s) n'ont pas pu être ré-attribuées — actualisation.`);
      else toast.success(`${preparedEntries.length} commande(s) de ${carrier.name} — fait par ${displayPersonName(person)}`);
      setBulkByOpen(false);
      // Les OrderRow figent leur état au montage → rechargement (gen++) pour
      // rafraîchir les badges « Fait par … » de toutes les lignes du groupe.
      onReload();
    } finally {
      setBulkBySaving(false);
    }
  }

  // Sous-groupes par TOURNÉE nommée (IDF, IDF 2, NORD…) au sein du transporteur.
  // On résout le nom via le catalogue de tournées du transporteur (SERGTRS).
  const carrierTournees = tourneesByCode[(carrier.code ?? "").toUpperCase()];
  const tourneeGroups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; docs: Doc[] }>();
    for (const d of carrier.docs) {
      const { key, label } = docTourneeKeyLabel(d, carrierTournees);
      const g = map.get(key) ?? { key, label, docs: [] };
      g.docs.push(d);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.docs.length - a.docs.length || a.label.localeCompare(b.label, "fr"));
  }, [carrier.docs, carrierTournees]);

  // Dès que le transporteur est déplié, on charge son catalogue de tournées pour
  // nommer les sous-groupes (IDF, NORD…) sans attendre l'ouverture d'une commande.
  useEffect(() => {
    if (!collapsed && carrier.code) onLoadTournees(carrier.code);
  }, [collapsed, carrier.code, onLoadTournees]);

  // Bouton d'avancement groupé — CHANGE selon l'onglet : À préparer → Fait →
  // Départ. (Départ = état terminal ; « Ventes » = mise en préparation par BL
  // ou via le bouton global de l'onglet — pas d'avancement d'état ici.)
  const forward =
    statusTab === "A_PREPARER"
      ? { target: "FAIT" as StatusTab, short: "Fait", long: "Tout marquer fait", Icon: CheckCircle2, cls: "bg-success text-white hover:bg-[color-mix(in_srgb,hsl(var(--success))_92%,black)]" }
      : statusTab === "FAIT"
      ? { target: "DEPART" as StatusTab, short: "Départ", long: "Tout marquer départ", Icon: Truck, cls: "bg-info text-white hover:bg-[color-mix(in_srgb,hsl(var(--info))_92%,black)]" }
      : null;
  const allowBulk = statusTab !== "VENTES";

  // Menu clic droit (desktop) sur l'en-tête transporteur → change l'état de TOUT
  // le groupe. Raccourci power-user : les mêmes actions vivent dans le menu « ⋯ ».
  // Pas d'action d'état groupée sur « Ventes » (BL pas encore lâchés) → désactivé.
  const { menu, openAt, close: closeMenu } = useContextMenu(224, 196);
  const onHeaderContextMenu = (e: ReactMouseEvent) => { if (allowBulk) openAt(e); };

  // Items d'état groupé injectés dans le menu « ⋯ » du bon de transport — pour
  // que toute action du clic droit existe AUSSI dans un menu visible (tablettes).
  const bulkMenuItems: ReactNode = (allowBulk && docEntries.length > 0) || preparedEntries.length > 0 ? (
    <>
      {allowBulk && docEntries.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-caption2 font-semibold uppercase tracking-wider text-muted-foreground">
            Tout le groupe ({docEntries.length})
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onBulkStatus(docEntries, "A_PREPARER")}>
            <Clock className="mr-2 h-4 w-4 text-warning" /> Tout : à préparer
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onBulkStatus(docEntries, "FAIT")}>
            <CheckCircle2 className="mr-2 h-4 w-4 text-success" /> Tout : fait
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onBulkStatus(docEntries, "DEPART")}>
            <Truck className="mr-2 h-4 w-4 text-info" /> Tout : départ
          </DropdownMenuItem>
        </>
      )}
      {preparedEntries.length > 0 && (
        <>
          <DropdownMenuSeparator />
          {/* setTimeout : laisse le menu rendre le focus avant d'ouvrir le dialog
              (sinon Radix referme le dialog en restituant le focus au trigger). */}
          <DropdownMenuItem onSelect={() => setTimeout(() => setBulkByOpen(true), 0)}>
            <UserCheck className="mr-2 h-4 w-4 text-success" /> Changer qui a fait… ({preparedEntries.length})
          </DropdownMenuItem>
        </>
      )}
    </>
  ) : null;

  return (
    <section className="rounded-xl bg-card ring-1 ring-border overflow-hidden">
      {/* En-tête transporteur — clic = replier/déplier ; clic droit = état groupé
          (raccourci) ; « ⋯ » = imprimer / envoyer / fiche / état groupé. */}
      <div
        role="button" tabIndex={0}
        onClick={() => onToggle(carrierKey)}
        onContextMenu={onHeaderContextMenu}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(carrierKey); } }}
        aria-expanded={!collapsed}
        title={collapsed ? "Déplier ce transporteur (clic droit : changer l'état du groupe)" : "Replier ce transporteur (clic droit : changer l'état du groupe)"}
        className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 border-b border-border bg-secondary/70 hover:bg-secondary cursor-pointer select-none transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-[var(--dur-base)] ease-[var(--ease-apple)] ${collapsed ? "-rotate-90" : ""}`} />
          <p className={`text-callout font-semibold truncate ${unassigned ? "text-muted-foreground italic" : "text-foreground"}`}>
            {carrier.name}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Avancement GROUPÉ — bouton qui change selon l'onglet, tactile sur mobile */}
          {forward && docEntries.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onBulkStatus(docEntries, forward.target); }}
              title={`Passer les ${docEntries.length} commande(s) de ${carrier.name} à « ${STATUS_LABEL[forward.target]} »`}
              className={`inline-flex shrink-0 items-center gap-1.5 h-11 sm:h-9 px-2.5 sm:px-3 rounded-lg text-caption font-semibold active:scale-[0.97] transition-[background-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-apple)] ${forward.cls}`}
            >
              {/* Icône masquée sur mobile : le libellé + la couleur suffisent, et
                  le nom du transporteur garde la place pour s'afficher en entier. */}
              <forward.Icon className="hidden sm:block h-4 w-4" />
              <span className="sm:hidden">{forward.short}</span>
              <span className="hidden sm:inline">{forward.long}</span>
            </button>
          )}
          {/* Métriques du groupe — chiffres tabulaires muted, une seule ligne.
              Mobile : seul le total de COLIS (repère métier) reste affiché. */}
          <p className="text-body tnum text-muted-foreground whitespace-nowrap text-right">
            <span className="hidden sm:inline">{fmtInt(carrier.orders)} cmd · </span>
            <span className="font-semibold text-foreground">{fmtNum(carrier.colis)}</span> colis
            <span className="hidden sm:inline"> · {fmtWeight(carrier.weightKg)}</span>
          </p>
          {/* Bon de transport + état groupé — menu « ⋯ » (imprimer / envoyer / fiche) */}
          <BonTransportActions
            carrier={carrier} date={date} canDispatch={canDispatch} docs={fullDocs}
            tournees={carrierTournees} menuExtras={bulkMenuItems} onReload={onReload}
          />
        </div>
      </div>

      {/* Sous-groupes TOURNÉE (masqués si le transporteur est replié) */}
      {!collapsed && tourneeGroups.map((tg) => {
        const subKey = `${carrierKey}::${tg.key}`;
        const subCollapsed = !expanded.has(subKey);
        return (
          <div key={subKey}>
            {/* Sous-en-tête tournée — cliquable */}
            <div
              role="button" tabIndex={0}
              onClick={() => onToggle(subKey)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(subKey); } }}
              aria-expanded={!subCollapsed}
              title={subCollapsed ? "Déplier cette tournée" : "Replier cette tournée"}
              className="flex items-center justify-between gap-3 pl-8 sm:pl-10 pr-3 sm:pr-4 py-2 border-b border-border bg-secondary/20 hover:bg-secondary/40 cursor-pointer select-none transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-[var(--dur-base)] ease-[var(--ease-apple)] ${subCollapsed ? "-rotate-90" : ""}`} />
                <span className="text-body font-semibold text-foreground truncate">{tg.label}</span>
              </div>
              {/* Même règle que l'en-tête transporteur : « cmd » et poids masqués sur mobile. */}
              <p className="text-caption tnum text-muted-foreground whitespace-nowrap shrink-0 text-right">
                <span className="hidden sm:inline">{fmtInt(tg.docs.length)} cmd · </span>
                {fmtNum(tg.docs.reduce((s, d) => s + d.colis, 0))} colis
                <span className="hidden sm:inline"> · {fmtWeight(tg.docs.reduce((s, d) => s + d.weightKg, 0))}</span>
              </p>
            </div>
            {/* Commandes de la tournée */}
            {!subCollapsed && (
              <ul className="divide-y divide-border">
                {tg.docs.map((d) => (
                  <OrderRow
                    key={`${d.docEntry}:${gen}`} doc={d} viewDate={date} carriers={carriers}
                    onCarrierChange={onCarrierChange} onDateChange={onDateChange}
                    tournees={d.trspCode ? tourneesByCode[d.trspCode.toUpperCase()] : undefined}
                    onLoadTournees={onLoadTournees} onTourneeChange={onTourneeChange}
                    onPatchDoc={onPatchDoc} onReload={onReload} canDispatch={canDispatch}
                    autoOpenNonce={autoOpen && autoOpen.docEntry === d.docEntry ? autoOpen.nonce : null}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {/* Menu clic droit (desktop) — raccourci power-user de l'état groupé */}
      <ContextMenu menu={menu} onClose={closeMenu} minWidth={214} header={
        <p className="px-3 py-1.5 text-caption2 uppercase tracking-wider font-semibold text-muted-foreground border-b border-border truncate">
          {carrier.name} · {docEntries.length} cmd
        </p>
      }>
        <MenuItem icon={Clock} accent="text-warning" active={statusTab === "A_PREPARER"}
          onClick={() => { closeMenu(); onBulkStatus(docEntries, "A_PREPARER"); }}>Tout : à préparer</MenuItem>
        <MenuItem icon={CheckCircle2} accent="text-success" active={statusTab === "FAIT"}
          onClick={() => { closeMenu(); onBulkStatus(docEntries, "FAIT"); }}>Tout : fait</MenuItem>
        <MenuItem icon={Truck} accent="text-info" active={statusTab === "DEPART"}
          onClick={() => { closeMenu(); onBulkStatus(docEntries, "DEPART"); }}>Tout : départ</MenuItem>
        {/* Ré-attribution GROUPÉE du « Fait par » — commandes déjà « faites » du groupe */}
        {preparedEntries.length > 0 && (
          <>
            <div className="my-1 h-px bg-border" />
            <MenuItem icon={UserCheck} accent="text-success"
              onClick={() => { closeMenu(); setBulkByOpen(true); }}>
              Changer qui a fait… ({preparedEntries.length})
            </MenuItem>
          </>
        )}
      </ContextMenu>

      {/* Changer la PERSONNE créditée du « fait » sur TOUT le groupe */}
      <PreparedByDialog
        open={bulkByOpen}
        onOpenChange={setBulkByOpen}
        subtitle={<>
          {carrier.name} — les <b className="text-foreground">{preparedEntries.length} commande{preparedEntries.length > 1 ? "s" : ""}</b>{" "}
          déjà marquées « faites » de ce groupe seront créditées à la personne choisie
          (les heures des clics « fait » sont conservées).
        </>}
        currentBy={null}
        saving={bulkBySaving}
        onPick={bulkChangePreparedBy}
      />

    </section>
  );
}

/* ═════════════════════════════════════════════════════════════
   Bon de transport — menu « ⋯ » (imprimer original + copie, envoyer par mail,
   fiche transporteur) + items d'état groupé injectés par le parent.
═════════════════════════════════════════════════════════════ */
function BonTransportActions({
  carrier, date, canDispatch, docs, tournees, menuExtras, onReload,
}: {
  carrier: Carrier;
  date: string;
  canDispatch: boolean;
  /** Commandes NON filtrées du transporteur (tous onglets confondus). */
  docs: Doc[];
  tournees: Tournee[] | undefined;
  /** Items supplémentaires du menu « ⋯ » (état groupé, ré-attribution). */
  menuExtras?: ReactNode;
  /** Rechargement de la liste (pastille « envoyé » après envoi). */
  onReload: () => void;
}) {
  // « Finalisé » = toutes les commandes (hors avoirés/exclus) sont faites ou
  // parties → le bouton « Feuille de route » ne s'active qu'à ce moment-là.
  const nonExcluded = docs.filter((d) => !d.excluded);
  const allFait = nonExcluded.length > 0 && nonExcluded.every((d) => d.prepared || d.departed);
  const sentAt = carrier.sentAt ?? null;
  // Lignes du bon (hors BL avoirés/exclus), groupées par tournée nommée.
  const rows = useMemo(
    () =>
      docs
        .filter((d) => !d.excluded)
        .map((d) => ({
          tournee: docTourneeKeyLabel(d, tournees).label,
          client: d.cardFullName ?? d.cardName,
          docNum: d.docNum,
          colis: d.colis,
          weightKg: d.weightKg,
          // Comptage saisi à la préparation ; null = non compté → case vide.
          palettes: d.palettes ?? null,
        }))
        .sort((a, b) => a.tournee.localeCompare(b.tournee, "fr") || a.client.localeCompare(b.client, "fr")),
    [docs, tournees],
  );
  // ── Fiche transporteur (email + téléphones) ──
  const [ficheOpen, setFicheOpen] = useState(false);
  const [ficheLoading, setFicheLoading] = useState(false);
  const [ficheSaving, setFicheSaving] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [phones, setPhones] = useState<{ label: string; value: string }[]>([]);

  const loadFiche = useCallback(async (): Promise<CarrierFiche | null> => {
    if (!carrier.code) return null;
    try {
      const r = await fetch(`/api/transporteurs/fiche?code=${encodeURIComponent(carrier.code)}`);
      const j = await r.json().catch(() => null);
      if (j?.ok) return j.fiche as CarrierFiche;
    } catch { /* best-effort */ }
    return null;
  }, [carrier.code]);

  async function openFiche() {
    setFicheOpen(true);
    setFicheLoading(true);
    const f = await loadFiche();
    if (f) { setEmails(f.emails ?? []); setPhones(f.phones ?? []); }
    setFicheLoading(false);
  }

  async function saveFiche() {
    if (!carrier.code) return;
    setFicheSaving(true);
    try {
      const res = await fetch("/api/transporteurs/fiche", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: carrier.code, emails: emails.map((e) => e.trim()).filter(Boolean), phones }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { toast.error(j?.error || "Échec de l'enregistrement de la fiche"); return; }
      toast.success(`Fiche ${carrier.name} enregistrée`);
      setFicheOpen(false);
    } catch {
      toast.error("Échec de l'enregistrement de la fiche");
    } finally {
      setFicheSaving(false);
    }
  }

  // ── Impression : ORIGINAL + COPIE (fenêtre ouverte SYNCHRONE pour passer les
  //    bloqueurs de pop-ups, contenu écrit après chargement de la fiche). ──
  function printBon() {
    const w = window.open("", "_blank", "width=920,height=1050");
    if (!w) { toast.error("Impression bloquée — autorisez les pop-ups pour ce site."); return; }
    w.document.write("<p style=\"font-family:sans-serif;padding:16px\">Préparation du bon de transport…</p>");
    (async () => {
      const fiche = await loadFiche();
      const html = renderBonTransport(
        {
          carrierName: carrier.name,
          dateLabel: formatDeliveryDate(date),
          emails: fiche?.emails ?? [],
          phones: fiche?.phones ?? [],
          rows,
        },
        { copies: ["ORIGINAL", "COPIE"], autoPrint: true },
      );
      w.document.open();
      w.document.write(html);
      w.document.close();
    })();
  }

  // ── Envoi par mail (depuis commercial@gervifrais.com) — avec confirmation. ──
  const [mailOpen, setMailOpen] = useState(false);
  const [mailFiche, setMailFiche] = useState<CarrierFiche | null>(null);
  const [mailLoading, setMailLoading] = useState(false);
  const [sending, setSending] = useState(false);

  async function openMail() {
    setMailOpen(true);
    setMailLoading(true);
    setMailFiche(await loadFiche());
    setMailLoading(false);
  }

  async function sendMail() {
    if (!carrier.code) return;
    setSending(true);
    try {
      const res = await fetch("/api/livraisons/bon-transport", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, trspCode: carrier.code }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { toast.error(j?.error || "Échec de l'envoi de la feuille de route"); return; }
      toast.success(`Feuille de route envoyée à ${j.to}`, { description: `Depuis ${j.from} — ${j.orders} commande(s).`, duration: 7000 });
      setMailOpen(false);
      onReload(); // rafraîchit la pastille « envoyé »
    } catch {
      toast.error("Échec de l'envoi de la feuille de route");
    } finally {
      setSending(false);
    }
  }

  const orderCount = rows.length;
  // Items propres au bon de transport (imprimer / envoyer / fiche).
  const hasOwnItems = orderCount > 0 || (canDispatch && !!carrier.code);
  if (!hasOwnItems && !menuExtras) return null;

  const sentTime = sentAt ? new Date(sentAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : null;
  const canSend = canDispatch && !!carrier.code && orderCount > 0;

  return (
    <div className="flex items-center gap-1.5 sm:gap-2" onClick={(e) => e.stopPropagation()}>
      {/* Pastille « feuille de route envoyée » — sinon bouton d'envoi (actif
          uniquement quand TOUTES les commandes du transporteur sont faites). */}
      {sentAt ? (
        <span
          title={`Feuille de route envoyée à ${sentTime}${carrier.sentTo?.length ? ` — ${carrier.sentTo.join(", ")}` : ""}`}
          className="inline-flex shrink-0 items-center gap-1.5 h-8 sm:h-9 px-2 sm:px-2.5 rounded-lg bg-success/12 text-success ring-1 ring-success/25 text-caption font-semibold"
        >
          <CheckCircle2 className="h-4 w-4" />
          <span className="hidden sm:inline">Envoyé</span>
          <span className="hidden sm:inline tnum font-normal text-success/80">{sentTime}</span>
        </span>
      ) : canSend ? (
        <button
          type="button"
          onClick={openMail}
          disabled={!allFait}
          title={allFait
            ? `Envoyer la feuille de route de ${carrier.name} au transporteur`
            : "Disponible quand toutes les commandes du transporteur sont faites"}
          className={`inline-flex shrink-0 items-center gap-1.5 h-11 sm:h-9 px-2.5 sm:px-3 rounded-lg text-caption font-semibold transition-[background-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-apple)] active:scale-[0.97] ${
            allFait
              ? "bg-brand-600 text-white hover:bg-brand-500"
              : "bg-secondary text-muted-foreground cursor-not-allowed opacity-70"
          }`}
        >
          <Send className="h-4 w-4" />
          <span className="hidden sm:inline">Feuille de route</span>
        </button>
      ) : null}

      {/* Menu « ⋯ » — regroupe imprimer / envoyer / fiche + l'état groupé. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={`Actions ${carrier.name} — bon de transport, état du groupe`}
            aria-label={`Actions du transporteur ${carrier.name}`}
            className="h-11 w-11 sm:h-9 sm:w-9 text-muted-foreground"
          >
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {orderCount > 0 && (
            <DropdownMenuItem onSelect={printBon}>
              <Printer className="mr-2 h-4 w-4 text-muted-foreground" /> Imprimer le bon de transport
            </DropdownMenuItem>
          )}
          {canDispatch && carrier.code && (
            <DropdownMenuItem onSelect={openFiche}>
              <Phone className="mr-2 h-4 w-4 text-muted-foreground" /> Fiche transporteur (emails, tél.)…
            </DropdownMenuItem>
          )}
          {menuExtras}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* ── Dialog fiche transporteur ── */}
      <Dialog open={ficheOpen} onOpenChange={(o) => { if (!ficheSaving) setFicheOpen(o); }}>
        <DialogContent size="sm">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 pr-8">
              <Phone className="h-5 w-5 text-muted-foreground shrink-0" />
              Fiche transporteur — {carrier.name}
            </DialogTitle>
            <DialogDescription className="text-caption">
              Coordonnées utilisées sur le bon de transport et pour son envoi par mail.
            </DialogDescription>
          </DialogHeader>
          {ficheLoading ? (
            <div className="flex items-center gap-2 py-4 text-body text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement de la fiche…
            </div>
          ) : (
            <>
              <div>
                <label className="text-caption font-medium text-foreground">Emails <span className="text-muted-foreground font-normal">(un ou plusieurs)</span></label>
                <div className="mt-1 space-y-2">
                  {emails.map((v, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="email"
                        value={v}
                        onChange={(e) => setEmails((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                        placeholder="contact@transporteur.fr"
                        disabled={ficheSaving}
                        className="h-10 flex-1 min-w-0 rounded-lg border border-border bg-background px-3 text-body font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                      />
                      <button
                        type="button"
                        onClick={() => setEmails((prev) => prev.filter((_, j) => j !== i))}
                        disabled={ficheSaving}
                        title="Retirer cet email"
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-60"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setEmails((prev) => [...prev, ""])}
                    disabled={ficheSaving || emails.length >= 10}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-dashed border-border text-caption font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60"
                  >
                    <Plus className="h-3.5 w-3.5" /> Ajouter un email
                  </button>
                </div>
              </div>
              <div>
                <label className="text-caption font-medium text-foreground">Téléphones</label>
                <div className="mt-1 space-y-2">
                  {phones.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={p.label}
                        onChange={(e) => setPhones((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                        placeholder="Libellé (ex. Exploitation)"
                        disabled={ficheSaving}
                        className="h-9 w-[42%] rounded-lg border border-border bg-background px-2.5 text-caption text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                      />
                      <input
                        value={p.value}
                        onChange={(e) => setPhones((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                        placeholder="06 12 34 56 78"
                        disabled={ficheSaving}
                        className="h-9 flex-1 min-w-0 rounded-lg border border-border bg-background px-2.5 text-caption tnum text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                      />
                      <button
                        type="button"
                        onClick={() => setPhones((prev) => prev.filter((_, j) => j !== i))}
                        disabled={ficheSaving}
                        title="Retirer ce numéro"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-60"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPhones((prev) => [...prev, { label: "", value: "" }])}
                    disabled={ficheSaving || phones.length >= 10}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-dashed border-border text-caption font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60"
                  >
                    <Plus className="h-3.5 w-3.5" /> Ajouter un téléphone
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="xl"
                  onClick={() => setFicheOpen(false)}
                  disabled={ficheSaving}
                >
                  Annuler
                </Button>
                <Button
                  type="button"
                  size="xl"
                  onClick={saveFiche}
                  disabled={ficheSaving}
                >
                  {ficheSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Enregistrer
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Dialog confirmation d'envoi par mail ── */}
      <Dialog open={mailOpen} onOpenChange={(o) => { if (!sending) setMailOpen(o); }}>
        <DialogContent size="sm">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 pr-8">
              <Send className="h-5 w-5 text-muted-foreground shrink-0" />
              Envoyer la feuille de route
            </DialogTitle>
          </DialogHeader>
          <p className="text-body text-muted-foreground">
            Récap des <b className="text-foreground">{orderCount} commande{orderCount > 1 ? "s" : ""}</b> de{" "}
            <b className="text-foreground">{carrier.name}</b> pour la livraison du{" "}
            <b className="text-foreground">{formatDeliveryDate(date)}</b>, envoyé depuis{" "}
            <b className="text-foreground">commercial@gervifrais.com</b>.
          </p>
          {mailLoading ? (
            <div className="flex items-center gap-2 text-body text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lecture de la fiche transporteur…
            </div>
          ) : mailFiche && mailFiche.emails.length > 0 ? (
            <div className="rounded-lg ring-1 ring-border bg-secondary/30 px-3.5 py-2.5 text-body">
              <span className="text-caption2 text-muted-foreground">Destinataire{mailFiche.emails.length > 1 ? "s" : ""}</span>
              <ul className="mt-1 space-y-0.5">
                {mailFiche.emails.map((e) => (
                  <li key={e} className="font-semibold text-foreground truncate">{e}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg ring-1 ring-warning/25 bg-warning/10 px-3.5 py-2.5">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <p className="text-caption text-foreground">
                Aucun email dans la fiche transporteur.
                <button
                  type="button"
                  onClick={() => { setMailOpen(false); openFiche(); }}
                  className="ml-1 font-semibold underline underline-offset-2"
                >
                  Renseigner la fiche
                </button>
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="xl"
              onClick={() => setMailOpen(false)}
              disabled={sending}
            >
              Annuler
            </Button>
            <Button
              type="button"
              size="xl"
              onClick={sendMail}
              disabled={sending || mailLoading || !mailFiche || mailFiche.emails.length === 0}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Envoyer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
