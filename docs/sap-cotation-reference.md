# Référence SAP B1 — Système de cotation automatique par client

> Doc **spécifique à la base SAP TeleVent / Gervifrais** (pas du SAP générique).
> Tout ce qui suit est extrait du code de prod : `lib/sapb1.ts`, `lib/gerviPricing.ts`,
> `app/api/sap/**`, `lib/sapMirror.ts`, et l'export `sap_scrape/sap_export/UserFieldsMD.csv`.
>
> Objectif : récupérer **prix, groupes clients, clients, articles, groupes articles** et
> tout ce qui sert à calculer une cotation. À jour au 2026-06-11.

---

## 1. Connexion au Service Layer

Tout passe par le **SAP B1 Service Layer** (OData v4, HTTPS), encapsulé dans `lib/sapb1.ts`.

### Variables d'environnement

| Variable | Rôle |
|---|---|
| `SAP_B1_BASE_URL` | URL du Service Layer, ex. `https://<hote>:50000/b1s/v1/` |
| `SAP_B1_COMPANY_DB` | Base société PROD (ex. `SBO_GERVIFRAIS`) |
| `SAP_B1_USERNAME` / `SAP_B1_PASSWORD` | Identifiants Service Layer |
| `SAP_B1_BASE_URL_TEST` / `SAP_B1_COMPANY_DB_TEST` / `..._USERNAME_TEST` / `..._PASSWORD_TEST` | Société TEST (bascule via le bouton navbar). Seul `SAP_B1_COMPANY_DB_TEST` est requis pour activer le test, le reste retombe sur PROD. |
| `SAP_B1_TLS_INSECURE=1` | Bypass TLS auto-signé (**dev uniquement**) |

### Cycle d'authentification

```
POST {BASE}/Login
  body: { "CompanyDB": "...", "UserName": "...", "Password": "..." }
  → 200 + header Set-Cookie: B1SESSION=...; ROUTEID=...
```

- Le cookie de session est mis en cache **en mémoire** (par environnement prod/test).
- Session **expirée après ~30 min d'inactivité** → le client renvoie `401`, on **re-login automatiquement** et on rejoue l'appel une fois.
- `loginInflight` coalesce les logins concurrents (un seul login en vol à la fois).
- ⚠️ Pour ton système parallèle : **réutilise une session**, ne fais pas un Login par requête (SAP limite le nombre de sessions concurrentes).

### Pagination OData

Le Service Layer pagine à **500 lignes max** (`Prefer: odata.maxpagesize=500`).
Deux helpers dans `lib/sapb1.ts` :

- `sap.getAll<T>(path)` — séquentiel, suit `@odata.nextLink` puis fallback `$skip/$top`.
- `sap.getAllParallel<T>(basePath, countPath)` — récupère le `$count` puis tire **toutes les pages en parallèle** (~3-5× plus rapide pour les grosses collections : Items, BusinessPartners).

```ts
import { sap } from "@/lib/sapb1";

// Lecture de référence → toujours forcer l'env PROD (le test n'est pas fiable)
const items = await sap.getAll<SapItem>(
  "Items?$select=ItemCode,ItemName&$filter=Valid eq 'tYES'",
  { env: "prod" },
);
```

> **Règle d'or de la base TeleVent** : toutes les **lectures de référence** (prix, stock,
> clients, groupes) sont forcées sur `env: "prod"`. Le test ne sert qu'aux écritures d'essai.

---

## 2. Entités OData utiles (récapitulatif)

| Besoin | Entité Service Layer | Clé | Champs notables |
|---|---|---|---|
| Articles | `Items` | `ItemCode` | `ItemsGroupCode`, `ItemPrices`, `U_GER_*`, unités, `ItemWarehouseInfoCollection` |
| Groupes articles | `ItemGroups` | `Number` | `GroupName` ⚠️ (≠ Code/Name) |
| Clients & fournisseurs | `BusinessPartners` | `CardCode` | `CardName`, `GroupCode`, `SalesPersonCode`, `U_*` |
| **Groupes clients** | `BusinessPartnerGroups` | `Code` | `Name` ⚠️, **`U_MB_*` (coefs cotation)**, `U_Limite`, `U_Plafond`, `U_PORT_*` |
| Commerciaux | `SalesPersons` | `SalesEmployeeCode` | `SalesEmployeeName` |
| Lots | `BatchNumberDetails` | — | `ItemCode`, `Batch`, dates |
| Prix d'achat par lot | `PurchaseDeliveryNotes` | `DocEntry` | `DocumentLines[].Price` + `BatchNumbers[]` |

> ⚠️ **Piège n°1 de ta base** : les deux « groupes » n'ont PAS le même schéma.
> - `ItemGroups` → champs **`Number`** + **`GroupName`**
> - `BusinessPartnerGroups` → champs **`Code`** + **`Name`**
>
> Inverser les deux est l'erreur historique qui laissait les `sapGroupName` vides (cf. `lib/sapMirror.ts:99`).

---

## 3. Articles — `Items`

### Requête type (telle qu'utilisée en sync)

```
GET Items
  ?$filter=Valid eq 'tYES' and Frozen eq 'tNO'
  &$select=ItemCode,ItemName,ItemsGroupCode,SalesUnit,SalesPackagingUnit,
           SalesQtyPerPackUnit,SalesUnitWeight,InventoryUOM,PurchaseUnit,
           ManageBatchNumbers,QuantityOnStock,ItemWarehouseInfoCollection,
           U_Pays,U_GER_Marque,U_GER_Det_Condt,U_GER_UVC,U_GER_NB_BARQ_COLIS
```

~1367 articles au total → ~425 actifs après filtre `Valid/Frozen`.

### Champs custom Gervifrais sur l'article (table SAP `OITM`)

| Champ Service Layer | Libellé SAP | Exemple | Usage cotation |
|---|---|---|---|
| `U_Pays` | Pays | `Belgique` | chip origine |
| `U_GER_Marque` | Marque | `Hoogstraten` | chip marque |
| `U_GER_CALIBRE` | Calibre | `3AEE` | chip calibre |
| `U_GER_Det_Condt` | Détail Condit. | `8x500g` | chip conditionnement |
| `U_GER_UVC` | Poids unitaire UVC | `500g` | fallback condi |
| `U_GER_NB_BARQ_COLIS` | Nb barquettes/colis | `8` | conversion colis↔pièce |
| `U_GER_NB_PIE_KG` | Nb pièces/kg | | conversion poids |
| `U_GER_Vente_Decouv` | Vente à découvert O/N | `N` | autorisation vente stock 0 |

> ⚠️ Les `U_*` **n'apparaissent que si tu les mets explicitement dans `$select`**.
> Sans `$select`, le Service Layer renvoie les champs standard mais souvent pas les UDF.

### Unités & conversions (logique métier TeleVent)

- `SalesUnit` (ex. `pie`), `SalesQtyPerPackUnit` (ex. 8 = pièces/colis), `SalesUnitWeight` (poids 1 pièce en kg, ex. 0.125).
- **Volume toujours en kg** chez TeleVent : `volume_kg = quantité × SalesUnitWeight`. Ne jamais raisonner en pièces pour les stats.
- `unitInfo()` dans `lib/gervifrais-calc.ts` calcule `packDivisor` / `displayUnit` / `priceUnit`.

### Stock par entrepôt

`ItemWarehouseInfoCollection[]` → on ne garde que **3 entrepôts** :

| Code | Sens |
|---|---|
| `000` | A/C – A/D |
| `01` | Stock physique |
| `R1` | Livraison J+1 (demain) |

`available = InStock − Committed` (par entrepôt).

### Prix de l'article — `ItemPrices`

`ItemPrices` est un tableau `[{ PriceList: number, Price: number }, ...]`.

> 🔑 **`PriceList = 2` = PRIX D'ACHAT** (`PURCHASE_PRICE_LIST` dans `lib/gerviPricing.ts`).
> C'est la base de toute la cotation.

```
GET Items?$filter=ItemCode eq 'FB4KA3'&$select=ItemCode,ItemsGroupCode,ItemPrices
→ ItemPrices: [{ PriceList: 1, Price: ... }, { PriceList: 2, Price: 4.20 }, ...]
```

---

## 4. Groupes articles — `ItemGroups`

```
GET ItemGroups?$select=Number,GroupName&$top=400
→ [{ Number: 101, GroupName: "Fraises" }, { Number: 106, GroupName: "Fruits Rges" }, ...]
```

### Mapping groupe article → **catégorie de coefficient** (clé de la cotation)

Les libellés des coefs côté groupe client donnent directement la correspondance :

| Catégorie cotation | Codes groupes articles | UDF coef côté groupe client |
|---|---|---|
| **Fraises** | `101` | `U_MB_Fraises` |
| **Fruits Rouges** | `106` | `U_MB_Fruits_Rges` |
| **Légumes** | `113` | `U_MB_Legumes` |
| **Fruits Préparés** | `103` | `U_MB_Fruits_Prep` |
| **Divers Fruits** | `107`, `108`, `127` | `U_MB_Divers_Fruits` |
| **Fruits Secs** | `138` à `154` | `U_MB_Fruits_Secs` |
| **Autres** | (reste) | `U_MB_Autres` |
| Emballage (exclu) | `114` | — |

Dans le code (`categoryFromGroupName`), la catégorie est déduite par **regex sur le nom**
du groupe (`/fraise/`, `/fruits rouges|framboise|myrtille/`, etc.). Tu peux aussi mapper
directement par **code** avec le tableau ci-dessus (plus robuste si les noms changent).

> Groupes « parasites » à filtrer (noms `.` `..` `...`) : `100,104,105,111,112,117,121,126,128,130`.

---

## 5. Clients — `BusinessPartners`

### Requête type (import clients)

```
GET BusinessPartners
  ?$select=CardCode,CardName,CardType,GroupCode,SalesPersonCode,EmailAddress,Phone1,Valid,UpdateDate,U_Actif
  &$filter=CardType eq 'cCustomer' and Frozen eq 'tNO'
```

- `CardType` : `cCustomer` (client) / `cSupplier` (fournisseur).
- `GroupCode` → clé de jointure vers `BusinessPartnerGroups` (= le tarif applicable).
- `SalesPersonCode` → résolu via `SalesPersons` pour le nom du commercial.
- `UpdateDate` → permet un pull **incrémental** (`UpdateDate gt <iso>`).

### Champs custom sur le client (table SAP `OCRD`)

| Champ | Libellé | Cotation / usage |
|---|---|---|
| `U_Actif` | Actif pour appel (`O`/`N`) | active la fiche en télévente |
| `U_Franco` | Transport à facturer (`O`/`N`) | applique ou non les frais de port |
| `U_GER_TRSPS` | Tournée simplifiée | transport |
| `U_Limite` / `U_Plafond` | (voir aussi groupe) | encours |
| `U_ComptaE` / `U_MailMail` | e-mails compta / facture | hors cotation |
| `U_DateDernLiv`, `U_DateAchat` | dernières dates | priorisation appel |

> Le nom du groupe client est souvent **null dans le miroir** → **classe par `groupCode`**,
> pas par `groupName` (cf. note `segments-groupcode-rungis-marges`).

---

## 6. Groupes clients — `BusinessPartnerGroups` (⭐ cœur de la cotation)

C'est ici que vivent les **coefficients de marge** et les **frais de port**.

```
GET BusinessPartnerGroups?$select=Code,Name      → liste (Code/Name !)
GET BusinessPartnerGroups(275)                    → un groupe avec tous ses U_*
```

### UDF du groupe client (table SAP `OCRG`)

| Champ Service Layer | Libellé SAP | Type | Rôle cotation |
|---|---|---|---|
| `U_MB_Fraises` | Coef Fraises (101) | float | coef × prix achat |
| `U_MB_Fruits_Rges` | Coef Fruits Rges (106) | float | coef |
| `U_MB_Legumes` | Coef Légumes (113) | float | coef |
| `U_MB_Fruits_Prep` | Coef Fruits Préparés (103) | float | coef |
| `U_MB_Divers_Fruits` | Coef Divers Fruits (107-108-127) | float | coef |
| `U_MB_Fruits_Secs` | Coef Fruits Secs (138→154) | float | coef |
| `U_MB_Autres` | Coef Autres | float | coef fallback catégorie |
| `U_Plafond` | Plafond | float | encours |
| `U_Limite` | Limite eng. | float | encours |
| `U_Marge` | Marge en euros | float | (info marge cible) |
| `U_Rungis` | Rungis (`O`/`N`) | alpha | segment Rungis (marges €/kg) |
| `U_PORT_INF_15KG` | Port < 15 kg | float | frais de port |
| `U_PORT_16_23KG` | Port 16-23 kg | float | frais de port |
| `U_PORT_24_39KG` | Port 24-39 kg | float | frais de port |
| `U_PORT_40_80KG` | Port 40-80 kg | float | frais de port |
| `U_PORT_81_150KG` | Port 81-150 kg | float | frais de port |

> Le code lit aussi des **paliers fraises** par prix d'achat : `U_MB_Fraises_0_3`,
> `U_MB_Fraises_3_5`, `U_MB_Fraises_5_8`, `U_MB_Fraises_8_999` (cf. `getBpGroupCoefs`).
> ⚠️ Ces 4 champs ne figurent pas dans l'export `UserFieldsMD.csv` actuel — **vérifie
> leur présence réelle sur ta société SAP** ; à défaut, le moteur retombe sur `U_MB_Fraises`.

---

## 7. Le moteur de cotation (formule complète)

Source : `lib/gerviPricing.ts`. **Prix conseillé indicatif** (le prix réel reste libre / appliqué par SAP).

```
PrixConseillé = round( PrixAchat × Coef , 2 décimales )

  PrixAchat = Items(<code>).ItemPrices[ PriceList == 2 ].Price
  Catégorie = mapping( Items(<code>).ItemsGroupCode )      # cf. §4
  Coef      = coefficient du groupe client pour cette catégorie
```

### Détermination du coefficient

1. **Catégorie = Fraises** et prix d'achat connu →
   palier `U_MB_Fraises_{0_3|3_5|5_8|8_999}` selon le prix d'achat,
   sinon `U_MB_Fraises`.
2. **Autre catégorie** → `U_MB_<Catégorie>` du groupe client.
3. **Aucun coef trouvé** → **défaut `1.5`** (`COEF_DEFAUT`), flag `isDefault = true`.

### Paliers fraises (par prix d'achat €)

| Prix achat | Champ groupe |
|---|---|
| `< 3` | `U_MB_Fraises_0_3` |
| `3 – 5` | `U_MB_Fraises_3_5` |
| `5 – 8` | `U_MB_Fraises_5_8` |
| `≥ 8` | `U_MB_Fraises_8_999` |

### Pseudo-code de bout en bout

```ts
// 1. Groupe client
const bp = await sap.get(`BusinessPartners('${cardCode}')?$select=GroupCode`, { env: "prod" });
const groupCode = bp.GroupCode;

// 2. Coefs du groupe
const g = await sap.get(`BusinessPartnerGroups(${groupCode})`, { env: "prod" });

// 3. Pour chaque article : prix d'achat + groupe article
const it = await sap.get(
  `Items?$filter=ItemCode eq '${code}'&$select=ItemCode,ItemsGroupCode,ItemPrices`,
  { env: "prod" },
);
const achat = it.value[0].ItemPrices.find(p => p.PriceList === 2)?.Price ?? null;
const cat   = categoryFromGroupCode(it.value[0].ItemsGroupCode);  // §4

// 4. Coef + prix
let coef = (cat === "Fraises" && achat != null)
  ? fraiseBand(g, achat) ?? g.U_MB_Fraises
  : g[`U_MB_${cat}`];
const finalCoef = coef ?? 1.5;
const prixConseille = achat != null ? Math.round(achat * finalCoef * 100) / 100 : null;
```

> Endpoint déjà prêt si tu veux réutiliser : **`GET /api/sap/prices?clientId=…&items=A,B,C`**
> (ou `?group=275&items=…`, ou `?cardCode=APLAI&items=…`). Renvoie
> `{ group, prices: { CODE: { prixAchat, coef, prixConseille, isDefault, marque, calibre, pays } } }`.
> Implémentation : `app/api/sap/prices/route.ts` + `getSuggestedPrices()`.

---

## 8. Frais de port (cotation « rendu »)

Si `U_Franco = 'O'` sur le client (transport à facturer), ajoute le port du **groupe client**
selon le **poids total de la commande en kg** :

| Poids commande (kg) | Champ |
|---|---|
| `< 15` | `U_PORT_INF_15KG` |
| `16 – 23` | `U_PORT_16_23KG` |
| `24 – 39` | `U_PORT_24_39KG` |
| `40 – 80` | `U_PORT_40_80KG` |
| `81 – 150` | `U_PORT_81_150KG` |

Poids = `Σ (quantité_pièces × SalesUnitWeight)`.

---

## 9. Encours / limites (garde-fou cotation)

Deux niveaux de limite : `U_Limite` / `U_Plafond` (sur le groupe **et** le client).
Le solde réel se calcule côté factures ouvertes (`bost_Open`, `PaidToDate`, `DocDueDate`) —
cf. `/api/encours`. À intégrer si la cotation doit bloquer/avertir au-delà du plafond.

---

## 10. Commerciaux — `SalesPersons`

```
GET SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName
```

Jointure : `BusinessPartners.SalesPersonCode → SalesEmployeeCode`.

---

## 11. Recettes OData prêtes à l'emploi

```http
### Tous les groupes clients avec leurs coefs (un appel par groupe pour les U_*)
GET BusinessPartnerGroups?$select=Code,Name

### Un groupe client complet (coefs + ports + limites)
GET BusinessPartnerGroups(275)

### Prix d'achat d'un lot d'articles
GET Items?$filter=(ItemCode eq 'FB4KA3' or ItemCode eq 'FB4FA2H')&$select=ItemCode,ItemsGroupCode,ItemPrices

### Clients actifs d'un commercial donné
GET BusinessPartners?$filter=CardType eq 'cCustomer' and Frozen eq 'tNO' and SalesPersonCode eq 12&$select=CardCode,CardName,GroupCode

### Pull incrémental clients (depuis un curseur)
GET BusinessPartners?$filter=CardType eq 'cCustomer' and UpdateDate gt 2026-06-01&$select=CardCode,CardName,GroupCode,UpdateDate

### Groupes articles
GET ItemGroups?$select=Number,GroupName&$top=400
```

> Échappement OData : double les apostrophes dans les valeurs (`O'Brien` → `O''Brien`),
> et `encodeURIComponent` le `$filter`.

---

## 12. Pièges spécifiques à ta base (checklist)

1. **`ItemGroups` = Number/GroupName** ; **`BusinessPartnerGroups` = Code/Name**. Ne pas confondre.
2. **`PriceList 2 = prix d'achat`** (base de tous les coefs).
3. **Coef par défaut = 1.5** quand le groupe client n'a pas de coef pour la catégorie.
4. Les **UDF `U_*` ne reviennent que si listés dans `$select`**.
5. **Classer par `groupCode`**, pas `groupName` (souvent null dans le miroir).
6. **Volume toujours en kg** (`qty × SalesUnitWeight`), jamais en pièces.
7. Entrepôts pertinents : **`000`, `01`, `R1`** uniquement ; `available = InStock − Committed`.
8. Groupes articles **parasites** (`100,104,105,111,112,117,121,126,128,130`) et **emballage `114`** à exclure.
9. **Marges RUNGIS négatives = réalité SAP** (la marge réelle se lit via les coefs €/kg, pas la marge ligne).
10. Toujours lire la **référence sur PROD** (`env: "prod"`), réserver le test aux écritures.
11. **Réutilise la session** Service Layer (ne pas Login par requête) ; gère le **401 → re-login**.

---

## 13. Fichiers de référence dans le repo

| Sujet | Fichier |
|---|---|
| Client Service Layer (auth, pagination, types) | `lib/sapb1.ts` |
| Moteur de cotation (formule, coefs, catégories) | `lib/gerviPricing.ts` |
| Endpoint prix conseillé | `app/api/sap/prices/route.ts` |
| Import clients + activation | `app/api/sap/clients/import/route.ts` |
| Miroir BP / groupes / commerciaux | `lib/sapMirror.ts`, `app/api/sap/sync/mirror/route.ts` |
| Sync articles + stock + lots | `app/api/sap/sync/products/route.ts` |
| Dictionnaire complet des UDF (OITM/OCRD/OCRG/…) | `sap_scrape/sap_export/UserFieldsMD.csv` |
| Conversions unités / poids | `lib/gervifrais-calc.ts` |
