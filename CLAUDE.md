# CLAUDE.md — Carte de navigation TeleVent

> **But de ce fichier** : permettre de travailler sur le repo en lisant le
> **minimum de tokens**. Il est auto-chargé à chaque session. Lis-le EN PREMIER,
> sers-toi de l'index pour aller droit au bon fichier, lis des **extraits ciblés**
> (offsets) plutôt que des fichiers entiers. Ne relis pas ce qui est déjà ici.

## Règle d'or token
1. **Localiser avant de lire** : Glob/Grep → puis Read par offset. Jamais un
   fichier entier « pour voir ».
2. **L'index `lib/` ci-dessous = le cerveau métier.** 90 % des questions logiques
   s'y répondent via l'en-tête du module (8 premières lignes documentent tout).
3. **Ne pas parcourir `scripts/`** (≈95 `.mjs` jetables) ni `prisma/schema.prisma`
   en entier — la liste des modèles est plus bas.
4. Les calculs critiques sont dans des **fonctions PURES testées** (`*.test.ts`) :
   lire le test donne le contrat sans lire tout le module.

## Stack
Next.js 14 (App Router, TS) · Prisma + Postgres (**Supabase**) · NextAuth v5
(Microsoft Entra, domaine `gervifrais.com`) · Microsoft Graph (agenda) · SAP
Business One via Service Layer → **miroir local** (tables `Sap*`) · TanStack
Query · Tailwind + design-system maison (Framer Motion + visx, `SurfaceCard`).
UI 100 % FR.

## ⚠️ Règles métier à ne JAMAIS violer
- **Marge = COGS réel** (`lib/cogs.ts`), **jamais** le `grossProfit` SAP.
  CA NET = factures − avoirs clients. Achats NET = EM − retours.
- **Unités** : produits vendus au **kg / colis / barquette**. Ne JAMAIS supposer
  le kg. Volume = kg (qty × `salesUnitWeight`). Tout article = un colis de X
  unités. Côté UI/API fabrication : **tout en colis** (`lib/colis.ts`,
  `lib/fabrication.ts`).
- **Scoping `slpName`** : par défaut un commercial ne voit QUE ses données.
  Admins (= `ADMIN_EMAILS` **ou** `User.isAdmin`) voient tout. Toute route `/api`
  doit appliquer le scope — cf. `lib/permissions.ts`.
- **SAP Service Layer** : pas de `$expand`, pas de lambda `any()`, `GrossProfit`
  par ligne seulement, `ECONNRESET` sur longues paginations. Beaucoup d'accès en
  raw SQL (`$queryRawUnsafe`) car le client Prisma est parfois en retard.

## Où trouver quoi (tâche → emplacement)
| Besoin | Aller voir |
|---|---|
| Droits / scoping / admin | `lib/permissions.ts` |
| Calcul marge / COGS | `lib/cogs.ts` (+ `lib/cogs`… pures) |
| Prix conseillé | `lib/gerviPricing.ts`, `lib/gervifrais-calc.ts` |
| Colis / poids / conditionnement | `lib/colis.ts`, `lib/fabrication.ts` |
| Optimisation transformation | `lib/fabrication-optim.ts` |
| Résolution de lot (U_NoLot) | `lib/lotResolver.ts` |
| Agrégats dashboard / KPI / YoY | `lib/pilotage.ts` (+ `pilotage-time.ts`) |
| Pull / sync SAP | `lib/sapMirror.ts`, `lib/stockSync.ts`, `app/api/sap/sync/*` |
| Client SAP bas niveau | `lib/sapb1.ts` |
| Mapping commercial↔user | `lib/salespeople.ts`, table `UserCommercial` |
| Transporteurs / tournées | `lib/clientCarriers.ts` (UDT `SERG_TRCL`) |
| Familles / segments produits | `lib/familles.ts`, `lib/segments.ts` |
| Cache agrégats lourds | `lib/ttlCache.ts` |
| Semaine ISO / calendrier | `lib/iso-week.ts` |
| Validation formulaires | `lib/validations.ts` (Zod) |
| Auth / session | `lib/auth.ts`, `middleware.ts` |
| Schéma DB | `prisma/schema.prisma` (modèles listés plus bas) |

## Carte des dossiers
- **`app/`** — pages (App Router) + `app/api/` (toutes les routes serveur).
- **`components/`** — UI, sous-dossiers calqués sur les modules (`pilotage/`,
  `console/`, `clients/`, `commerciaux/`, …) + `ui/` (primitives, `SurfaceCard`).
- **`lib/`** — logique métier et intégrations (= le cerveau ; index ci-dessous).
- **`prisma/`** — `schema.prisma` (source de vérité du modèle).
- **`scripts/`** — ≈95 `.mjs` : DDL idempotents (`ddl-*.mjs`) + diagnostics
  jetables (`diag-* probe-* find-* test-* verif-*`). **Ne pas lire en masse.**
- **`docs/`** — `audit-prompt.md` (relancer l'audit), `cotation-brief-*` +
  `sap-cotation-reference.md` (système de cotation auto).
- Racine : `README.md` (install/déploiement, partiellement obsolète),
  `DESIGN-CHANGELOG.md` (historique design-system).

## Index `lib/` (en-tête = doc complète)
- `permissions.ts` — droits & scoping `slpName`. `getAccessScope`,
  `requireAdmin`, `pilotageSlpFilter`, `clientInScope/clientIdsInScope`,
  `resolvePilotageView` (mode « Voir comme » admin).
- `cogs.ts` — COGS réel = marge vraie (jamais SAP).
- `gervifrais-calc.ts` — fonctions **pures** finances (découpe entrepôts, TPF,
  prix conseillé). Testé.
- `gerviPricing.ts` — moteur prix conseillé : PrixAchat (liste SAP n°2) × coef.
- `colis.ts` — nb colis exact + poids colis. **Pur**, testé.
- `fabrication.ts` — helpers serveur fabrication v2 (recipes/options/assembly),
  tout en colis.
- `fabrication-optim.ts` — optimiseur de transformation. **Pur**, testé.
- `lotResolver.ts` — `U_NoLot = "EM" + DocNum` du dernier PDN. Testé.
- `pilotage.ts` — agrégats sur miroir SAP (KPI/activity/annual/weekly/tops),
  YoY ; paramètre `slpName` optionnel pour le scoping.
- `pilotage-time.ts` — helpers temps/granularité pilotage.
- `pilotageSync.ts` / `consoleSync.ts` — sync 2 écrans (BroadcastChannel + miroir
  localStorage).
- `sapb1.ts` — client SAP B1 Service Layer (session B1SESSION en mémoire).
- `sapMirror.ts` — pull SAP → tables `Sap*` (backfill one-shot + mirror cron).
- `stockSync.ts` — synchro stock SAP → `ProductStock` (delta + orders).
- `insights.ts` — stats comportement client (meilleure heure/jour, intervalle).
  **Pas de LLM.**
- `familles.ts` — famille effective produit (ex. petits fruits).
- `segments.ts` — segments commerciaux au-dessus des groupes clients SAP.
- `salespeople.ts` — commercial SAP (trigramme) ↔ user ; **commercial** (account
  manager) vs **vendeur** (réalise la vente).
- `clientCarriers.ts` — transporteurs/tournées par client (UDT `SERG_TRCL`).
- `iso-week.ts` — semaine ISO 8601 + calendrier événements. **Pur**, testé.
- `ttlCache.ts` — cache mémoire TTL (process-local) pour agrégats lourds.
- `graph.ts` — Microsoft Graph (events agenda).
- `validations.ts` — schémas Zod (tél FR souple, etc.).
- `auth.ts` — NextAuth v5 (Entra), domaine autorisé.
- `prisma.ts` — singleton client Prisma.
- `motion.ts` — presets Framer Motion. `utils.ts` — `cn`, helpers.
- `useConsolePrefs.ts` / `useConsoleShortcuts.ts` — hooks UI console.
- Tests : `colis`, `fabrication-optim`, `gervifrais-calc`, `iso-week`,
  `lotResolver`, `pilotage` (`*.test.ts`, vitest).

## Modules applicatifs (`app/` + `components/`)
`/accueil` (hub) · `/dashboard` cockpit pilotage dual-écran (`+ecran2`) ·
`/console` commande SAP (`+ecran2` stock/BL) · `/encours` · `/fabrication` ·
`/clients` (`[id]`, `new`) · `/commerciaux` (`[slp]`) · `/plan-appel` ·
`/promos` · `/entrees` · `/products` · `/parametres` · `/login`.

`app/api/` (grande surface) regroupée par domaine : `auth`, `clients`
(CRUD/import/assign/contacts/compta/carriers/delivery-modes/comportement-yoy),
`commerciaux` (`objectif`, `sap`, `[slp]`), `pilotage`
(kpi/activity/annual/weekly/tops/actions), `sap`
(`sync/{backfill,delta,mirror,full-reset,products,client-groups}`,
invoices/orders/prices/suppliers/clients/goods-receipts/assembly/environment),
`fabrication`, `production`, `products`, `promos`, `encours`, `incidents`,
`entrees`, `appels`, `reminders`, `notifications`, `favorites`, `plan-appel`,
`temp-assignments`, `carriers`, `users`, `types`.

## Base de données (Supabase)
Projet Supabase : **`iokraagfwrpklyhgwknv`**. Modèle = `prisma/schema.prisma`.
Modèles principaux : `User`, `Account`, `Session`, `Presence`,
`CommercialObjectif`, `Client`, `Contact`, `Incident`, `ReceptionIncident`,
`Carrier`, `ClientDeliveryMode`, `TempAssignment`, `Product`, `ProductBom`,
`ProductionRecipe*`, `FabricationRun*`, `ProductStock`, `ProductBatch`,
`AppSetting`, `SyncLog`, `Rappel`, `AppelLog`, `Promo`, `FavoriteItem`,
miroir SAP : `SapBusinessPartner`, `SapInvoice(+Line)`, `SapOrder(+Line)`,
`SapPurchaseDeliveryNote(+PdnLine)`, `SapCreditNote(+Line)`,
`SapPurchaseReturn(+Line)`, curseurs `*Cursor`.

Mapping `UserCommercial` (commercial SAP → compte) :
`MM`→m.mandine · `JMG`→jm.gunslay · `AG`→m.essombe (@gervifrais.com).
Admins bootstrap : `jm.gunslay`, `m.mandine`.

**DDL appliqués via MCP Supabase (juin 2026)** — idempotents :
`User.isAdmin` (bool, défaut false) · table `CommercialObjectif`
(`slpName` PK, `objectifCa`, `updatedAt`) · backfill clients sans commercial
→ `JMG`. Scripts DDL équivalents : `scripts/ddl-*.mjs`.

## Commandes
`npm run dev|build|start` · `npm run lint` · `npm run format` ·
`npm run test` (vitest) · `npm run db:push|db:migrate|db:studio|db:generate`.
Audit lecture seule possible : `npx tsc --noEmit`, `npx vitest run`,
`npm run lint`, `npm audit`.

## Procédure de navigation économe (résumé)
1. Lire ce fichier. 2. Tâche métier → repérer le module via l'index `lib/`,
lire son en-tête / son test. 3. Route → `app/api/<domaine>/route.ts`. 4. UI →
`components/<module>/`. 5. Schéma → `prisma/schema.prisma` (ciblé par modèle).
6. **Ne pas** ouvrir `scripts/` sans besoin précis. 7. Toujours Grep/Glob avant
Read, lire par offsets.

## Relancer l'audit / définir les correctifs
L'audit multi-axes (commercial/marketing/perf/UI/données/cyber/RGPD/UX-métier)
se relance via **`docs/audit-prompt.md`** ; il produit un « TOP 10 prioritaire »
découpé en **lots**. **Lots 1→5 déjà livrés et mergés dans `main`** :
1. Sécurité — routes destructrices verrouillées admin.
2. Sécurité — scoping `slpName` généralisé (anti-IDOR/fuites).
3. Rôle admin en base (`User.isAdmin`) + toggle UI Équipe.
4. « Voir comme » — aperçu admin du cockpit d'un commercial (`?as=SLP`).
5. Objectifs CA par commercial + % atteint (`CommercialObjectif`).
Le rapport d'audit lui-même n'est pas versionné : relancer le prompt pour
régénérer le TOP 10 et identifier les lots restants.
