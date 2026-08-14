/**
 * Acheminement des relances — mode TEST vs LIVE.
 *
 * « Dans un premier temps, on envoie tout vers une boîte de test » : tant que
 * RELANCE_LIVE n'est pas explicitement activé, CHAQUE relance est redirigée vers
 * RELANCE_TEST_RECIPIENT, quel que soit l'email du client. On valide ainsi les
 * modèles et la chaîne d'envoi sans jamais écrire aux vrais débiteurs.
 *
 *   RELANCE_LIVE=1                → envoi réel (au destinataire du client)
 *   RELANCE_TEST_RECIPIENT=<mail> → boîte de test (défaut : wahofef603@aratrin.com)
 */

export const DEFAULT_TEST_RECIPIENT = "wahofef603@aratrin.com";

/** Boîte EXPÉDITRICE des relances (boîte partagée) — identité applicative. */
export const DEFAULT_FROM_ADDRESS = "compta@gervifrais.com";

export function testRecipient(): string {
  return process.env.RELANCE_TEST_RECIPIENT?.trim() || DEFAULT_TEST_RECIPIENT;
}

export function fromAddress(): string {
  return process.env.RELANCE_FROM_ADDRESS?.trim() || DEFAULT_FROM_ADDRESS;
}

export function isLive(): boolean {
  return process.env.RELANCE_LIVE === "1";
}

export interface ResolvedRecipient {
  /** Destinataire EFFECTIF de l'envoi (forme lisible, joint par « , » si plusieurs). */
  to: string;
  /**
   * Destinataire(s) EFFECTIF(S) de l'envoi, en liste (à passer à Graph
   * toRecipients). En mode test = [boîte de test] ; en live = TOUS les emails
   * compta configurés pour le client.
   */
  toList: string[];
  /** Destinataire réel (email(s) compta du client, joint par « , ») visé hors test. */
  intendedTo: string | null;
  /** true = envoi redirigé vers la boîte de test. */
  testMode: boolean;
}

/**
 * Sépare une chaîne d'emails compta (« a@x, b@y ; c@z ») en liste nettoyée.
 * Le champ Client.emailCompta stocke DÉSORMAIS plusieurs adresses (séparées par
 * « , »). Tolère aussi le point-virgule et les espaces superflus.
 */
export function splitEmails(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
}

/**
 * Résout le destinataire effectif. En mode test (défaut), redirige vers la boîte
 * de test ; en mode live, écrit au client — à TOUS ses emails compta (et retombe
 * sur la boîte de test si le client n'a aucun email connu, pour ne jamais échouer
 * silencieusement).
 */
export function resolveRecipient(
  clientEmail: string | null | undefined,
  opts?: { live?: boolean; testRecipient?: string },
): ResolvedRecipient {
  const emails = splitEmails(clientEmail);
  const intendedTo = emails.length ? emails.join(", ") : null;
  // `opts` (réglages modifiables dans l'app) prime sur l'env ; repli sur l'env.
  const live = opts?.live ?? isLive();
  if (live && emails.length) {
    return { to: intendedTo!, toList: emails, intendedTo, testMode: false };
  }
  const test = opts?.testRecipient?.trim() || testRecipient();
  return { to: test, toList: [test], intendedTo, testMode: true };
}
