"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MonitorSmartphone, Loader2, Phone, AlertTriangle, Clock,
  TrendingUp, TrendingDown, Minus, ShoppingCart, User, Users, Mail,
  Calendar, ArrowLeft, Truck, MessageSquareText,
} from "lucide-react";
import { Ecran2Order } from "@/components/console/Ecran2Order";
import { rememberConsoleScreen } from "@/components/console/ConsoleScreenGate";
import {
  subscribeActiveClient, readActiveClient, requestActiveClient, clearModif,
  type ActiveClientState, type ActiveClientInfo,
} from "@/lib/consoleSync";
import { formatPhoneDisplay, standardizePhone } from "@/lib/phone";
import { fullNameFromSlp } from "@/lib/salespeople";

type ModifTarget = { docEntry: number; docNum: number; clientId: string | null; clientName: string | null };

/**
 * Écran 2 (fenêtre détachée) — optimisé **marge + relation client + incident**.
 * Synchronisé à l'écran 1. Le constructeur de commande prend toute la largeur.
 *
 * Mode MODIFICATION : « Détail livraison » diffuse une cible de modif via
 * consoleSync ; l'écran 2 bascule en saisie sur ce BL **dans la même fenêtre**
 * (aucun nouvel onglet). Le mode est « collant » : une fois en modif, les
 * rediffusions de client actif de la console sont ignorées tant que
 * l'utilisateur n'a pas quitté la modification (bouton « Quitter »).
 */
export default function Ecran2Page() {
  const [state, setState] = useState<ActiveClientState | null>(null);
  const [modif, setModif] = useState<ModifTarget | null>(null);
  const [ready, setReady] = useState(false);
  // Réf pour lire l'état « en modif ? » dans le callback de souscription (collant).
  const inModif = useRef(false);
  inModif.current = modif != null;

  // C3 — mémorise « dernier écran Console = Écran 2 » : le lien Console de la
  // sidebar ramènera ici (cf. ConsoleScreenGate sur /console).
  useEffect(() => { rememberConsoleScreen("ecran2"); }, []);

  useEffect(() => {
    const initial = readActiveClient();
    setState(initial);
    if (initial?.modif) {
      setModif({ docEntry: initial.modif.docEntry, docNum: initial.modif.docNum, clientId: initial.clientId, clientName: initial.clientName });
    }
    const unsub = subscribeActiveClient((s) => {
      if (s.modif) {
        // Nouvelle cible de modif → on bascule l'écran (même fenêtre).
        setModif({ docEntry: s.modif.docEntry, docNum: s.modif.docNum, clientId: s.clientId, clientName: s.clientName });
        setState(s);
      } else if (!inModif.current) {
        // Broadcast normal (client actif). En modif, on l'ignore (collant) pour ne
        // pas se faire éjecter par la rediffusion continue de la console.
        setState(s);
      }
    });
    requestActiveClient();
    setReady(true);
    return unsub;
  }, []);

  // Quitte la modification → reprend la synchro normale avec le client actif.
  const exitModif = useCallback(() => {
    clearModif();
    setModif(null);
    const s = readActiveClient();
    if (s) setState({ ...s, modif: null });
  }, []);

  const clientId = modif ? modif.clientId : (state?.clientId ?? null);
  const clientName = modif ? modif.clientName : (state?.clientName ?? null);
  const sharePct = state?.stockSharePct ?? 100;
  const info = modif ? null : (state?.client ?? null);
  const modifier = modif ? { docEntry: modif.docEntry, docNum: modif.docNum } : null;

  return (
    <div className="h-full flex flex-col gap-3 animate-fade-up min-h-0">
      <ClientBanner clientId={clientId} clientName={clientName} info={info} />

      {/* Constructeur de commande — prend tout l'espace restant */}
      <div className="flex-1 min-h-0">
        {!ready ? (
          <p className="text-[13px] text-muted-foreground inline-flex items-center gap-2 p-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Connexion…
          </p>
        ) : clientId && clientName ? (
          <Ecran2Order
            key={modif ? `m${modif.docEntry}` : clientId}
            clientId={clientId} clientName={clientName} stockSharePct={sharePct}
            modifier={modifier} onExitModif={exitModif}
          />
        ) : (
          <div className="h-full flex items-center justify-center panel">
            <p className="hidden md:block text-[13px] text-muted-foreground text-center max-w-xs">
              Sélectionne un client sur l&apos;écran 1 — son stock et la saisie de commande apparaîtront ici.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Bandeau client riche — toutes les infos contextuelles pour
   conduire l'entretien (téléphones, commercial, interlocuteurs,
   habitudes, incidents, cadence de livraison). Le nom du client
   est cliquable → fiche complète (plus de bouton dédié).
───────────────────────────────────────────────────────────── */

const JOURS_FR = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"] as const;

/** C3 — Retour volontaire à l'Écran 1 dans CETTE fenêtre : on réécrit la
 *  mémoire d'écran AVANT de naviguer, sinon le Gate de /console nous
 *  renverrait immédiatement ici. */
function Ecran1Link() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => { rememberConsoleScreen("ecran1"); router.push("/console"); }}
      title="Revenir à l'Écran 1 (file d'appel) dans cette fenêtre"
      className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-muted-foreground hover:text-brand-600 dark:hover:text-brand-400 hover:underline shrink-0"
    >
      <ArrowLeft className="h-3 w-3" /> Écran 1
    </button>
  );
}

function ClientBanner({
  clientId, clientName, info,
}: { clientId: string | null; clientName: string | null; info: ActiveClientInfo | null }) {
  if (!clientName) {
    return (
      <header className="shrink-0 panel px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="kicker mb-0.5 inline-flex items-center gap-1.5">
            <MonitorSmartphone className="h-3 w-3" /> Écran 2 · synchronisé
          </p>
          <Ecran1Link />
        </div>
        <h1 className="text-[19px] font-semibold tracking-tight text-muted-foreground">
          En attente d&apos;un client…
        </h1>
      </header>
    );
  }

  const tels = info ? [
    { label: "Standard", value: info.tel1 },
    { label: "Direct 1", value: info.tel2 },
    { label: "Direct 2", value: info.tel3 },
  ].filter((t): t is { label: string; value: string } => !!t.value) : [];

  const commercialName = fullNameFromSlp(info?.commercial);

  const incidents = info?.openIncidents ?? 0;
  const lastDays = info?.lastOrderDays;
  const lastLabel = lastDays === 0 ? "Aujourd'hui"
                  : lastDays === 1 ? "Hier"
                  : lastDays != null ? `il y a ${lastDays} j`
                  : null;

  const TrendIcon = info?.trend30 === "rising"  ? TrendingUp
                  : info?.trend30 === "falling" ? TrendingDown
                  :                                Minus;
  const trendColor = info?.trend30 === "rising"  ? "text-emerald-600 dark:text-emerald-400"
                   : info?.trend30 === "falling" ? "text-rose-500 dark:text-rose-400"
                   :                                "text-muted-foreground";

  return (
    <header className="shrink-0 panel divide-y divide-border">
      {/* ── Ligne 1 — Identité (nom = lien fiche) + commercial + téléphones ── */}
      <div className="px-4 py-3 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="kicker mb-1 inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <MonitorSmartphone className="h-3 w-3" /> Écran 2 · synchronisé
            </span>
            <Ecran1Link />
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Le nom EST le lien vers la fiche complète (plus de bouton dédié). */}
            {clientId ? (
              <Link
                href={`/clients/${clientId}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Ouvrir la fiche client complète (nouvel onglet)"
                className="text-[22px] font-semibold tracking-tight text-foreground leading-tight truncate hover:text-brand-600 dark:hover:text-brand-400 hover:underline decoration-2 underline-offset-2 transition-colors"
              >
                {clientName}
              </Link>
            ) : (
              <h1 className="text-[22px] font-semibold tracking-tight text-foreground leading-tight truncate">
                {clientName}
              </h1>
            )}
            {info?.type && (
              <span className={`text-[10px] font-bold tracking-[0.14em] uppercase px-2 py-0.5 rounded ${
                info.type === "EXPORT" ? "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" :
                info.type === "GMS"    ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" :
                                         "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
              }`}>
                {info.type}
              </span>
            )}
            {incidents > 0 && (
              <span
                className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                title={`${incidents} incident(s) BL ouvert(s)`}
              >
                <AlertTriangle className="h-3 w-3" /> {incidents} incident{incidents > 1 ? "s" : ""}
              </span>
            )}
          </div>
          {/* Ligne meta : commercial (nom complet, plus d'acronyme) + e-mail */}
          {(commercialName || info?.email) && (
            <div className="flex items-center gap-3 mt-1.5 text-[11.5px] text-muted-foreground flex-wrap">
              {commercialName && (
                <span className="inline-flex items-center gap-1" title="Commercial en charge">
                  <User className="h-3 w-3" /> {commercialName}
                </span>
              )}
              {info?.email && (
                <a
                  href={`mailto:${info.email}`}
                  className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline truncate max-w-[260px]"
                  title={info.email}
                >
                  <Mail className="h-3 w-3" /> {info.email}
                </a>
              )}
            </div>
          )}
        </div>

        {/* Téléphones — colonne droite, alignés (label fixe 60px, n° tnum) */}
        {tels.length > 0 && (
          <div className="shrink-0 flex flex-col gap-0.5">
            {tels.map((t, i) => (
              <a
                key={t.label}
                href={`tel:${standardizePhone(t.value)}`}
                className={`group inline-flex items-center justify-end gap-2 px-2.5 py-1 rounded-md transition-colors ${
                  i === 0
                    ? "bg-primary/15 hover:bg-primary/25 text-foreground"
                    : "hover:bg-secondary/40 text-foreground/80"
                }`}
              >
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground w-[60px] text-right shrink-0">
                  {t.label}
                </span>
                <Phone className={`h-3 w-3 shrink-0 ${i === 0 ? "text-primary" : "text-muted-foreground/70"}`} />
                <span className="font-mono tnum text-[13px] font-semibold tracking-tight">{formatPhoneDisplay(t.value)}</span>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* ── Ligne 2 — Habitudes en chips (sans jours d'appel) ── */}
      {(lastLabel || info?.medianHour != null || info?.bestDayOfWeek != null || info?.trend30) && (
        <div className="px-4 py-2 flex items-center gap-2 flex-wrap text-[11px]">
          {info?.medianHour != null && (
            <Chip icon={Clock} label="Créneau">
              <span className="font-semibold tnum">{info.medianHour}h</span>
            </Chip>
          )}
          {info?.bestDayOfWeek != null && (
            <Chip icon={Calendar} label="Meilleur jour">
              <span className="font-semibold">{JOURS_FR[info.bestDayOfWeek]}</span>
            </Chip>
          )}
          {lastLabel && (
            <Chip icon={ShoppingCart} label="Dernière cde">
              <span className="font-semibold">{lastLabel}</span>
              {info?.ordersCount != null && info.ordersCount > 0 && (
                <span className="text-muted-foreground"> · {info.ordersCount} cde{info.ordersCount > 1 ? "s" : ""}</span>
              )}
            </Chip>
          )}
          {info?.trend30 && (
            <Chip icon={TrendIcon} label="Tendance 30j">
              <span className={`font-semibold ${trendColor}`}>
                {info.trend30 === "rising" ? "En hausse" : info.trend30 === "falling" ? "En baisse" : "Stable"}
              </span>
            </Chip>
          )}
        </div>
      )}

      {/* ── Ligne 3 — Interlocuteurs (fetch direct, clé = clientId) ── */}
      {clientId && <InterlocuteursStrip clientId={clientId} />}

      {/* ── Ligne 4 — Cadence de livraison + commentaires des dernières cdes ── */}
      {clientId && <DeliveryHistoryStrip clientId={clientId} />}
    </header>
  );
}

/* Chip uniforme — icône + label uppercase + valeur. Hauteur fixe pour alignement. */
function Chip({
  icon: Icon, label, children,
}: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md border border-border bg-card">
      <Icon className="h-3 w-3 text-muted-foreground/70 shrink-0" />
      <span className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
        {label}
      </span>
      <span className="text-[11.5px] text-foreground/90">{children}</span>
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────
   Interlocuteurs — strip horizontal compact (lecture seule).
   Édition complète sur la fiche compte (/clients/[id]).
───────────────────────────────────────────────────────────── */

interface Contact {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
}

function InterlocuteursStrip({ clientId }: { clientId: string }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setContacts([]);
    fetch(`/api/clients/${clientId}/contacts`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { contacts?: Contact[] }) => { if (!cancelled) setContacts(j.contacts ?? []); })
      .catch(() => { if (!cancelled) setContacts([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading) {
    return (
      <div className="px-4 py-2 inline-flex items-center gap-2 text-[11px] text-muted-foreground">
        <Users className="h-3 w-3" /> <Loader2 className="h-3 w-3 animate-spin" /> Interlocuteurs…
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="px-4 py-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Users className="h-3 w-3" />
        <span className="text-[10px] uppercase tracking-[0.12em] font-semibold">Interlocuteurs</span>
        <span className="italic text-muted-foreground/60">aucun enregistré.</span>
        <Link href={`/clients/${clientId}`} target="_blank" rel="noopener noreferrer"
          className="ml-auto text-[10.5px] text-brand-600 dark:text-brand-400 hover:underline inline-flex items-center gap-1">
          + Ajouter sur la fiche
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-2 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-foreground/80">
        <Users className="h-3 w-3 text-muted-foreground" />
        Interlocuteurs <span className="text-muted-foreground/60 font-normal">({contacts.length})</span>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-0.5">
        {contacts.map((c, i) => (
          <li key={c.id} className="flex items-baseline gap-1.5 text-[11.5px] min-w-0">
            <span className="h-4 w-4 shrink-0 rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-400 text-[9px] font-bold inline-flex items-center justify-center self-center">
              {i + 1}
            </span>
            <span className="font-medium text-foreground truncate">{c.name}</span>
            {c.role && (
              <span className="text-[10px] text-muted-foreground/80 truncate shrink-0">· {c.role}</span>
            )}
            {c.phone && (
              <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 font-mono tnum text-foreground/80 hover:text-brand-600 ml-auto shrink-0 text-[10.5px]">
                <Phone className="h-2.5 w-2.5" /> {c.phone}
              </a>
            )}
            {c.email && !c.phone && (
              <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-foreground/70 hover:text-brand-600 ml-auto shrink-0 text-[10.5px] truncate">
                <Mail className="h-2.5 w-2.5" /> {c.email}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Cadence de livraison — frise « °°°■°°°■ » sur les 21 derniers
   jours : un point pour un jour sans livraison, un carré plein
   (poids dans le carré) pour un jour livré. + commentaires des
   dernières commandes (s'il y en a). Source : /api/sap/orders.
───────────────────────────────────────────────────────────── */

interface DeliveryDoc {
  docEntry: number; docNum: number; docDate: string; dueDate: string;
  weightKg?: number | null; colis?: number | null; comments?: string | null;
  total?: number;
}

/** Compact « 248 » / « 1,2t » pour tenir dans un petit carré. */
function kgChip(kg: number): string {
  if (kg >= 1000) return (kg / 1000).toFixed(kg >= 10000 ? 0 : 1).replace(".", ",") + "t";
  return String(Math.round(kg));
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseKey(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const WINDOW_DAYS = 21;

function DeliveryHistoryStrip({ clientId }: { clientId: string }) {
  const [docs, setDocs] = useState<DeliveryDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDocs([]);
    fetch(`/api/sap/orders?clientId=${encodeURIComponent(clientId)}&last=20`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { docs?: DeliveryDoc[] }) => { if (!cancelled) setDocs(j.docs ?? []); })
      .catch(() => { if (!cancelled) setDocs([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading) {
    return (
      <div className="px-4 py-2 inline-flex items-center gap-2 text-[11px] text-muted-foreground">
        <Truck className="h-3 w-3" /> <Loader2 className="h-3 w-3 animate-spin" /> Livraisons…
      </div>
    );
  }

  // Agrège les commandes par jour de livraison prévu (DocDueDate).
  const byDay = new Map<string, { weightKg: number; colis: number; count: number }>();
  for (const d of docs) {
    const key = (d.dueDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const e = byDay.get(key) ?? { weightKg: 0, colis: 0, count: 0 };
    e.weightKg += d.weightKg ?? 0;
    e.colis += d.colis ?? 0;
    e.count += 1;
    byDay.set(key, e);
  }

  // Fenêtre de 21 jours, calée sur la livraison la plus récente (qui peut être
  // à venir : J+1) sinon sur aujourd'hui.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const keys = [...byDay.keys()].sort();
  let end = today;
  if (keys.length) { const last = parseKey(keys[keys.length - 1]); if (last > end) end = last; }
  const days: { dt: Date; key: string; del: { weightKg: number; colis: number; count: number } | null; future: boolean }[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const dt = new Date(end); dt.setDate(dt.getDate() - i);
    const key = dayKey(dt);
    days.push({ dt, key, del: byDay.get(key) ?? null, future: dt > today });
  }
  const hasDeliveries = byDay.size > 0;

  // Commentaires des dernières commandes (docs déjà triés DocEntry desc).
  const comments: { date: string; text: string; docNum: number }[] = [];
  const seenComment = new Set<string>();
  for (const d of docs) {
    const text = (d.comments ?? "").trim();
    if (!text || seenComment.has(text)) continue;
    seenComment.add(text);
    comments.push({ date: d.dueDate || d.docDate, text, docNum: d.docNum });
    if (comments.length >= 3) break;
  }

  return (
    <div className="px-4 py-2.5 space-y-2">
      {/* En-tête + frise cadence */}
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-foreground/80">
        <Truck className="h-3 w-3 text-muted-foreground" />
        Livraisons récentes
        {hasDeliveries && (
          <span className="text-muted-foreground/60 font-normal normal-case tracking-normal">
            · 3 dernières semaines
          </span>
        )}
      </div>

      {hasDeliveries ? (
        <div className="flex items-end gap-[3px] pt-0.5">
          {days.map((day) => {
            const label = day.dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
            const weekend = day.dt.getDay() === 0 || day.dt.getDay() === 6;
            return (
              <div key={day.key} className="flex-1 min-w-0 flex flex-col items-center gap-1">
                {day.del ? (
                  <div
                    title={`${day.dt.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })} — ${Math.round(day.del.weightKg)} kg · ${day.del.colis} colis (${day.del.count} cde${day.del.count > 1 ? "s" : ""})`}
                    className={`aspect-square w-full max-w-[34px] rounded-md flex items-center justify-center shadow-sm text-white bg-gradient-to-br from-brand-400 to-brand-600 ${
                      day.future ? "ring-2 ring-brand-300/70 ring-offset-1 ring-offset-card animate-pulse" : ""
                    }`}
                  >
                    <span className="text-[8.5px] font-bold leading-none tnum px-0.5">{kgChip(day.del.weightKg)}</span>
                  </div>
                ) : (
                  <div className="aspect-square w-full max-w-[34px] flex items-center justify-center">
                    <span className={`h-1 w-1 rounded-full ${weekend ? "bg-muted-foreground/15" : "bg-muted-foreground/30"}`} />
                  </div>
                )}
                <span className={`text-[8px] leading-none tnum tracking-tight ${
                  day.del ? "text-foreground/70 font-semibold" : "text-transparent"
                }`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] italic text-muted-foreground/60">Aucune livraison récente.</p>
      )}

      {/* Commentaires des dernières commandes */}
      {comments.length > 0 && (
        <div className="space-y-1 pt-1">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-foreground/80">
            <MessageSquareText className="h-3 w-3 text-muted-foreground" />
            Notes des dernières commandes
          </div>
          <ul className="space-y-1">
            {comments.map((c) => (
              <li key={c.docNum} className="flex items-start gap-2 text-[11.5px] rounded-md border border-border bg-card/60 px-2 py-1">
                <span className="shrink-0 text-[9.5px] font-semibold tnum text-muted-foreground mt-0.5">
                  {new Date(c.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
                </span>
                <span className="text-foreground/85 leading-snug">{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
