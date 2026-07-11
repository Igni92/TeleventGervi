/**
 * CONGÉS — notifications EMPLOYEUR multi-canal (au-delà du push in-app) :
 *
 *   • EMAIL au patron à chaque demande de congés/récup/sans solde d'un salarié
 *     (Graph `sendMailAsShared`, identité applicative — comme les relances) ;
 *   • WHATSAPP (Meta Cloud API) si configuré — message texte avec lien vers
 *     l'app ; hors fenêtre de 24 h Meta exige un TEMPLATE approuvé
 *     (WHATSAPP_TEMPLATE_NAME, corps à 1 variable {{1}}) ;
 *   • une fois VALIDÉ, l'évènement arrive dans le CALENDRIER OUTLOOK de la
 *     direction (Graph `createCalendarEventAsApp`, permission d'application
 *     `Calendars.ReadWrite`).
 *
 * Tout est BEST-EFFORT : un canal non configuré ou en échec ne bloque jamais
 * la demande (le push in-app reste le canal de base). Les constructeurs de
 * contenu sont PURS (testés) ; seuls les senders touchent le réseau.
 */
import { CONGE_TYPE_LABEL, congeDayCount, type CongeRequest } from "./conges";
import { dayAfter } from "./planning";
import { sendMailAsShared, createCalendarEventAsApp } from "./graph";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtD = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });

export const congeRangeLabel = (c: Pick<CongeRequest, "start" | "end">) =>
  c.start === c.end ? fmtD(c.start) : `du ${fmtD(c.start)} au ${fmtD(c.end)}`;

/** URL publique de l'app (liens des emails / WhatsApp). */
export function appBaseUrl(): string {
  const raw = process.env.APP_PUBLIC_URL || process.env.NEXTAUTH_URL || "https://televent.gervifrais.com";
  return raw.replace(/\/+$/, "");
}

/* ───────────────────────── Constructeurs PURS (testés) ─────────────────────── */

/** Ligne résumé : « Jean Dupont — Récupération, du lundi 3 au mardi 4 août (2 j) ». */
export function congeSummary(c: CongeRequest): string {
  const days = congeDayCount(c.start, c.end);
  return `${c.name} — ${CONGE_TYPE_LABEL[c.type]}, ${congeRangeLabel(c)}${days ? ` (${days} j)` : ""}`;
}

/** Email HTML envoyé à la direction à chaque DEMANDE d'un salarié. */
export function congeMailHtml(c: CongeRequest, planningUrl: string): string {
  const days = congeDayCount(c.start, c.end);
  return `
  <div style="font:14px/1.6 'Segoe UI',Arial,sans-serif;color:#111;max-width:560px">
    <p style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#666;margin:0 0 4px">Gervifrais · Planning</p>
    <h2 style="margin:0 0 12px;font-size:19px">Demande de ${esc(CONGE_TYPE_LABEL[c.type].toLowerCase())}</h2>
    <table style="border-collapse:collapse;width:100%;margin-bottom:14px">
      <tr><td style="padding:6px 10px;border:1px solid #ddd;color:#555;width:110px">Salarié</td><td style="padding:6px 10px;border:1px solid #ddd;font-weight:600">${esc(c.name)}</td></tr>
      <tr><td style="padding:6px 10px;border:1px solid #ddd;color:#555">Type</td><td style="padding:6px 10px;border:1px solid #ddd">${esc(CONGE_TYPE_LABEL[c.type])}</td></tr>
      <tr><td style="padding:6px 10px;border:1px solid #ddd;color:#555">Période</td><td style="padding:6px 10px;border:1px solid #ddd">${esc(congeRangeLabel(c))}${days ? ` · <b>${days} j</b>` : ""}</td></tr>
      ${c.note ? `<tr><td style="padding:6px 10px;border:1px solid #ddd;color:#555">Motif</td><td style="padding:6px 10px;border:1px solid #ddd">« ${esc(c.note)} »</td></tr>` : ""}
    </table>
    <p style="margin:0 0 18px">
      <a href="${esc(planningUrl)}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">
        Valider / refuser dans TeleVent
      </a>
    </p>
    <p style="font-size:12px;color:#666;margin:0">Les compteurs (CP restants, heures de récup) de ${esc(c.name)} sont affichés au-dessus de son calendrier dans l'onglet Planning.</p>
  </div>`;
}

/** Message WhatsApp (texte) envoyé à la direction à chaque demande. */
export function congeWhatsappText(c: CongeRequest, planningUrl: string): string {
  return `🌴 TeleVent — ${congeSummary(c)}.\nValider ou refuser : ${planningUrl}`;
}

/** Évènement Outlook (journée(s) entière(s)) d'un congé VALIDÉ — Graph veut un
 *  all-day minuit→minuit avec FIN EXCLUSIVE (lendemain du dernier jour). */
export function outlookCongeEvent(c: CongeRequest, planningUrl: string): Record<string, unknown> {
  const days = congeDayCount(c.start, c.end);
  return {
    subject: `${c.type === "recup" ? "🔄" : "🌴"} ${CONGE_TYPE_LABEL[c.type]} — ${c.name}`,
    body: {
      contentType: "text",
      content: `${congeSummary(c)} — validé.\n${c.note ? `Motif : « ${c.note} »\n` : ""}Planning : ${planningUrl}`,
    },
    start: { dateTime: `${c.start}T00:00:00`, timeZone: "Europe/Paris" },
    end: { dateTime: `${dayAfter(c.end)}T00:00:00`, timeZone: "Europe/Paris" },
    isAllDay: true,
    // L'absence d'un salarié n'occupe pas le patron : l'évènement reste « libre ».
    showAs: "free",
    reminderMinutesBeforeStart: days && days > 0 ? 12 * 60 : 0,
    isReminderOn: true,
  };
}

/* ─────────────────────────── Senders (best-effort) ─────────────────────────── */

/** EMAIL à la direction — boîte d'envoi CONGES_FROM_ADDRESS (repli
 *  RELANCE_FROM_ADDRESS). Sans boîte configurée ou sans destinataire → no-op. */
export async function emailDirectionConge(c: CongeRequest, to: string[]): Promise<void> {
  const from = process.env.CONGES_FROM_ADDRESS || process.env.RELANCE_FROM_ADDRESS;
  if (!from || to.length === 0) return;
  await sendMailAsShared(from, {
    to,
    subject: `🌴 ${congeSummary(c)}`,
    html: congeMailHtml(c, `${appBaseUrl()}/planning`),
  });
}

/** WHATSAPP à la direction (Meta Cloud API). Sans WHATSAPP_ACCESS_TOKEN /
 *  WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_DIRECTION_TO → no-op. Avec
 *  WHATSAPP_TEMPLATE_NAME, envoie le template ({{1}} = résumé + lien) — requis
 *  par Meta hors fenêtre de service de 24 h ; sinon message texte simple. */
export async function whatsappDirectionConge(c: CongeRequest): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const recipients = (process.env.WHATSAPP_DIRECTION_TO ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (!token || !phoneId || recipients.length === 0) return;

  const text = congeWhatsappText(c, `${appBaseUrl()}/planning`);
  const template = process.env.WHATSAPP_TEMPLATE_NAME;
  for (const to of recipients) {
    const payload = template
      ? {
          messaging_product: "whatsapp", to, type: "template",
          template: {
            name: template,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "fr" },
            components: [{ type: "body", parameters: [{ type: "text", text }] }],
          },
        }
      : { messaging_product: "whatsapp", to, type: "text", text: { preview_url: true, body: text } };
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`WhatsApp (${to}) error: ${res.status} - ${JSON.stringify(err).slice(0, 300)}`);
    }
  }
}

/** CALENDRIER OUTLOOK : pousse le congé VALIDÉ dans le calendrier de chaque
 *  membre de la direction (identité applicative, `Calendars.ReadWrite`). */
export async function addCongeToOutlook(c: CongeRequest, calendarEmails: string[]): Promise<void> {
  if (calendarEmails.length === 0) return;
  const event = outlookCongeEvent(c, `${appBaseUrl()}/planning`);
  const results = await Promise.allSettled(calendarEmails.map((email) => createCalendarEventAsApp(email, event)));
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed.length === results.length && failed.length > 0) {
    throw failed[0].reason instanceof Error ? failed[0].reason : new Error(String(failed[0].reason));
  }
}
