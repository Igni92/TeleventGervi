/**
 * Microsoft Graph API client utilities — calendrier (rappels, jeton délégué de
 * l'utilisateur connecté) et envoi des emails de relance DEPUIS une boîte
 * PARTAGÉE via l'identité applicative (client credentials + permission
 * d'application `Mail.Send`) — cf. sendMailAsShared / NT-2026-RC-01.
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
  /**
   * Pièces jointes inline (base64). Convient aux PDF de facture (petits) :
   * Graph limite l'envoi inline à ~3 Mo par fichier / <4 Mo par requête ;
   * au-delà il faudrait une upload session (non gérée ici).
   */
  attachments?: { name: string; base64: string; contentType?: string }[];
}

// ── Jeton applicatif Graph (client credentials) ───────────────────────────
// Mis en cache en mémoire jusqu'à ~expiration. Permet d'envoyer depuis une boîte
// PARTAGÉE (compta@…) au nom de l'application, indépendamment de l'opérateur.
let appTokenCache: { token: string; expMs: number } | null = null;
let appTokenInflight: Promise<string> | null = null;

async function getAppGraphToken(): Promise<string> {
  if (appTokenCache && appTokenCache.expMs - 60_000 > Date.now()) return appTokenCache.token;
  if (appTokenInflight) return appTokenInflight;
  appTokenInflight = (async () => {
    const tenant = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    if (!tenant || !clientId || !clientSecret) {
      throw new Error(
        "Identité applicative Graph non configurée (AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET).",
      );
    }
    const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !data.access_token) {
      throw new Error(`Jeton applicatif Graph échoué : ${res.status} - ${JSON.stringify(data).slice(0, 300)}`);
    }
    appTokenCache = { token: data.access_token, expMs: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return data.access_token;
  })();
  try {
    return await appTokenInflight;
  } finally {
    appTokenInflight = null;
  }
}

function buildMessage(input: SendMailInput): Record<string, unknown> {
  const addresses = Array.isArray(input.to) ? input.to : [input.to];
  const message: Record<string, unknown> = {
    subject: input.subject,
    body: { contentType: "HTML", content: input.html },
    toRecipients: addresses.map((address) => ({ emailAddress: { address } })),
  };
  if (input.cc?.length) message.ccRecipients = input.cc.map((address) => ({ emailAddress: { address } }));
  if (input.replyTo) message.replyTo = [{ emailAddress: { address: input.replyTo } }];
  if (input.attachments?.length) {
    message.attachments = input.attachments.map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.name,
      contentType: a.contentType ?? "application/pdf",
      contentBytes: a.base64,
    }));
  }
  return message;
}

/**
 * Crée un évènement dans le calendrier Outlook d'UN UTILISATEUR via l'identité
 * APPLICATIVE (client credentials) — permission d'APPLICATION Microsoft Graph
 * `Calendars.ReadWrite` + consentement admin requis. Sert au planning congés :
 * un congé VALIDÉ est poussé dans le calendrier Outlook de la direction.
 *
 * Erreurs explicites : 403 = permission Calendars.ReadWrite non accordée.
 */
export async function createCalendarEventAsApp(
  userEmail: string,
  event: Record<string, unknown>,
): Promise<CalendarEventResult> {
  const token = await getAppGraphToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/events`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(event),
    },
  );
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(`Graph createEvent (${userEmail}) error: ${res.status} - ${JSON.stringify(error)}`);
  }
  const data = (await res.json()) as { id: string };
  return { id: data.id };
}

/**
 * Envoie un email DEPUIS une boîte partagée (ex. compta@gervifrais.com) via
 * l'identité applicative — permission d'APPLICATION Microsoft Graph `Mail.Send`
 * (consentement admin requis ; idéalement restreinte à cette boîte par une
 * ApplicationAccessPolicy Exchange). Indépendant de l'opérateur connecté.
 *
 * Erreurs explicites : 401/invalid_client = secret/app KO ; 403 = permission
 * Mail.Send non accordée ou boîte hors ApplicationAccessPolicy.
 */
export async function sendMailAsShared(from: string, input: SendMailInput): Promise<void> {
  const token = await getAppGraphToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: buildMessage(input), saveToSentItems: input.saveToSentItems ?? true }),
    },
  );
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(`Graph sendMail (${from}) error: ${res.status} - ${JSON.stringify(error)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// LECTURE d'une boîte partagée (permission d'APPLICATION `Mail.Read`) — sert à
// l'archivage des PDF (BL/avoirs/factures) de factures-archive@gervifrais.com.
// Requiert la permission Mail.Read (consentement admin, idéalement restreinte à
// cette boîte par une ApplicationAccessPolicy — comme Mail.Send).
// Erreurs explicites : 403 = Mail.Read non accordée ou boîte hors policy.
// ─────────────────────────────────────────────────────────────────────────

export interface GraphMessageHead {
  id: string;
  subject: string | null;
  receivedDateTime: string; // ISO
}

export interface GraphAttachmentMeta {
  id: string;
  name: string;
  contentType: string | null;
  size: number;
  isFile: boolean;
}

async function graphGet<T>(url: string): Promise<T> {
  const token = await getAppGraphToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(`Graph GET ${url.replace(/https:\/\/graph\.microsoft\.com\/v1\.0/, "")} error: ${res.status} - ${JSON.stringify(error).slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/**
 * Liste les messages d'une boîte AYANT des pièces jointes, reçus depuis `sinceISO`
 * (défaut : pas de borne). Suit la pagination Graph jusqu'à `max` messages.
 */
export async function listMailboxMessagesWithAttachments(
  mailbox: string,
  sinceISO?: string,
  max = 400,
): Promise<GraphMessageHead[]> {
  // On filtre UNIQUEMENT sur receivedDateTime (propriété indexée) + tri sur la
  // même propriété : combiner `hasAttachments eq true` avec un intervalle de date
  // + tri déclenche « InefficientFilter » (400) côté Graph. On repère donc les
  // pièces jointes message par message (listMessageFileAttachments).
  // NB : encodage manuel (espaces → %20) — URLSearchParams met « + » que l'OData
  // de Graph interprète mal dans $filter/$orderby.
  const parts = [`$orderby=${encodeURIComponent("receivedDateTime desc")}`, "$select=id,subject,receivedDateTime", "$top=50"];
  if (sinceISO) parts.unshift(`$filter=${encodeURIComponent(`receivedDateTime ge ${sinceISO}`)}`);
  let url: string | null =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages?${parts.join("&")}`;
  const out: GraphMessageHead[] = [];
  while (url && out.length < max) {
    const page: { value: GraphMessageHead[]; "@odata.nextLink"?: string } = await graphGet(url);
    out.push(...(page.value ?? []));
    url = page["@odata.nextLink"] ?? null;
  }
  return out.slice(0, max);
}

/** Métadonnées des pièces jointes FICHIER d'un message (sans le contenu). */
export async function listMessageFileAttachments(
  mailbox: string,
  messageId: string,
): Promise<GraphAttachmentMeta[]> {
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}` +
    `/attachments?$select=id,name,contentType,size,@odata.type`;
  const page: { value: (GraphAttachmentMeta & { "@odata.type"?: string })[] } = await graphGet(url);
  return (page.value ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    contentType: a.contentType ?? null,
    size: a.size ?? 0,
    isFile: (a["@odata.type"] ?? "").includes("fileAttachment"),
  }));
}

/**
 * Récupère le contenu d'une pièce jointe fichier en base64 (Graph renvoie
 * `contentBytes` pour un fileAttachment).
 */
export async function getAttachmentBase64(
  mailbox: string,
  messageId: string,
  attachmentId: string,
): Promise<string> {
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}` +
    `/attachments/${encodeURIComponent(attachmentId)}`;
  const att: { contentBytes?: string } = await graphGet(url);
  if (!att.contentBytes) throw new Error("Pièce jointe sans contentBytes (pas un fichier ?)");
  return att.contentBytes;
}

/**
 * Supprime un message de la boîte (→ Éléments supprimés). Requiert la permission
 * d'APPLICATION `Mail.ReadWrite` (et non le simple Mail.Read). Utilisé pour vider
 * la boîte d'archive une fois les pièces jointes récupérées.
 */
export async function deleteMailboxMessage(mailbox: string, messageId: string): Promise<void> {
  const token = await getAppGraphToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok && res.status !== 404) {
    const error = await res.json().catch(() => ({}));
    throw new Error(`Graph DELETE message error: ${res.status} - ${JSON.stringify(error).slice(0, 300)}`);
  }
}
