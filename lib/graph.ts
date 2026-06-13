/**
 * Microsoft Graph API client utilities for calendar event management.
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
