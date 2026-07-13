/**
 * Web-Push (PWA) — envoi serveur, avec dégradation gracieuse.
 *
 * Nécessite 3 variables d'env (générables via `npx web-push generate-vapid-keys`) :
 *   VAPID_PUBLIC_KEY   — clé publique (aussi exposée au client, cf. /api/push/vapid)
 *   VAPID_PRIVATE_KEY  — clé privée (SECRÈTE)
 *   VAPID_SUBJECT      — "mailto:contact@exemple.fr" (contact requis par le protocole)
 *
 * Si les clés sont absentes, `pushEnabled()` renvoie false et `sendPush()` no-op :
 * l'app fonctionne sans notifications (aucune régression) tant que la config n'est
 * pas fournie.
 */
import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { preparateurEmails } from "@/lib/preparateur";
import { listAllConges } from "@/lib/congesRh";
import { rangesOverlap } from "@/lib/conges";

let configured = false;
let configuredOk = false;

function ensureConfigured(): boolean {
  if (configured) return configuredOk;
  configured = true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@gervifrais.fr";
  if (!pub || !priv) {
    configuredOk = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, pub, priv);
    configuredOk = true;
  } catch (e) {
    console.error("[push] VAPID mal configurées:", e);
    configuredOk = false;
  }
  return configuredOk;
}

/** Les notifications push sont-elles activées (clés VAPID présentes) ? */
export function pushEnabled(): boolean {
  return ensureConfigured();
}

/** Clé publique VAPID (à exposer au client pour s'abonner). */
export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** URL ouverte au clic sur la notification. */
  url?: string;
  tag?: string;
  /** Regroupe/écrase une notif de même tag plutôt que d'empiler. */
  renotify?: boolean;
}

/**
 * Envoie une notification. Renvoie :
 *   "ok"      — envoyé
 *   "gone"    — abonnement expiré (404/410) → l'appelant doit le supprimer
 *   "skip"    — push désactivé (pas de clés)
 *   "error"   — autre échec (loggé)
 */
export async function sendPush(target: PushTarget, payload: PushPayload): Promise<"ok" | "gone" | "skip" | "error"> {
  if (!ensureConfigured()) return "skip";
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      { TTL: 3600 },
    );
    return "ok";
  } catch (e: unknown) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) return "gone";
    console.error("[push] échec d'envoi:", status ?? e);
    return "error";
  }
}

/**
 * Envoie une notification à TOUS les abonnés push (opt-in via la cloche), en
 * excluant éventuellement un email (ex. l'auteur de l'action). Best-effort et
 * parallèle ; nettoie les abonnements expirés. Renvoie le nb d'envois réussis.
 * Ne throw jamais (à appeler en fire-and-forget depuis les routes).
 */
export async function notifyAll(payload: PushPayload, opts: { exceptEmail?: string | null } = {}): Promise<number> {
  if (!ensureConfigured()) return 0;
  try {
    const subs = await prisma.pushSubscription.findMany({
      where: opts.exceptEmail ? { NOT: { email: opts.exceptEmail } } : {},
    });
    if (subs.length === 0) return 0;
    const gone: string[] = [];
    const results = await Promise.all(
      subs.map(async (t) => {
        const r = await sendPush({ endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth }, payload);
        if (r === "gone") gone.push(t.endpoint);
        return r === "ok";
      }),
    );
    if (gone.length) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: gone } } }).catch(() => {});
    }
    return results.filter(Boolean).length;
  } catch (e) {
    console.error("[push] notifyAll échec:", e);
    return 0;
  }
}

/**
 * Envoie une notification aux abonnés dont l'email figure dans `emails`
 * (ciblage nominatif : employeur ⇄ salariés pour la validation des heures).
 * Best-effort, parallèle, nettoie les abonnements expirés. Ne throw jamais.
 */
export async function notifyEmails(emails: string[], payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0;
  const wanted = new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  if (wanted.size === 0) return 0;
  try {
    const subs = await prisma.pushSubscription.findMany();
    const targets = subs.filter((s) => s.email && wanted.has(s.email.trim().toLowerCase()));
    if (targets.length === 0) return 0;
    const gone: string[] = [];
    const results = await Promise.all(
      targets.map(async (t) => {
        const r = await sendPush({ endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth }, payload);
        if (r === "gone") gone.push(t.endpoint);
        return r === "ok";
      }),
    );
    if (gone.length) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: gone } } }).catch(() => {});
    }
    return results.filter(Boolean).length;
  } catch (e) {
    console.error("[push] notifyEmails échec:", e);
    return 0;
  }
}

/**
 * Emails ciblés « entrepôt » : préparateurs restreints (liste env) + comptes DB
 * portant le flag `isPreparateur` ou `isLivreur`. Défensif : si les colonnes
 * n'existent pas encore, on garde au moins la liste email.
 */
async function preparateurTargetEmails(): Promise<Set<string>> {
  const targetEmails = new Set(preparateurEmails());
  try {
    const rows = await prisma.$queryRawUnsafe<{ email: string | null }[]>(
      `SELECT "email" FROM "User" WHERE "isPreparateur" = true OR "isLivreur" = true`,
    );
    for (const r of rows) if (r.email) targetEmails.add(r.email.trim().toLowerCase());
  } catch { /* colonnes absentes → repli sur la liste email seule */ }
  return targetEmails;
}

/**
 * Envoie une notification aux seuls PRÉPARATEURS / LIVREURS abonnés (ceux qui
 * préparent la marchandise) : préparateurs restreints (liste email), et comptes
 * portant le flag DB `isPreparateur` ou `isLivreur`. Best-effort, parallèle,
 * nettoie les abonnements expirés. Ne throw jamais (fire-and-forget).
 *
 * Sert à prévenir l'entrepôt qu'une commande vient d'être mise en préparation.
 */
export async function notifyPreparateurs(payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0;
  try {
    const targetEmails = await preparateurTargetEmails();
    if (targetEmails.size === 0) return 0;

    const subs = await prisma.pushSubscription.findMany();
    const targets = subs.filter((s) => s.email && targetEmails.has(s.email.trim().toLowerCase()));
    if (targets.length === 0) return 0;

    const gone: string[] = [];
    const results = await Promise.all(
      targets.map(async (t) => {
        const r = await sendPush({ endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth }, payload);
        if (r === "gone") gone.push(t.endpoint);
        return r === "ok";
      }),
    );
    if (gone.length) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: gone } } }).catch(() => {});
    }
    return results.filter(Boolean).length;
  } catch (e) {
    console.error("[push] notifyPreparateurs échec:", e);
    return 0;
  }
}

/**
 * Comme `notifyPreparateurs`, mais RESTREINT aux préparateurs PRÉSENTS AUJOURD'HUI :
 * on retire ceux dont un congé / une absence APPROUVÉ(E) couvre la date du jour
 * (Europe/Paris), et `exceptEmail` exclut l'auteur de l'action. Sert à prévenir
 * l'entrepôt qu'une commande DÉJÀ EN PRÉPARATION vient d'être modifiée (lots /
 * lignes) — inutile de réveiller un préparateur en congé. Best-effort, parallèle,
 * nettoie les abonnements expirés. Ne throw jamais (fire-and-forget).
 */
export async function notifyPreparateursPresents(
  payload: PushPayload,
  opts: { exceptEmail?: string | null } = {},
): Promise<number> {
  if (!ensureConfigured()) return 0;
  try {
    const targetEmails = await preparateurTargetEmails();

    // Retire les absents du jour (congé/maladie/récup… approuvé couvrant la date
    // du jour). Faute de pointage entrepôt, le congé validé est le seul signal
    // fiable d'absence — s'il est indisponible, on notifie tout le monde.
    try {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
      const conges = await listAllConges();
      for (const c of conges) {
        if (c.status === "approved" && rangesOverlap(c.start, c.end, today, today)) {
          targetEmails.delete(c.email.trim().toLowerCase());
        }
      }
    } catch { /* congés indisponibles → on garde l'ensemble des préparateurs */ }

    const except = opts.exceptEmail?.trim().toLowerCase() || null;
    if (except) targetEmails.delete(except);
    if (targetEmails.size === 0) return 0;

    const subs = await prisma.pushSubscription.findMany();
    const targets = subs.filter((s) => s.email && targetEmails.has(s.email.trim().toLowerCase()));
    if (targets.length === 0) return 0;

    const gone: string[] = [];
    const results = await Promise.all(
      targets.map(async (t) => {
        const r = await sendPush({ endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth }, payload);
        if (r === "gone") gone.push(t.endpoint);
        return r === "ok";
      }),
    );
    if (gone.length) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: gone } } }).catch(() => {});
    }
    return results.filter(Boolean).length;
  } catch (e) {
    console.error("[push] notifyPreparateursPresents échec:", e);
    return 0;
  }
}
