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
