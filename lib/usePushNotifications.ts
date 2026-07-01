"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Gestion de l'abonnement Web-Push côté client (PWA).
 *
 * Cycle : enregistre le service worker `/sw.js`, demande la permission, souscrit
 * via PushManager avec la clé VAPID publique (récupérée sur /api/push/vapid),
 * puis persiste l'abonnement côté serveur (/api/push/subscribe).
 *
 * Dégradation gracieuse : si le navigateur ne supporte pas le push, ou si les
 * clés VAPID ne sont pas configurées côté serveur (`configured=false`), le hook
 * renvoie `supported=false` → l'UI masque le bouton.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export interface PushState {
  /** Push utilisable (navigateur compatible ET clés VAPID configurées). */
  supported: boolean;
  /** Permission navigateur : "default" | "granted" | "denied". */
  permission: NotificationPermission | null;
  /** Abonnement actif sur cet appareil. */
  subscribed: boolean;
  busy: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function usePushNotifications(): PushState {
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  const browserSupports =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  // Récupère l'état serveur (clés configurées ?) + l'abonnement courant.
  useEffect(() => {
    if (!browserSupports) return;
    setPermission(Notification.permission);
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/push/vapid");
        const j = await r.json();
        if (cancelled) return;
        setConfigured(!!j.enabled);
        setVapidKey(j.key ?? null);
      } catch {
        if (!cancelled) setConfigured(false);
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (!cancelled) setSubscribed(!!sub);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [browserSupports]);

  const subscribe = useCallback(async () => {
    if (!browserSupports || !vapidKey) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // cast : TS récent type Uint8Array<ArrayBufferLike>, l'API veut BufferSource.
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setSubscribed(res.ok);
    } catch (e) {
      console.error("[push] abonnement échoué", e);
    } finally {
      setBusy(false);
    }
  }, [browserSupports, vapidKey]);

  const unsubscribe = useCallback(async () => {
    if (!browserSupports) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (e) {
      console.error("[push] désabonnement échoué", e);
    } finally {
      setBusy(false);
    }
  }, [browserSupports]);

  return {
    supported: browserSupports && configured === true,
    permission,
    subscribed,
    busy,
    subscribe,
    unsubscribe,
  };
}
