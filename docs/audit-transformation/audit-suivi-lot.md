# Audit — Suivi des numéros de lot (affectation & proposition)

> Déclencheur : « affectation ou proposition de lot **qui date énormément** ».
> Périmètre : cycle de vie complet d'un lot `EM<DocNum>` — réception → registre →
> proposition → affectation → expédition → synchro.
> Méthode : lecture du code + 3 traces ciblées (réception, vente, synchro).
> Sévérité : 🔴 Bloquant/Critique · 🟠 Majeur · 🟡 Mineur · ℹ️ Info.
> Ancrage métier : `PRODUCT.md` (« Do » #4 : *FIFO réel au picking, lot + DLC*),
> `docs/audit-transformation/audits/08-expert-metier.md` (§3 rotation inversée,
> priorité 3 *FEFO réel par DLC*).

---

## 1. Le symptôme en une phrase

TeleVent choisit et **fige** un numéro de lot très tôt, à partir de deux sources
qui **dérivent de la réalité avec le temps** — un cache d'entrées marchandise
(EM) et un registre de stock par lot jamais réconcilié — **sans jamais regarder
la DLC**. Résultat : à la vente comme à la préparation, on voit remonter des lots
« qui datent » : soit **périmés**, soit **déjà épuisés** (fantômes), soit **figés
au moment de l'offre** et jamais rafraîchis.

Trois causes racines, indépendantes et cumulatives :

| # | Cause racine | Produit le symptôme… |
|---|---|---|
| **A** | Le **registre des lots dérive** (crédité à la réception, débité presque jamais) → de vieux lots gardent une quantité fantôme > 0 | **proposition** de lot qui date (candidats triés FIFO : le plus vieux fantôme en tête) |
| **B** | Le lot est **choisi au niveau ARTICLE, jamais au niveau lot**, et **jamais re-résolu** après coup (offre figée, retro incomplète) | **affectation** de lot qui date (vieux lot posé/gelé alors que l'article a du stock ailleurs) |
| **C** | La **DLC n'est branchée nulle part sur la sélection** — elle est saisie, stockée, affichée… mais jamais utilisée pour filtrer/trier | les lots **périmés** sont proposés et affectés comme des frais |

---

## 2. Trois logiques d'ordre de lot **incohérentes** dans le même produit

C'est le cœur du problème d'ergonomie : selon l'écran, l'ordre des lots change.

| Surface | Fichier | Ordre appliqué | Filtre péremption ? |
|---|---|---|---|
| Résolution auto d'un BL (vente) | `lib/lotResolver.ts:198` `resolveLotForSegment` | **LIFO** — EM la plus récente du segment | ❌ non |
| Proposition manuelle (bons de commande) | `app/api/lots/candidates/route.ts:178` | **FIFO** — admission la plus ancienne | ❌ non (avant ce correctif) |
| Détail des lots (console, clic droit) | `app/api/products/[id]/batches/route.ts:35` | **FEFO** — DLC la plus proche | ⚠️ sur `ProductBatch.expirationDate` (≈ toujours null, cf. §4) |

Le module de production, lui, réclame explicitement « **plus vieux lot d'abord** »
(`prisma/schema.prisma:381`) — jamais appliqué à la vente. **Le bon standard pour
une denrée périssable est FEFO** (First Expired First Out) : on écoule d'abord ce
qui périme le plus tôt. Aucune des trois surfaces ne l'applique correctement.

---

## 3. Cause A — Le registre des lots dérive (proposition « qui date »)

Le stock **par lot** n'existe pas dans le Service Layer de cette base SAP ; TeleVent
le tient lui-même dans `ProductBatch.quantity` (`lib/lotLedger.ts`) : **crédité à la
réception**, **débité à la vente**. La proposition manuelle (`/api/lots/candidates`)
propose tous les lots au registre `quantity > 0`, **triés du plus ancien au plus
récent** — donc un vieux lot resté à > 0 remonte **en tête**.

Or le débit est appelé à **2 endroits seulement**, le crédit à **1** :

- `creditLots` → `app/api/sap/goods-receipts/route.ts:263` (réception).
- `debitLots` → `app/api/sap/orders/route.ts:991` (création BL direct) **et**
  `app/api/bons-commande/route.ts:394` (affectation manuelle d'un lot).

**Toutes les autres opérations laissent le registre désynchronisé — et il ne se
répare jamais :**

| 🔴/🟠 | Cas | Effet sur le registre | Preuve |
|---|---|---|---|
| 🔴 | **Vente à découvert** (EM_PENDING résolu à la réception) | créditée à la réception, **jamais débitée** (la retro-propagation ne fait que `creditLots`, pas `debitLots`) | `goods-receipts/route.ts:263,379-404` |
| 🔴 | **Modification de BL** (`.../modif`) | ni débit ni re-crédit — ligne ajoutée/augmentée/retirée invisible du registre | `app/api/sap/orders/[docEntry]/modif/route.ts` (aucun import registre) |
| 🔴 | **Annulation / rebind** | le débit initial **reste** ; le lot recréé n'est pas débité | `app/api/sap/orders/cancel/route.ts`, `.../rebind/route.ts` (aucun `creditLots`) |
| 🟠 | **Re-affectation d'un lot** | ancien lot non re-crédité, nouveau non débité | `bons-commande/route.ts:387,394` (débit seulement si `wasAllPending`) |
| 🟠 | **Vente directe dans SAP** (hors TeleVent) | jamais débitée (TeleVent ne la voit pas) | par construction |
| 🟠 | **Réception sans idempotence** | un retry réseau peut re-créer un PDN et **re-créditer** (double stock) | `goods-receipts/route.ts:222` (pas de clé d'idempotence) |

**Conséquence** : la quantité par lot ne fait que se **désaccorder** au fil des
jours ; de vieux lots gardent un solde fantôme > 0 et remontent **en tête** des
propositions (tri FIFO). C'est le « **proposition de lot qui date énormément** »
vécu par l'opérateur.

---

## 4. Cause C — La DLC existe mais n'est branchée nulle part sur la sélection

L'audit métier l'avait déjà pointé (« aveugle à la fraîcheur ») ; depuis, la donnée
a été **créée** (table `LotDlc`, saisie à la réception, `freshnessLabel` pour
l'affichage) mais **jamais raccordée à la décision** :

- La DLC saisie à la réception va dans **`LotDlc`** (table séparée), via
  `POST /api/lots/dlc` (best-effort, non bloquant) — `GoodsReceiptForm.tsx:383`.
- `ProductBatch.expirationDate` n'est alimenté que par la synchro depuis
  `BatchNumberDetails` — or **cette base n'a pas d'articles gérés par lot**, donc
  cette colonne est **quasi toujours null**. Le filtre FEFO de la console
  (`products/[id]/batches/route.ts:33`) porte donc sur une colonne vide → **no-op
  de fait**. La vraie DLC (dans `LotDlc`) n'est jamais jointe à la sélection.
- 🔴 **Aucune route de sélection/affectation ne lit la DLC** : ni `orders`, ni
  `bons-commande`, ni `candidates` (avant ce correctif), ni la retro de
  `goods-receipts`. Un `EM<DocNum>` **périmé** peut être proposé, affecté et
  expédié sans le moindre signal.
- 🟠 **La DLC est pré-remplie côté client seulement, et skippable** : le serveur
  n'appelle jamais `getShelfLifeMap` (`lib/shelfLife.ts` = code mort). Si la durée
  de vie d'un article n'est pas configurée → DLC vide → « DLC non saisie ».
- 🟠 **Une seule DLC par EM** (`LotDlc.batchNumber @unique`) : une EM multi-articles
  à durées de vie hétérogènes s'effondre sur une seule date (dernière écriture).
- 🟠 La DLC client est calculée sur `new Date()` (aujourd'hui), **pas** sur la date
  de réception saisie (`GoodsReceiptForm.tsx:240`) → DLC fausse sur une réception
  antidatée.

---

## 5. Cause B — Lot choisi trop tôt, au mauvais niveau, jamais re-résolu

### 5.1 Garde-fou stock au niveau ARTICLE, jamais au niveau lot
`chooseLot` (`lib/gervifrais-calc.ts:190`) pose le lot résolu **dès que l'ARTICLE a
du stock quelque part** (`localAvailable > 0 || sapOnHand > 0`). Rien ne vérifie que
**ce lot précis** a encore du stock. Comme `resolveLotForSegment` renvoie la
dernière EM affectée au segment du client, un client EXPORT peut se voir poser une
EM vieille de plusieurs semaines (dernier arrivage « export ») alors qu'existe un
stock « Tous » plus frais.

### 5.2 Lot figé à l'offre, jamais re-résolu à la commande
🔴 Un lot affecté sur une **offre** (Quotation) est **recopié tel quel** à la
conversion en commande (BaseType 23), des jours plus tard, **sans re-vérifier**
stock/segment/DLC (`app/api/bons-commande/route.ts:428-545`). Pire : une fois
pré-affectée, la commande a `pendingCount = 0` et **disparaît de la file
d'affectation** (`bons-commande/route.ts:314`) → le lot périmé n'est **jamais**
revisité. C'est littéralement « **affectation qui date énormément** ».

### 5.3 Lots figés « écrits une fois, jamais rafraîchis »
🟠 Trois stockages *write-once* : le `U_NoLot` d'offre (5.2), les lots forcés d'un
**bon de préparation export** (`orders/route.ts:475`, rejoués sans réalignement), et
**tout `EM<DocNum>` réel déjà posé** — que la retro ne réécrit jamais (elle ne
touche que les lignes strictement égales à `EM_PENDING`).

### 5.4 La propagation rétro laisse des lignes coincées
La retro de réception (`goods-receipts/route.ts`) réécrit `EM_PENDING → EM<DocNum>`,
mais rate plusieurs classes de lignes qui restent **indéfiniment** en attente (ou
finissent avec un lot choisi bien plus tard) :

- 🟠 fenêtre **60 jours** (`RETRO_WINDOW_DAYS`) : au-delà, jamais rescannées ;
- 🟠 **sentinelles famille** `EM_FAM:<fruit>` : jamais réécrites (par design) ;
- 🟠 **réception via bon de commande fournisseur** (`purchase-orders/receive`) : **aucune
  retro** — les découverts restent `EM_PENDING` jusqu'à une réception manuelle ;
- 🟡 **budget consommé par ligne entière** (pas de découpe partiel) : une grosse
  ligne peut affamer les suivantes ;
- 🟡 retro **fabrication** limitée au **jour même**.

---

## 6. Ce qui est **sain** (à garder)

- ✅ Le socle `chooseLot` + `EM_PENDING` + propagation rétro : aucune ligne ne part
  sans `U_NoLot` (bug BL 24011560 réglé) — bonne fondation.
- ✅ La **synchro n'écrase pas le registre** : elle n'écrit jamais `quantity`, ne
  supprime jamais `ProductBatch`, partage `warehouseCode=""` (pas de doublon). La
  dérive du §3 vient **du côté vente**, pas de la synchro. *(vérifié)*
- ✅ La DLC comme **donnée** existe déjà (`LotDlc`, `freshnessLabel`) : il « suffit »
  de la brancher — c'est ce que fait le correctif ci-dessous.
- ✅ `lib/colis.ts`, garde-fou encours, inventaire guidé : rigueur métier réelle.

*(Note : l'affirmation d'un tri SQL lexicographique dans `lotResolver.ts` évoquée
en cours d'audit a été **infirmée** — ce code n'existe pas.)*

---

## 7. Smoke test livré

`lib/lotSuiviAudit.smoke.test.ts` reproduit, sur la logique **pure et testable**,
les trois causes et prouve le correctif :

- **Cause #1** : `chooseLot` pose un vieux lot tant que l'article a du stock ;
- **Cause #2** : `resolveLotForSegment` fige un vieux lot de segment ;
- **Cause #3** : `buildLotCandidates` liste un lot périmé comme un frais (aucune
  entrée DLC) → puis **FIX** : `partitionByFreshness` l'écarte et trie FEFO ;
- **Garde-fou** : sans DLC saisie, l'ordre reste FIFO (aucune régression).

Primitive de fraîcheur : `lib/lotFreshness.ts` (pure, couverte par
`lib/lotFreshness.test.ts`). `npx vitest run lib/lotFreshness.test.ts
lib/lotSuiviAudit.smoke.test.ts` → **18 verts**.

---

## 8. Solutions — feuille de route priorisée

### ✅ Fait dans ce lot (contenu, sans risque SAP)
- 🔴→✅ **Filtre DLC + tri FEFO sur la proposition** (`/api/lots/candidates`) : un
  lot **périmé n'est plus proposé** (isolé, `expiredCount`), les proposables sont
  triés « à écouler d'abord ». Repli FIFO conservé quand la DLC manque ; jamais de
  liste vide (si tout est périmé, on montre en le signalant). Primitive pure +
  tests + smoke test.

### 🟠 À décider / chantier (touche les écritures SAP — je ne le fais pas à l'aveugle)
1. **Fiabiliser le registre (Cause A)** — le plus fort ROI :
   - **débiter à la retro** de `goods-receipts` (découverts) ;
   - **re-créditer à l'annulation** et **rejouer le delta à la modif** ;
   - **idempotence** sur la réception (clé `NumAtCard`/hash) contre le double-crédit ;
   - filet : un **job de réconciliation** périodique registre ↔ stock SAP article.
2. **Re-résoudre le lot à la conversion offre→commande (Cause B, §5.2)** — ou au
   minimum re-valider (stock du lot / DLC) et **re-marquer « à affecter »** toute
   commande dont le lot pré-affecté est périmé/épuisé, pour qu'elle **revienne**
   dans la file au lieu d'en disparaître.
3. **Garde-fou lot à la vente (Cause B, §5.1)** — passer d'un contrôle stock
   *article* à un contrôle *lot + DLC* dans `chooseLot`/`orders`, avec repli
   `EM_PENDING` si le lot résolu est périmé/épuisé.
4. **Fermer les trous de la retro (§5.4)** : brancher la retro sur
   `purchase-orders/receive`, élargir/paramétrer la fenêtre 60 j, gérer le partiel.
5. **DLC (Cause C) au niveau process** : rendre la durée de vie serveur (brancher
   `getShelfLifeMap`), calculer sur la **date de réception**, permettre une DLC
   **par article** dans une EM multi-articles.

### Décision métier requise
- **FEFO vs FIFO** comme règle de rotation officielle (le correctif applique FEFO,
  conforme à `PRODUCT.md` #4 ; à confirmer comme la règle unique des 3 surfaces).
- **Bloquer** la vente d'un lot périmé, ou seulement **alerter** ? (le correctif
  n'écarte que de la *proposition* ; il ne bloque pas une saisie manuelle forcée.)

---

*Document vivant — à compléter au fil des décisions ci-dessus.*
