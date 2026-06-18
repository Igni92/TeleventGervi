/**
 * Paramètres CGV / société des courriers de relance — NT-2026-RC-01 (§3, §4, §7).
 *
 * ⚠️ POINT DE VIGILANCE (note §7) : le taux de pénalités appliqué doit être
 * STRICTEMENT aligné sur la clause des CGV en vigueur. On ne fabrique donc PAS
 * de taux par défaut : `penaliteTauxAnnuel` vaut 0 tant qu'il n'est pas
 * explicitement paramétré → les pénalités s'affichent à 0,00 € (jamais un
 * montant inventé qui fragiliserait juridiquement la relance). L'IFR (40 €) est
 * un forfait légal fixe (art. L441-10/D441-5) — calculé par facture.
 *
 * Les valeurs sont stockées dans AppSetting (clés `relance_*`) et surchargeables
 * sans redéploiement. Les défauts ci-dessous s'appliquent si une clé manque.
 *
 * NB : Prisma est importé DYNAMIQUEMENT dans getRelanceParams (et non au top du
 * module) — sinon les tests vitest, qui ne résolvent pas l'alias @/, casseraient
 * à l'import de DEFAULT_RELANCE_PARAMS (même convention que lib/sapb1.ts).
 */

export interface RelanceParams {
  /** Libellé du taux affiché dans le courrier (ex. « 3 × le taux d'intérêt légal »). */
  tauxPenalitesLabel: string;
  /** Taux ANNUEL des pénalités, en fraction (0,15 = 15 %). 0 = non configuré. */
  penaliteTauxAnnuel: number;
  /** Indemnité forfaitaire de recouvrement par facture (€). Forfait légal = 40. */
  ifrParFacture: number;
  /** Délai de règlement accordé, libellé (ex. « 8 jours »). */
  delaiReponse: string;
  /** Signataire des courriers. */
  signataire: string;
  /** Fonction du signataire. */
  fonctionSignataire: string;
  /** Raison sociale émettrice. */
  societe: string;
}

export const DEFAULT_RELANCE_PARAMS: RelanceParams = {
  tauxPenalitesLabel: "3 × le taux d'intérêt légal",
  penaliteTauxAnnuel: 0,
  ifrParFacture: 40,
  delaiReponse: "8 jours",
  signataire: "La Direction",
  fonctionSignataire: "Service comptabilité",
  societe: "GERVIFRAIS SARL",
};

/** Clés AppSetting ↔ champ de RelanceParams. */
const KEYS: Record<string, keyof RelanceParams> = {
  relance_taux_penalites_label: "tauxPenalitesLabel",
  relance_penalite_taux_annuel: "penaliteTauxAnnuel",
  relance_ifr_par_facture: "ifrParFacture",
  relance_delai_reponse: "delaiReponse",
  relance_signataire: "signataire",
  relance_fonction_signataire: "fonctionSignataire",
  relance_societe: "societe",
};

/**
 * Charge les paramètres de relance (AppSetting + défauts). Best-effort : si la
 * base est indisponible, on retombe sur les défauts (pas de blocage de l'aperçu).
 */
export async function getRelanceParams(): Promise<RelanceParams> {
  const params: RelanceParams = { ...DEFAULT_RELANCE_PARAMS };
  try {
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: Object.keys(KEYS) } },
      select: { key: true, value: true },
    });
    for (const { key, value } of rows) {
      const field = KEYS[key];
      if (!field || value == null || value === "") continue;
      if (field === "penaliteTauxAnnuel" || field === "ifrParFacture") {
        const n = Number(value.replace(",", "."));
        if (Number.isFinite(n)) (params[field] as number) = n;
      } else {
        (params[field] as string) = value;
      }
    }
  } catch {
    /* DB indispo → défauts */
  }
  return params;
}
