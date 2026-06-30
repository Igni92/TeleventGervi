# Exploitation & déploiement — TeleVent

## Déploiement
Le projet est déployé sur **Vercel** (`televent-gervi`, domaine `televent.gervifrais.com`).
Tout push sur `main` déclenche un déploiement **production** ; les autres branches
créent des **previews**. Le build local de référence : `npm run build`
(`prisma generate && next build`).

> Si les pushes ne déclenchent plus de build : **Vercel → Settings → Git →
> Disconnect/Reconnect** le dépôt (le webhook GitHub→Vercel peut se désactiver).

## Variable d'environnement à définir : `CRON_SECRET`
Les routes de synchro SAP acceptent un **déclenchement machine** (cron Vercel) en
plus du déclenchement manuel admin. L'authentification machine se fait par un
secret partagé :

- **`CRON_SECRET`** : chaîne aléatoire (ex. `openssl rand -base64 32`).
  - À définir dans **Vercel → Settings → Environment Variables** (Production).
  - Vercel ajoute automatiquement l'en-tête `Authorization: Bearer <CRON_SECRET>`
    aux invocations de cron déclarées dans `vercel.json`.
  - Si la variable est **absente**, les crons restent **inactifs** (aucun bypass
    possible — `isCronAuthorized` renvoie `false`), sans aucun risque : le
    déclenchement manuel admin continue de fonctionner normalement.

### Crons déclarés (`vercel.json`)
| Route | Rôle | Fréquence indicative |
|-------|------|----------------------|
| `/api/sap/sync/mirror` | Miroir documentaire (factures, commandes, EM, avoirs…) | ~10 min |
| `/api/sap/sync/delta` | Synchro incrémentale | ~10 min (décalé) |
| `/api/inventaire/refresh-stock` | Rafraîchissement du stock | ~15 min |

> Objectif métier : garder le miroir SAP **frais en continu** (KPI, encours,
> marge, stock) même le soir et le week-end, sans dépendre d'un clic humain.
