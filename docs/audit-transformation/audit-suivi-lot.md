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

> **Règle métier tranchée par le client :** on ne propose / n'affecte QUE les
> lots **réellement présents en stock**. La **DLC n'entre pas en compte** dans la
> sélection du lot — seule la présence en stock décide.

Deux causes racines, indépendantes et cumulatives :

| # | Cause racine | Produit le symptôme… |
|---|---|---|
| **A** | Le **registre des lots dérive** (crédité à la réception, débité presque jamais) → de vieux lots gardent une quantité fantôme > 0, ET la proposition ne recoupait pas la quantité registre avec le **stock physique** | **proposition** de lot qui date (un lot épuisé remonte encore) |
| **B** | Le lot est **choisi au niveau ARTICLE, jamais au niveau lot**, et **jamais re-résolu** après coup (offre figée, retro incomplète) | **affectation** de lot qui date (vieux lot posé/gelé alors que l'article a du stock ailleurs) |

---

## 2. Trois logiques d'ordre de lot **incohérentes** dans le même produit

C'est le cœur du problème d'ergonomie : selon l'écran, l'ordre des lots change.

| Surface | Fichier | Ordre appliqué | Filtre péremption ? |
|---|---|---|---|
| Résolution auto d'un BL (vente) | `lib/lotResolver.ts:198` `resolveLotForSegment` | **LIFO** — EM la plus récente du segment | ❌ non |
| Proposition manuelle (bons de commande) | `app/api/lots/candidates/route.ts:178` | **FIFO** — admission la plus ancienne | ❌ non (avant ce correctif) |
| Détail des lots (console, clic droit) | `app/api/products/[id]/batches/route.ts:35` | **FEFO** — DLC la plus proche | ⚠️ sur `ProductBatch.expirationDate` (≈ toujours null, cf. §4) |

**Règle retenue (client) : le tri importe peu — ce qui compte est de ne proposer
QUE des lots présents en stock.** L'ordre reste FIFO (plus vieux d'abord, rotation
naturelle) ; la **DLC est hors sujet** pour la sélection. Le vrai défaut n'était
pas l'ordre mais l'**absence de recoupement avec le stock** : la proposition
listait des lots au registre `> 0` sans vérifier qu'ils étaient encore physiquement
là.

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

## 4. Cause C — La proposition ne recoupait pas la présence en STOCK

**Décision client : la DLC n'entre PAS en compte dans la sélection du lot.** Le
seul critère est la **présence en stock**. Le défaut réel n'était donc pas la DLC
mais le fait que `/api/lots/candidates` proposait un lot dès que le **registre**
`ProductBatch.quantity > 0`, **sans recouper avec le stock physique** (`ProductStock`).
Comme le registre peut dériver (cf. §3), un lot **épuisé** (entrepôt sans stock)
restait proposé — c'est le « lot qui date ».

Le correctif (Lot 1) ajoute le **filtre stock** sur la source registre : un lot
n'est proposé que si son entrepôt de réception a réellement du stock physique pour
l'article (la source de repli le faisait déjà). La DLC n'est ni lue ni utilisée.

*(La table `LotDlc` et l'affichage `freshnessLabel` restent pour information à
l'écran, sans jamais piloter la sélection.)*

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
conversion en commande (BaseType 23), des jours plus tard, **sans re-vérifier le
stock** (`app/api/bons-commande/route.ts:428-545`). Pire : une fois pré-affectée,
la commande a `pendingCount = 0` et **disparaît de la file d'affectation**
(`bons-commande/route.ts:314`) → le lot épuisé n'est **jamais** revisité. C'est
littéralement « **affectation qui date énormément** ».

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
les causes et prouve la **règle stock** :

- **Cause #1** : `chooseLot` pose un vieux lot tant que l'article a du stock
  (contrôle article, pas lot) ;
- **Cause #2** : `resolveLotForSegment` fige un vieux lot de segment sans vérifier
  son stock ;
- **RÈGLE** : `buildLotCandidates` ne retient QUE les lots présents en stock — un
  lot dont l'entrepôt est vide (épuisé) n'est **pas** proposé, et n'est jamais
  « suggéré ». Aucune notion de DLC.

Classifieur de départ : `lib/orderLots.ts` (pur, couvert par `lib/orderLots.test.ts`).
`npx vitest run lib/orderLots.test.ts lib/lotSuiviAudit.smoke.test.ts` → verts.

---

## 8. Solutions — état d'avancement

### ✅ Lot 1 — Proposition filtrée sur le STOCK (contenu, sans risque SAP)
- 🔴→✅ **Filtre stock sur la proposition** (`/api/lots/candidates`) : un lot n'est
  proposé que s'il est **réellement en stock** (l'entrepôt de réception a du stock
  physique pour l'article). Un lot épuisé au registre `> 0` n'est plus proposé ni
  « suggéré ». Ordre FIFO conservé. **La DLC n'entre pas en compte** (décision
  client). Smoke test `lib/lotSuiviAudit.smoke.test.ts`.

### ✅ Lot 2 — Garantie de départ + fiabilisation du registre
- 🔴→✅ **GARANTIE : aucune commande ne part sans lot réel.** Garde-fou serveur dans
  `/api/livraisons/departed` : le passage en « départ » est **refusé (409, code
  `LOT_PENDING`)** si une ligne est encore vide / EM_PENDING / EM_FAM. La commande
  bloquée est **mise en file d'affectation** automatiquement ; dérogation possible
  (`force:true`) mais **tracée en audit** (`DEPART_SANS_LOT`). Panne SAP → on ne
  fige pas l'entrepôt (avertissement). Classifieur pur `lib/orderLots.ts` + tests.
- 🔴→✅ **Registre fiabilisé (Cause A)** :
  - **débit à la retro** des ventes à découvert (`goods-receipts`) — fin du stock
    fantôme crédité-jamais-débité ;
  - **re-crédit à l'annulation** (`orders/cancel`) ;
  - **réconciliation différentielle à la modif** (`orders/[docEntry]/modif` :
    ajout/retrait/changement de lot → débit/crédit du delta) ;
  - **crédit au PO-receive** (`purchase-orders/receive`, aligné sur `goods-receipts`).
  - *(Le rebind reste cohérent tel quel — débit initial conservé — non modifié.)*
- 🟠→✅ **Re-validation STOCK à la conversion (Cause B §5.2)** : à la conversion
  offre→commande, toute ligne au lot **pré-affecté ÉPUISÉ** (registre à 0) est remise
  en `EM_PENDING` → elle **revient** dans la file et est bloquée au départ tant qu'un
  lot présent n'est pas posé.

### ✅ Lot 3 — Le registre est L'AUTORITÉ, alimenté à CHAQUE mouvement
Décision client : *« à chaque EM et chaque sortie (bon / sortie / fabrication) la
gestion des lots est gérée par l'app »* et *« pas de stock → pas de lot »*.

- 🔴→✅ **Fabrication (`/api/sap/assembly`)** : **débit** des lots composants
  consommés + **crédit** du lot PARENT produit sous son code `OP<NNNNN>` (nouveau
  stock fabriqué, suivi par lot comme une réception).
- 🔴→✅ **`isRealLot` étendu aux lots `OP<NNNNN>`** : un produit FABRIQUÉ est un vrai
  lot au même titre qu'un article reçu (crédit/débit, proposition, départ).
- 🔴→✅ **Repli REGISTRE à la vente + modif** (`orders`, `orders/[docEntry]/modif`) :
  quand le résolveur PDN est aveugle (produit fabriqué, ou article suivi seulement
  au registre), on pose le **lot FIFO en stock du registre** au lieu d'`EM_PENDING`
  (`getLedgerFifoLot`). Un produit fabriqué (DECO…) part donc **automatiquement avec
  son lot OP** — plus de blocage au départ. « Pas de stock, pas de lot » : un lot à
  quantité 0 n'est jamais renvoyé.
- 🔴→✅ **Régularisation d'inventaire** (`inventoryAdjust`) : **débit** des manques
  (sorties) + **crédit** des excédents (entrées).
- 🔴→✅ **Retour fournisseur** (`goods-receipts/[docEntry]/return`) : **débit** du lot
  d'origine `EM<DocNum>` retourné.
- 🔴→✅ **Débit à la retro fabrication** (`goods-receipts`) : les composants fabriqués
  à découvert désormais servis par le lot reçu sont **débités** (miroir de la retro
  Orders).

Bilan : le registre `ProductBatch.quantity` est maintenant crédité/débité à
**chaque** mouvement — réception, PO-receive, vente (BL/découvert/modif/annulation),
fabrication (composants + parent), régularisation d'inventaire, retour fournisseur.

### 🟠 Reste (chantier / décision)
- **Idempotence de la réception** (clé `NumAtCard`/hash) contre un double-crédit sur
  retry réseau — non fait (SAP-side).
- **Retro sur `purchase-orders/receive`** : crédit registre branché, propagation
  rétro (réécrire les découverts) toujours inline dans `goods-receipts` (à extraire).
  Filet : garde-fou de départ + repli registre couvrent le cas.
- **Assemblage v1 legacy** (`assemblyLegacy`, BOM) : sans lots composants — parent non
  crédité (le flux réel est v2/v3, couvert). À traiter si v1 encore utilisé.
- **Réconciliation registre ↔ stock physique** : purge des reliquats historiques là où
  l'article×entrepôt est physiquement à 0 (petit script one-shot).

### Note
- **DLC hors périmètre** : décision client — la DLC ne pilote pas la sélection du
  lot. Seule la **présence en stock** décide. `LotDlc` reste pour l'affichage.

---

*Document vivant — à compléter au fil des décisions ci-dessus.*
