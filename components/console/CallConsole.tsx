"use client";

import * as React from "react";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Search, Phone, ShoppingCart, Clock, BellRing, CheckCircle2,
  ChevronRight,
  Loader2, Calendar, Sparkles, ArrowUpDown,
  StickyNote, History, User, TrendingUp, TrendingDown, Minus,
  MessageSquare, AlertTriangle, Settings, Mail, Tag,
} from "lucide-react";
import type { ClientInsights } from "@/lib/insights";
import { dayOfWeekLabel, summaryRecommendation, hourWindowLabel } from "@/lib/insights";
import { useConsolePrefs, SECTION_LABELS, type SectionId } from "@/lib/useConsolePrefs";
import {
  useConsoleShortcuts, SHORTCUT_LABELS, displayKey, isBindableKey,
  type ShortcutAction,
} from "@/lib/useConsoleShortcuts";
import { HabitudesBanner } from "@/components/console/HabitudesBanner";
import { broadcastActiveClient } from "@/lib/consoleSync";
import { loadCallNote, saveCallNote, clearCallNote } from "@/lib/callNoteStorage";
import { MonitorSmartphone } from "lucide-react";
import { BLDialog } from "@/components/console/BLDialog";
import { SapOrderHistory } from "@/components/console/SapOrderHistory";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, GripVertical, Eye, EyeOff, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { formatDate, formatDateInput, formatRelative } from "@/lib/utils";
import { motion } from "framer-motion";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { DUR, EASE } from "@/lib/motion";

/* ─────────────────────────────────────────────────────────────
   Types (mirror /api/console response)
───────────────────────────────────────────────────────────── */
interface AppelLog {
  id: string;
  type: "COMMANDE" | "DEMAIN";
  note: string | null;
  heureAppel: string;
  scheduledFor?: string | null;
}
interface Rappel { id: string; dateRappel: string; note: string | null; statut: string; }
interface Client {
  id: string; code: string; nom: string;
  type: string | null; commercial: string | null;
  tel1: string | null; tel2: string | null; tel3: string | null;
  email: string | null;
  sapGroupCode: number | null;
  sapGroupName: string | null;
  notes: string | null; joursAppel: string | null;
  rappels: Rappel[]; appels: AppelLog[];
  insights?: ClientInsights;
  /** null = not claimed; string = original commercial name (I covered this client today) */
  claimedFrom?: string | null;
  /** true = client REPRIS aujourd'hui dont le commercial d'origine est absent → vraie couverture */
  ownerAbsent?: boolean;
  /** nb d'incidents ouverts (BL) — affiché dans la file */
  openIncidents?: number;
}
interface ConsoleData {
  queue: Client[]; done: Client[];
  stats: { remaining: number; called: number; commandes: number; demains: number; conversion: number };
  presence?: { present: string[]; absent: string[]; toCover: number };
  me?: { stockSharePct: number };
}

const JOURS_FR: Record<number, string> = { 0:"Dim",1:"Lun",2:"Mar",3:"Mer",4:"Jeu",5:"Ven",6:"Sam" };

/* ─────────────────────────────────────────────────────────────
   Main component — single-page daily workspace
───────────────────────────────────────────────────────────── */
type SortMode = "name" | "hour" | "type" | "lastOrder";

export function CallConsole() {
  const [data, setData] = useState<ConsoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortMode>("hour");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rappelOpen, setRappelOpen] = useState(false);
  const [blOpen, setBlOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  // Per-call comment that gets attached to the appel log when clicking Commande/À demain
  const [callNote, setCallNote] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Display preferences (visibility + ordering of fiche sections)
  const { prefs, toggleVisibility, toggleCollapsed, reorder, reset: resetPrefs } = useConsolePrefs();

  // Personalisable keyboard shortcuts (persisted in localStorage)
  const { keymap, remap, reset: resetShortcuts, matches } = useConsoleShortcuts();

  /* ── Fetch ───────────────────────────────────────────────── */
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/console", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const json: ConsoleData = await res.json();
      setData(json);
      setActiveId((prev) => {
        if (prev && json.queue.some((c) => c.id === prev)) return prev;
        return json.queue[0]?.id ?? null;
      });
    } catch {
      toast.error("Erreur de chargement de la console");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const allClients = useMemo(
    () => [...(data?.queue ?? []), ...(data?.done ?? [])],
    [data],
  );
  const active = allClients.find((c) => c.id === activeId) ?? null;

  /* ── Diffuse le client actif vers l'écran 2 (mode 2 écrans) ── */
  useEffect(() => {
    broadcastActiveClient({
      clientId: active?.id ?? null,
      clientName: active?.nom ?? null,
      stockSharePct: data?.me?.stockSharePct ?? 100,
      client: active ? {
        code: active.code, type: active.type, commercial: active.commercial,
        tel1: active.tel1, tel2: active.tel2, tel3: active.tel3,
        email: active.email, sapGroupCode: active.sapGroupCode, sapGroupName: active.sapGroupName,
        notes: active.notes,
        joursAppel: active.joursAppel,
        openIncidents: active.openIncidents ?? null,
        lastOrderDays: active.insights?.lastOrderDays ?? null,
        ordersCount: active.appels.filter((a) => a.type === "COMMANDE").length,
        medianHour: active.insights?.medianHour
          ?? active.insights?.bestHour?.hour
          ?? null,
        bestDayOfWeek: active.insights?.bestDayOfWeek?.dow ?? null,
        trend30: active.insights?.trend30 ?? null,
      } : null,
    });
  }, [active, data?.me?.stockSharePct]);

  /* ── Sync notes draft when active client changes ─────────── */
  useEffect(() => {
    setNotesDraft(active?.notes ?? "");
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Filtered + sorted queue (console PERSONNELLE : on ne voit que SES
        clients à la vente — aucun filtre d'équipe / par commercial) ──────── */
  const filteredQueue = useMemo(() => {
    if (!data) return [];
    let q = [...data.queue];

    // Recherche (nom / code)
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      q = q.filter((c) =>
        c.nom.toLowerCase().includes(term) ||
        c.code.toLowerCase().includes(term),
      );
    }

    // Tri
    q.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.nom.localeCompare(b.nom, "fr");
        case "type":
          return (a.type || "zzz").localeCompare(b.type || "zzz");
        case "lastOrder": {
          const da = a.insights?.lastOrderDays ?? 9999;
          const db = b.insights?.lastOrderDays ?? 9999;
          return da - db; // most recent first
        }
        case "hour":
        default: {
          // Sort by optimal call hour (median) — clients without insights go last
          const ha = a.insights?.medianHour ?? a.insights?.bestHour?.hour ?? 99;
          const hb = b.insights?.medianHour ?? b.insights?.bestHour?.hour ?? 99;
          return ha - hb;
        }
      }
    });

    return q;
  }, [data, search, sortBy]);

  /* ── Auto-advance to next client in queue ────────────────── */
  const advance = useCallback(() => {
    if (!data) return;
    const idx = data.queue.findIndex((c) => c.id === activeId);
    const next = data.queue[idx + 1] ?? data.queue[0] ?? null;
    setActiveId(next?.id ?? null);
  }, [data, activeId]);

  /* ── Log appel (COMMANDE / DEMAIN) ──────────────────────────
     scheduledFor (optional): for pre-commandes — client is snoozed
     until that date, no callback needed before it.
  */
  const logAppel = useCallback(async (
    type: "COMMANDE" | "DEMAIN",
    scheduledFor?: string,
  ) => {
    if (!active) return;
    setActionLoading(type);
    try {
      const res = await fetch("/api/appels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: active.id,
          type,
          note: callNote.trim() || undefined,
          scheduledFor: scheduledFor || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      const dateLabel = scheduledFor
        ? new Date(scheduledFor).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
        : null;
      toast.success(
        type === "COMMANDE"
          ? `✅ ${dateLabel ? `Pré-commande ${dateLabel}` : "Commande"} — ${active.nom}`
          : `📅 À demain — ${active.nom}`,
      );
      // Action journalisée → la note rapide n'a plus lieu d'être conservée.
      clearCallNote(active.id);
      setCallNote("");
      advance();
      fetchData();
    } catch {
      toast.error("Erreur d'enregistrement");
    } finally {
      setActionLoading(null);
    }
  }, [active, callNote, advance, fetchData]);

  // Restaure la note rapide persistée (localStorage) quand le client actif
  // change — survit ainsi à un refresh de page. Écrite par client via
  // setCallNotePersisted ci-dessous, et effacée lors d'une action journalisée.
  useEffect(() => {
    setCallNote(loadCallNote(activeId));
  }, [activeId]);

  // Setter "persistant" : met à jour le state ET sauvegarde la note pour le
  // client actif (clé `tv-callnote-<id>`). Passé à l'ActionPanel.
  const setCallNotePersisted = useCallback((v: string) => {
    setCallNote(v);
    saveCallNote(activeId, v);
  }, [activeId]);

  /* ── Save notes inline ───────────────────────────────────── */
  const saveNotes = useCallback(async () => {
    if (!active) return;
    if (notesDraft === (active.notes ?? "")) return;
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/clients/${active.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: active.code,
          nom: active.nom,
          type: active.type || undefined,
          commercial: active.commercial || undefined,
          tel1: active.tel1 || undefined,
          tel2: active.tel2 || undefined,
          tel3: active.tel3 || undefined,
          email: active.email || undefined,
          notes: notesDraft || undefined,
          joursAppel: active.joursAppel
            ? active.joursAppel.split(",").map(Number).filter((n) => !isNaN(n))
            : [],
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Notes sauvegardées");
      fetchData();
    } catch {
      toast.error("Erreur sauvegarde notes");
    } finally {
      setSavingNotes(false);
    }
  }, [active, notesDraft, fetchData]);

  /* ── Save email inline (PATCH SAP bidir côté API) ──────── */
  const saveEmail = useCallback(async (nextEmail: string) => {
    if (!active) return;
    const trimmed = nextEmail.trim();
    if (trimmed === (active.email ?? "")) return;
    try {
      const res = await fetch(`/api/clients/${active.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: active.code,
          nom: active.nom,
          type: active.type || undefined,
          commercial: active.commercial || undefined,
          tel1: active.tel1 || undefined,
          tel2: active.tel2 || undefined,
          tel3: active.tel3 || undefined,
          email: trimmed || undefined,
          notes: active.notes || undefined,
          joursAppel: active.joursAppel
            ? active.joursAppel.split(",").map(Number).filter((n) => !isNaN(n))
            : [],
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Erreur sauvegarde email");
        return;
      }
      toast.success("Email enregistré");
      fetchData();
    } catch {
      toast.error("Erreur sauvegarde email");
    }
  }, [active, fetchData]);

  /* ── Keyboard shortcuts (personnalisables — voir useConsoleShortcuts) ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Répétition clavier (touche maintenue) → ignorée pour éviter les double-logs.
      if (e.repeat) return;
      // Ignore when typing in input/textarea/select ou champ éditable
      // (parité avec PilotageSlider). Escape blur reste universel.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) {
        if (e.key === "Escape") el?.blur();
        return;
      }
      // Une modale est ouverte → les raccourcis console sont neutralisés
      // (évite un "À demain" fantôme + advance() sous la modale).
      if (blOpen || rappelOpen || shortcutsOpen) return;

      if (matches(e, "searchFocus")) { e.preventDefault(); searchRef.current?.focus(); return; }
      if (matches(e, "openBL"))      { e.preventDefault(); if (active) setBlOpen(true); return; }
      if (matches(e, "demain"))      { e.preventDefault(); if (!actionLoading) logAppel("DEMAIN"); return; }
      if (matches(e, "rappel"))      { e.preventDefault(); setRappelOpen(true); return; }
      if (matches(e, "skip"))        { e.preventDefault(); advance(); return; }
      if (matches(e, "navNext")) {
        e.preventDefault();
        const idx = filteredQueue.findIndex((c) => c.id === activeId);
        const next = filteredQueue[Math.min(idx + 1, filteredQueue.length - 1)];
        if (next) setActiveId(next.id);
        return;
      }
      if (matches(e, "navPrev")) {
        e.preventDefault();
        const idx = filteredQueue.findIndex((c) => c.id === activeId);
        const prev = filteredQueue[Math.max(idx - 1, 0)];
        if (prev) setActiveId(prev.id);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, filteredQueue, logAppel, active, matches, blOpen, rappelOpen, shortcutsOpen, actionLoading, advance]);

  if (loading) {
    return (
      <div className="h-[calc(100vh-160px)] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stats = data?.stats ?? { remaining: 0, called: 0, commandes: 0, demains: 0, conversion: 0 };

  return (
    <div className="h-full flex flex-col gap-5 animate-fade-up min-h-0">
      {/* ── Top stat strip ─────────────────────────────────── */}
      <div className="shrink-0 flex items-start justify-between gap-4">
        <ConsoleHeader stats={stats} />
        <button
          type="button"
          onClick={() => window.open("/console/ecran2", "televent-ecran2", "width=720,height=900")}
          title="Ouvre une 2e fenêtre (stock perso + saisie BL) synchronisée — à glisser sur ton 2e écran"
          className="shrink-0 hidden md:inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card text-[12px] font-medium text-foreground/80 hover:text-foreground hover:border-brand-400 transition-colors"
        >
          <MonitorSmartphone className="h-3.5 w-3.5" />
          2ᵉ écran
        </button>
      </div>

      {/* ── Bandeau présence / distribution ────────────────── */}
      {data?.presence && (data.presence.absent.length > 0) && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 dark:bg-orange-950/25 border border-orange-200/70 dark:border-orange-500/30 text-[12px]">
          <span className="h-1.5 w-1.5 rounded-full bg-orange-500 shrink-0" />
          <p className="text-orange-900 dark:text-orange-200">
            <span className="font-semibold">{data.presence.absent.length} absent{data.presence.absent.length > 1 ? "s" : ""}</span>
            {" "}({data.presence.absent.join(", ")})
            {data.presence.toCover > 0 && (
              <> · <span className="font-semibold">{data.presence.toCover} client{data.presence.toCover > 1 ? "s" : ""} à couvrir</span> dans ta file</>
            )}
          </p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- navigation full-reload volontaire (comportement preexistant inchange) */}
          <a href="/commerciaux" className="ml-auto text-[11.5px] font-medium text-orange-800 dark:text-orange-300 hover:underline shrink-0">
            Gérer les présences →
          </a>
        </div>
      )}

      {/* ── 3-column workspace — fills remaining height, each column scrolls ──
           Mise à jour : queue élargie (col-4) car la file d'appel est le
           point d'ancrage de la Console 1 ; le centre rétrécit car la
           récup d'info détaillée se fait sur l'Écran 2. */}
      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">

        {/* ── LEFT : Queue rail ─────────────────────────── */}
        <aside className="col-span-12 lg:col-span-4 panel p-0 overflow-hidden flex flex-col">
          {/* Search */}
          <div className="px-4 pt-4 pb-3 border-b border-border space-y-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={searchRef}
                placeholder="Rechercher…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-[13px]"
              />
              <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground/60 bg-secondary/60 px-1.5 py-0.5 rounded">
                {displayKey(keymap.searchFocus)}
              </kbd>
            </div>

            {/* Tri — console personnelle : aucun filtre d'équipe / par commercial */}
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortMode)}>
              <SelectTrigger className="h-8 text-[11.5px]">
                <span className="inline-flex items-center gap-1.5 truncate">
                  <ArrowUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="Tri" />
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hour">Heure optimale</SelectItem>
                <SelectItem value="name">Nom (A–Z)</SelectItem>
                <SelectItem value="type">Type</SelectItem>
                <SelectItem value="lastOrder">Dernière commande</SelectItem>
              </SelectContent>
            </Select>

            {/* Queue header */}
            <div className="flex items-center justify-between mt-1 px-1">
              <span className="kicker">À appeler</span>
              <span className="text-[11px] tnum text-muted-foreground">
                {filteredQueue.length}
              </span>
            </div>
          </div>

          {/* Queue list */}
          <div className="flex-1 overflow-y-auto">
            {filteredQueue.length === 0 ? (
              <div className="p-6 text-center">
                <CheckCircle2 className="h-7 w-7 mx-auto text-emerald-500 mb-2" />
                <p className="text-[13px] font-medium text-foreground">Tout est fait 🎉</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Aucun client à appeler maintenant.
                </p>
              </div>
            ) : (
              <ol>
                {filteredQueue.map((c) => (
                  <QueueRow
                    key={c.id}
                    client={c}
                    active={c.id === activeId}
                    onSelect={setActiveId}
                  />
                ))}
              </ol>
            )}

            {/* Done section */}
            {(data?.done.length ?? 0) > 0 && (
              <div className="border-t border-border mt-2">
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="kicker text-emerald-600/80 dark:text-emerald-400/80">Faits aujourd&apos;hui</span>
                  <span className="text-[11px] tnum text-muted-foreground">
                    {data?.done.length}
                  </span>
                </div>
                <ol>
                  {data!.done.map((c) => (
                    <QueueRow
                      key={c.id}
                      client={c}
                      active={c.id === activeId}
                      done
                      onSelect={setActiveId}
                    />
                  ))}
                </ol>
              </div>
            )}
          </div>
        </aside>

        {/* ── CENTER : Active client ──────────────────────── */}
        <main className="col-span-12 lg:col-span-5 panel p-5 overflow-y-auto relative">
          {/* Prefs kebab — top-right of the panel itself, always visible */}
          {active && (
            <div className="absolute top-3 right-3 z-20">
              <FichePrefsMenu
                prefs={prefs}
                toggleVisibility={toggleVisibility}
                reset={resetPrefs}
              />
            </div>
          )}
          {!active ? (
            <EmptyActive />
          ) : (
            <ActiveClient
              client={active}
              notesDraft={notesDraft}
              setNotesDraft={setNotesDraft}
              saveNotes={saveNotes}
              savingNotes={savingNotes}
              saveEmail={saveEmail}
              prefs={prefs}
              toggleVisibility={toggleVisibility}
              toggleCollapsed={toggleCollapsed}
              reorder={reorder}
              resetPrefs={resetPrefs}
            />
          )}
        </main>

        {/* ── RIGHT : Actions ─────────────────────────────── */}
        <aside className="col-span-12 lg:col-span-3 panel p-0 overflow-hidden flex flex-col">
          <ActionPanel
            client={active}
            onDemain={() => logAppel("DEMAIN")}
            onRappel={() => setRappelOpen(true)}
            onBL={() => setBlOpen(true)}
            onSkip={advance}
            actionLoading={actionLoading}
            callNote={callNote}
            setCallNote={setCallNotePersisted}
            keymap={keymap}
          />
        </aside>
      </div>

      {/* ── Keyboard hints footer ────────────────────────── */}
      <div className="shrink-0">
        <KeyboardHints keymap={keymap} onOpenSettings={() => setShortcutsOpen(true)} />
      </div>

      {/* ── Rappel dialog ────────────────────────────────── */}
      <RappelDialog
        open={rappelOpen}
        onOpenChange={setRappelOpen}
        client={active}
        onCreated={() => { fetchData(); advance(); }}
      />

      {/* ── Keyboard shortcuts customization dialog ──────── */}
      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        keymap={keymap}
        remap={remap}
        reset={resetShortcuts}
      />

      {/* ── BL (Bon de Livraison) dialog ─────────────────── */}
      {active && (
        <BLDialog
          open={blOpen}
          onOpenChange={setBlOpen}
          clientId={active.id}
          clientName={active.nom}
          stockSharePct={data?.me?.stockSharePct ?? 100}
          onCreated={() => {
            // BL = commande journalisée → on purge la note rapide du client.
            clearCallNote(active.id);
            setCallNote("");
            fetchData();
            advance();
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Sub-components
═══════════════════════════════════════════════════════════════ */

function ConsoleHeader({ stats }: { stats: ConsoleData["stats"] }) {
  const date = new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long",
  });
  return (
    <header className="flex items-end justify-between gap-6 flex-wrap">
      <div>
        <p className="kicker mb-1.5">Console télévente</p>
        <h1 className="font-display text-[34px] font-semibold text-foreground tracking-tight leading-none">
          {date.charAt(0).toUpperCase() + date.slice(1)}
        </h1>
      </div>
      {/* Strip de stats — masqué sur mobile (on veut la file d'appel, pas le score) */}
      <div className="hidden md:flex items-stretch gap-2.5 flex-wrap">
        <Stat
          label="Restants" value={stats.remaining} tone="brand" icon={Phone} delay={0}
          info={{ label: "Restants à appeler",
            content: "Clients planifiés ce jour (lun/mar/…) qui n'ont pas encore été contactés aujourd'hui, et qui n'ont pas de rappel futur programmé." }}
        />
        <Stat
          label="Appelés" value={stats.called} icon={CheckCircle2} delay={60}
          info={{ label: "Appelés aujourd'hui",
            content: "Nombre total d'actions enregistrées aujourd'hui (commandes + reports à demain), tous clients confondus." }}
        />
        <Stat
          label="Commandes" value={stats.commandes} tone="emerald" icon={ShoppingCart} delay={120}
          info={{ label: "Commandes du jour",
            content: "Appels marqués « Commande » aujourd'hui. C'est ton compteur de ventes du jour." }}
        />
        <Stat
          label="À demain" value={stats.demains} tone="amber" icon={Clock} delay={180}
          info={{ label: "Reports à demain",
            content: "Clients que tu as marqués « À demain » aujourd'hui — ils reviendront automatiquement dans la file lors de leur prochain jour d'appel." }}
        />
        <Stat
          label="Conv." value={stats.conversion} suffix="%" tone="violet" icon={TrendingUp} delay={240}
          info={{ label: "Taux de conversion",
            content: <>commandes ÷ appels passés aujourd&apos;hui.<br/>Au-dessus de <b>50%</b> = bonne journée.</> }}
        />
      </div>
    </header>
  );
}

function Stat({
  label, value, suffix = "", tone, info, icon: Icon, delay = 0,
}: {
  label: string; value: number; suffix?: string;
  tone?: "brand" | "emerald" | "amber" | "violet";
  info?: { label: string; content: React.ReactNode };
  icon?: React.ElementType;
  delay?: number;
}) {
  const valueColor =
    tone === "brand"   ? "text-brand-600 dark:text-brand-400" :
    tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" :
    tone === "amber"   ? "text-amber-600 dark:text-amber-400" :
    tone === "violet"  ? "text-violet-600 dark:text-violet-400" :
                         "text-foreground";
  const accentBorder =
    tone === "brand"   ? "border-l-brand-500" :
    tone === "emerald" ? "border-l-emerald-500" :
    tone === "amber"   ? "border-l-amber-500" :
    tone === "violet"  ? "border-l-violet-500" :
                         "border-l-muted-foreground/40";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.base, ease: EASE.out, delay: delay / 1000 }}
      className={`rounded-xl border border-border border-l-4 ${accentBorder} bg-card px-4 py-3 min-w-[116px]
                 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover`}
    >
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className={`h-3.5 w-3.5 ${valueColor}`} />}
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        {info && (
          <InfoTip label={info.label} content={info.content} side="bottom" iconSize={11} />
        )}
      </div>
      <p className={`font-display text-[30px] font-bold tnum leading-none mt-2 ${valueColor}`}>
        <AnimatedNumber value={value} suffix={suffix} duration={DUR.slow} animateOnMount />
      </p>
    </motion.div>
  );
}

/**
 * QueueRow — version compacte 2 lignes.
 *  L1 : ● Nom + badges          tél (tnum, droite)
 *  L2 : code · créneau                        TYPE
 *
 * Commercial volontairement retiré : info portée par le filtre commercial
 * en haut de la file (déjà filtré) — y mettre le nom dans chaque ligne =
 * doublon visuel qui rallonge la file pour rien.
 */
const QueueRow = React.memo(function QueueRow({
  client,
  active,
  done,
  onSelect,
}: { client: Client; active: boolean; done?: boolean; onSelect: (id: string) => void }) {
  const window = client.insights ? hourWindowLabel(client.insights) : null;
  // Direct line first if available, fallback to standard
  const phone = client.tel2 || client.tel1;
  const isDirect = !!client.tel2;
  return (
    <li>
      <button
        onClick={() => onSelect(client.id)}
        className={`w-full text-left px-3 py-1.5 border-l-2 transition-colors duration-150 group
          ${active
            ? "bg-brand-50/60 dark:bg-brand-950/30 border-l-brand-500"
            : "border-l-transparent hover:bg-secondary/40"}
          ${done ? "opacity-55 hover:opacity-90" : ""}
        `}
      >
        {/* ── L1 — dot + nom + badges + téléphone à droite ── */}
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full shrink-0 ${
            done
              ? "bg-emerald-500"
              : active
              ? "bg-brand-500 dot-accent"
              : "bg-border group-hover:bg-foreground/30"
          }`} />
          <p className={`text-[12.5px] truncate tracking-tight min-w-0 ${
            active ? "font-semibold text-foreground" : "font-medium text-foreground/85"
          }`}>
            {client.nom}
          </p>
          {/* « à couvrir » = reprise effective d'un collègue absent (ownerAbsent
              implique claimedFrom). Prioritaire sur le badge "récup." pour ne pas
              doubler l'info. Sinon, pour une reprise sans absence avérée, on
              garde le badge "récup.". */}
          {client.ownerAbsent ? (
            <span
              className="text-[9px] font-semibold uppercase tracking-wider px-1 py-px rounded bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300 shrink-0"
              title={`${client.claimedFrom} est absent — client repris à couvrir`}
            >
              à couvrir
            </span>
          ) : client.claimedFrom ? (
            <span
              className="text-[9px] font-semibold uppercase tracking-wider px-1 py-px rounded bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 shrink-0"
              title={`Récupéré de ${client.claimedFrom}`}
            >
              récup.
            </span>
          ) : null}
          {!!client.openIncidents && client.openIncidents > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-px rounded bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 shrink-0"
              title={`${client.openIncidents} incident(s) ouvert(s)`}
            >
              <AlertTriangle className="h-2.5 w-2.5" /> {client.openIncidents}
            </span>
          )}
          {/* Pastille "À relancer" — pas de commande depuis +7j (ou jamais sur la fenêtre).
              Style aligné sur la pastille type (GMS) : rond, uppercase, couleur dédiée. */}
          {(() => {
            const d = client.insights?.lastOrderDays;
            const needsRevival = d == null || d > 7;
            if (!needsRevival) return null;
            const label = d == null ? "JAMAIS" : `+${d}J`;
            const title = d == null
              ? "Aucune commande sur la fenêtre — à relancer"
              : `Dernière commande il y a ${d} jours — à relancer`;
            return (
              <span
                className="shrink-0 text-[9px] font-bold tracking-wider px-1.5 py-px rounded bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                title={title}
              >
                {label}
              </span>
            );
          })()}
          {phone && (
            <span
              className={`ml-auto shrink-0 font-mono tnum text-[11.5px] leading-none ${
                isDirect ? "text-foreground" : "text-foreground/70"
              }`}
              title={isDirect ? "Ligne directe" : "Standard"}
            >
              {phone}
            </span>
          )}
        </div>

        {/* ── L2 — code (+ créneau) à gauche, TYPE à droite ── */}
        <div className="flex items-center gap-2 mt-0.5 pl-4 min-w-0">
          <span className="text-[10px] font-mono text-muted-foreground/70 truncate min-w-0">
            {client.code}
          </span>
          {window && window !== "—" && (
            <span className="text-[9.5px] font-mono tnum text-muted-foreground shrink-0">
              · {window}
            </span>
          )}
          {client.type && (
            <span className={`ml-auto shrink-0 text-[9px] font-bold tracking-wider px-1.5 py-px rounded leading-tight ${
              client.type === "EXPORT" ? "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" :
              client.type === "GMS"    ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" :
                                         "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
            }`}>
              {client.type}
            </span>
          )}
        </div>
      </button>
    </li>
  );
});
QueueRow.displayName = "QueueRow";

function EmptyActive() {
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

function ActiveClient({
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
      client.insights && (client.insights.bestHour || client.insights.bestDayOfWeek || client.insights.medianIntervalDays) ? (
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
          <div className="flex gap-1.5 flex-wrap">
            {[1,2,3,4,5,6,0].map((d) => {
              const active = days.includes(d);
              return (
                <span
                  key={d}
                  className={`h-7 w-10 rounded-md text-[11px] font-semibold flex items-center justify-center transition-colors ${
                    active
                      ? "bg-brand-600 text-white"
                      : "bg-secondary text-muted-foreground/60"
                  }`}
                >
                  {JOURS_FR[d]}
                </span>
              );
            })}
          </div>
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

    rappels: () =>
      client.rappels.length > 0 ? (
        <Block icon={BellRing} label="Rappels planifiés" {...collapseProps("rappels")}>
          <ul className="space-y-1.5">
            {client.rappels.map((r) => (
              <li key={r.id} className="flex items-baseline gap-3 text-[12.5px]">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 bg-brand-100 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                  {r.statut === "PLANIFIE" ? "à venir" : r.statut.toLowerCase()}
                </span>
                <span className="text-foreground/80 tnum">{formatDate(r.dateRappel)}</span>
                {r.note && <span className="text-muted-foreground truncate flex-1 italic">— {r.note}</span>}
              </li>
            ))}
          </ul>
        </Block>
      ) : null,
  };

  return (
    <div key={client.id} className="animate-client-swap space-y-7">
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
          <h2 className="text-[26px] font-bold text-foreground tracking-tight leading-tight">
            {client.nom}
          </h2>
          {client.type && (
            <span className={`text-[10px] font-bold tracking-[0.14em] uppercase px-1.5 py-0.5 rounded ${
              client.type === "EXPORT" ? "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" :
              client.type === "GMS"    ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" :
                                         "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
            }`}>
              {client.type}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11.5px] text-muted-foreground">
          <span className="font-mono text-foreground/70">{client.code}</span>
          {client.commercial && (
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" />
              {client.commercial}
            </span>
          )}
        </div>
      </div>

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

/* ─────────────────────────────────────────────────────────────
   NotesCluster — 4 sous-zones :
     1. Email (chip mailto, éditable, bidir SAP)
     2. Groupe SAP (badge lecture seule)
     3. Historique compilé (notes des AppelLog COMMANDE)
     4. Note libre (textarea résiduel)
───────────────────────────────────────────────────────────── */
function NotesCluster({
  client, notesDraft, setNotesDraft, saveNotes, savingNotes, saveEmail, notesDirty,
}: {
  client: Client;
  notesDraft: string;
  setNotesDraft: (v: string) => void;
  saveNotes: () => void;
  savingNotes: boolean;
  saveEmail: (next: string) => void;
  notesDirty: boolean;
}) {
  const [emailDraft, setEmailDraft] = useState(client.email ?? "");
  const [editingEmail, setEditingEmail] = useState(false);

  // Reset email draft when active client changes
  useEffect(() => {
    setEmailDraft(client.email ?? "");
    setEditingEmail(false);
  }, [client.id, client.email]);

  // Notes COMMANDE non vides — historique compilé (plus récentes en tête)
  const commandeNotes = client.appels.filter(
    (a) => a.type === "COMMANDE" && a.note && a.note.trim(),
  );

  return (
    <div className="space-y-3.5">
      {/* ── Email ────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
          <Mail className="h-3 w-3" /> Email
        </div>
        {editingEmail ? (
          <div className="flex items-center gap-2">
            <Input
              type="email"
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              placeholder="client@exemple.fr"
              className="h-8 text-[12.5px]"
              autoFocus
            />
            <Button
              size="sm"
              onClick={() => { saveEmail(emailDraft); setEditingEmail(false); }}
              className="h-8 px-2.5"
            >
              OK
            </Button>
            <button
              type="button"
              onClick={() => { setEmailDraft(client.email ?? ""); setEditingEmail(false); }}
              className="text-[11.5px] text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>
        ) : client.email ? (
          <div className="flex items-center gap-2">
            <a
              href={`mailto:${client.email}`}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/10 hover:bg-primary/20 text-[12px] text-foreground transition-colors truncate"
              title={client.email}
            >
              <Mail className="h-3 w-3 text-primary" />
              <span className="truncate">{client.email}</span>
            </a>
            <button
              type="button"
              onClick={() => setEditingEmail(true)}
              className="text-[11px] text-muted-foreground hover:text-brand-600"
            >
              modifier
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingEmail(true)}
            className="text-[12px] italic text-muted-foreground hover:text-brand-600"
          >
            + Renseigner un email
          </button>
        )}
      </div>

      {/* ── Groupe SAP (lecture seule) ──────────────────── */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
          <Tag className="h-3 w-3" /> Groupe SAP
        </div>
        {client.sapGroupName ? (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-secondary/40 text-[12px]"
            title="Édition réservée à SAP B1 (pilote les coefs de prix conseillé)"
          >
            <span className="font-medium text-foreground">{client.sapGroupName}</span>
            {client.sapGroupCode != null && (
              <span className="font-mono text-[10.5px] text-muted-foreground">#{client.sapGroupCode}</span>
            )}
          </span>
        ) : (
          <span className="text-[11.5px] italic text-muted-foreground">— non synchronisé —</span>
        )}
      </div>

      {/* ── Historique compilé (notes laissées sur les commandes) ── */}
      {commandeNotes.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
            <MessageSquare className="h-3 w-3" />
            Historique notes commandes
            <span className="text-muted-foreground/60 font-normal normal-case tracking-normal">
              ({commandeNotes.length})
            </span>
          </div>
          <ul className="space-y-1 max-h-32 overflow-y-auto pr-1">
            {commandeNotes.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-baseline gap-1.5 text-[11.5px]">
                <span className="text-muted-foreground/70 tnum text-[10.5px] shrink-0">
                  {formatDate(a.heureAppel)}
                </span>
                <span className="text-foreground/80 truncate">— {a.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Note libre (résiduelle) ─────────────────────── */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
          <StickyNote className="h-3 w-3" /> Note libre
        </div>
        <Textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          placeholder="Anecdotes, contexte, infos non catégorisables…"
          rows={3}
          className="resize-none text-[13px] leading-relaxed"
        />
        {notesDirty && (
          <div className="flex items-center gap-2 animate-fade-in">
            <Button size="sm" onClick={saveNotes} disabled={savingNotes}>
              {savingNotes ? <Loader2 className="h-3 w-3 animate-spin" /> : "Sauvegarder"}
            </Button>
            <button
              type="button"
              onClick={() => setNotesDraft(client.notes ?? "")}
              className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Annuler
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Prefs kebab — show/hide only. Reorder is done via drag on the fiche. ── */
function FichePrefsMenu({
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

function InsightsBlock({
  insights, collapsible, collapsed, onToggle,
}: {
  insights: ClientInsights;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const reco = summaryRecommendation(insights);
  const TrendIcon = insights.trend30 === "rising"  ? TrendingUp
                  : insights.trend30 === "falling" ? TrendingDown
                  :                                  Minus;
  const trendColor = insights.trend30 === "rising"  ? "text-emerald-600 dark:text-emerald-400"
                   : insights.trend30 === "falling" ? "text-rose-500 dark:text-rose-400"
                   :                                  "text-muted-foreground";

  const header = (
    <div className={`flex items-center gap-2 ${collapsed ? "" : "mb-3 border-b border-border pb-1.5"}`}>
      <span className="h-3 w-0.5 bg-brand-500 rounded-full shrink-0" />
      <Sparkles className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/85">
        Analyse comportementale
      </p>
      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
        insights.confidence === "high"   ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" :
        insights.confidence === "medium" ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" :
                                           "bg-secondary text-muted-foreground"
      }`}>
        {insights.confidence === "high" ? "fiable" : insights.confidence === "medium" ? "moyen" : "données limitées"}
      </span>
      <span className="ml-auto inline-flex items-center gap-1.5">
        <InfoTip
          label="Analyse comportementale"
          content={<>Stats calculées sur l&apos;historique des 180 derniers jours.<br/>Plus de commandes = plus de fiabilité.</>}
          side="left"
          iconSize={11}
        />
        {collapsible && (
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground/60 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        )}
      </span>
    </div>
  );

  return (
    <section className={`rounded-md border border-border bg-card ${collapsed ? "p-3" : "p-4"}`}>
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="w-full text-left rounded-md -mx-1 px-1 py-0.5 hover:bg-secondary/30 transition-colors"
        >
          {header}
        </button>
      ) : (
        header
      )}

      {!collapsed && reco && (
        <p className="text-[13px] text-foreground font-medium leading-snug mb-4 pl-1">
          {reco}
        </p>
      )}

      {!collapsed && (
      <div className="grid grid-cols-2 gap-x-5 gap-y-3 text-[12px]">
        {insights.bestHour && (
          <Metric
            label="Meilleure heure"
            value={insights.hourWindow
              ? `${insights.hourWindow.start}h – ${insights.hourWindow.end}h`
              : `${insights.bestHour.hour}h`}
            hint={`${insights.bestHour.share}% des cdes`}
            info="Heure (ou créneau) où ce client a passé le plus de commandes."
          />
        )}
        {insights.bestDayOfWeek && (
          <Metric
            label="Meilleur jour"
            value={dayOfWeekLabel(insights.bestDayOfWeek.dow)}
            hint={`${insights.bestDayOfWeek.share}% des cdes`}
            info="Jour de la semaine le plus prolifique en commandes."
          />
        )}
        {insights.medianIntervalDays !== null && (
          <Metric
            label="Fréquence"
            value={`~${insights.medianIntervalDays} j`}
            hint="entre commandes (médiane)"
            info="Intervalle médian entre deux commandes successives. La médiane est plus robuste aux écarts ponctuels que la moyenne."
          />
        )}
        {insights.conversionRate !== null && (
          <Metric
            label="Conversion historique"
            value={`${insights.conversionRate}%`}
            hint={`${insights.ordersCount}/${insights.callsCount} appels`}
            info="Part des appels qui ont abouti à une commande, sur tout l'historique connu."
          />
        )}
        {insights.lastOrderDays !== null && (
          <Metric
            label="Dernière commande"
            value={insights.lastOrderDays === 0 ? "Aujourd'hui"
                 : insights.lastOrderDays === 1 ? "Hier"
                 : `il y a ${insights.lastOrderDays} j`}
            info="Délai depuis la dernière commande prise par ce client."
          />
        )}
        {insights.trend30 && (
          <Metric
            label="Tendance 30j"
            value={
              <span className={`inline-flex items-center gap-1 ${trendColor}`}>
                <TrendIcon className="h-3 w-3" />
                {insights.trend30 === "rising" ? "En hausse" : insights.trend30 === "falling" ? "En baisse" : "Stable"}
              </span>
            }
            info="Comparaison du nombre de commandes des 30 derniers jours vs les 30 jours précédents."
          />
        )}
      </div>
      )}
    </section>
  );
}

function Metric({
  label, value, hint, info,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  info?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <p className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">{label}</p>
        {info && <InfoTip label={label} content={info} side="top" iconSize={10} />}
      </div>
      <p className="text-[14.5px] font-semibold text-foreground mt-1 tnum tracking-tight">{value}</p>
      {hint && <p className="text-[10.5px] text-muted-foreground mt-0.5">{hint}</p>}
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

function ActionPanel({
  client, onDemain, onRappel, onBL, onSkip, actionLoading,
  callNote, setCallNote, keymap,
}: {
  client: Client | null;
  onDemain: () => void;
  onRappel: () => void;
  onBL: () => void;
  onSkip: () => void;
  actionLoading: string | null;
  callNote: string;
  setCallNote: (v: string) => void;
  keymap: Record<ShortcutAction, string>;
}) {
  if (!client) {
    return (
      <div className="p-5 text-center py-10 text-[12.5px] text-muted-foreground">
        Sélectionne un client pour voir les actions.
      </div>
    );
  }

  const tels = [
    { label: "Standard", value: client.tel1 },
    { label: "Direct 1", value: client.tel2 },
    { label: "Direct 2", value: client.tel3 },
  ].filter((t) => t.value);

  return (
    <div className="flex flex-col h-full animate-fade-in min-h-0">
      {/* ── Top zone (téléphones + note) — peut défiler si besoin ── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-6">
        {/* ── Téléphones — n°1 = CTA d'appel géant, les autres en compact ── */}
        <section>
          <p className="kicker mb-3">Appeler</p>
          {tels.length === 0 ? (
            <p className="text-[12px] italic text-muted-foreground py-2">Aucun numéro renseigné.</p>
          ) : (
            <div className="space-y-2">
              {/* Numéro principal — gros, le plus accessible (loi de Fitts) */}
              <a
                href={`tel:${tels[0].value}`}
                className="group flex items-center gap-3 px-4 py-4 rounded-2xl bg-primary text-primary-foreground shadow-[0_2px_14px_rgba(250,204,21,0.3)] hover:brightness-105 hover:shadow-[0_4px_22px_rgba(250,204,21,0.45)] transition-all active:scale-[0.99]"
              >
                <Phone className="h-6 w-6 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{tels[0].label}</p>
                  <p className="text-[22px] font-mono font-bold tnum leading-tight truncate">{tels[0].value}</p>
                </div>
              </a>
              {/* Numéros secondaires — compacts */}
              {tels.slice(1).map((t) => (
                <a
                  key={t.label}
                  href={`tel:${t.value}`}
                  className="group flex items-center gap-2.5 px-3 py-2 rounded-lg bg-secondary/40 hover:bg-secondary border border-border transition-all"
                >
                  <Phone className="h-3.5 w-3.5 text-brand-500 dark:text-brand-400 shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-16 shrink-0">{t.label}</span>
                  <span className="text-[13px] font-mono font-semibold text-foreground tnum truncate">{t.value}</span>
                </a>
              ))}
            </div>
          )}
        </section>

        <div className="hairline" />

        {/* ── Note de l'appel (CRM) ── */}
        <section>
          <div className="flex items-center gap-1.5 mb-2.5">
            <MessageSquare className="h-3 w-3 text-muted-foreground/70" />
            <p className="kicker">Note d&apos;appel</p>
            <InfoTip
              label="Note d'appel"
              content={<>Saisie facultative qui sera attachée à l&apos;action loggée et visible dans le fil d&apos;activité du client (objections, demandes spéciales, contexte…).</>}
              side="left"
              iconSize={11}
            />
          </div>
          <Textarea
            value={callNote}
            onChange={(e) => setCallNote(e.target.value)}
            placeholder="Quantités, conditions, objection, remarque…"
            rows={3}
            className="text-[12.5px] leading-relaxed resize-none"
          />
        </section>
      </div>

      {/* ── Verdict — barre fixe en bas, TOUJOURS visible (loi de Fitts) ── */}
      <div className="shrink-0 border-t border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-1.5 mb-1">
          <p className="kicker">Résultat de l&apos;appel</p>
          <InfoTip
            label="Résultat de l'appel"
            content="Choisis l'issue de ton appel — l'action est loggée (avec la note ci-dessus) et le client suivant s'affiche automatiquement."
            side="top"
            iconSize={11}
          />
        </div>
        <VerdictButton
          onClick={onBL}
          icon={ShoppingCart}
          label="Commande (BL)"
          shortcut={displayKey(keymap.openBL)}
          variant="primary"
          tipLabel="Commande"
          tipContent={<>Ouvre la saisie du bon de livraison SAP.<br/>Pré-rempli avec la dernière commande si tu cliques sur « rejouer ».</>}
        />
        <VerdictButton
          onClick={onDemain}
          loading={actionLoading === "DEMAIN"}
          icon={Clock}
          label="À demain"
          shortcut={displayKey(keymap.demain)}
          variant="warning"
          tipLabel="À demain"
          tipContent={<>Le client n&apos;a pas commandé mais doit être recontacté.<br/>Il sera replacé dans la file lors de son prochain jour d&apos;appel programmé.</>}
        />
        <VerdictButton
          onClick={onRappel}
          icon={BellRing}
          label="Rappel programmé"
          shortcut={displayKey(keymap.rappel)}
          variant="brand"
          tipLabel="Rappel programmé"
          tipContent={<>Choisit une date et heure précises pour rappeler ce client.<br/>L&apos;événement est ajouté à ton calendrier Microsoft.</>}
        />
        <button
          type="button"
          onClick={onSkip}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-all"
        >
          <span>Passer sans loguer</span>
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
            {displayKey(keymap.skip)}
          </kbd>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ── Bouton verdict — gros, plein largeur, raccourci kbd à droite ──
   Variante "primary" = jaune brand (CTA principal).
*/
function VerdictButton({
  onClick, loading, icon: Icon, label, shortcut, variant,
  tipLabel, tipContent,
}: {
  onClick: () => void;
  loading?: boolean;
  icon: React.ElementType;
  label: string;
  shortcut: string;
  variant: "primary" | "warning" | "brand";
  tipLabel?: string;
  tipContent?: React.ReactNode;
}) {
  const styles =
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:brightness-105 shadow-[0_2px_10px_rgba(250,204,21,0.28)] hover:shadow-[0_4px_16px_rgba(250,204,21,0.4)]"
      : variant === "warning"
      ? "bg-card hover:bg-amber-50 dark:hover:bg-amber-950/30 border border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-300"
      : "bg-card hover:bg-brand-50 dark:hover:bg-brand-950/30 border border-brand-300 dark:border-brand-500/40 text-brand-700 dark:text-brand-300";

  const btn = (
    <button
      onClick={onClick}
      disabled={loading}
      className={`w-full h-12 flex items-center gap-3 px-4 rounded-xl transition-all duration-150 active:scale-[0.98] disabled:opacity-60 ${styles}`}
    >
      <span className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
        variant === "primary" ? "bg-black/10" : "bg-secondary/40"
      }`}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="flex-1 text-left text-[14px] font-semibold leading-tight">{label}</span>
      <kbd className={`text-[10.5px] font-mono px-1.5 py-0.5 rounded ${
        variant === "primary" ? "bg-black/15 text-primary-foreground/90" : "bg-secondary text-muted-foreground"
      }`}>
        {shortcut}
      </kbd>
    </button>
  );

  if (!tipContent) return btn;
  return (
    <InfoTip label={tipLabel} content={tipContent} side="left" className="block w-full">
      {btn}
    </InfoTip>
  );
}

function KeyboardHints({
  keymap, onOpenSettings,
}: {
  keymap: Record<ShortcutAction, string>;
  onOpenSettings: () => void;
}) {
  const hints: [string, string][] = [
    [displayKey(keymap.searchFocus), "Recherche"],
    [`${displayKey(keymap.navPrev)}${displayKey(keymap.navNext)}`, "Naviguer"],
    [displayKey(keymap.openBL), "Commande (BL)"],
    [displayKey(keymap.demain), "À demain"],
    [displayKey(keymap.rappel), "Rappel"],
    [displayKey(keymap.skip), "Passer"],
  ];
  return (
    <footer className="hidden md:flex items-center justify-end gap-4 flex-wrap text-[11px] text-muted-foreground">
      {hints.map(([k, l]) => (
        <span key={l} className="flex items-center gap-1.5">
          <kbd className="font-mono bg-secondary/60 border border-border px-1.5 py-0.5 rounded text-[10px] text-foreground/70">
            {k}
          </kbd>
          {l}
        </span>
      ))}
      <button
        type="button"
        onClick={onOpenSettings}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
        title="Personnaliser les raccourcis clavier"
      >
        <Settings className="h-3 w-3" />
        Personnaliser
      </button>
    </footer>
  );
}

/* ── Rappel dialog ─────────────────────────────────────────── */
function RappelDialog({
  open, onOpenChange, client, onCreated,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  client: Client | null;
  onCreated: () => void;
}) {
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      // default to tomorrow 10:00
      const t = new Date();
      t.setDate(t.getDate() + 1);
      t.setHours(10, 0, 0, 0);
      setDate(formatDateInput(t));
      setNote("");
    }
  }, [open]);

  const minDateTime = formatDateInput(new Date(Date.now() + 5 * 60 * 1000));

  const submit = async () => {
    if (!client) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, dateRappel: date, note: note || undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Rappel créé · ajouté au calendrier Microsoft");
      onOpenChange(false);
      onCreated();
    } catch {
      toast.error("Erreur lors de la création du rappel");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[18px] font-semibold tracking-tight">
            <BellRing className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            Programmer un rappel
          </DialogTitle>
          {client && (
            <p className="text-[12.5px] text-muted-foreground mt-1">
              pour <span className="font-medium text-foreground">{client.nom}</span>
            </p>
          )}
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="rdate">Date et heure</Label>
            <Input
              id="rdate" type="datetime-local"
              min={minDateTime}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rnote">Note (facultatif)</Label>
            <Textarea
              id="rnote"
              rows={3}
              placeholder="Sujet, contexte de l'appel…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button onClick={submit} disabled={submitting || !date} className="w-full">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Créer le rappel</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Shortcuts customization dialog ────────────────────────── */
function ShortcutsDialog({
  open, onOpenChange, keymap, remap, reset,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  keymap: Record<ShortcutAction, string>;
  remap: (action: ShortcutAction, key: string) => void;
  reset: () => void;
}) {
  // Quand l'utilisateur clique sur "Modifier" pour une action, on capture la
  // prochaine touche pressée (Esc pour annuler).
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setCapturing(null); return; }
      if (!isBindableKey(e.key)) return;
      remap(capturing, e.key);
      setCapturing(null);
    };
    // capture phase pour court-circuiter les autres handlers globaux
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, remap]);

  // Reset la capture si le dialog se ferme
  useEffect(() => { if (!open) setCapturing(null); }, [open]);

  // Détection de conflits — touche utilisée par 2 actions
  const usage = new Map<string, number>();
  (Object.values(keymap)).forEach((k) => usage.set(k.toLowerCase(), (usage.get(k.toLowerCase()) ?? 0) + 1));

  const actions: ShortcutAction[] = ["searchFocus", "openBL", "demain", "rappel", "navNext", "navPrev"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[18px] font-semibold tracking-tight">
            <Settings className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            Raccourcis clavier
          </DialogTitle>
          <p className="text-[12.5px] text-muted-foreground mt-1">
            Clique sur une touche pour la remplacer. Persisté localement.
          </p>
        </DialogHeader>

        <ul className="mt-2 divide-y divide-border">
          {actions.map((a) => {
            const key = keymap[a];
            const isConflict = (usage.get(key?.toLowerCase() ?? "") ?? 0) > 1;
            const isCapturing = capturing === a;
            return (
              <li key={a} className="flex items-center gap-3 py-2.5">
                <span className="flex-1 text-[13px] text-foreground">{SHORTCUT_LABELS[a]}</span>
                {isConflict && !isCapturing && (
                  <span
                    className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                    title="Cette touche est partagée avec une autre action"
                  >
                    conflit
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setCapturing(isCapturing ? null : a)}
                  className={`min-w-[88px] inline-flex items-center justify-center px-2.5 py-1.5 rounded-md border text-[12px] font-mono transition-colors ${
                    isCapturing
                      ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300 animate-pulse"
                      : "border-border bg-secondary/40 hover:border-brand-400 text-foreground"
                  }`}
                >
                  {isCapturing ? "Pressez une touche…" : displayKey(key)}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
          <button
            type="button"
            onClick={reset}
            className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Réinitialiser les défauts
          </button>
          <Button size="sm" variant="secondary" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
        </div>

        <p className="text-[10.5px] text-muted-foreground/70 mt-2 leading-snug">
          Astuce : <kbd className="font-mono bg-secondary/60 px-1 rounded">Esc</kbd> pendant
          la capture annule. Les modificateurs seuls (Shift, Ctrl…) ne sont pas acceptés.
        </p>
      </DialogContent>
    </Dialog>
  );
}
