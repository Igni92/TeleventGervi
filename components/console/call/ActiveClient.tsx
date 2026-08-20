"use client";

import * as React from "react";
import { useState } from "react";
import {
  ShoppingCart, Calendar, Sparkles, StickyNote, History, PhoneCall,
  User, BellRing, ArrowUpRight, ChevronDown, Loader2,
  CheckCircle2, MoreHorizontal, GripVertical, Eye, EyeOff,
} from "lucide-react";
import Link from "next/link";
import { SECTION_LABELS, type SectionId } from "@/lib/useConsolePrefs";
import { segmentBadgeClass } from "@/lib/segments";
import { displayNameFromSlp } from "@/lib/salespeople";
import { HabitudesBanner } from "@/components/console/HabitudesBanner";
import { SapOrderHistory } from "@/components/console/SapOrderHistory";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InfoTip } from "@/components/ui/info-tip";
import { formatDate, formatRappelDate, formatRelative } from "@/lib/utils";
import { type Client, type AppelLog, JOURS_FR, LIFECYCLE_PILL, appelBadge } from "./shared";
import { InsightsBlock } from "./InsightsBlock";
import { NotesCluster } from "./NotesCluster";

export function EmptyActive() {
  return (
    <div className="relative h-full flex flex-col items-center justify-center text-center py-16 overflow-hidden">
      {/* Anneaux radar décoratifs (écho au logo / signal) */}
      <svg aria-hidden viewBox="0 0 400 400"
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[420px] w-[420px] text-brand-400 opacity-[0.10]">
        {[60, 120, 180].map((r) => (
          <circle key={r} cx="200" cy="200" r={r} fill="none" stroke="currentColor" strokeWidth="1" />
        ))}
        <line x1="200" y1="0" x2="200" y2="400" stroke="currentColor" strokeWidth="1" strokeDasharray="2 10" />
        <line x1="0" y1="200" x2="400" y2="200" stroke="currentColor" strokeWidth="1" strokeDasharray="2 10" />
      </svg>
      <div className="relative">
        <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/30 flex items-center justify-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-500" />
        </div>
        <p className="text-[15px] font-medium text-foreground">Plus de clients à appeler</p>
        <p className="text-[13px] text-muted-foreground mt-1 max-w-sm">
          Tu peux relancer un client de la file pour continuer.
        </p>
      </div>
    </div>
  );
}

export function ActiveClient({
  client, notesDraft, setNotesDraft, saveNotes, savingNotes, saveEmail,
  prefs, toggleVisibility, toggleCollapsed, reorder, resetPrefs,
}: {
  client: Client;
  notesDraft: string;
  setNotesDraft: (v: string) => void;
  saveNotes: () => void;
  savingNotes: boolean;
  saveEmail: (next: string) => void;
  prefs: { id: SectionId; visible: boolean; collapsed: boolean }[];
  toggleVisibility: (id: SectionId) => void;
  toggleCollapsed: (id: SectionId) => void;
  reorder: (fromId: SectionId, toId: SectionId, position?: "before" | "after") => void;
  resetPrefs: () => void;
}) {
  // Drag-and-drop state for reordering sections
  const [draggedId, setDraggedId] = useState<SectionId | null>(null);
  const [overId, setOverId] = useState<SectionId | null>(null);
  // Insert position relative to overId — "before" (above) or "after" (below)
  const [overPos, setOverPos] = useState<"before" | "after">("before");
  const days = client.joursAppel?.split(",").map(Number).filter((n) => !isNaN(n)) || [];
  const lastCmd = client.appels.find((a) => a.type === "COMMANDE");
  const ordersCount = client.appels.filter((a) => a.type === "COMMANDE").length;
  const notesDirty = notesDraft !== (client.notes ?? "");

  // Pre-commande snooze info
  const preCommande = client.appels.find(
    (a) => a.type === "COMMANDE" && a.scheduledFor && new Date(a.scheduledFor) > new Date(),
  );

  // Helper : récupère l'état "collapsed" d'une section depuis prefs.
  const collapseProps = (id: SectionId) => {
    const p = prefs.find((x) => x.id === id);
    return {
      collapsible: true,
      collapsed: p?.collapsed ?? false,
      onToggle: () => toggleCollapsed(id),
    };
  };

  // Renderers per section — keyed by SectionId
  // NB. `stock` a été retiré : la consultation de stock vit sur l'Écran 2.
  const renderers: Record<SectionId, () => React.ReactNode> = {
    insights: () =>
      client.insights && (client.insights.bestPickup || client.insights.answerRate !== null || client.insights.bestHour || client.insights.bestDayOfWeek || client.insights.medianIntervalDays) ? (
        <InsightsBlock insights={client.insights} {...collapseProps("insights")} />
      ) : null,

    jours: () =>
      days.length > 0 ? (
        <Block
          icon={Calendar}
          label="Jours d'appel programmés"
          info={{
            label: "Jours d'appel",
            content: <>Les jours de la semaine où ce client doit être recontacté.<br/>Il apparaîtra automatiquement dans la file ces jours-là.</>,
          }}
          {...collapseProps("jours")}
        >
          {/* Info PASSIVE (pas des toggles) : juste les jours programmés en
              texte, séparés par des points. Ne peut pas déborder d'une colonne
              étroite, contrairement aux 7 pastilles fixes précédentes. */}
          <p className="text-body font-semibold text-foreground">
            {[1,2,3,4,5,6,0].filter((d) => days.includes(d)).map((d) => JOURS_FR[d]).join(" · ")}
          </p>
        </Block>
      ) : null,

    notes: () => (
      <Block icon={StickyNote} label="Notes client" {...collapseProps("notes")}>
        <NotesCluster
          client={client}
          notesDraft={notesDraft}
          setNotesDraft={setNotesDraft}
          saveNotes={saveNotes}
          savingNotes={savingNotes}
          saveEmail={saveEmail}
          notesDirty={notesDirty}
        />
      </Block>
    ),

    history: () => {
      // Fil unique : SAP B1 fait foi pour les commandes ; on superpose
      // les DEMAIN du CRM qui ne sont pas suivis d'une commande le même
      // jour (promesses encore ouvertes). La commande SAP qui « efface »
      // un DEMAIN est captée via le log CRM COMMANDE du même jour (un BL
      // SAP émis par le commercial génère systématiquement ce log).
      const dayKey = (d: string) => new Date(d).toISOString().slice(0, 10);
      const cmdDays = new Set(
        client.appels.filter((a) => a.type === "COMMANDE").map((a) => dayKey(a.heureAppel)),
      );
      const liveDemains = client.appels
        .filter((a) => a.type === "DEMAIN" && !cmdDays.has(dayKey(a.heureAppel)))
        .slice(0, 5);

      return (
        <Block icon={History} label="Historique commandes" info={{
          label: "Historique commandes",
          content: <>Dernières commandes SAP B1 (BL) avec lignes, facture liée et incidents.<br/>Les reports « à demain » sans commande de suivi apparaissent en haut.</>,
        }} {...collapseProps("history")}>
          {liveDemains.length > 0 && (
            <div className="mb-3 pb-3 border-b border-dashed border-border/60">
              <p className="text-[10px] uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400 font-semibold mb-1.5">
                À recontacter
              </p>
              <ul className="space-y-1.5">
                {liveDemains.map((a) => (
                  <li key={a.id} className="flex items-baseline gap-1.5 text-[11.5px] flex-wrap">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 shrink-0">
                      À demain
                    </span>
                    <span className="text-foreground/80 tnum shrink-0">{formatRelative(a.heureAppel)}</span>
                    <span className="text-muted-foreground/70 tnum text-[10.5px] shrink-0">· {formatDate(a.heureAppel)}</span>
                    {a.note && (
                      <span className="text-muted-foreground italic truncate basis-full sm:basis-auto sm:flex-1 min-w-0">
                        — {a.note}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <SapOrderHistory clientId={client.id} />
        </Block>
      );
    },

    appels: () =>
      client.appels.length > 0 ? (
        <Block icon={PhoneCall} label="Historique des appels" info={{
          label: "Historique des appels",
          content: <>Journal des issues d&apos;appel (commande, à demain, pas de réponse, refus…).<br/>Les 3 derniers sont affichés ; « voir plus » charge tout l&apos;historique.</>,
        }} {...collapseProps("appels")}>
          <AppelsJournal clientId={client.id} appels={client.appels} />
        </Block>
      ) : null,

    rappels: () =>
      client.rappels.length > 0 ? (
        <Block icon={BellRing} label="Rappels planifiés" {...collapseProps("rappels")}>
          <ul className="space-y-1.5">
            {client.rappels.map((r) => (
              <li key={r.id} className="flex items-baseline gap-3 text-[12.5px]">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 bg-brand-100 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                  {r.statut === "PLANIFIE" ? "à venir" : r.statut.toLowerCase()}
                </span>
                <span className="text-foreground/80 tnum">{formatRappelDate(r.dateRappel)}</span>
                {r.note && <span className="text-muted-foreground truncate flex-1 italic">— {r.note}</span>}
              </li>
            ))}
          </ul>
        </Block>
      ) : null,
  };

  return (
    <div key={client.id} className="animate-client-swap space-y-5">
      {/* ── Claimed banner ── */}
      {client.claimedFrom && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200/60 dark:border-purple-500/30 text-[12px]">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-500 shrink-0" />
          <p className="text-purple-900 dark:text-purple-200">
            Tu couvres ce client pour <span className="font-semibold">{client.claimedFrom}</span> aujourd&apos;hui.
          </p>
        </div>
      )}

      {/* ── Pre-commande banner ── */}
      {preCommande && preCommande.scheduledFor && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-500/30 text-[12px]">
          <ShoppingCart className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
          <p className="text-blue-900 dark:text-blue-200">
            Pré-commande enregistrée pour le{" "}
            <span className="font-semibold tnum">
              {new Date(preCommande.scheduledFor).toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long" })}
            </span>.
          </p>
        </div>
      )}

      {/* ── Header — compact : tout ce qui sert PENDANT l'appel.
           Les méta (dernière cde, nb cdes, etc.) sont remontées sur l'Écran 2. */}
      <div className="pr-10 border-b border-border pb-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <Link
            href={`/clients/${client.id}`}
            title={`Ouvrir la fiche de ${client.nom}`}
            className="group/name inline-flex items-baseline gap-1.5 rounded-md text-[26px] font-bold leading-tight tracking-tight text-foreground transition-colors hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:text-brand-400"
          >
            <span className="underline decoration-transparent decoration-2 underline-offset-4 transition-colors group-hover/name:decoration-brand-500/50">
              {client.nom}
            </span>
            <ArrowUpRight className="h-4 w-4 shrink-0 self-center opacity-0 transition-opacity group-hover/name:opacity-70" aria-hidden />
          </Link>
          {client.type && (
            <span className={`text-[10px] font-bold tracking-[0.14em] uppercase px-1.5 py-0.5 rounded ${segmentBadgeClass(client.type)}`}>
              {client.type}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11.5px] text-muted-foreground">
          <span className="font-mono text-foreground/70">{client.code}</span>
          {client.commercial && (
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" />
              {displayNameFromSlp(client.commercial)}
            </span>
          )}
        </div>
      </div>

      {/* ── Prochaine action (next-best-action) — CRM : l'app dit QUOI faire,
           pas seulement « voici des données ». La phrase vient du score serveur
           (lib/priority). Affichée pour les états à traiter ; un client dans sa
           cadence n'a pas besoin d'injonction. */}
      {client.lifecycle && client.priority && LIFECYCLE_PILL[client.lifecycle.state] && (
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-semibold ${LIFECYCLE_PILL[client.lifecycle.state]}`}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {client.priority.reason}
          </span>
          {client.tier && (client.tier.tier === "A" || client.tier.tier === "B") && (
            <span className="text-[11.5px] text-muted-foreground">
              {client.tier.label}
              {typeof client.ca12m === "number" && client.ca12m > 0
                ? ` · ${Math.round(client.ca12m).toLocaleString("fr-FR")} € sur 12 mois`
                : ""}
            </span>
          )}
        </div>
      )}

      {/* ── Habitudes (bandeau fixe — toujours visible, non draggable) ── */}
      <HabitudesBanner
        clientId={client.id}
        lastCallOrder={lastCmd ? { heureAppel: lastCmd.heureAppel } : null}
        ordersCount={ordersCount}
      />

      <div className="hairline" />

      {/* ── Sections render — driven by prefs (visibility + order) + native drag-and-drop ──
           Each section is wrapped + interleaved with explicit drop-zones
           (DropGap) so the user can drop ANYWHERE — on a section (top/bottom
           half) OR in the empty space between two sections.
      */}
      <div
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setOverId(null);
        }}
        className="space-y-7"
      >
        {(() => {
          // Build visible list once for indexing
          const visiblePrefs = prefs.filter((p) => p.visible && renderers[p.id]?.());
          const nodes: React.ReactNode[] = [];

          visiblePrefs.forEach((pref, i) => {
            const node = renderers[pref.id]!();
            if (!node) return;

            // Insert a gap drop-zone BEFORE each section (and after the last one)
            const gapBefore = (
              <DropGap
                key={`gap-${pref.id}-before`}
                isActive={
                  !!draggedId &&
                  draggedId !== pref.id &&
                  overId === pref.id &&
                  overPos === "before"
                }
                onDragOver={() => {
                  if (!draggedId || draggedId === pref.id) return;
                  setOverId(pref.id);
                  setOverPos("before");
                }}
                onDrop={() => {
                  if (draggedId && draggedId !== pref.id) reorder(draggedId, pref.id, "before");
                  setDraggedId(null);
                  setOverId(null);
                }}
              />
            );
            nodes.push(gapBefore);

            nodes.push(
              <SortableSection
                key={pref.id}
                id={pref.id}
                isDragging={draggedId === pref.id}
                isOver={overId === pref.id && draggedId !== pref.id}
                overPos={overPos}
                onDragStart={() => setDraggedId(pref.id)}
                onDragOver={(pos) => {
                  if (!draggedId || draggedId === pref.id) return;
                  setOverId(pref.id);
                  setOverPos(pos);
                }}
                onDrop={() => {
                  if (draggedId && draggedId !== pref.id) reorder(draggedId, pref.id, overPos);
                  setDraggedId(null);
                  setOverId(null);
                }}
                onDragEnd={() => { setDraggedId(null); setOverId(null); }}
              >
                {node}
              </SortableSection>,
            );

            // Final trailing gap (after last section) so we can drop at the very end
            if (i === visiblePrefs.length - 1) {
              nodes.push(
                <DropGap
                  key={`gap-${pref.id}-after`}
                  isActive={
                    !!draggedId &&
                    draggedId !== pref.id &&
                    overId === pref.id &&
                    overPos === "after"
                  }
                  onDragOver={() => {
                    if (!draggedId || draggedId === pref.id) return;
                    setOverId(pref.id);
                    setOverPos("after");
                  }}
                  onDrop={() => {
                    if (draggedId && draggedId !== pref.id) reorder(draggedId, pref.id, "after");
                    setDraggedId(null);
                    setOverId(null);
                  }}
                />,
              );
            }
          });

          return nodes;
        })()}
      </div>

    </div>
  );
}

/* ── Prefs kebab — show/hide only. Reorder is done via drag on the fiche. ── */
export function FichePrefsMenu({
  prefs, toggleVisibility, reset,
}: {
  prefs: { id: SectionId; visible: boolean }[];
  toggleVisibility: (id: SectionId) => void;
  reset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Personnaliser la fiche"
          className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground">
          Sections de la fiche
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ul className="py-1">
          {prefs.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => toggleVisibility(p.id)}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-accent/40 transition-colors text-left"
              >
                {p.visible
                  ? <Eye className="h-3.5 w-3.5 text-foreground/70 shrink-0" />
                  : <EyeOff className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />}
                <span className={`text-[12.5px] flex-1 truncate ${p.visible ? "text-foreground" : "text-muted-foreground/60 line-through"}`}>
                  {SECTION_LABELS[p.id]}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <DropdownMenuSeparator />
        <div className="px-2.5 py-2 space-y-1.5">
          <p className="text-[10.5px] text-muted-foreground leading-snug flex items-start gap-1.5">
            <GripVertical className="h-3 w-3 mt-px shrink-0 opacity-60" />
            Glissez les sections pour les réorganiser.
          </p>
          <button
            onClick={reset}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Réinitialiser l&apos;ordre
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── DropGap — invisible drop zone between sections.
   Sits in the gap (negative margin to consume the space-y-7),
   captures dragOver + drop events even when there's no section
   directly under the cursor.
*/
function DropGap({
  isActive, onDragOver, onDrop,
}: {
  isActive: boolean;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      // -my-3.5 cancels half of the space-y-7 (28px) above and below so this
      // div occupies the full 28px gap. h-7 gives a 28px hit target.
      className="h-7 -my-3.5 relative"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      {isActive && (
        <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-0.5 bg-brand-500 rounded-full pointer-events-none animate-fade-in">
          <span className="absolute left-0 -top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
          <span className="absolute right-0 -top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
        </div>
      )}
    </div>
  );
}

/* ── Sortable wrapper — native HTML5 drag-and-drop ──────────
   Supports dropping ABOVE or BELOW each section + in the gap
   between sections. The cursor's Y position vs. the section
   midpoint decides "before" vs. "after".
*/
function SortableSection({
  id, children, isDragging, isOver, overPos,
  onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  id: SectionId;
  children: React.ReactNode;
  isDragging: boolean;
  isOver: boolean;
  overPos: "before" | "after";
  onDragStart: () => void;
  onDragOver: (pos: "before" | "after") => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        // Compute insert position from cursor Y vs section bounds
        const rect = e.currentTarget.getBoundingClientRect();
        // Expand hit area into the gap (space-y-7 = 28px) — half above, half below
        const gap = 14;
        const localY = e.clientY - rect.top;
        const adjustedY = localY + gap; // shift so gap above counts as "before" region
        const adjustedHeight = rect.height + gap * 2;
        const pos: "before" | "after" = adjustedY < adjustedHeight / 2 ? "before" : "after";
        onDragOver(pos);
      }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={onDragEnd}
      className={`relative group transition-all duration-150 ${
        isDragging ? "opacity-30 scale-[0.99]" : ""
      }`}
      // Extend hit area upward into the gap so dropping between sections still works
      style={{ marginTop: isDragging ? undefined : undefined }}
    >
      {/* Drop indicator ABOVE — when overPos = "before" */}
      {isOver && overPos === "before" && (
        <div className="absolute -top-[15px] left-0 right-0 h-0.5 bg-brand-500 rounded-full pointer-events-none animate-fade-in">
          <span className="absolute left-0 -top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
          <span className="absolute right-0 -top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
        </div>
      )}

      {/* Drop indicator BELOW — when overPos = "after" */}
      {isOver && overPos === "after" && (
        <div className="absolute -bottom-[15px] left-0 right-0 h-0.5 bg-brand-500 rounded-full pointer-events-none animate-fade-in">
          <span className="absolute left-0 -top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
          <span className="absolute right-0 -top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
        </div>
      )}

      {/* Drag handle — visible on hover, fully discoverable */}
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", id);
          onDragStart();
        }}
        className="absolute -left-1 top-0 h-6 w-5 -translate-x-full inline-flex items-center justify-center rounded text-muted-foreground/30 hover:text-foreground hover:bg-secondary/60 opacity-0 group-hover:opacity-100 transition-all cursor-grab active:cursor-grabbing focus:outline-none focus-visible:opacity-100 focus-visible:text-foreground"
        aria-label="Déplacer la section"
        title="Glisser pour réorganiser"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {children}
    </div>
  );
}

function Block({
  icon: Icon, label, children, info,
  collapsible, collapsed, onToggle,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
  info?: { label: string; content: React.ReactNode };
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  // Header style "moins IA / plus CRM" : libellé en foreground/85 (pas muted),
  // petit accent à gauche pour structurer visuellement la section.
  const header = (
    <div className="flex items-center gap-2 mb-2 border-b border-border pb-1.5">
      <span className="h-3 w-0.5 bg-brand-500 rounded-full shrink-0" />
      <Icon className="h-3.5 w-3.5 text-foreground/70" />
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/85">
        {label}
      </p>
      {info && (
        <InfoTip label={info.label} content={info.content} side="right" iconSize={11} />
      )}
      {collapsible && (
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 text-muted-foreground/60 transition-transform ${
            collapsed ? "-rotate-90" : ""
          }`}
        />
      )}
    </div>
  );

  return (
    <section>
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="w-full text-left rounded -mx-1 px-1 hover:bg-secondary/40 transition-colors"
        >
          {header}
        </button>
      ) : (
        header
      )}
      {!collapsed && <div className="pl-3.5">{children}</div>}
    </section>
  );
}

/**
 * Journal des appels — les 3 derniers par défaut ; « voir plus » charge tout
 * l'historique du client (/api/appels?clientId). Chaque ligne : pastille
 * d'issue + date/heure + note (le cas échéant).
 */
function AppelsJournal({ clientId, appels }: { clientId: string; appels: AppelLog[] }) {
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState<AppelLog[] | null>(null);
  const [loading, setLoading] = useState(false);

  const seeMore = async () => {
    if (full) { setExpanded(true); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/appels?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
      const j = await res.json();
      setFull(Array.isArray(j) ? (j as AppelLog[]) : []);
      setExpanded(true);
    } catch {
      // Repli : au moins ce qui est déjà chargé.
      setFull(appels);
      setExpanded(true);
    } finally { setLoading(false); }
  };

  const rows = expanded ? (full ?? appels) : appels.slice(0, 3);
  const hasMore = !expanded && appels.length > 3;

  return (
    <div className="space-y-1.5">
      <ul className="space-y-1.5">
        {rows.map((a) => {
          const b = appelBadge(a);
          return (
            <li key={a.id} className="flex items-baseline gap-2 text-[12px]">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ${b.cls}`}>
                {b.text}
              </span>
              <span className="text-foreground/80 tnum text-[11px] shrink-0" title={formatDate(a.heureAppel)}>
                {formatRelative(a.heureAppel)}
              </span>
              {a.note && (
                <span className="text-muted-foreground italic truncate flex-1 min-w-0">— {a.note}</span>
              )}
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <button
          type="button"
          onClick={seeMore}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-brand-600 dark:text-brand-400 hover:underline underline-offset-2 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Voir tout l&apos;historique
        </button>
      )}
      {expanded && (full ?? appels).length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className="h-3.5 w-3.5 rotate-180" />
          Réduire
        </button>
      )}
    </div>
  );
}
