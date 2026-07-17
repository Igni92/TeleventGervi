# Déploiement OVH VPS-3 — TeleVent auto-hébergé

Guide de bout en bout pour faire tourner TeleVent sur un **VPS-3 OVHcloud**
(remplace le déploiement Vercel décrit dans `DEPLOIEMENT.md`). Les fichiers de
configuration prêts à l'emploi sont dans **`deploy/`** :

```
deploy/
  nginx/televent.conf        # reverse proxy HTTPS
  systemd/televent.service   # maintien du process next start
  cron/televent.cron         # synchros SAP automatiques + backup
  scripts/setup-vps.sh       # provisionnement initial du serveur (root)
  scripts/deploy.sh          # mise à jour de l'app (pull + build + restart)
  scripts/cron-call.sh       # helper appelé par le cron (porte le CRON_SECRET)
  scripts/backup-db.sh       # pg_dump quotidien avec rétention
```

> **Gain principal vs Vercel Hobby** : plus aucune limite de cron (1/jour) ni de
> timeout serverless — la synchro SAP devient **automatique** (§6) et la
> resynchro complète (~3 ans de documents) tourne sans être coupée.

---

## 0. La commande chez OVH

| Choix | Valeur |
|---|---|
| Modèle | **VPS-3** — 6 vCores AMD EPYC, **12 Go RAM**, 100 Go SSD NVMe, 2 Gbit/s (~10,40 € HT/mois) |
| Localisation | **Gravelines (GRA)** ou Strasbourg (SBG) — France (RGPD, latence) |
| OS | **Ubuntu Server 24.04 LTS** (64 bits) |
| Clé SSH | Ajouter votre clé publique **dès la commande** (évite le mot de passe root par mail) |
| Options | Backup automatisé 1 j **inclus**. Si PostgreSQL local (§3 option B) : prendre l'option **Automated Backup 7 j**. Faire un **snapshot** avant chaque grosse mise à jour. |

Pourquoi ce dimensionnement : le build (`next build`, 571 fichiers TS) consomme
~4 Go en pointe ; PostgreSQL tuné à ~2 Go ; la resynchro SAP complète fait des
pics mémoire. 12 Go laissent de la marge pour tout faire cohabiter.

## 1. Architecture cible

```
Internet ──▶ nginx :80/:443 (TLS Let's Encrypt)
                 │  proxy_pass + X-Forwarded-Host/Proto (requis par proxy.ts)
                 ▼
             next start ─ 127.0.0.1:3000 (systemd: televent.service)
                 │
                 ├──▶ PostgreSQL 16 local (option B) — ou Supabase (option A)
                 ├──▶ SAP B1 Service Layer (https, réseau Gervifrais/EDOS)
                 └──▶ Microsoft Graph (login, agenda, Mail.Send)

cron système (/etc/cron.d/televent) ──▶ 127.0.0.1:3000/api/cron/sap-sync (+ delta, stock)
```

## 2. Provisionnement initial

Sur le VPS fraîchement livré, en **root** :

```bash
git clone https://github.com/Igni92/TeleventGervi.git /srv/televent/app
bash /srv/televent/app/deploy/scripts/setup-vps.sh
```

Le script (idempotent) installe et configure : utilisateur applicatif
`televent`, pare-feu **ufw** (22/80/443), **fail2ban**, swap 2 Go, **Node 22
LTS**, **nginx**, **certbot**, mises à jour de sécurité automatiques — et
**PostgreSQL 16** si lancé avec `INSTALL_POSTGRES=1`.

## 3. Base de données — deux options

### Option A — garder Supabase (démarrage le plus simple)
Rien à faire : conserver le `DATABASE_URL` Supabase actuel
(`sslmode=require`). Le VPS ne fait tourner que Next.js — on peut migrer la
base plus tard sans toucher au reste.

### Option B — PostgreSQL local sur le VPS
1. Provisionner avec `INSTALL_POSTGRES=1` (§2) — le script crée la base
   `televent`, l'utilisateur `televent` et applique le tuning mémoire
   (`shared_buffers=2GB`, `effective_cache_size=6GB`, `work_mem=32MB`).
2. **Migrer les données depuis Supabase** (schéma `public` uniquement — les
   schémas internes Supabase `auth`/`storage` ne doivent PAS être copiés) :
   ```bash
   pg_dump "postgresql://USER:PASS@HOST:5432/postgres?sslmode=require" \
     -n public --no-owner --no-privileges -Fc -f /tmp/televent.dump
   sudo -u postgres pg_restore --no-owner --no-privileges \
     -d televent /tmp/televent.dump
   ```
3. `DATABASE_URL=postgresql://televent:MOT_DE_PASSE@127.0.0.1:5432/televent`

> ⚠️ Comme sur Vercel : **NE JAMAIS lancer `prisma db push`** sur la base de
> prod. Le schéma est géré par migrations additives manuelles
> (`prisma/migrations/manual/*.sql`), le build ne fait que `prisma generate`.

## 4. Application

En tant qu'utilisateur `televent` :

```bash
cd /srv/televent/app
cp .env.example .env && chmod 600 .env   # puis remplir (tableau ci-dessous)
npm ci
npm run build                             # prisma generate && next build
```

Variables `.env` (mêmes valeurs que le tableau de `DEPLOIEMENT.md`, plus) :

| Variable | Valeur VPS | Note |
|---|---|---|
| `NEXTAUTH_URL` | `https://televent.gervifrais.com` | inchangé si on garde le domaine |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | `openssl rand -base64 32` | |
| `DATABASE_URL` | Supabase (A) ou local (B) | |
| `CRON_SECRET` | `openssl rand -base64 32` | **requis** pour les synchros auto (§6) |
| `AZURE_*`, `SAP_B1_*`, `RELANCE_*`, `VAPID_*` | identiques à la prod Vercel | |

Puis activer le service systemd (fichier `deploy/systemd/televent.service`) :

```bash
sudo cp deploy/systemd/televent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now televent
journalctl -u televent -f     # suivre les logs
```

## 5. Nginx + HTTPS

```bash
sudo cp deploy/nginx/televent.conf /etc/nginx/sites-available/televent.conf
sudo ln -s /etc/nginx/sites-available/televent.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
# Une fois le DNS pointé sur le VPS (§7) :
sudo certbot --nginx -d televent.gervifrais.com   # ajoute le TLS + redirection
```

Le fichier transmet `X-Forwarded-Host` / `X-Forwarded-Proto` — **obligatoire** :
`proxy.ts` et NextAuth (`trustHost: true`) reconstruisent l'origine réelle à
partir de ces en-têtes (sinon redirections vers localhost).

## 6. Synchros SAP automatiques (enfin)

Les routes acceptent déjà le déclenchement machine (`isCronAuthorized`, en-tête
`x-cron-secret`). Le middleware `proxy.ts` laisse passer les requêtes porteuses
du `CRON_SECRET`. Il suffit donc de :

```bash
sudo cp deploy/scripts/cron-call.sh /usr/local/bin/televent-cron-call
sudo chmod 755 /usr/local/bin/televent-cron-call
sudo cp deploy/cron/televent.cron /etc/cron.d/televent
```

Cadences par défaut (ajustables dans `/etc/cron.d/televent`) :

| Route | Rôle | Cadence |
|---|---|---|
| `/api/cron/sap-sync` | **Cron unique global** : miroir documents puis produits+stock, en séquence | toutes les 30 min |
| `/api/sap/sync/delta` | Synchro incrémentale stock | toutes les 10 min (décalé) |
| `/api/inventaire/refresh-stock` | Rafraîchissement du stock | toutes les 15 min (décalé) |

La resynchro complète (~3 ans) reste déclenchable depuis
**Paramètres › Données · SAP** — sans timeout sur le VPS.

> Si le Service Layer SAP filtre les IP entrantes, faire ajouter **l'IP du VPS**
> à la liste blanche (EDOS).

## 7. DNS + Azure

1. Abaisser le TTL de `televent.gervifrais.com` (300 s) la veille de la bascule.
2. Pointer l'enregistrement **A** sur l'IP du VPS (et AAAA si IPv6 configurée).
3. **Rien à changer côté Azure** si le domaine reste identique (l'URI de
   redirection `https://televent.gervifrais.com/api/auth/callback/microsoft-entra-id`
   est déjà déclarée). Idem pour `NEXTAUTH_URL`.
4. Lancer certbot (§5), vérifier, puis mettre le projet Vercel en pause (ou
   supprimer le domaine du projet) pour éviter deux prods en parallèle.

## 8. Sauvegardes

- **VPS** : backup OVH automatique quotidien (inclus) + snapshot manuel avant
  toute opération risquée.
- **Base locale (option B)** : `deploy/scripts/backup-db.sh` est planifié chaque
  nuit par `/etc/cron.d/televent` — `pg_dump` compressé dans
  `/var/backups/televent/`, rétention 14 jours. Recommandé : copier ces dumps
  hors du VPS (rclone vers OVH Object Storage ou autre).
- **Base Supabase (option A)** : backups gérés par Supabase, rien à faire.

## 9. Tests de fumée (mêmes que `DEPLOIEMENT.md` §5)

- [ ] `https://televent.gervifrais.com` → redirection `/login`, certificat valide.
- [ ] **Login Microsoft** réel (`@gervifrais.com`) → accès accordé.
- [ ] **/encours** charge ; tri colonnes OK ; carte maplibre du dashboard OK.
- [ ] Relance test → mail reçu sur la boîte test, expéditeur `compta@`.
- [ ] `televent-cron-call /api/cron/sap-sync` à la main → `{"ok":true,...}` et
      fraîcheur de synchro mise à jour dans Paramètres.
- [ ] PWA : `sw.js` accessible sans session, installation Android OK.

## 10. Exploitation courante

| Opération | Commande |
|---|---|
| Mettre à jour l'app | `bash deploy/scripts/deploy.sh` (pull + build + restart, ~1 min) |
| Logs applicatifs | `journalctl -u televent -f` |
| Redémarrer l'app | `sudo systemctl restart televent` |
| État nginx / renouvellement TLS | `systemctl status nginx` / `certbot renew --dry-run` (auto via timer) |
| Rollback | snapshot OVH, ou `git checkout <tag>` + `deploy.sh` |
