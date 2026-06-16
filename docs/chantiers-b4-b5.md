# Chantiers structurants B4 & B5 — plan d'implémentation

> Issu de l'audit. **Plan uniquement** (pas de code appliqué) : ces deux chantiers
> touchent l'architecture / le schéma et doivent être validés avant exécution.
> Premier pas sûr et réversible décrit pour chacun.

---

## B4 — Unifier « documents `slpName` » vs « portefeuille `Client.commercial`/`vendeur` »

### Constat : même vocabulaire (trigrammes MM/JMG/AG), deux sources de vérité disjointes
- **Source A — `slpName` document** : snapshot SAP `SalesPersonCode` figé sur chaque
  pièce (`SapInvoice.slpName`, `SapOrder.slpName`, `SapCreditNote.slpName`) = « qui a porté la vente ».
- **Source B — assignation portefeuille** : `Client.commercial` (account manager,
  commissionné) et `Client.vendeur` (dérivé du dernier BL, `app/api/clients/sync-vendeurs/route.ts`).
- **Aucune table de correspondance** : le pont est purement nominal (même chaîne).
  Seul mapping formel : `email → slpName` (`UserCommercial`, `lib/permissions.ts`) + hardcode `lib/salespeople.ts`.

### Divergences (chemin:ligne + impact)
1. `app/api/commerciaux/sap/route.ts` — dans la **même réponse** : `caNetYtd` (Σ `SapInvoice.docTotal`
   par `slpName` document) vs `caPortefeuilleYtd` (Σ par `Client.commercial`). L'objectif
   (`CommercialObjectif`, keyé `slpName`) est comparé au **portefeuille**, mais la tuile CA
   affiche le **document** → « mon CA » ≠ « mon réalisé objectif ».
2. `lib/pilotage.ts` — incohérence intra-module : KPI CA/marge filtrés `slpName` document,
   activité CRM (`crmActivity`, `clientsToRelance`) filtrée `Client.commercial` → dénominateurs incohérents.
3. `clientOwnerWhere` (`lib/pilotage.ts`) ignore volontairement `vendeur`, alors que
   `permissions.ts` / `plan-appel` / `encours` l'incluent → KPI CRM sous-comptés.

### Stratégie (ne PAS fusionner — les deux notions sont métier-distinctes)
- **Étape 1 — canonisation** : table `SalesPerson { slpName @id, code, email, active }`
  (remplace le hardcode `lib/salespeople.ts`), alimentée par le miroir SAP.
- **Étape 2 — vue réconciliée** : exposer **les deux chiffres nommés** partout où un seul
  est montré (`caDocuments` = « ce que j'ai porté » vs `caPortefeuille` = « mes comptes »)
  + delta + drill-down « factures hors portefeuille ». Rend la divergence *visible*.
- **Étape 3 — alignement objectif** : décider la base de l'objectif (recommandé : portefeuille,
  car commissionné) et étiqueter le CA affiché en conséquence.
- **Étape 4 — cohérence vendeur** : aligner `clientOwnerWhere` sur le reste (inclure `vendeur`,
  ou paramétrer commercial vs commercial∪vendeur selon le KPI).

### Fichiers : `lib/salespeople.ts`, `lib/sapMirror.ts`, `prisma/schema.prisma`,
`app/api/commerciaux/sap/route.ts`, `app/commerciaux/[slp]/*`, `components/pilotage/*`, `lib/pilotage.ts`.

### Risques : inclure `vendeur` augmente les compteurs CRM (rupture de continuité historique) → flag/afficher les deux.
### Premier pas sûr (additif, zéro calcul changé) : exposer `caDocumentsYtd` **à côté** de
`caPortefeuilleYtd` dans `commerciaux/sap` + libellés explicites + delta dans la fiche commercial.

---

## B5 — Multi-CardCode (1 client logique ↔ N comptes SAP)

### Modèle actuel
- `Client.code` (`@unique`) ↔ `<doc>.cardCode` par **convention** (jamais une vraie FK Prisma).
- **Multi-cardCode déjà amorcé** : `ClientDeliveryMode.sapCardCode` (« plusieurs codes SAP pour
  un même client TeleVent »), mais consommé **seulement** par `comportement-yoy` et `habits`
  (qui assemblent `[client.code, ...deliveryModes.sapCardCode]`). Pilotage, encours, scoping,
  sync-vendeurs **ignorent** les codes secondaires → fuites/pertes de lignes.

### Schéma proposé (Variante A recommandée — réutilise l'intention existante)
```prisma
model ClientCardCode {
  id        String  @id @default(cuid())
  clientId  String
  client    Client  @relation(fields: [clientId], references: [id], onDelete: Cascade)
  cardCode  String  @unique   // un cardCode SAP = 1 seul client logique
  isPrimary Boolean @default(false)
  source    String?           // "principal" | "deliveryMode" | "manuel"
  createdAt DateTime @default(now())
  @@index([clientId])
}
```
Backfill non destructif : `(Client.code, isPrimary=true)` + tous les `ClientDeliveryMode.sapCardCode`.
Helper central `cardCodesForClient(clientId): string[]` (+ inverse), **avec fallback `[client.code]`** si table vide.

### Requêtes à adapter (ordre)
1. Backfill + helper (no-op fonctionnel). 2. Fiche client (`comportement-yoy`, `habits`) → helper.
3. **Scoping droits** (`permissions.ts`, `encours`, `clients`) : `WHERE code IN (cardCodes)` — *priorité sécurité*.
4. Pilotage / top clients (agréger par client logique, sinon doublons). 5. Encours (total client). 6. sync-vendeurs.

### Risques : double comptage (empêché par `cardCode @unique`) ; baisse du compteur « clients actifs »
après dé-doublonnage (attendu, documenter) ; `prisma generate` EPERM → DDL raw + accès raw (pattern existant).
### Premier pas sûr : créer `ClientCardCode` (DDL additive) + helper avec fallback, brancher **uniquement**
`comportement-yoy` et `habits` (qui font déjà ce regroupement à la main) → zéro changement de résultat.

---

## C8 — `managedUnitOf` (résolu)
**Retiré** (code mort, zéro consommateur). Si la marge €/unité-de-gestion est souhaitée,
c'est un chantier à part (UI + agrégats) — voir l'historique git pour l'amorce.
