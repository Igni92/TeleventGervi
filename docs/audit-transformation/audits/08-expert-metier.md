# Audit métier — Fraîcheur, logistique, litiges & recouvrement (grossiste fraises GERVI)

## 1. Synthèse

TeleVent est un excellent outil de **télévente et de gestion de flux SAP** : la saisie de commande est fluide, la traçabilité du lot à la vente est garantie (aucune ligne sans `U_NoLot`), le recouvrement est de niveau cabinet, et l'inventaire guidé est remarquablement accessible. **Mais l'outil est aveugle au cœur du métier d'un grossiste de fraises : la fraîcheur.**

Le constat est systémique et se tient en une phrase : **aucune DLC n'est jamais saisie, donc aucune DLC ne peut jamais être affichée, donc aucune décision (vente, picking, déstockage, casse) n'est prise en fonction de la péremption.** À cela s'ajoutent trois angles morts qui coûtent directement de l'argent : pas de garde-fou sur la quantité/le prix à la saisie, pas de vue des retards de livraison, et un recouvrement qui ne sait pas geler un litige qualité.

**Note de maturité de la dimension fraîcheur/logistique/litiges : 38/100.** Les fondations (lot, encours, relance, incidents) sont là ; la couche métier « denrée périssable » manque presque entièrement.

---

## 2. La chaîne du froid de la donnée : où la fraîcheur se perd

| Étape | Donnée DLC présente ? | Preuve |
|---|---|---|
| Réception marchandise (saisie) | ❌ Aucun champ DLC | `GoodsReceiptForm.tsx:29-40` |
| Envoi du lot à SAP | ❌ Pas de `ExpirationDate`/`BatchNumbers` | `goods-receipts/route.ts:164-185` |
| Stockage local (`ProductBatch.expirationDate`) | ⚠️ Champ existe et indexé mais **jamais alimenté** | `schema.prisma:502,512` |
| Console de vente (`Ecran2Order`) | ❌ Invisible | `Ecran2Order.tsx` (grep DLC = 0) |
| Panier / Bon de livraison | ❌ Invisible | idem |
| Bon de préparation (livraisons) | ❌ Ni lot ni DLC transmis | `livraisons/route.ts:159-166`, `LivraisonDetail.tsx:26-36` |
| Inventaire guidé / panel | ❌ Invisible | `GuidedCounter.tsx`, `InventairePanel.tsx` |
| Table admin produit | ✅ Seul endroit | `ProductsTable.tsx:790-812` |

**Le seul affichage de DLC du produit est dans une table d'administration que personne ne regarde pendant qu'il vend ou qu'il prépare.** C'est la définition même d'une donnée orpheline.

### Scénario qui casse aujourd'hui
> Lundi 8h, réception de 40 colis de fraises Hoogstraten, DLC mercredi. Le commercial vend lundi et mardi au prix « conseillé d'hier » sans voir la DLC. Mercredi matin, 12 colis non vendus passent à J-0 ; le système ne les a jamais signalés « à écouler ». Ils partent en casse. Perte sèche non quantifiée (cf. finding incidents sans montant), et invisible dans le pilotage de rentabilité.

---

## 3. La rotation est inversée : « FIFO » qui est en réalité du LIFO

Le résolveur de lots est commenté FIFO partout, mais sélectionne **le `DocNum` le plus grand**, donc la **réception la plus récente** :

```
// lib/lotResolver.ts:76
if (!maps.byItem.has(l.ItemCode) || d.DocNum > maps.byItem.get(l.ItemCode)!) { ... }
```

Pour une denrée périssable, attribuer la vente au lot **le plus frais** revient à laisser vieillir le lot de la veille — l'exact inverse de ce qu'il faut faire. L'intention correcte (« plus vieux lot d'abord ») est écrite… dans le module de **production** (`schema.prisma:371`), jamais appliquée à la vente. Une fois la DLC saisie, le picking doit être piloté par `expirationDate ASC`, pas par `DocNum DESC`.

---

## 4. La saisie de commande n'est pas protégée contre l'erreur humaine

Deux risques classiques d'un commercial rapide (~20 ans, densité, raccourcis) :

| Risque | État actuel | Preuve |
|---|---|---|
| Quantité aberrante (200 au lieu de 20) | ❌ `min={0}` sans `max`, serveur `qty>0` seulement | `Ecran2Order.tsx:1290-1292`, `orders/route.ts:109-113` |
| Vente sous le coût / sous marge | ❌ Prix libre, aucune alerte | `Ecran2Order.tsx:1310-1311` |
| Doublon de commande | ⚠️ Anti-doublon **ligne** seulement | `Ecran2Order.tsx:539` |

Le plus frustrant : **les briques existent déjà**. `number-input.tsx` gère le `clamp(max)` (l.41-43), et `lib/cogs.ts` sait recalculer le coût d'entrée réel par article (dernière EM ≤ date de vente). Il « suffit » de brancher un plafond de quantité et une pastille de marge par ligne, sur le modèle de la modale de confirmation d'encours déjà en place. Pour de la fraise dont le cours bouge chaque jour, reprendre le prix d'hier après une flambée = vente à perte silencieuse.

---

## 5. Retards de livraison : invisibles

La vue livraison (`LivraisonDetail.tsx`) est conçue pour **un seul jour** (J+1 par défaut, `:371`), groupée par transporteur, avec un excellent suivi `Faite / À préparer / À reprendre`. Mais le type `Doc` (`:37-61`) n'a **aucune notion de retard** : une commande d'hier restée « À préparer » ou un BL dont la date promise est dépassée ne remonte nulle part une fois la date changée.

Cela contredit directement la devise du produit (« Qu'est-ce qui est urgent ? Quelle est la prochaine action ? ») et laisse la Direction — peu à l'aise numériquement — sans écran qui dise « voici ce qui est en retard aujourd'hui ». **Manque un bandeau/onglet « En retard & urgent ».**

---

## 6. Litiges qualité ↔ recouvrement : la boucle est rompue

Le module recouvrement est par ailleurs très bon (6 niveaux, IFR, mode test/live, avoirs attribués par facture dans `Encours.tsx`). Deux ruptures métier :

1. **Le gel sur litige est promis mais inexistant.** `levels.ts:9-10` affirme que l'escalade est « gelée en cas de litige déclaré (cf. /api/relance) ». En réalité `server.ts:97` ne suspend que les factures **lettrées** (`balance<=0.01`). Aucun flag litige nulle part (`app/api/relance/*`). Résultat : un client qui retient le paiement à cause de fraises pourries (litige légitime, avoir en cours) reçoit quand même **R4 mise en demeure LRAR** puis **R5 contentieux** — faute relationnelle et fragilité juridique.

2. **Les incidents ne sont pas chiffrés ni reliés aux avoirs.** `ReceptionIncident` et `Incident` (`schema.prisma:164-200`) ne portent qu'une **note libre** : pas de quantité, pas de montant, pas de lien vers l'avoir fournisseur/client. Déclarer « Casse » ou « Manquant » ne dit pas combien ni combien ça coûte. La **casse/les invendus**, premier poste de perte d'un grossiste fraise, restent donc **invisibles dans le pilotage de rentabilité**.

De plus, **on ne peut pas signaler un litige depuis l'écran de livraison** (point de constat naturel : retour chauffeur, colis écrasés) — l'incident client ne se déclare que depuis la fiche client, alors que le modèle `Incident` porte déjà `docEntry/docNum` du BL (`schema.prisma:164-169`). Un bouton « Signaler » réutilisant les logos de la réception serait un quick win à fort ROI.

---

## 7. Saisonnalité & ruptures : revendiquées, pas outillées

Le code répète que la saisonnalité fraise impose des comparaisons par semaine (`pilotage/weekly/route.ts:21`, `commerciaux/[slp]/route.ts:19`), mais aucun écran n'exploite `ProductStock.committed/ordered/available` (`schema.prisma:478-481`) pour anticiper une **rupture en pic de saison** ou sécuriser une **vente à découvert** (`Ecran2Order.tsx:932-946`, qui ne dit pas si une entrée est attendue). En pleine saison, ne pas voir qu'on va manquer = ventes GMS récurrentes perdues.

---

## 8. Ce qu'il faut garder absolument

- **`chooseLot` + EM_PENDING + propagation rétro** (`gervifrais-calc.ts:123`, `goods-receipts/route.ts:227`) : le socle de traçabilité est sain et gère déjà le cas « vendu avant réception du matin ». C'est la fondation sur laquelle brancher la fraîcheur.
- **Garde-fou encours** (`orders/route.ts:398-413`) et **module relance** (`lib/relance/*`) : robustes, paramétrables, sécurisés.
- **Incidents de réception à logos** dont « Température » (`ReceptionIncidents.tsx`) : pertinent chaîne du froid, juste à enrichir d'un montant.
- **Inventaire guidé** (`GuidedCounter.tsx`) : modèle d'accessibilité terrain.
- **`lib/colis.ts`** : rigueur métier sur le conditionnement, pièges documentés sur cas SAP réels.

---

## 9. Priorisation (ROI)

| Priorité | Action | Effort | ROI |
|---|---|---|---|
| 1 | Saisir la DLC à la réception + la pousser dans le lot SAP | 🛠️ | Fort |
| 2 | Afficher la fraîcheur en console/panier/bon de prépa + tuile « à écouler » | 🛠️ | Fort |
| 3 | Corriger la rotation (FIFO réel par DLC, pas LIFO par DocNum) | 🛠️ | Fort |
| 4 | Plafond quantité + alerte vente sous coût/marge à la saisie | ⚡/🛠️ | Fort |
| 5 | Bandeau « En retard & urgent » sur les livraisons | 🛠️ | Fort |
| 6 | Bouton « Signaler » sur l'écran livraison | ⚡ | Fort |
| 7 | Gel relance sur litige + incidents chiffrés reliés aux avoirs | 🛠️ | Moyen |

**Conclusion.** Le produit a déjà l'ossature d'un CRM métier premium. Le chantier prioritaire n'est pas cosmétique : c'est de **donner des yeux à l'outil sur la fraîcheur** — depuis le seul point où la donnée naît (la réception) jusqu'à tous les écrans où l'on décide (vente, prépa, déstockage). Sans DLC, TeleVent reste un excellent ERP de flux ; avec elle, il devient un vrai outil de grossiste de fruits frais.