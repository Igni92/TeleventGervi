"use client";

import * as React from "react";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Search, Loader2, ArrowUpDown, CheckCircle2, MonitorSmartphone,
} from "lucide-react";
import { useConsolePrefs } from "@/lib/useConsolePrefs";
import { useConsoleShortcuts, displayKey } from "@/lib/useConsoleShortcuts";
import { broadcastActiveClient } from "@/lib/consoleSync";
import { segmentBadgeClass } from "@/lib/segments";
import { displayNameFromSlp } from "@/lib/salespeople";
import { loadCallNote, saveCallNote, clearCallNote } from "@/lib/callNoteStorage";
import { BLDialog } from "@/components/console/BLDialog";
import { NotificationsBell } from "@/components/console/NotificationsBell";
import { ConsoleSectionTabs } from "@/components/console/ConsoleSectionTabs";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
// Blocs d'affichage de la console — extraits sous components/console/call/*.
// L'orchestrateur ne garde que l'état, le fetch, les raccourcis, consoleSync et logAppel.
import {
  type Client, type ConsoleData, type GlobalHit, type SortMode,
  clientFromSearch,
} from "@/components/console/call/shared";
import { QueueRow } from "@/components/console/call/QueueRow";
import { ConsoleHeader, DueRappelsBanner, PresenceBanner } from "@/components/console/call/headerStats";
import { EmptyState } from "@/components/ui/empty-state";
import { ActiveClient, EmptyActive, FichePrefsMenu } from "@/components/console/call/ActiveClient";
import { ActionPanel } from "@/components/console/call/ActionPanel";
import { ClientContextMenu } from "@/components/console/call/ClientContextMenu";
import { RappelDialog } from "@/components/console/call/RappelDialog";
import { ShortcutsDialog } from "@/components/console/call/ShortcutsDialog";
import { KeyboardHints } from "@/components/console/call/KeyboardHints";

/* ─────────────────────────────────────────────────────────────
   Main component — single-page daily workspace (orchestrateur)
───────────────────────────────────────────────────────────── */

/**
 * En-tête de section ÉPINGLÉ (sticky) dans la file groupée. Le ton colore
 * uniquement le libellé (rouge = rappels dus bloquants, vert = faits validés).
 */
function QueueGroupHeader({
  label, count, tone,
}: { label: string; count: number; tone?: "danger" | "success" }) {
  const labelTone =
    tone === "danger" ? "text-destructive" :
    tone === "success" ? "text-success" :
    "text-muted-foreground";
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-card/95 backdrop-blur-sm border-b border-border">
      <span className={`text-caption2 font-semibold uppercase tracking-[0.14em] ${labelTone}`}>
        {label}
      </span>
      <span className="text-caption2 tnum text-muted-foreground">{count}</span>
    </div>
  );
}

export function CallConsole({ isAdmin = false, meInitials = null }: { isAdmin?: boolean; meInitials?: string | null }) {
  const [data, setData] = useState<ConsoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Menu contextuel (clic droit) sur une ligne de la file — actions portefeuille.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; client: Client } | null>(null);
  const [search, setSearch] = useState("");
  // Recherche « globale » : comptes HORS file d'appel (pour créer un BL sans
  // passer par la télévente). La même saisie filtre la file ET interroge
  // /api/clients ; les comptes trouvés hors file apparaissent sous « Autres
  // comptes ». Le compte choisi devient client actif (fiche + envoi écran 2).
  const [globalResults, setGlobalResults] = useState<Client[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  // Compte sélectionné hors file (n'existe pas dans queue/done) — conservé pour
  // que `active` puisse le résoudre même s'il n'est dans aucune liste.
  const [manualActive, setManualActive] = useState<Client | null>(null);
  const globalSeq = useRef(0);
  // Miroir de `manualActive` pour le lire dans fetchData (mémoïsé, deps []) sans
  // le recréer : évite que la réconciliation d'activeId éjecte un compte hors file.
  const manualActiveRef = useRef<Client | null>(null);
  const [sortBy, setSortBy] = useState<SortMode>("priorite");
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
        // Compte hors file sélectionné via la recherche → on le garde actif
        // (il n'est pas dans la file, mais l'utilisateur travaille dessus).
        if (prev && manualActiveRef.current?.id === prev) return prev;
        return json.queue[0]?.id ?? null;
      });
      // Pas de cron (Vercel Hobby = 1/jour) : quand des rappels sont dus et que
      // la console est ouverte, on pousse la notif vers les autres appareils de
      // l'agent (best-effort, marque notifiedAt côté serveur → pas de doublon).
      if ((json.dueRappels?.length ?? 0) > 0) {
        fetch("/api/push/flush", { method: "POST" }).catch(() => {});
      }
    } catch {
      toast.error("Erreur de chargement de la console");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ── Rafraîchissement périodique (60 s) ──────────────────────
     Un rappel dont l'heure arrive PENDANT que la console est ouverte doit
     remonter en tête tout seul : le serveur ne le sort du snooze qu'une fois
     l'heure passée, donc on re-fetch régulièrement. Pausé quand l'onglet est
     masqué (économie) et relancé au retour au premier plan. */
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (id == null) id = setInterval(fetchData, 60_000); };
    const stop = () => { if (id != null) { clearInterval(id); id = null; } };
    const onVis = () => { if (document.hidden) stop(); else { fetchData(); start(); } };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [fetchData]);

  /* ── Recherche de comptes hors file (débouncée) ──────────────
     Même terme que le filtre de file. Un compteur de séquence ignore les
     réponses périmées. /api/clients est authentifié + scopé côté serveur
     (un commercial ne trouve que SES comptes ; admin = tous). */
  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) { setGlobalResults([]); setGlobalLoading(false); return; }
    const my = ++globalSeq.current;
    setGlobalLoading(true);
    const h = setTimeout(() => {
      fetch(`/api/clients?search=${encodeURIComponent(term)}&limit=8`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: { clients?: GlobalHit[] }) => {
          if (my !== globalSeq.current) return;
          setGlobalResults((j.clients ?? []).map(clientFromSearch));
        })
        .catch(() => { if (my === globalSeq.current) setGlobalResults([]); })
        .finally(() => { if (my === globalSeq.current) setGlobalLoading(false); });
    }, 250);
    return () => clearTimeout(h);
  }, [search]);

  /* ── Actions portefeuille (menu clic droit) — admin uniquement ──────────── */
  const openCtxMenu = useCallback((e: React.MouseEvent, client: Client) => {
    if (!isAdmin) return;              // non-admin → menu natif du navigateur
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, client });
  }, [isAdmin]);

  const assignClient = useCallback(async (client: Client, body: Record<string, unknown>, okMsg: string) => {
    setCtxMenu(null);
    try {
      const res = await fetch(`/api/clients/${client.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Échec");
      toast.success(okMsg);
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de l'opération");
    }
  }, [fetchData]);

  const deactivateClient = useCallback((client: Client) => {
    if (!window.confirm(`Passer « ${client.nom} » en inactif ? Il quittera la file d'appel.`)) { setCtxMenu(null); return; }
    assignClient(client, { activeTelevente: false }, `${client.nom} — passé en inactif`);
  }, [assignClient]);

  const reassignClient = useCallback((client: Client, initials: string) => {
    // Réassigne UNIQUEMENT le vendeur (télévente) → le client bascule dans la
    // console du commercial cible. Le « commercial » (account manager) ne bouge pas.
    assignClient(client, { vendeur: initials }, `${client.nom} — envoyé à ${displayNameFromSlp(initials) ?? initials}`);
  }, [assignClient]);

  const allClients = useMemo(
    () => [...(data?.queue ?? []), ...(data?.done ?? [])],
    [data],
  );
  // Client actif : d'abord dans la file (queue/done) ; sinon un compte
  // sélectionné hors file via la recherche (manualActive).
  const active = allClients.find((c) => c.id === activeId)
    ?? (manualActive && manualActive.id === activeId ? manualActive : null);

  // Sélection d'un compte hors file → il devient actif (fiche au centre +
  // diffusion vers l'écran 2). On le mémorise pour que `active` le résolve.
  const pickGlobal = useCallback((c: Client) => {
    setManualActive(c);
    setActiveId(c.id);
  }, []);
  // Garde le miroir à jour pour la réconciliation d'activeId dans fetchData.
  manualActiveRef.current = manualActive;

  // Ouverture DIRECTE d'un client via l'URL (?open=CODE) — clic depuis la liste
  // Clients. On réutilise la recherche globale (chemin testé) pour le résoudre,
  // puis pickGlobal (le client devient actif, même hors file du jour).
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("open");
    if (!code) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("open");
    window.history.replaceState({}, "", url.toString()); // évite la réouverture au refresh
    fetch(`/api/clients?search=${encodeURIComponent(code)}&limit=5`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const hits: Parameters<typeof clientFromSearch>[0][] = j?.clients ?? [];
        const hit = hits.find((h) => (h.code ?? "").toLowerCase() === code.toLowerCase()) ?? hits[0];
        if (hit) pickGlobal(clientFromSearch(hit));
      })
      .catch(() => {});
  }, [pickGlobal]);

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
        medianHour: active.insights?.recommendedHour
          ?? active.insights?.medianHour
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

    // Tri. « priorité » = ordre SERVEUR (valeur × urgence) : on ne re-trie pas,
    // la file arrive déjà priorisée côté API (lib/priority). Les autres modes
    // restent des surcharges manuelles cosmétiques.
    if (sortBy !== "priorite") {
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
            // Tri par heure optimale d'appel : on privilégie l'heure de DÉCROCHÉ
            // (recommendedHour), avec repli sur l'heure typique du type (cold-start)
            // pour ne pas reléguer les clients neufs en fin de file.
            const ha = a.insights?.recommendedHour ?? a.fallbackHour ?? a.insights?.medianHour ?? 99;
            const hb = b.insights?.recommendedHour ?? b.fallbackHour ?? b.insights?.medianHour ?? 99;
            return ha - hb;
          }
        }
      });
    }

    // RAPPELS DUS TOUJOURS EN TÊTE — quel que soit le tri choisi (un rappel dont
    // l'heure est passée est un rendez-vous d'appel : il prime). Le plus ancien
    // d'abord ; le reste garde son ordre.
    const due = q.filter((c) => c.dueReminderAt);
    if (due.length === 0) return q;
    due.sort((a, b) => (a.dueReminderAt! < b.dueReminderAt! ? -1 : 1));
    const rest = q.filter((c) => !c.dueReminderAt);
    return [...due, ...rest];
  }, [data, search, sortBy]);

  /* ── Auto-advance to next client in queue ────────────────── */
  const advance = useCallback(() => {
    if (!data) return;
    const idx = data.queue.findIndex((c) => c.id === activeId);
    const next = data.queue[idx + 1] ?? data.queue[0] ?? null;
    setActiveId(next?.id ?? null);
  }, [data, activeId]);

  /* ── Retrait OPTIMISTE de la file « À appeler » ──────────────
     Une action journalisée (BL, commande, demain, rappel) doit faire
     disparaître le client de la file IMMÉDIATEMENT au clic, sans attendre le
     re-fetch serveur. On le bascule côté « Fait » et fetchData() réconcilie. */
  const markHandled = useCallback((id: string | null | undefined) => {
    if (!id) return;
    setData((cur) => {
      if (!cur) return cur;
      const c = cur.queue.find((x) => x.id === id);
      return {
        ...cur,
        queue: cur.queue.filter((x) => x.id !== id),
        done: c && !cur.done.some((x) => x.id === id) ? [c, ...cur.done] : cur.done,
      };
    });
  }, []);

  /* ── Log appel (COMMANDE / DEMAIN) ──────────────────────────
     scheduledFor (optional): for pre-commandes — client is snoozed
     until that date, no callback needed before it.
  */
  const logAppel = useCallback(async (
    type: "COMMANDE" | "DEMAIN",
    scheduledFor?: string,
    outcome?: "COMMANDE" | "DEMAIN" | "NRP" | "REFUS" | "REPONDEUR" | "LITIGE" | "RAPPELE",
  ) => {
    if (!active) return;
    setActionLoading(outcome ?? type);
    try {
      const res = await fetch("/api/appels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: active.id,
          type,
          outcome: outcome ?? type,
          note: callNote.trim() || undefined,
          scheduledFor: scheduledFor || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      const dateLabel = scheduledFor
        ? new Date(scheduledFor).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
        : null;
      const OUTCOME_LABELS: Record<string, string> = {
        NRP: "📵 Pas de réponse",
        REPONDEUR: "📨 Répondeur",
        REFUS: "🚫 Refus",
        LITIGE: "⚠️ Litige",
        RAPPELE: "↩️ Rappellera",
      };
      toast.success(
        type === "COMMANDE"
          ? `✅ ${dateLabel ? `Pré-commande ${dateLabel}` : "Commande"} — ${active.nom}`
          : outcome && OUTCOME_LABELS[outcome]
            ? `${OUTCOME_LABELS[outcome]} — ${active.nom}`
            : `📅 À demain — ${active.nom}`,
      );
      // Action journalisée → la note rapide n'a plus lieu d'être conservée.
      clearCallNote(active.id);
      setCallNote("");
      advance();
      markHandled(active.id);   // disparaît de « À appeler » au clic
      fetchData();
    } catch {
      toast.error("Erreur d'enregistrement");
    } finally {
      setActionLoading(null);
    }
  }, [active, callNote, advance, markHandled, fetchData]);

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

  /* ── Marque un rappel « fait » (bandeau des rappels dus) ─────────────── */
  const markRappelDone = useCallback(async (rappelId: string) => {
    // Retrait optimiste du bandeau.
    setData((cur) => cur ? { ...cur, dueRappels: (cur.dueRappels ?? []).filter((r) => r.id !== rappelId) } : cur);
    try {
      const res = await fetch("/api/reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rappelId, statut: "FAIT" }),
      });
      if (!res.ok) throw new Error();
      toast.success("Rappel marqué comme fait");
    } catch {
      toast.error("Erreur — rappel non mis à jour");
      fetchData();
    }
  }, [fetchData]);

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

  // « Autres comptes » : résultats de recherche qui ne sont PAS déjà dans la
  // file (queue/done) — pour ne pas dédoubler. Affichés sous la file.
  const queueIds = new Set(allClients.map((c) => c.id));
  const externalResults = globalResults.filter((c) => !queueIds.has(c.id));
  const showGlobal = search.trim().length >= 2 && (globalLoading || externalResults.length > 0);

  // File groupée : rappels dus (en tête, déjà triés par filteredQueue) vs reste.
  const dueRows = filteredQueue.filter((c) => c.dueReminderAt);
  const callRows = filteredQueue.filter((c) => !c.dueReminderAt);

  return (
    <div className="h-full flex flex-col gap-5 animate-fade-up min-h-0">
      {/* Onglets de section Télévente (Appels / Commande) — l'entrée de nav est
          fusionnée, cette barre bascule vers l'Écran 2 (prise de commande). */}
      <div className="shrink-0 flex items-center justify-between gap-3">
        <ConsoleSectionTabs />
        <NotificationsBell />
      </div>

      {/* ── Top stat strip ─────────────────────────────────── */}
      <div className="shrink-0">
        <ConsoleHeader stats={stats} />
      </div>

      {/* ── Pile de bandeaux — même design, une seule colonne en tête ──────
           Fusion des anciens bandeaux concurrents (rappels dus + présence)
           en une pile homogène « attention ». */}
      {((data?.dueRappels?.length ?? 0) > 0 || (data?.presence && data.presence.absent.length > 0)) && (
        <div className="shrink-0 flex flex-col gap-2">
          {(data?.dueRappels?.length ?? 0) > 0 && (
            <DueRappelsBanner
              items={data!.dueRappels!}
              onOpen={(clientId) => {
                if (allClients.some((c) => c.id === clientId)) setActiveId(clientId);
              }}
              onDone={markRappelDone}
            />
          )}
          {data?.presence && data.presence.absent.length > 0 && (
            <PresenceBanner presence={data.presence} />
          )}
        </div>
      )}

      {/* ── 3-column workspace — fills remaining height, each column scrolls ──
           Mise à jour : queue élargie (col-4) car la file d'appel est le
           point d'ancrage de la Console 1 ; le centre rétrécit car la
           récup d'info détaillée se fait sur l'Écran 2.
           TABLETTE (< xl) : les 3 colonnes s'EMPILENT — le layout PC serré se
           chevauchait. La page scrolle, chaque panneau est plafonné à ~75 vh
           et scrolle en interne. */}
      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0 overflow-y-auto xl:overflow-visible">

        {/* ── LEFT : Queue rail ─────────────────────────── */}
        <aside className="col-span-12 xl:col-span-4 max-h-[75vh] xl:max-h-none panel p-0 overflow-hidden flex flex-col">
          {/* Search */}
          <div className="px-4 pt-4 pb-3 border-b border-border space-y-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={searchRef}
                placeholder="Rechercher un compte (file + hors file)…"
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
                <SelectItem value="priorite">Priorité (valeur × urgence)</SelectItem>
                <SelectItem value="hour">Heure optimale</SelectItem>
                <SelectItem value="name">Nom (A–Z)</SelectItem>
                <SelectItem value="type">Type</SelectItem>
                <SelectItem value="lastOrder">Dernière commande</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Queue list — liste groupée à en-têtes épinglés */}
          <div className="flex-1 overflow-y-auto">
            {filteredQueue.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Tout est fait"
                description="Journée d'appels bouclée — aucun client à appeler maintenant."
                className="animate-fade-up"
              />
            ) : (
              <>
                {/* Rappels dus — épinglés en tête de file (rôle bloquant). */}
                {dueRows.length > 0 && (
                  <section>
                    <QueueGroupHeader label="Rappels dus" count={dueRows.length} tone="danger" />
                    <ol>
                      {dueRows.map((c) => (
                        <QueueRow
                          key={c.id}
                          client={c}
                          active={c.id === activeId}
                          onSelect={setActiveId}
                          onContext={isAdmin ? openCtxMenu : undefined}
                        />
                      ))}
                    </ol>
                  </section>
                )}
                {/* À appeler — le reste de la file priorisée. */}
                {callRows.length > 0 && (
                  <section>
                    <QueueGroupHeader label="À appeler" count={callRows.length} />
                    <ol>
                      {callRows.map((c) => (
                        <QueueRow
                          key={c.id}
                          client={c}
                          active={c.id === activeId}
                          onSelect={setActiveId}
                          onContext={isAdmin ? openCtxMenu : undefined}
                        />
                      ))}
                    </ol>
                  </section>
                )}
              </>
            )}

            {/* Autres comptes (hors file d'appel) — recherche globale. Cliquer
                un compte l'affiche au centre + l'envoie sur l'écran 2 pour un BL. */}
            {showGlobal && (
              <section>
                <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-card/95 backdrop-blur-sm border-b border-border">
                  <span className="inline-flex items-center gap-1.5 text-caption2 font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    <Search className="h-3 w-3" /> Autres comptes · hors file
                  </span>
                  {globalLoading
                    ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    : <span className="text-caption2 tnum text-muted-foreground">{externalResults.length}</span>}
                </div>
                {externalResults.length === 0 ? (
                  !globalLoading && (
                    <p className="px-4 py-3 text-caption text-muted-foreground italic">Aucun autre compte.</p>
                  )
                ) : (
                  <ol>
                    {externalResults.map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => pickGlobal(c)}
                          className={`w-full text-left px-4 py-2 border-l-2 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-apple)] group
                            ${c.id === activeId
                              ? "bg-primary/10 border-l-primary"
                              : "border-l-transparent hover:bg-secondary/50"}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`h-2 w-2 rounded-full shrink-0 ${
                              c.id === activeId ? "bg-primary dot-accent" : "bg-border group-hover:bg-foreground/30"
                            }`} />
                            <p className={`text-body truncate min-w-0 ${
                              c.id === activeId ? "font-semibold text-foreground" : "font-medium text-foreground/85"
                            }`}>
                              {c.nom}
                            </p>
                            {c.type && (
                              <span className={`shrink-0 text-caption2 font-semibold tracking-wider px-1.5 py-px rounded leading-tight ${segmentBadgeClass(c.type)}`}>
                                {c.type}
                              </span>
                            )}
                            <span className="ml-auto shrink-0 font-mono tnum text-caption2 text-muted-foreground">{c.code}</span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}

            {/* Done section */}
            {(data?.done.length ?? 0) > 0 && (
              <section>
                <QueueGroupHeader label="Faits aujourd'hui" count={data?.done.length ?? 0} tone="success" />
                <ol>
                  {data!.done.map((c) => (
                    <QueueRow
                      key={c.id}
                      client={c}
                      active={c.id === activeId}
                      done
                      onSelect={setActiveId}
                      onContext={isAdmin ? openCtxMenu : undefined}
                    />
                  ))}
                </ol>
              </section>
            )}
          </div>
        </aside>

        {/* ── CENTER : Active client ──────────────────────── */}
        <main className="col-span-12 xl:col-span-5 max-h-[75vh] xl:max-h-none panel p-5 overflow-y-auto relative">
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
            <>
              {/* Compte hors file (sélectionné via la recherche) : rappel qu'il
                  est aussi poussé sur l'écran 2 pour la saisie du BL. */}
              {!queueIds.has(active.id) && (
                <div className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-amber-300/70 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                  <MonitorSmartphone className="h-3.5 w-3.5" />
                  Compte hors file d&apos;appel — affiché sur l&apos;écran 2 pour créer un BL
                </div>
              )}
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
            </>
          )}
        </main>

        {/* ── RIGHT : Actions ─────────────────────────────── */}
        <aside className="col-span-12 xl:col-span-3 max-h-[75vh] xl:max-h-none panel p-0 overflow-hidden flex flex-col">
          <ActionPanel
            client={active}
            onDemain={() => logAppel("DEMAIN")}
            onOutcome={(o) => logAppel("DEMAIN", undefined, o)}
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
        onCreated={() => { advance(); markHandled(active?.id); fetchData(); }}
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
            advance();
            markHandled(active.id);   // le client quitte « À appeler » dès le clic
            fetchData();
          }}
        />
      )}

      {/* ── Menu contextuel (clic droit sur une ligne de file) — admin ──── */}
      {ctxMenu && (
        <ClientContextMenu
          menu={ctxMenu}
          meInitials={meInitials}
          onClose={() => setCtxMenu(null)}
          onDeactivate={deactivateClient}
          onReassign={reassignClient}
        />
      )}
    </div>
  );
}
