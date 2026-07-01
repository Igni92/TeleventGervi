"use client";

import { Bell, BellRing, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { usePushNotifications } from "@/lib/usePushNotifications";

/**
 * Bouton d'activation des notifications push (PWA) — dans l'en-tête console.
 * Masqué si le navigateur ne supporte pas le push ou si les clés VAPID ne sont
 * pas configurées côté serveur (dégradation gracieuse).
 */
export function NotificationsBell() {
  const { supported, permission, subscribed, busy, subscribe, unsubscribe } = usePushNotifications();

  if (!supported) return null;

  const denied = permission === "denied";

  const onClick = async () => {
    if (denied) {
      toast.error("Notifications bloquées par le navigateur. Autorise-les dans les réglages du site.");
      return;
    }
    if (subscribed) {
      await unsubscribe();
      toast.success("Notifications désactivées sur cet appareil");
    } else {
      await subscribe();
      // Le hook met à jour `subscribed` ; on informe selon la permission finale.
      if (Notification.permission === "granted") toast.success("Notifications activées — tu seras prévenu des rappels dus");
      else if (Notification.permission === "denied") toast.error("Permission refusée");
    }
  };

  const Icon = busy ? Loader2 : denied ? BellOff : subscribed ? BellRing : Bell;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={
        denied ? "Notifications bloquées par le navigateur"
        : subscribed ? "Notifications actives — cliquer pour désactiver"
        : "Activer les notifications de rappels"
      }
      className={`shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[12px] font-medium transition-colors ${
        subscribed
          ? "border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
          : "border-border bg-card text-foreground/80 hover:text-foreground hover:border-brand-400"
      }`}
    >
      <Icon className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
      <span className="hidden sm:inline">{subscribed ? "Notifs actives" : "Notifs"}</span>
    </button>
  );
}
