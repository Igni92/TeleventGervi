# Relance et recouvrement des encours — NT-2026-RC-01

Implémentation des modèles de relance (R0→R5) et de la chaîne d'envoi décrits
dans la note technique **NT-2026-RC-01**. Objectif : industrialiser les relances
(réduire le DSO) et sécuriser juridiquement le recouvrement (piste d'audit).

## Où ça vit dans l'app

- Page **Encours** (`/encours`) → ouvrir un client (clic) → bouton **Relancer**.
- La modale de relance permet de choisir le niveau (R0→R5), d'**prévisualiser**
  le courrier (objet + corps HTML + décompte), de voir le **destinataire
  effectif**, puis d'**envoyer** l'email. L'historique des relances du client
  s'affiche en bas.

## Architecture

| Fichier | Rôle |
|---|---|
| `lib/relance/levels.ts` | Échelle R0→R5 (seuils en jours / échéance) + `suggestLevel`. |
| `lib/relance/params.ts` | Paramètres CGV/société (AppSetting `relance_*` + défauts). |
| `lib/relance/fields.ts` | Calcul **pur** des champs de fusion + montants (pénalités, IFR, total). |
| `lib/relance/render.ts` | Modèles R0→R5 (texte de la note) + moteur de rendu (HTML/texte). |
| `lib/relance/delivery.ts` | Acheminement : mode **test** (redirection) vs **live**. |
| `lib/relance/server.ts` | Assemblage serveur : lit les factures SAP ouvertes, rend le courrier. |
| `lib/graph.ts` → `sendMail` | Envoi via Microsoft Graph (`/me/sendMail`). |
| `app/api/relance/preview` | Aperçu (sans envoi). |
| `app/api/relance/send` | Envoi + journalisation (`RelanceLog`). |
| `app/api/relance/log` | Historique d'un client. |
| `components/encours/RelanceDialog.tsx` | UI (niveau, aperçu, envoi, historique). |
| `prisma/migrations/manual/20260618_relance_log.sql` | Table `RelanceLog`. |

## Échelle de relance (§2)

| Code | Libellé | Déclenchement | Canal | Mono/Multi |
|---|---|---|---|---|
| R0 | Relance préventive | J-3 | Email | mono |
| R1 | 1re relance | J+8 | Email | mono |
| R2 | 2e relance | J+21 | Email + appel | multi |
| R3 | Avant mise en demeure | J+35 | Email + courrier | multi + décompte |
| R4 | Mise en demeure | J+45 | LRAR | multi + décompte |
| R5 | Dernier avis avant contentieux | J+60 | LRAR + protocole | multi |

Les seuils (jours / échéance) sont des **valeurs par défaut** centralisées dans
`lib/relance/levels.ts`.

## Calcul des montants (§3, §7)

- **IFR** = `40 € × nombre de factures` en retard (forfait légal, art. L441-10 /
  D441-5) — calculé **par facture**, pas une fois par client.
- **Pénalités de retard** = `principal × taux annuel × jours_retard / 365`.
  ⚠️ Le **taux** doit être strictement aligné sur la clause des CGV en vigueur.
  Tant qu'il n'est pas paramétré (`relance_penalite_taux_annuel` absent ou `0`),
  **les pénalités valent 0,00 €** : on n'invente jamais un montant qui
  fragiliserait la relance. Le **libellé** affiché (`{{TauxPenalites}}`) reste
  descriptif (« 3 × le taux d'intérêt légal »).
- **Total dû** = principal + pénalités + IFR.
- Solde = `DocTotal − PaidToDate` (TTC), facture soldée (lettrée) ⇒ exclue
  (escalade suspendue, §6). Fuseau **Europe/Paris** pour les jours de retard.

## Paramètres (AppSetting)

| Clé | Défaut | Rôle |
|---|---|---|
| `relance_taux_penalites_label` | `3 × le taux d'intérêt légal` | libellé affiché |
| `relance_penalite_taux_annuel` | `0` | taux annuel (0,15 = 15 %) ; **0 = pas de pénalités** |
| `relance_ifr_par_facture` | `40` | IFR par facture (€) |
| `relance_delai_reponse` | `8 jours` | délai accordé |
| `relance_signataire` | `La Direction` | signataire |
| `relance_fonction_signataire` | `Service comptabilité` | fonction |
| `relance_societe` | `GERVIFRAIS SARL` | raison sociale |

Exemple de paramétrage (à exécuter via Supabase) :

```sql
INSERT INTO "AppSetting" ("key","value","updatedAt") VALUES
  ('relance_penalite_taux_annuel','0.1505', now()),
  ('relance_signataire','Jean-Michel Gunslay', now()),
  ('relance_fonction_signataire','Gérant', now())
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now();
```

## Envoi : mode TEST vs LIVE

> **Dans un premier temps, on envoie tout vers une boîte de test.**

- Par défaut (**`RELANCE_LIVE` absent**), chaque relance est **redirigée** vers
  `RELANCE_TEST_RECIPIENT` (défaut `wahofef603@aratrin.com`), quel que soit
  l'email du client. La modale affiche un bandeau « Mode test » et le log
  enregistre `testMode = true` + le destinataire réel visé (`intendedTo`).
- Pour l'**envoi réel** : `RELANCE_LIVE=1` (l'email part vers
  `Client.emailCompta`, repli `Client.email`).

### Prérequis Microsoft Graph

L'envoi utilise `/me/sendMail` → scope **`Mail.Send`** (ajouté dans
`lib/auth.ts`). **Comme le scope a été ajouté après coup, les comptes déjà
connectés doivent se reconnecter une fois** pour consentir le nouveau scope
(sinon l'API renvoie 401 « reconnectez-vous »).

## Journalisation (§6)

Chaque envoi crée une ligne `RelanceLog` (horodatage, tiers, niveau, canal,
destinataire effectif + visé, `testMode`, factures `docEntries`, décompte,
statut `ENVOYE`/`ECHEC`, opérateur). Constitue la piste d'audit / preuve des
diligences en cas de contentieux.

## Reste à faire (hors périmètre de ce lot)

- **Automatisation** : tâche planifiée quotidienne faisant avancer chaque facture
  R0→R5 selon le retard (déclenchement piloté par SAP). Ici, l'envoi est manuel.
- **LRAR (R4/R5)** : génération d'un PDF prêt pour lettre recommandée
  électronique / postale + conservation de l'accusé. Ici, R4/R5 partent en email
  (mention « recommandée » dans le corps) — l'email **ne remplace pas** le LRAR.
- **Gel pour litige** : un statut « litige déclaré » par facture/tiers qui
  suspend l'escalade (à modéliser — pas de champ litige aujourd'hui).
- **Tableau de bord** : balance âgée / DSO / top débiteurs (la balance âgée
  30-45 / 45-90 / +90 j existe déjà sur `/encours`).
- **Paramétrage UI** : écran de réglage des clés `relance_*` (aujourd'hui en base).
