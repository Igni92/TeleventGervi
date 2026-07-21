# Déploiement TeleVent — v1 (production)

Cible recommandée : **Vercel** (SAP Service Layer joignable depuis Internet,
Supabase et Microsoft 365 étant déjà cloud). Alternative on-prem en fin de doc.

> Périmètre v1 : encours **au net** (avoirs déduits, tri colonnes) · relances
> **R0→R5 manuelles en mode test** (envoi depuis `compta@` via identité
> applicative) · journalisation. **Hors v1** (notés) : pièces jointes PDF (attend
> l'archive SharePoint) et automatisation cron.

## 0. Pré-requis
- Accès **Vercel** (compte + droit de créer un projet) relié au repo GitHub.
- Accès **admin Azure** (Entra ID) pour les URI de redirection + permission Graph.
- La base **Supabase de prod** (`iokraagfwrpklyhgwknv`) et ses identifiants.
- Les identifiants **SAP B1 Service Layer** de prod.

## 1. Variables d'environnement (Vercel → Project → Settings → Environment Variables)
| Variable | Valeur | Note |
|---|---|---|
| `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID` | depuis l'app Azure | aussi utilisés par l'identité applicative (relances) |
| `AUTH_SECRET` (= `NEXTAUTH_SECRET`) | secret aléatoire fort | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | URL de prod (ex. `https://televent.vercel.app`) | |
| `DATABASE_URL` | URL Supabase prod (`sslmode=require`) | |
| `SAP_B1_BASE_URL` / `SAP_B1_COMPANY_DB` / `SAP_B1_USERNAME` / `SAP_B1_PASSWORD` | SAP prod | |
| `SAP_B1_TLS_INSECURE` | `0` | ⚠️ `1` seulement si cert auto-signé (à éviter en prod) |
| `RELANCE_FROM_ADDRESS` | `compta@gervifrais.com` | boîte expéditrice des relances |
| `RELANCE_TEST_RECIPIENT` | `wahofef603@aratrin.com` (ou autre) | destinataire en mode test |
| `RELANCE_LIVE` | **NON défini** | ⚠️ laisser vide en v1 → relances vers la boîte test |
| `SAP_B1_COMPANY_DB_TEST` | (optionnel) | active la bascule prod↔test SAP |
| `ALLOWED_EMAIL_DOMAIN` | (optionnel) `gervifrais.com` | restreint le login |

## 2. Azure / Microsoft Entra ID
1. App registration → **Authentication** → **Redirect URIs** : ajouter
   `https://<URL-prod>/api/auth/callback/microsoft-entra-id`.
2. (Relances) **API permissions** → **Application** → **`Mail.Send`** →
   **Grant admin consent** ; + **ApplicationAccessPolicy** Exchange restreignant
   l'app à `compta@gervifrais.com` (cf. `docs/relance-recouvrement.md`).
3. Vérifier qu'un **client secret** valide correspond à `AZURE_CLIENT_SECRET`.

## 3. Base de données
- Le schéma additif (dont la table **`RelanceLog`**) est **déjà appliqué** sur la
  base de prod via les migrations manuelles (`prisma/migrations/manual/*.sql`,
  appliquées via Supabase MCP).
- ⚠️ **NE PAS exécuter `prisma db push`** (la base contient les données de prod ;
  schéma géré par migrations additives). Le build se contente de `prisma generate`
  (postinstall) — aucune modification de schéma.

## 4. Déploiement Vercel
1. **Importer le repo** sur Vercel (branche `main`).
2. Framework **Next.js** (détecté). Build par défaut (`next build`). Node ≥ 20.9.
3. Renseigner les variables d'env (étape 1) pour l'environnement **Production**.
4. **Deploy**. Vercel build + déploie.
5. Reporter l'URL finale dans `NEXTAUTH_URL` **et** dans l'URI de redirection Azure
   (si elle a changé), puis redéployer si besoin.

## 5. Tests de fumée (après déploiement)
- [ ] **Login Microsoft** réel (compte `@gervifrais.com`) → accès accordé.
- [ ] **/encours** charge ; FANTASY ≈ solde du grand livre (net) ; tri colonnes OK.
- [ ] Carte **maplibre** (dashboard écran 3) s'affiche sous React 19.
- [ ] Ouvrir un client → **Relancer** → **Envoyer (test)** → mail reçu sur la boîte
      test, **expéditeur `compta@`**, ligne dans l'historique (RelanceLog).
- [ ] Bascule SAP prod↔test (navbar) si configurée.

## 6. Passage en envoi réel (plus tard, après validation)
Positionner `RELANCE_LIVE=1` → les relances partent vers `Client.emailCompta`
(repli boîte test si vide). À ne faire **qu'après** avoir validé les modèles.

## 7. Rollback
Vercel → onglet **Deployments** → un déploiement précédent → **Promote to
Production** (rollback instantané). Le tag `v1.0.0` repère la version livrée.

## 8. Synchronisation SAP — ordonnancement des crons
Le miroir SAP (factures, avoirs, commandes, EM → pilotage & marges) est alimenté
par un déclencheur **externe** qui appelle, toutes les ~30 min :
```
GET https://televent.gervifrais.com/api/cron/sap-sync
en-tête : x-cron-secret: <CRON_SECRET>
```
L'endpoint (auth `CRON_SECRET`, cf. `lib/cronAuth.ts`) enchaîne miroir documents
puis produits/stock — idempotent, throttle serveur 60 s. Le cron **natif Vercel**
a été retiré (cadence 30 min non permise par le plan → bloquait les déploiements
prod) : l'ordonnancement vit donc **hors Vercel**.

**Cible : VPS OVH** (centralise tous les crons du parc). Crontab à poser sur le VPS :
```cron
# /etc/cron.d/televent-sync  (secret dans /etc/televent/sync.env → CRON_SECRET=…)
*/30 * * * *  root  . /etc/televent/sync.env; curl -fsS --max-time 300 \
  -H "x-cron-secret: $CRON_SECRET" \
  https://televent.gervifrais.com/api/cron/sap-sync \
  >> /var/log/televent-sync.log 2>&1
```

**Dépannage actuel (avant bascule OVH)** : un workflow **GitHub Actions**
(`.github/workflows/sap-sync.yml`, `*/30` + déclenchement manuel) tape le même
endpoint. Pré-requis : secret GitHub `CRON_SECRET`. ⚠️ **Quand le VPS OVH prend le
relais, désactiver ce workflow** (Actions → *SAP mirror sync* → *Disable*) pour ne
pas déclencher deux fois — sans danger (idempotent + throttle), mais inutile.

En manuel, un admin peut toujours resynchroniser depuis
*Paramètres → Données stats → **Synchroniser maintenant*** (ou le backfill mensuel).

## Alternative on-prem (si SAP n'était joignable qu'en interne)
Sur un serveur Windows/Linux du réseau (qui voit SAP) :
```bash
npm ci
npm run build
npm run start   # next start, port 3000 ; mettre derrière un reverse proxy HTTPS
```
Mêmes variables d'env (fichier `.env`), même URI de redirection Azure pointant
l'URL interne, et un process manager (PM2 / service Windows) pour le maintien.
