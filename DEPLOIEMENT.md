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
Le miroir SAP (factures, avoirs, commandes, EM → pilotage & marges), le stock et
le catalogue produits sont alimentés par les **crons système du VPS**, seul et
unique ordonnanceur depuis la sortie de Vercel.

Source de vérité **versionnée** : `deploy/cron/televent.cron`, installé dans
`/etc/cron.d/televent` par `deploy/scripts/deploy.sh` (idempotent). Chaque ligne
passe par le helper `/usr/local/bin/televent-cron-call`
(`deploy/scripts/cron-call.sh`), qui lit `CRON_SECRET` dans
`/srv/televent/app/.env` et appelle Next.js **en local** (`127.0.0.1:3000`, sans
passer par nginx), en-tête `x-cron-secret` ; les routes re-vérifient le secret
(`lib/cronAuth.ts`). Cadence : miroir documents toutes les 10 min, delta stock
toutes les 10 min (décalé de 5), stock inventaire tous les 1/4 h, catalogue
produits 2×/h, sauvegarde base à 02h15.

**Modifier une planification** = éditer `deploy/cron/televent.cron` puis relancer
`deploy/scripts/deploy.sh` sur le VPS. Ne jamais éditer `/etc/cron.d/televent`
à la main : le déploiement suivant l'écrase.

**Dépannage** (sur le VPS, en `ubuntu`). ⚠️ **`sudo` obligatoire** partout : le
`.env` appartient à `televent` et le journal système n'est pas lisible par un
compte hors des groupes `adm`/`systemd-journal` — sans `sudo` on obtient
« Permission denied » ou « No entries » et on conclut à tort que rien ne tourne.
```bash
# 1. Le crontab est-il réellement installé ? (sinon : lancer deploy.sh)
sudo cat /etc/cron.d/televent

# 2. Le démon cron tourne-t-il, et a-t-il lancé les lignes ?
systemctl is-active cron
sudo journalctl -u cron --since '2 hours ago' | grep televent | tail

# 3. Résultat des appels (succès ET échecs y sont journalisés).
#    `journalctl -t` n'accepte PAS de joker : on filtre au grep.
sudo journalctl --since '2 hours ago' | grep televent-cron | tail -20

# 4. Le secret est-il présent ? (doit renvoyer 1)
sudo grep -c '^CRON_SECRET=' /srv/televent/app/.env

# 5. Déclenchement manuel DANS LES CONDITIONS DU CRON (utilisateur televent) :
sudo -u televent /usr/local/bin/televent-cron-call /api/sap/sync/mirror; echo "code=$?"

# 6. L'app répond-elle en local ? (le helper tape 127.0.0.1:3000, pas nginx)
sudo systemctl status televent --no-pager --lines=5
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login
```
Sans `CRON_SECRET` dans le `.env`, le helper refuse l'appel (message explicite
dans le journal) et **aucune** synchro ne tourne : c'est le premier point à
vérifier si le miroir se fige (« CA du jour » à 0, stock périmé).

**Historique — GitHub Actions supprimé.** Un workflow `.github/workflows/sap-sync.yml`
(`*/30` → `/api/cron/sap-sync`) avait servi d'ordonnanceur de secours à l'époque
Vercel. Il a été retiré : le secret `CRON_SECRET` n'a jamais existé côté GitHub,
donc il échouait à **chaque** exécution (267 runs rouges d'affilée) sans rien
synchroniser, et il ferait doublon avec le crontab du VPS. L'endpoint
`/api/cron/sap-sync` (miroir + produits enchaînés) reste en place et reste
appelable depuis n'importe quel déclencheur externe portant le bon secret.

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
