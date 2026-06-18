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

export function testRecipient(): string {
  return process.env.RELANCE_TEST_RECIPIENT?.trim() || DEFAULT_TEST_RECIPIENT;
}

export function isLive(): boolean {
  return process.env.RELANCE_LIVE === "1";
}

export interface ResolvedRecipient {
  /** Destinataire EFFECTIF de l'envoi. */
  to: string;
  /** Destinataire réel (email compta du client) qui serait visé hors test. */
  intendedTo: string | null;
  /** true = envoi redirigé vers la boîte de test. */
  testMode: boolean;
}

/**
 * Résout le destinataire effectif. En mode test (défaut), redirige vers la boîte
 * de test ; en mode live, écrit au client (et retombe sur la boîte de test si le
 * client n'a aucun email connu, pour ne jamais échouer silencieusement).
 */
export function resolveRecipient(clientEmail: string | null | undefined): ResolvedRecipient {
  const intendedTo = clientEmail?.trim() || null;
  if (isLive() && intendedTo) {
    return { to: intendedTo, intendedTo, testMode: false };
  }
  return { to: testRecipient(), intendedTo, testMode: true };
}
