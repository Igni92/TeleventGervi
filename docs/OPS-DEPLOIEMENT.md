# Exploitation & déploiement — TeleVent

## Déploiement
Le projet est déployé sur **Vercel** (`televent-gervi`, domaine `televent.gervifrais.com`).
Tout push sur `main` déclenche un déploiement **production** ; les autres branches
créent des **previews**. Le build local de référence : `npm run build`
(`prisma generate && next build`).

> Si les pushes ne déclenchent plus de build : **Vercel → Settings → Git →
> Disconnect/Reconnect** le dépôt (le webhook GitHub→Vercel peut se désactiver).

## Synchronisation SAP : **manuelle** (état actuel)

⚠️ **`vercel.json` ne déclare AUCUN cron** (uniquement `{"regions":["cdg1"]}`).
La synchro du miroir SAP est donc **entièrement manuelle** : elle ne se fait que
lorsqu'un admin lance une resynchronisation depuis **Paramètres › Données · SAP**
(bouton « Resynchroniser (PROD) » = reconstruction complète sur ~3 ans, profondeur
du rapport annuel). Le stock « live » de la console se rafraîchit à part, à la
demande (pull delta déclenché par les consoles ouvertes).

> Conséquence : entre deux resynchros manuelles, le miroir (KPI, marge, rapport
> annuel) n'évolue pas. Relancer la resynchro « de temps en temps », et après tout
> import massif de factures côté SAP.

### Optionnel — activer une synchro automatique (crons Vercel)
Les routes de synchro SAP **acceptent déjà** un déclenchement machine (elles ne
sont simplement pas planifiées). Pour automatiser, il faudrait **les deux** :

1. Définir **`CRON_SECRET`** (chaîne aléatoire, ex. `openssl rand -base64 32`)
   dans **Vercel → Settings → Environment Variables** (Production). Sans cette
   variable, tout déclenchement machine est refusé (`isCronAuthorized` → `false`) ;
   le déclenchement manuel admin continue de fonctionner.
2. Déclarer un bloc **`crons`** dans `vercel.json` pointant les routes ci‑dessous.
   ⚠️ Le plan **Hobby limite les crons à 1/jour** ; une cadence ~10 min impose
   **Vercel Pro**.

| Route (déclenchement machine `GET`) | Rôle | Cadence si activé |
|-------|------|----------------------|
| `/api/sap/sync/mirror` | Miroir documentaire (factures, commandes, EM, avoirs…) | ~10 min (Pro) |
| `/api/sap/sync/delta` | Synchro incrémentale stock | ~10 min décalé (Pro) |
| `/api/inventaire/refresh-stock` | Rafraîchissement du stock | ~15 min (Pro) |
