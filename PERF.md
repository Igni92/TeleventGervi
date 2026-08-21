# Plan performance — miroir Postgres autosuffisant (≈ zéro appel SAP live hors cron)

Objectif (demande propriétaire, 2026-08-21) : « le miroir nickel en permanence,
quasi aucun appel SAP hors cron ; les crons font le max ». Les chargements sont
trop longs parce que plusieurs écrans lisent SAP en **temps réel** au lieu du
miroir Postgres local (127.0.0.1, déjà rapide).

## Principe directeur
1. **Toute LECTURE d'écran → miroir Postgres.** Aucun `sap.get` sur un chemin
   de navigation/lecture.
2. **Les ÉCRITURES restent live** (créer commande/BL/réception/facture/avoir :
   impossible à miroiter). MAIS chaque écriture fait un **write-through** :
   elle upsert immédiatement la ligne `Sap*` correspondante → l'UI est fraîche
   sans attendre le prochain cron ni relire SAP.
3. **Les crons comblent les trous** (Quotations, dispo par lot, qty/entrepôt de
   lot, champs d'encours) pour que le miroir suffise.

## État actuel (audit 2026-08-21)
Miroir déjà bon pour : dashboards/pilotage (CA, marge, tops, encours agrégé),
catalogue produits, stock grossier (entrepôts 000/01/R1), liste état
documentaire, cœur console (file, notes, historique). DB locale, crons sains
(miroir ~1-2 min, produits 12 s, delta rapide).

### Hotspots SAP live à éliminer (lecture) — par douleur décroissante
| # | Hotspot | Fichier | Écrans impactés |
|---|---------|---------|-----------------|
| H1 | `nav-badges` : Quotations + PurchaseOrders live à **chaque page** (cache 120 s) | `app/api/nav-badges/route.ts:77,95` | TOUTE la nav |
| H2 | `getLotMaps` : scan **live de ~1500 réceptions** | `lib/lotResolver.ts:185` | Livraisons (lots), Bons de commande, création commande, `/api/lots/candidates` |
| H3 | `/api/livraisons` : Orders du jour + Items stock/calibre + CreditNotes live | `app/api/livraisons/route.ts:164,331,532` | Livraisons |
| H4 | `/api/bons-commande` : Quotations + Orders + Items calibre live | `app/api/bons-commande/route.ts:107,150,193` | Bons de commande |
| H5 | `/api/encours` : Invoices ouvertes live (PaidToDate/DocDueDate absents du miroir) | `app/api/encours/route.ts:121,128` | Encours / relance |
| H6 | Fiche article : Items + item-udfs live | `app/api/products/[id]/route.ts:98`, `app/api/sap/item-udfs/route.ts:38` | Fiche article |
| H7 | Sync POST déclenchés au **browse** (Stock 30 s, Console StockPanel) — redondants avec le cron | `components/products/ProductsTable.tsx:196,215,260` | Stock, Console |

### Trous de couverture miroir (agent B)
- **G1** Dispo par lot NON miroitée : `ProductBatch.quantity`/`warehouseCode` jamais écrits → tout passe par le scan live H2.
- **G2** Prix d'achat/tarif lus live (`lib/gerviPricing.ts:131`) — pas de colonne prix sur `Product`.
- **G3** Encours : `SapInvoice` sans `paidToDate`/`docDueDate`.
- **G4** Quotations (offres) : **aucun modèle** miroir.
- **G5** Réceptions listées live (`goods-receipts` GET) alors que `SapPurchaseDeliveryNote` existe.
- **G6** Détails commande/adresses BP lus live (`orderLots`, `clients/[id]/*-address`).
- **G7** Stock miroir limité aux entrepôts 000/01/R1.

Note : les écritures (POST/PATCH/Cancel vers `/api/sap/orders|goods-receipts|purchase-orders|invoices|credit-notes|assembly`) restent live par nature.

## Plan d'exécution (chantiers indépendants, chacun livrable seul)

### Chantier A — Badges de nav sans SAP  ⟶ *global, le plus rentable, faible risque*
- Nouveau modèle `SapQuotation` (+ `SapQuotationLine`), miroité par le cron `mirror` (incrémental `UpdateDate`, comme les autres).
- Compter les PurchaseOrders dues via un miroir PO (ou dériver du miroir existant).
- `nav-badges` `offresDueCount`/`poDueCount` → lecture Postgres. **Plus aucun appel SAP par page.**

### Chantier B — Disponibilité des lots depuis le miroir  ⟶ *le plus lourd, gros gain*
- Peupler `ProductBatch.quantity` + `warehouseCode` au cron `products` (fix G1) via `BatchNumberDetails` (qty en stock par lot/entrepôt).
- Réécrire `getLotMaps` pour lire `ProductBatch` + `SapPdnLine` du miroir au lieu du scan live 1500 PDN.
- Gagne Livraisons (lots), Bons de commande, création commande, `/api/lots/candidates`.

### Chantier C — Livraisons & Bons de commande servis par le miroir
- `/api/livraisons` : Orders du jour ← `SapOrder` ; stock ← `ProductStock` ; calibre ← `Product` ; avoirs ← `SapCreditNote`.
- `/api/bons-commande` : Quotations ← miroir (A) ; Orders ← `SapOrder` ; calibre ← `Product`.

### Chantier D — Écriture write-through
- Chaque écriture SAP upsert immédiatement la ligne `Sap*` (order/PDN/facture/avoir/quotation) → UI fraîche sans relire SAP ni attendre le cron.

### Chantier E — Encours depuis le miroir
- Ajouter `paidToDate`, `docDueDate` à `SapInvoice` ; miroiter. `/api/encours` lit le miroir.

### Chantier F — Fiche article miroir + suppression des sync au browse
- Fiche article ← `Product` (+ UDF miroités). Retirer/étrangler les POST de sync déclenchés au chargement de Stock/Console (le cron couvre déjà).

## Ordre recommandé
A (global, sûr) → B (grosse douleur lots) → C (livraisons/BC) → D (fraîcheur) → E → F.
A+B+C+D couvrent l'essentiel de la lenteur ressentie.

## Garde-fous
- Migrations Prisma additives (nouvelles colonnes/tables), jamais destructives.
- Chaque chantier : tsc + vitest + build avant déploiement, rollback tag dispo.
- Le cron `mirror` réchauffe déjà `warmAccueil`/`warmLotMaps` : on bascule ces
  caches vers des tables persistées, pas seulement mémoire.
