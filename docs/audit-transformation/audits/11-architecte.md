# Audit Architecture Logicielle — TeleVent (GERVI / Gervifrais)

## Synthèse exécutive

TeleVent est un projet techniquement **plus mûr que la moyenne** des produits métier à ce stade : typage TypeScript strict réellement tenu (un seul `any` dans tout `app`+`lib`+`components`), un client SAP B1 de qualité production, une stratégie de synchronisation idempotente intelligemment pensée autour des contraintes réelles du Service Layer SAP et du pooler Supabase, et une couche de droits/IDOR centralisée. La documentation inline (le *pourquoi*, les incidents passés, les pièges OData) est un actif de maintenabilité rare.

Cette base solide est cependant grevée par **trois dettes structurelles** qui pèsent directement sur les objectifs métier (rentabilité, fraîcheur fraise, confiance Direction) :

1. **Absence de couche service** — la logique métier critique (calcul des taxes para-fiscales, choix du lot FIFO, contrôle d'encours, création de commande) vit dans des **routes de 600-800 lignes** et est **dupliquée dans des composants de 1500-2200 lignes**. Non testable, non réutilisable, divergence silencieuse garantie.
2. **Orchestration de synchronisation SAP fragile** — le `full-reset` est destructif et non transactionnel (timeout = miroir partiel et faux), **aucun cron n'est câblé** (le miroir ne se met à jour que si un humain ouvre la bonne page), et **zéro observabilité** sur les ticks les plus fréquents.
3. **Filet de sécurité runtime troué** — **aucune error boundary** (page d'erreur brute Next.js pour une Direction à faible aisance numérique), et des caches en mémoire non partagés entre lambdas serverless.

**Note de maturité de la dimension Architecture : 68/100.** Le socle (typage, client SAP, sync idempotente, pooler) mériterait 80+ ; il est tiré vers le bas par la structuration applicative (pas de services), l'orchestration de sync et l'absence de filets runtime.

---

## 1. Structuration applicative — la logique métier est au mauvais endroit

### 1.1 Routes obèses, zéro couche service

Le cas d'école est `app/api/sap/orders/route.ts` (**774 lignes**, POST de ~530 lignes). Une seule fonction orchestre, en ligne :

| Étape | Ligne | Nature |
|---|---|---|
| Résolution CardCode (mode de livraison) | 128-142 | raw SQL |
| Pré-validation existence + stock SAP | 164-208 | I/O SAP par paquets |
| Calcul TPF2 INTERFEL (0,21 % du HT) + TPF3 DDG (0,02 €/colis) | 275-291 | **règle métier de facturation** |
| Choix du lot FIFO (stock local OU SAP) | 302-315 | **traçabilité fraise/DLC** |
| Garde-fou encours / compte gelé | 398-415 | **recouvrement** |
| POST SAP + refetch + **réconciliation TPF par PATCH** | 432-516 | I/O SAP |
| Miroir optimiste + AppelLog | 518-556 | écriture DB |

Aucun module `services/` ou `lib/orders/` n'existe. Conséquence métier concrète : si Gervifrais change le taux INTERFEL, ou la règle « 5 colis achetés + 1 offert », il faut modifier **la route ET les deux composants de saisie** — avec un risque réel de divergence, car la route fait une *réconciliation TPF post-création* (le HT n'étant connu qu'après le POST) que l'UI, elle, ne fait pas.

> **Recommandation** : extraire `createOrder(input, ctx)` (validation Zod → TPF → lot → encours → POST SAP → miroir), routes réduites à de la glu (< 80 l.), couche service testée avec un client SAP mocké. Cibler aussi BL, réception marchandise, inventaire.

### 1.2 Composants hors normes

| Composant | Lignes | Rôle |
|---|---|---|
| `console/CallConsole.tsx` | 2192 | cœur télévente |
| `console/Ecran2Order.tsx` | 1516 | saisie commande écran 2 |
| `inventaire/InventairePanel.tsx` | 1359 | comptage |
| `livraisons/LivraisonDetail.tsx` | 1226 | détail BL |
| `products/ProductsTable.tsx` | 1026 | stock |
| `console/BLDialog.tsx` | 1023 | modale BL |
| `pilotage/PilotageScreen2.tsx` | 987 | dashboard visx |

Sept composants > 950 lignes. Au-delà du nombre, le problème est que la **logique métier de commande y est ré-implémentée** (cf. 1.3).

### 1.3 Duplication BLDialog ↔ Ecran2Order (~2500 lignes)

Les deux fichiers partagent les mêmes imports métier (`splitByWarehouse, totalAvailable, personalStock, unitInfo`), des interfaces quasi identiques (`DeliveryMode`, `ProductHit`/`Product`, `CartLine`/`BLLine`), la même découpe multi-entrepôt et la même construction du payload `/api/sap/orders`. **`TODO-AUDIT.md:72` le signale déjà** (« hook commun (dette technique) ») mais ce n'est pas traité. Risque : un correctif sur le calcul colis↔pièces ou l'application d'une promo dans un fichier et oublié dans l'autre → **deux commerciaux produisent des bons différents pour la même situation**.

> **Recommandation** : `useOrderCart` + composants partagés (`LigneArticle`, `RecherchePanier`), adossés à la couche service `createOrder`.

---

## 2. Intégration & synchronisation SAP

### 2.1 Le client `lib/sapb1.ts` — à conserver tel quel (force)

Retry/backoff ciblé sur les **seules** erreurs transitoires (502/503/504, ECONNRESET/ETIMEDOUT…), re-login coalescé sur 401 avec verrou single-in-flight, timeout `AbortController` par appel, pagination parallèle (`getAllParallel`). C'est de l'ingénierie réseau soignée.

### 2.2 La stratégie de mirroring — bien raisonnée (force)

`lib/sapMirror.ts` documente et corrige de vrais incidents : écritures **bulk** (INSERT multi-VALUES `ON CONFLICT` par lots de 200) pour ne pas saturer le pooler Supabase (`EMAXCONNSESSION` vécu le 2026-06-11), **découpage mensuel** anti-troncature (plafond 10 000 docs/pull), ordre **récent→ancien** pour qu'un timeout serverless ne sacrifie que l'historique profond. `lib/cogs.ts` recalcule la marge réelle en **SQL pur (LATERAL)** sans boucle JS. Excellent.

### 2.3 Mais l'ORCHESTRATION est le maillon faible

**(a) `full-reset` destructif et non transactionnel** — `app/api/sap/sync/full-reset/route.ts:52` fait `TRUNCATE … CASCADE` **puis** re-pull un an. Le commentaire l'admet (« si un pull échoue ensuite, le miroir peut rester partiel »). Avec `maxDuration=300` (plafond Hobby) et le volume d'un grossiste, un timeout en cours de reconstruction laisse les **dashboards Direction affichant un CA/marge tronqués** — le scénario « faire peur à la Direction » à éviter absolument. Et le cron incrémental ne *reconstruit* pas : un miroir partiel reste faux jusqu'à une resync manuelle.

**(b) Aucun cron câblé** — `vercel.json` = `{ regions: ['cdg1'] }`, **pas de bloc `crons`**. Le stock n'est rafraîchi que pendant qu'une console est ouverte (`setInterval` 30 s) ; le miroir documentaire (→ tous les KPI, encours, marge) seulement sur clic admin. Le soir/week-end, **le stock affiché est périmé → risque de survente de fraises** (DLC courte). De plus `/sync/mirror` exige `requireAdmin` : un cron Vercel sans session recevrait **403** — aucun bypass `CRON_SECRET`.

**(c) Zéro observabilité** — `SyncLog` n'est écrit que par `products` et `backfill`. `mirror`, `delta`, `full-reset` ne loggent rien en base. Impossible de répondre depuis l'UI à « depuis quand la marge est-elle figée ? » ou « le miroir est-il complet ? ».

### 2.4 Couplage fort à SAP

**34 routes** importent directement `lib/sapb1` et écrivent de l'OData inline ; **8 routes** lisent `process.env.SAP_B1_COMPANY_DB` en dur — alors que le client a un **environnement runtime** (prod/test) basculable. D'où une **incohérence possible** : un message d'erreur affiche `"<DB PROD>"` alors que `sap.getEnvironment().company` vaut la société TEST. Il manque un **repository SAP métier** au-dessus de `sapb1`.

---

## 3. État serveur & runtime client

### 3.1 Deux paradigmes d'état serveur coexistent

`app/providers.tsx` configure un `QueryClient` (TanStack Query, staleTime 60 s) — l'outillage est là. Mais `components/Sidebar.tsx` (montée en permanence) implémente **4 boucles `fetch`+`setInterval`** manuelles (incidents, notifications 60 s, commandes dues 120 s, inventaires 120 s), et `StockPanel`/`ProductsTable` un `setInterval` 30 s pour `sync/delta`. Sans dédup ni pause en arrière-plan : **plusieurs onglets = N× les appels** (et N× les pulls SAP delta), boucles tournant toute la journée sur chaque poste.

> **Recommandation** : migrer vers `useQuery` (`refetchInterval`, `refetchOnWindowFocus`) ; un seul hook partagé pour déclencher `sync/delta`.

### 3.2 Aucune error boundary

**0 `error.tsx`, 0 `global-error.tsx`, 0 `ErrorBoundary`** dans tout le repo (12 `loading.tsx` en revanche). En React 19/Next 16, une exception de rendu (visx, maplibre, agrégat pilotage inattendu) remonte jusqu'à l'**écran d'erreur brut Next.js**. Pour le persona **DIRECTION** (« l'interface doit rassurer, jamais faire peur »), c'est le pire résultat. D'autant que la migration Next 16 + visx/maplibre est elle-même marquée « à valider en runtime » dans `TODO-AUDIT`.

### 3.3 Caches module-scope non partagés

≥ 9 caches en variable de module (sessions SAP, `ttlCache`, `expensesCache` taxes, token Graph, pricing, transporteurs, carriers, jours fériés). En serverless multi-lambda, **chaque instance a son cache** : `invalidate('pilotage:')` après une commande ne purge que l'instance courante. Tolérable pour des agrégats internes ; plus discutable pour `expensesCache` (taux INTERFEL/DDG qui impactent la facturation).

---

## 4. Schéma, dette des scripts et tests

### 4.1 Source de vérité du schéma éclatée

44 modèles dans `schema.prisma`, **mais** plusieurs tables/colonnes sont créées par des scripts impératifs `ddl-*.mjs` (UserCommercial, BrandLogo, CommercialObjectif, fabrication v2, `User.isAdmin/isDirection`, `Client.vendeur`…) et restent « hors client Prisma typé ». D'où **13+ accès `$queryRawUnsafe` non typés** dont plusieurs sur des chemins **sécurité** (`lib/permissions.ts`) : requêtes heureusement **paramétrées** (`$1/$2`, pas d'injection) et entourées de `try/catch`, mais la **sécurité de type est perdue là où elle compte le plus** (un retour mal typé sur `isAdmin`/`slpName` affecte le périmètre de données).

### 4.2 103 scripts = dette de dépôt

`scripts/` : 28 `probe-*`, 14 `diag-*`, 10 `ddl-*`, 9 `test-*`, 3 `migrate-*`… Les ~70 `probe/diag/test` sont des explorations jetables du Service Layer SAP qui **noient** les 5-6 scripts opérationnels utiles (`backfill`, `seed-carriers`, `assign-*`).

> **Recommandation** : rapatrier les DDL dans des **migrations Prisma** (réunifie le schéma, regénère le client typé, élimine les `$queryRawUnsafe`) ; archiver les probe/diag/test one-shot hors du repo principal.

### 4.3 Couverture de tests : le pur est couvert, le critique ne l'est pas

16 fichiers `.test.ts` couvrent bien la **logique pure** (marge, lots, fuseau Paris, iso-week, relance, sync-slices…). Mais **rien** ne couvre les chemins où un bug coûte de l'argent :

| Fichier non testé | Lignes | Risque |
|---|---|---|
| `lib/sapMirror.ts` | 715 | mapping **positionnel** doc→colonnes, dérivation `lineCost` |
| `lib/sapb1.ts` | 448 | retry/relogin/pagination |
| `lib/stockSync.ts` | 338 | décrément optimiste, RAZ des épuisés |
| `lib/permissions.ts` | 232 | **IDOR / périmètre commercial** |
| `lib/cogs.ts` | 199 | marge réelle LATERAL |
| `lib/inventoryAdjust.ts` | 435 | régularisation stock |

Le mapping bulk est **positionnel** (`SALES_HEADER_COLS`/`SALES_LINE_COLS` + tableaux de valeurs dans le même ordre) : un décalage de colonne fausse silencieusement le CA ou la marge, sans erreur. C'est exactement le genre de bug qu'un test de mapping attraperait.

---

## 5. Plan de réduction de dette priorisé

| # | Action | Effort | ROI | Pourquoi maintenant (métier) |
|---|---|---|---|---|
| 1 | **Câbler les crons Vercel** (`mirror` 5-10 min, `delta`/`products`) + auth machine `CRON_SECRET` | ⚡ | Fort | Stock & KPI à jour hors présence humaine → anti-survente fraise, encours fiable |
| 2 | **`app/error.tsx` + `global-error.tsx`** + boundaries sur dashboard/pilotage/carte | ⚡ | Fort | Ne jamais montrer une page d'erreur brute à la Direction |
| 3 | **`full-reset` en staging + swap atomique** (le live n'est jamais vide) | 🛠️ | Fort | Pas de CA/marge tronqués pendant/après une resync |
| 4 | **Couche service `createOrder` / `lib/orders/`** + tests | 🛠️ | Fort | TPF, lot, encours testables et uniques (rentabilité + traçabilité) |
| 5 | **Hook `useOrderCart` partagé** BLDialog/Ecran2Order | 🛠️ | Fort | Fin de la divergence de comportement sur la prise de commande |
| 6 | **Tests** mapping `sapMirror` + matrice `permissions` + `cogs` | 🛠️ | Fort | Protéger CA/marge et l'étanchéité des données entre commerciaux |
| 7 | **`SyncLog`** sur mirror/delta/full-reset + badge fraîcheur UI | 🛠️ | Moyen | « Je comprends ce qui se passe » (Direction) |
| 8 | **Pollings Sidebar → `useQuery`** | 🛠️ | Moyen | Moins d'appels SAP redondants, code unifié |
| 9 | **DDL `ddl-*` → migrations Prisma** + suppression des `$queryRawUnsafe` non typés | 🛠️ | Moyen | Réunifier le schéma, regagner la sécurité de type sur permissions |
| 10 | **Repository SAP métier** au-dessus de `sapb1` + `getEnvironment()` partout | 🛠️ | Moyen | Découpler 34 routes du Service Layer ; messages d'erreur cohérents |

---

## Conclusion

L'ossature est saine et le **savoir-faire d'ingénierie est réel** (client SAP, sync idempotente, pooler, typage, droits). La valeur se débloquera en **remontant la logique métier des routes/composants vers une couche service testée**, en **fiabilisant l'orchestration de synchronisation** (cron, swap atomique, observabilité) et en **posant les filets runtime manquants** (error boundaries). Les deux premiers quick wins (crons + error boundaries) sont à faible effort et à fort impact direct sur la fraîcheur du stock et la confiance de la Direction.