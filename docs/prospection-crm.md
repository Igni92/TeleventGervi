# Module Prospection (CRM)

Pipeline commercial pour transformer des **prospects** (GMS avec labo pâtisserie) en
**clients**, avec agenda de rendez-vous et notifications.

## Séparation Clients / Prospects

- **Client** : compte facturé il y a **moins d'un an**.
- **Prospect** : compte **en pipeline** (`Client.prospectStage` ≠ `GAGNE`) **ou** sans
  commande depuis **plus d'un an** (ou jamais).

Règle implémentée dans `lib/prospection.ts` → `classifyAccount(lastOrderAt, prospectStage)`
(`PROSPECT_INACTIVITY_DAYS = 365`). Un compte gagné qui ne commande plus pendant > 1 an
**redevient prospect** automatiquement.

## Pipeline (5 étapes + Perdu)

| Étape | Clé | Rôle |
|---|---|---|
| À contacter | `A_CONTACTER` | prospect importé / pas encore travaillé |
| Qualification | `QUALIFICATION` | labo ? volumes ? produits ? |
| Présentation + RDV | `PRESENTATION` | gamme **par mail** + prise de **rendez-vous** |
| Après 1re commande | `POST_COMMANDE` | suivi post-livraison |
| Client gagné | `GAGNE` | **2e commande** → bascule au portefeuille clients |
| Perdu | `PERDU` | avec motif (`LOST_REASONS`) |

Chaque étape porte un **script d'appel** par défaut (`STAGES[].script`), éditable côté app.

## Propriété

Un prospect travaillé par un commercial lui reste rattaché (`Client.prospectOwner` =
son trigramme SAP `slpName`). À l'étape `GAGNE`, il entre dans **son** portefeuille
clients (mêmes règles d'accès scopé que le reste — cf. `lib/permissions`).

## Rendez-vous & notifications

Table `RendezVous` : R1 physique / appels programmés, avec `notifyMinutesBefore`
(**défaut 60 = 1 h avant, modifiable** par RDV) et `notifiedAt` (anti-doublon).
La notification push est envoyée par le cron `reminders` (même mécanique que
`Rappel.notifiedAt` + `lib/push`).

## Timeline

Table `ProspectionActivity` : historique par prospect (`APPEL | MAIL | RDV | NOTE | STAGE`),
alimente la fiche prospect.

## Base de données

Migration additive idempotente : `prisma/migrations/manual/20260721_prospection_pipeline.sql`
(colonnes `Client.*` + tables `RendezVous`, `ProspectionActivity`, RLS deny-all).
Nouvelles colonnes lues en `$queryRawUnsafe` tant que `prisma generate` reste bloqué
(même convention que `activeTelevente` / `vendeur`).

**Application en prod :**
```
psql "$DATABASE_URL" -f prisma/migrations/manual/20260721_prospection_pipeline.sql
```
(ou Supabase MCP `apply_migration`).

## Reste à faire (étapes suivantes)

1. **API** `/api/prospection` (liste scopée par étape), `/api/prospection/[id]` (déplacer
   d'étape + activité), `/api/rendez-vous` (CRUD agenda).
2. **Écran** `/prospection` : Kanban 5 colonnes (glisser-déposer), fiche prospect
   (timeline + script de l'étape), agenda des RDV.
3. **Cron** : envoi push `notifyMinutesBefore` avant chaque RDV.
4. **Import** des prospects GMS IDF pâtisserie en étape `À contacter`.
5. **Séparation UI** Clients vs Prospects dans la liste existante.
