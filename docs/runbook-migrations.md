# Runbook — appliquer les migrations de l'audit (prod)

> À lancer depuis une machine disposant du `.env` prod (`DATABASE_URL` Supabase +
> identifiants SAP). Le conteneur Claude éphémère n'a PAS ces secrets → ces étapes
> n'ont pas pu être exécutées automatiquement. Toutes les migrations sont
> **additives, idempotentes, non destructives** (`ADD COLUMN/CREATE TABLE IF NOT
> EXISTS`, backfill `ON CONFLICT DO NOTHING`).

## 0. Pré-requis
```bash
git pull            # récupérer la branche claude/adoring-goldberg-yp91i6 (PR #17)
npm install
```

## 1. C6 — encours / limite de crédit (SapBusinessPartner)
```bash
node scripts/ddl-bp-credit.mjs            # dry-run : vérifier le DDL
node scripts/ddl-bp-credit.mjs --apply    # ajoute creditLimit/currentAccountBalance/frozen
npx prisma generate
```
Puis **relancer une synchro BusinessPartners** (admin) : Paramètres → Données · SAP →
synchro miroir, ou `POST /api/sap/sync/mirror`. L'encart crédit de la fiche client
apparaît une fois les colonnes peuplées (avant : masqué proprement).

## 2. B5 — table canonique ClientCardCode (multi-CardCode)
```bash
node scripts/ddl-client-cardcodes.mjs           # dry-run
node scripts/ddl-client-cardcodes.mjs --apply   # crée la table + backfill (Client.code + modes de livraison)
npx prisma generate
```
Effet : l'encours regroupe déjà les comptes secondaires sous le client logique
(fonctionne dès maintenant via dérivation ; après backfill, le store canonique
`ClientCardCode` prend le relais). Pour rattacher un compte SAP **manuellement**
(hors mode de livraison), insérer une ligne dans `ClientCardCode`.

## 3. B4 — référentiel SalesPerson
```bash
node scripts/ddl-salesperson.mjs           # dry-run
node scripts/ddl-salesperson.mjs --apply   # crée la table + seed (MM/JMG/AG)
npx prisma generate
```
La prochaine synchro BusinessPartners complète/réactualise automatiquement la table
(greffe gardée dans `lib/sapMirror.ts`).

## 4. Vérification post-migration
```bash
npx tsc --noEmit && npm test && npm run build
```
Contrôler en prod : fiche client (encart crédit visible), `/encours` (lignes
consolidées par client), table `SalesPerson` peuplée.

## Rollback
Tout est additif. Pour annuler sans perte de données : `DROP TABLE "ClientCardCode"`,
`DROP TABLE "SalesPerson"`, ou ignorer les colonnes crédit (l'app dégrade proprement
si elles manquent). Le code reste fonctionnel avant comme après application.
