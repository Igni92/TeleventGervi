# Brief de passation — Système de cotation automatique par client (TeleVent / Gervifrais)

> **À lire par un autre Claude Code.** Ce document est auto-suffisant : il contient tout
> le savoir métier + SAP nécessaire pour démarrer, même sans accès au repo TeleVent.
> Si tu as accès au repo principal, les fichiers cités en §9 sont la source de vérité.

---

## 1. Mission

Construire un **système de cotation automatique par client** : pour un client donné et une
liste d'articles, calculer le **prix de vente conseillé** (et, à terme, chiffrer une commande
complète : ports + encours). Le moteur de prix existe déjà côté TeleVent ; il s'agit de le
réutiliser / l'industrialiser dans le nouveau système.

## 2. Contexte métier

- **Gervifrais** = grossiste fruits & légumes (forte saisonnalité fraises / fruits rouges).
- Vente par **télévente** (au téléphone). Le commercial a besoin d'un **prix conseillé
  instantané, propre à chaque client**, car le tarif dépend du **groupe tarifaire du client**.
- Le prix conseillé est **indicatif** (aide à la saisie) : le prix réellement facturé reste
  libre / appliqué par SAP. Ne jamais présenter la cotation comme un prix figé.
- **Volume toujours en kg** chez TeleVent (`qty × poids_unitaire`), jamais en pièces.

## 3. Stack & accès

- ERP : **SAP Business One**, via le **Service Layer** (OData v4, HTTPS, port 50000, `/b1s/v1/`).
- App de référence : **Next.js (App Router) + Prisma + PostgreSQL**.
- Variables d'environnement attendues :

| Variable | Rôle |
|---|---|
| `SAP_B1_BASE_URL` | ex. `https://<hote>:50000/b1s/v1/` |
| `SAP_B1_COMPANY_DB` | base société (ex. `SBO_GERVIFRAIS`) |
| `SAP_B1_USERNAME` / `SAP_B1_PASSWORD` | identifiants Service Layer |
| `SAP_B1_TLS_INSECURE=1` | bypass TLS auto-signé — **dev uniquement** |

## 4. Données à récupérer dans SAP (entités OData)

| Donnée | Entité | Clé | Champs clés |
|---|---|---|---|
| **Prix d'achat** | `Items` | `ItemCode` | `ItemPrices` → `PriceList == 2` est le **PRIX D'ACHAT** |
| Attributs article | `Items` | | `ItemsGroupCode`, `U_GER_Marque`, `U_GER_CALIBRE`, `U_Pays`, `SalesUnitWeight` |
| **Groupes articles** | `ItemGroups` | `Number` | `GroupName` *(schéma Number/GroupName !)* |
| **Clients** | `BusinessPartners` | `CardCode` | `CardName`, `GroupCode`, `SalesPersonCode`, `U_Actif` |
| **Groupes clients (tarif)** | `BusinessPartnerGroups` | `Code` | `Name`, **`U_MB_*` (coefs)**, `U_PORT_*`, `U_Limite`, `U_Plafond` *(schéma Code/Name !)* |
| Commerciaux | `SalesPersons` | `SalesEmployeeCode` | `SalesEmployeeName` |

## 5. La formule de cotation (le cœur)

```
PrixConseillé = round( PrixAchat × Coef , 2 décimales )

  PrixAchat = Items(code).ItemPrices[ PriceList == 2 ].Price
  Catégorie = mapping( Items(code).ItemsGroupCode )            # voir tableau ci-dessous
  Coef      = BusinessPartnerGroups(client.GroupCode).U_MB_<Catégorie>
              sinon  COEF_DEFAUT = 1.5
```

### Mapping groupe article → catégorie de coefficient

| Catégorie | Codes groupes articles | Champ coef (sur le groupe client) |
|---|---|---|
| Fraises | `101` | `U_MB_Fraises` *(+ paliers, voir ci-dessous)* |
| Fruits Rouges | `106` | `U_MB_Fruits_Rges` |
| Légumes | `113` | `U_MB_Legumes` |
| Fruits Préparés | `103` | `U_MB_Fruits_Prep` |
| Divers Fruits | `107`, `108`, `127` | `U_MB_Divers_Fruits` |
| Fruits Secs | `138` → `154` | `U_MB_Fruits_Secs` |
| Autres | (reste) | `U_MB_Autres` |
| Emballage (exclure) | `114` | — |

### Cas particulier Fraises — paliers par prix d'achat

| Prix d'achat (€) | Champ |
|---|---|
| `< 3` | `U_MB_Fraises_0_3` |
| `3 – 5` | `U_MB_Fraises_3_5` |
| `5 – 8` | `U_MB_Fraises_5_8` |
| `≥ 8` | `U_MB_Fraises_8_999` |

> ⚠️ Ces 4 champs paliers sont lus par le code mais **peuvent ne pas exister** sur la
> société SAP cible (absents de l'export des UDF). **Vérifie leur présence** ; à défaut,
> retomber sur `U_MB_Fraises`.

### Pseudo-code de bout en bout

```ts
// 1. groupe tarifaire du client
const bp = await sapGet(`BusinessPartners('${cardCode}')?$select=GroupCode`);
const groupCode = bp.GroupCode;

// 2. coefs du groupe (tous les U_MB_* + ports + limites)
const g = await sapGet(`BusinessPartnerGroups(${groupCode})`);

// 3. prix d'achat + groupe de chaque article
const r = await sapGet(
  `Items?$filter=ItemCode eq '${code}'&$select=ItemCode,ItemsGroupCode,ItemPrices`
);
const it = r.value[0];
const achat = it.ItemPrices.find(p => p.PriceList === 2)?.Price ?? null;
const cat = categoryFromGroupCode(it.ItemsGroupCode);   // §5

// 4. coefficient + prix conseillé
let coef = (cat === "Fraises" && achat != null)
  ? fraiseBand(g, achat) ?? g.U_MB_Fraises
  : g[`U_MB_${cat}`];
const finalCoef = coef ?? 1.5;                          // défaut
const prixConseille = achat != null
  ? Math.round(achat * finalCoef * 100) / 100
  : null;
```

## 6. Client Service Layer minimal (référence)

```ts
// Login → cookie de session réutilisable. NE PAS se reconnecter à chaque requête.
let cookie: string | null = null;

async function login() {
  const res = await fetch(`${BASE}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ CompanyDB: COMPANY, UserName: USER, Password: PASS }),
  });
  cookie = res.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
}

async function sapGet(path: string): Promise<any> {
  if (!cookie) await login();
  let res = await fetch(`${BASE}/${path}`, { headers: { Cookie: cookie! } });
  if (res.status === 401) { cookie = null; await login();   // session expirée (~30 min)
    res = await fetch(`${BASE}/${path}`, { headers: { Cookie: cookie! } }); }
  return res.json();
}
```

- Pagination : 500 lignes max par page (`Prefer: odata.maxpagesize=500`), suivre
  `@odata.nextLink` puis fallback `$skip/$top`.
- Échappement OData : doubler les apostrophes (`O'Brien` → `O''Brien`) et
  `encodeURIComponent` le `$filter`.

## 7. Frais de port & encours (pour chiffrer une commande complète)

- **Port** : si `BusinessPartners.U_Franco = 'O'`, ajouter le port du **groupe client**
  selon le **poids total kg** = `Σ(qty × SalesUnitWeight)` :

  | Poids (kg) | Champ |
  |---|---|
  | `< 15` | `U_PORT_INF_15KG` |
  | `16 – 23` | `U_PORT_16_23KG` |
  | `24 – 39` | `U_PORT_24_39KG` |
  | `40 – 80` | `U_PORT_40_80KG` |
  | `81 – 150` | `U_PORT_81_150KG` |

- **Encours** : limites `U_Limite` / `U_Plafond` (sur groupe ET client). Solde réel via
  factures ouvertes (`bost_Open`, `PaidToDate`, `DocDueDate`). À utiliser pour bloquer /
  avertir si la cotation dépasse le plafond.

## 8. Pièges spécifiques à cette base (checklist anti-perte-de-temps)

1. **`ItemGroups` = `Number`/`GroupName`** ; **`BusinessPartnerGroups` = `Code`/`Name`**. Schémas différents — ne pas confondre.
2. **`PriceList 2 = prix d'ACHAT`** (pas un prix de vente).
3. Les **UDF `U_*` ne reviennent que si listés explicitement dans `$select`**.
4. **Coef par défaut = 1.5** si le groupe client n'a pas de coef pour la catégorie.
5. **Classer par `groupCode`**, pas `groupName` (souvent null).
6. **Volume toujours en kg** (`qty × SalesUnitWeight`).
7. Entrepôts pertinents : **`000`, `01`, `R1`** ; `available = InStock − Committed`.
8. Exclure groupes parasites `100,104,105,111,112,117,121,126,128,130` et emballage `114`.
9. Marges « RUNGIS » négatives = **réalité SAP** (la marge réelle se lit via les coefs €/kg).
10. Lire la **référence sur PROD** ; réserver le TEST aux écritures d'essai.

## 9. Livrables suggérés

1. **Fonction pure** `coter(cardCode, lignes[]) → { lignes: [{code, prixAchat, coef, prixConseille, isDefault}], port, totalHT }` — réutilisable hors framework.
2. **Cache** des coefs par groupe client et des noms de groupes articles (TTL ~10 min) — éviter de re-tirer SAP à chaque ligne.
3. **Endpoint HTTP** `GET /cotation?cardCode=…&items=A,B,C`.
4. (Option) **Export CSV** de la grille complète groupes clients × catégories pour repérer les coefs manquants (→ tombent sur 1.5).
5. **Tests** sur quelques clients connus + articles fraises (pour valider les paliers).

## 10. Questions ouvertes à confirmer avec l'utilisateur

- Les **paliers fraises** `U_MB_Fraises_*` existent-ils sur la société SAP cible ?
- La cotation doit-elle **bloquer** au-delà du plafond d'encours, ou seulement **avertir** ?
- Faut-il intégrer les **frais de port** dès la v1, ou prix article seul d'abord ?
- Le système vit-il **dans le repo TeleVent** ou dans un **projet séparé** ?

## 11. Références dans le repo TeleVent (si accès)

| Sujet | Fichier |
|---|---|
| Doc de référence SAP complète | `docs/sap-cotation-reference.md` |
| Moteur de cotation (implémentation existante) | `lib/gerviPricing.ts` |
| Endpoint prix conseillé existant | `app/api/sap/prices/route.ts` |
| Client Service Layer (auth, pagination) | `lib/sapb1.ts` |
| Import clients + activation | `app/api/sap/clients/import/route.ts` |
| Miroir BP / groupes / commerciaux | `lib/sapMirror.ts` |
| Sync articles + stock | `app/api/sap/sync/products/route.ts` |
| Dictionnaire UDF (OITM/OCRD/OCRG) | `sap_scrape/sap_export/UserFieldsMD.csv` |
| Conversions unités / poids | `lib/gervifrais-calc.ts` |
