/**
 * Modèles de courrier R0 → R5 et moteur de rendu — NT-2026-RC-01 (§5).
 *
 * Les modèles sont repris MOT POUR MOT de la note. Les champs {{Champ}} sont
 * fusionnés depuis le contexte (lib/relance/fields). Le bloc {{TableauFactures}}
 * (multi-factures) est rendu spécifiquement : tableau HTML pour l'email, liste
 * à puces pour la version texte.
 *
 * Sortie : { subject, html, text } prête pour Graph (sendMailAsShared, HTML).
 */
import type { RelanceCode } from "./levels";
import { type RelanceContext, invoiceRows } from "./fields";

interface Template {
  subject: string;
  /** Mention « lettre recommandée » placée en tête de courrier (R4/R5). */
  recommande?: boolean;
  body: string;
}

const TABLE_TOKEN = "{{TableauFactures}}";

export const TEMPLATES: Record<RelanceCode, Template> = {
  R0: {
    subject: "Rappel d'échéance — Facture {{NumFacture}}",
    body: `Bonjour,

Sauf erreur de notre part, la facture {{NumFacture}} du {{DateFacture}}, d'un montant de {{MontantTTC}}, arrivera à échéance le {{DateEcheance}}.

Nous vous remercions de bien vouloir en prévoir le règlement à cette date. Si celui-ci a déjà été initié, nous vous prions de ne pas tenir compte du présent message.

Nous restons à votre disposition pour toute information.

Cordialement,
{{Signataire}}
{{FonctionSignataire}} — {{Societe}}`,
  },
  R1: {
    subject: "Relance — Facture {{NumFacture}} échue",
    body: `Bonjour,

Sauf règlement croisé avec le présent message, nous constatons que la facture {{NumFacture}} du {{DateFacture}}, d'un montant de {{MontantRestantDu}}, demeure impayée à ce jour, son échéance étant intervenue le {{DateEcheance}} (soit {{JoursRetard}} jours de retard).

Nous vous remercions de bien vouloir procéder à son règlement sous {{DelaiReponse}}. Si un différend motive ce retard, nous vous invitons à nous contacter sans délai afin d'y remédier ensemble.

Cordialement,
{{Signataire}}
{{FonctionSignataire}} — {{Societe}}`,
  },
  R2: {
    subject: "2e relance — Facture(s) impayée(s)",
    body: `{{Civilite}},

Malgré notre précédent rappel, nous n'avons pas enregistré le règlement de la (des) facture(s) suivante(s) :

${TABLE_TOKEN}

soit un total de {{MontantRestantDu}} restant dû.

Nous vous remercions de bien vouloir régulariser cette situation sous {{DelaiReponse}}. À défaut, et conformément à nos conditions générales de vente, des pénalités de retard ainsi qu'une indemnité forfaitaire de recouvrement de 40 € par facture deviendront exigibles de plein droit.

Dans cette attente, je vous prie d'agréer, {{Civilite}}, l'expression de mes salutations distinguées.

{{Signataire}}
{{FonctionSignataire}} — {{Societe}}`,
  },
  R3: {
    subject: "Dernier rappel amiable avant mise en demeure",
    body: `{{Civilite}},

En dépit de nos relances, la (les) facture(s) ci-dessous demeure(nt) impayée(s) :

${TABLE_TOKEN}

À ce jour, votre compte présente le solde débiteur suivant :

{{LigneTotalFactures}}
{{LigneDeduction}}
Principal restant dû : {{MontantRestantDu}}
Pénalités de retard ({{TauxPenalites}}) : {{MontantPenalites}}
Indemnité forfaitaire de recouvrement : {{IndemniteForfaitaire}}
Total dû : {{TotalDu}}

Nous vous demandons de bien vouloir régler ce montant sous {{DelaiReponse}}. À défaut de règlement dans ce délai, nous serions contraints de vous adresser une mise en demeure par lettre recommandée avec accusé de réception, préalable à toute action en recouvrement.

Nous privilégions une issue amiable et restons à votre écoute.

Dans cette attente, je vous prie d'agréer, {{Civilite}}, l'expression de mes salutations distinguées.

{{Signataire}}
{{FonctionSignataire}} — {{Societe}}`,
  },
  R4: {
    subject: "MISE EN DEMEURE DE PAYER — Facture(s) impayée(s)",
    recommande: true,
    body: `{{Civilite}},

Nos relances étant restées sans effet, nous vous mettons en demeure, par la présente, de procéder au règlement des sommes ci-dessous restant dues :

${TABLE_TOKEN}

{{LigneTotalFactures}}
{{LigneDeduction}}
Principal restant dû : {{MontantRestantDu}}
Pénalités de retard ({{TauxPenalites}}) : {{MontantPenalites}}
Indemnité forfaitaire de recouvrement : {{IndemniteForfaitaire}}
Total dû : {{TotalDu}}

Ces sommes sont exigibles de plein droit. Nous vous mettons en demeure de nous en régler le montant intégral dans un délai de {{DelaiReponse}} à compter de la réception de la présente.

À défaut de paiement dans ce délai, nous nous réservons le droit d'engager toute procédure de recouvrement judiciaire (injonction de payer, référé-provision), sans nouvel avis, les intérêts et frais demeurant à votre charge.

La présente vaut mise en demeure au sens des articles 1344 et suivants du Code civil.

Dans cette attente, je vous prie d'agréer, {{Civilite}}, l'expression de mes salutations distinguées.

{{Signataire}}
{{FonctionSignataire}} — {{Societe}}`,
  },
  R5: {
    subject: "DERNIER AVIS AVANT CONTENTIEUX — Proposition de protocole d'accord",
    recommande: true,
    body: `{{Civilite}},

{{RappelMiseEnDemeure}} votre compte présente à ce jour un solde exigible de {{TotalDu}}, détaillé comme suit :

${TABLE_TOKEN}

Avant d'engager la procédure contentieuse, et dans un esprit de règlement amiable, nous vous proposons le protocole d'accord ci-joint, prévoyant un règlement échelonné assorti d'une clause résolutoire.

Ce protocole devra nous être retourné, daté et signé, sous {{DelaiReponse}}. Passé ce délai, ou en cas de non-respect de l'échéancier convenu, la procédure contentieuse sera engagée sans nouvelle relance, l'intégralité de la créance redevenant immédiatement exigible.

Dans cette attente, je vous prie d'agréer, {{Civilite}}, l'expression de mes salutations distinguées.

{{Signataire}}
{{FonctionSignataire}} — {{Societe}}`,
  },
};

const RECOMMANDE_NOTE = "Lettre recommandée avec accusé de réception";

/** Remplace les {{Champ}} scalaires (laisse les inconnus tels quels). */
function fuse(str: string, fields: Record<string, string>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (m, key: string) =>
    Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : m,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function tableHtml(ctx: RelanceContext): string {
  const rows = invoiceRows(ctx.invoices)
    .map(
      (r) => `      <tr>
        <td style="padding:6px 10px;border:1px solid #d8dee9;font-family:monospace;">${escapeHtml(r.num)}</td>
        <td style="padding:6px 10px;border:1px solid #d8dee9;">${escapeHtml(r.date)}</td>
        <td style="padding:6px 10px;border:1px solid #d8dee9;">${escapeHtml(r.echeance)}</td>
        <td style="padding:6px 10px;border:1px solid #d8dee9;text-align:right;white-space:nowrap;">${escapeHtml(r.montant)}</td>
      </tr>`,
    )
    .join("\n");
  return `    <table style="border-collapse:collapse;font-size:13px;margin:4px 0;">
      <thead>
        <tr style="background:#f0f2f6;">
          <th style="padding:6px 10px;border:1px solid #d8dee9;text-align:left;">N° facture</th>
          <th style="padding:6px 10px;border:1px solid #d8dee9;text-align:left;">Date</th>
          <th style="padding:6px 10px;border:1px solid #d8dee9;text-align:left;">Échéance</th>
          <th style="padding:6px 10px;border:1px solid #d8dee9;text-align:right;">Montant dû</th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>`;
}

function tableText(ctx: RelanceContext): string {
  return invoiceRows(ctx.invoices)
    .map((r) => `  - Facture ${r.num} du ${r.date}, échéance ${r.echeance} : ${r.montant}`)
    .join("\n");
}

export interface RenderedRelance {
  subject: string;
  html: string;
  text: string;
  recommande: boolean;
}

/**
 * Rend un courrier de relance complet (objet + corps HTML + corps texte) pour le
 * niveau et le contexte donnés. Le texte sert d'aperçu / repli ; l'email est
 * envoyé en HTML.
 */
export function renderRelance(level: RelanceCode, ctx: RelanceContext): RenderedRelance {
  const tpl = TEMPLATES[level];
  const subject = fuse(tpl.subject, ctx.fields);

  // ── Découpe en blocs (séparés par ligne vide), le tableau étant un bloc à part.
  const blocks = tpl.body.split(/\n\n+/);

  const htmlParts: string[] = [];
  const textParts: string[] = [];

  if (tpl.recommande) {
    htmlParts.push(`<p style="font-weight:600;text-transform:uppercase;letter-spacing:.04em;font-size:12px;color:#b91c1c;">${escapeHtml(RECOMMANDE_NOTE)}</p>`);
    textParts.push(RECOMMANDE_NOTE.toUpperCase());
  }

  for (const block of blocks) {
    if (block.trim() === TABLE_TOKEN) {
      htmlParts.push(tableHtml(ctx));
      textParts.push(tableText(ctx));
      continue;
    }
    // Fusion + suppression des lignes vides : les lignes optionnelles (ex. la
    // déduction des encaissements) disparaissent proprement quand le champ est vide.
    const lines = fuse(block, ctx.fields).split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) continue;
    htmlParts.push(`<p style="margin:0 0 12px;line-height:1.5;">${lines.map(escapeHtml).join("<br>")}</p>`);
    textParts.push(lines.join("\n"));
  }

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1f29;max-width:640px;">
${htmlParts.join("\n")}
</div>`;
  const text = textParts.join("\n\n");

  return { subject, html, text, recommande: !!tpl.recommande };
}
