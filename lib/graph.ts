/**
 * Microsoft Graph API client utilities — calendrier (rappels) et envoi d'emails
 * (relances de recouvrement, NT-2026-RC-01).
 *
 * ⚠️ L'envoi d'email (sendMail) requiert le scope OAuth `Mail.Send` (cf.
 * lib/auth.ts). Si le scope a été ajouté APRÈS la dernière connexion, l'opérateur
 * doit se reconnecter (re-consentement) pour que le jeton Graph le porte.
 */

interface ClientInfo {
  code: string;
  nom: string;
  tel1?: string | null;
  tel2?: string | null;
  tel3?: string | null;
}

interface CalendarEventResult {
  id: string;
}

/**
 * Creates a calendar event in Microsoft Calendar for a télévente reminder.
 */
export async function createCalendarEvent(
  accessToken: string,
  client: ClientInfo,
  dateRappel: Date,
  note?: string | null
): Promise<CalendarEventResult> {
  const startDateTime = new Date(dateRappel);
  const endDateTime = new Date(dateRappel);
  endDateTime.setMinutes(endDateTime.getMinutes() + 30); // 30 min event

  const phoneLines = [
    client.tel1 ? `Standard : ${client.tel1}` : null,
    client.tel2 ? `Direct 1 : ${client.tel2}` : null,
    client.tel3 ? `Direct 2 : ${client.tel3}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const bodyContent = [
    `Code client : ${client.code}`,
    `Client : ${client.nom}`,
    "",
    phoneLines,
    note ? `\nNote : ${note}` : "",
  ]
    .join("\n")
    .trim();

  const event = {
    subject: `Rappel télévente - ${client.nom}`,
    body: {
      contentType: "text",
      content: bodyContent,
    },
    start: {
      dateTime: startDateTime.toISOString(),
      timeZone: "Europe/Paris",
    },
    end: {
      dateTime: endDateTime.toISOString(),
      timeZone: "Europe/Paris",
    },
    reminderMinutesBeforeStart: 15,
    isReminderOn: true,
  };

  const response = await fetch("https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Graph API error: ${response.status} - ${JSON.stringify(error)}`
    );
  }

  const data = await response.json();
  return { id: data.id };
}

/**
 * Deletes a calendar event from Microsoft Calendar.
 */
export async function deleteCalendarEvent(
  accessToken: string,
  msEventId: string
): Promise<void> {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/events/${msEventId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok && response.status !== 404) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Graph API error: ${response.status} - ${JSON.stringify(error)}`
    );
  }
}

interface SendMailInput {
  to: string | string[];
  subject: string;
  /** Corps HTML du message. */
  html: string;
  cc?: string[];
  /** Adresse de réponse (ex. boîte compta) — facultatif. */
  replyTo?: string;
  /** Conserver une copie dans « Éléments envoyés » (défaut : true). */
  saveToSentItems?: boolean;
}

/**
 * Envoie un email au nom de l'utilisateur connecté (POST /me/sendMail).
 * Requiert le scope `Mail.Send`. Lève une erreur explicite en cas d'échec Graph
 * (403 = scope manquant / consentement requis ; 401 = jeton expiré).
 */
export async function sendMail(accessToken: string, input: SendMailInput): Promise<void> {
  const addresses = Array.isArray(input.to) ? input.to : [input.to];
  const toRecipients = addresses.map((address) => ({ emailAddress: { address } }));

  const message: Record<string, unknown> = {
    subject: input.subject,
    body: { contentType: "HTML", content: input.html },
    toRecipients,
  };
  if (input.cc?.length) {
    message.ccRecipients = input.cc.map((address) => ({ emailAddress: { address } }));
  }
  if (input.replyTo) {
    message.replyTo = [{ emailAddress: { address: input.replyTo } }];
  }

  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: input.saveToSentItems ?? true }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Graph sendMail error: ${response.status} - ${JSON.stringify(error)}`
    );
  }
}
