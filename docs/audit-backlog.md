# Backlog d'audit TeleVent — lots restants (post Lots 1→10)

> Issu de l'audit multi-axes relancé en juin 2026 (cf. `docs/audit-prompt.md`).
> **Lots 1→5** (sécurité de base, rôle admin, « voir comme », objectifs CA) et
> **Lots 6→11** (ci-dessous, déjà mergés) sont faits. Ce fichier liste ce qui
> **reste à faire** : chaque item est une spec actionnable, mais nécessite une
> **décision produit/archi** ou une **validation sur données réelles** — d'où le
> non-traitement en autonomie. Format : `chemin:ligne` · Sévérité · Effort.

## Déjà livrés (rappel)
- **Lot 6** Sécurité : `requireAdmin` (environment/backfill/mirror+cron), anti-IDOR
  (`cardCodeInScope`/`clientInScope`) sur orders/invoices, en-têtes de sécurité.
- **Lot 7** Perf : cache TTL 120 s des agrégats cockpit (kpi/tops/activity/actions).
- **Lot 8** Marketing : `PromoBanner` sur `/plan-appel`.
- **Lot 9** Lisibilité : « Volume HT »→« CA HT BL », « coût SAP »→« coût d'entrée ».
- **Lot 11** A11y : `focus-visible:` cohérent (select, dialog).

---

## A. Cohérence des chiffres (financier — VALIDER la définition voulue)
> Changent des montants/classements que le patron voit. À trancher puis coder
> AVEC un test `lib/pilotage.test.ts` + validation sur données réelles.

1. **Top clients en CA brut** — `lib/pilotage.ts:289` · Majeur · quick win.
   `ca = _sum.docTotal` (factures, **avoirs non déduits**) alors que `margin`
   utilise déjà `realMarginByKey` (net) et le KPI à côté est en CA net. Répliquer
   le pattern de `topSuppliers` (PDN − retours) : grouper `SapCreditNote` par
   `cardCode`, netter, **re-classer** sur le net, `take(limit)`.
2. **Base de la marge % incohérente écran 1 vs écran 2** — `lib/pilotage.ts:366,373`
   (aggregateActivity) vs `:111` (aggregateKpi) · Majeur · quick win.
   Écran 1 : `marginPct = margin / volume` avec `volume = DocTotal` (services
   inclus) ; Écran 2 : divise par `caProductNet` (base produit). Ajouter une base
   « CA produit net » à `ActivityBucket` et diviser la marge par celle-ci.
3. **Panier moyen biaisé par les avoirs** — `lib/pilotage.ts:171` · Mineur.
   Numérateur net (− avoirs), dénominateur = nb factures seules. Documenter ou
   diviser le CA **brut** par le nb de factures.

## B. Périmètre & modèle de données (ARCHI — décision structurante)
4. **Deux définitions de périmètre incompatibles** — `lib/permissions.ts:131`
   (CRM = `Client.commercial/vendeur`) vs `lib/pilotage.ts` slpWhere (= slpName des
   documents SAP) · Majeur · chantier. Cockpit, objectifs et « à relancer » ne
   parlent pas du même portefeuille. Choisir une **clé unique** (idéalement le
   portefeuille `Client.commercial/vendeur`) et documenter le mapping.
5. **Multi-CardCode non modélisé** — `prisma/schema.prisma:88` (`Client.code @unique`)
   · Majeur · chantier. Un client = 1 seul CardCode → CA/encours/insights éclatés
   pour les clients multi-comptes (siège + PDV, EXPORT/GMS). Table de liaison
   `1 Client ↔ N CardCode` avant toute consolidation.

## C. Données métier à exposer (FEATURES)
6. **Limite de crédit / encours invisible** — donnée lue à la commande
   (`app/api/sap/orders/route.ts:~375`, `CreditLimit`/`CurrentAccountBalance`) mais
   absente de `/encours`, plan-appel, fiche client · Bloquant · chantier moyen.
   Exposer `CreditLimit` + ratio encours/limite (badge couleur) sur les écrans de
   travail.
7. **Produits récurrents / hit-rate par client** — fiche client + cockpit ·
   Bloquant · chantier. Aucun écran ne montre les produits régulièrement commandés
   ni leur fréquence (LE levier d'un télévendeur). `lib/insights.ts` calcule déjà
   heure/jour/intervalle — ajouter le mix produit.
8. **`managedUnitOf`/`unitsSold` = code mort** — `lib/cogs.ts:170-199` · Majeur ·
   chantier. La marge €/unité de **gestion** (règle « jamais €/colis pour un kg »)
   est codée, **non testée, appelée nulle part**. Brancher dans la fiche
   produit/client (+ test `lib/cogs.test.ts`) OU retirer.
9. **Couverture poids kg silencieuse** — `lib/pilotage.ts:~389` (`COALESCE(salesUnitWeight,0)`)
   · Majeur · quick win. Un article sans `salesUnitWeight` contribue 0 kg sans
   signal (contrairement à `marginCoverage`). Exposer une « couverture poids ».
10. **Rupture prochaine non signalée avant l'appel** — pilotage/plan-appel · Mineur.
    La logique lot/découvert est correcte (`lib/lotResolver.ts`) mais aucun badge
    rupture sur le top clients/produits.

## D. UI / UX (VALIDATION VISUELLE requise)
11. **Dé-duplication des fetchs promos** — `PromoBanner.tsx:68-71` + `PromoRibbon.tsx:43`
    · Majeur · quick win. `/api/notifications` est un **superset** de
    `/api/promos?active=1` → sur `/accueil` (2 composants) = 4 requêtes pour 1
    besoin. Mapper `notification → ActivePromo` et ne garder qu'un fetch.
12. **Ruban promo invisible sur mobile** — `PromoRibbon.tsx:80` (`hidden md:block`)
    · Majeur · quick win. Cible vendeurs mobiles → prévoir une variante mobile
    (mini-bandeau), pas un simple retrait du `hidden` (corner element).
13. **PromoBanner absent du dashboard** — cockpit dual-écran · Majeur · quick win
    (placement à designer dans la grille de tuiles).
14. **Contraste sous WCAG AA** — `ClientTable.tsx:102,116,501-522` (`text-slate-300`,
    `text-muted-foreground/40`) · Majeur · chantier. Remonter à `/70` minimum.
15. **Filtres non responsives** — `ClientTable.tsx:340,353,366` (selects `w-[130px]`
    sans `sm:`) · Majeur · quick win. `w-full sm:w-[Npx]` + `flex-wrap`.
16. **Skeleton manquant pendant re-sync** — `Ecran2Order.tsx:~608`, `StockPanel.tsx:80`
    · Majeur · chantier. Voile/skeleton sur `isFetching` (table « gelée » sinon).
17. **Onglet « Comptabilité » mal nommé** — `components/clients/ClientTabs.tsx:35`
    · Majeur · quick win (décision : renommer « Contacts & livraison » si l'onglet
    reste logistique, ou y mettre l'encours/limite réels).

## E. Performance (chantiers)
18. **N+1 `topSalespersonsOrder`** — `lib/pilotage.ts:~458` · Majeur · quick win.
    Boucle `findMany(distinct cardCode)` par commercial → un seul
    `COUNT(DISTINCT cardCode)` groupé par `slpName` (raw SQL). À tester.
19. **N+1 transporteurs** — `lib/clientCarriers.ts:227,252` (`ensureCarrier` en
    boucle) · Majeur · chantier. Batch `findMany({sapValue:{in:codes}})` +
    `createMany` ; remplacer `findFirst+create` par `upsert`.
20. **Anti-stampede cache** — `lib/ttlCache.ts:19` · Mineur · chantier. Mémoriser la
    Promise en vol (pas seulement la valeur) pour éviter N `compute()` au cache miss.
21. **Refactor `CallConsole`** (~2170 lignes, tout client) — `components/console/CallConsole.tsx`
    · Majeur · chantier. Découper en sous-composants mémoïsés.

## F. Cyber / RGPD (CHANTIERS structurants + décisions)
22. **Next.js vulnérable** — `next@14.2.18` · **Bloquant** · chantier. GHSA-f82v-jwr5-mffw
    « Authorization Bypass in Next.js Middleware » (l'authZ des pages repose sur
    `middleware.ts`). Monter à une version corrigée (breaking, à planifier/tester).
23. **`npm ci` cassé** — `package-lock.json` désynchronisé de `package.json` ·
    Majeur · quick win. Régénérer le lockfile (review du diff) pour rétablir les
    installs reproductibles en CI/déploiement.
24. **RGPD — traçabilité** — aucun journal d'accès/modif des PII (contacts, compta,
    appels) · Majeur · chantier (art. 30/32). Table d'audit.
25. **RGPD — rétention** — aucune politique ni purge (`AppelLog`, `Contact`,
    incidents conservés sans limite) · Majeur · chantier (art. 5.1.e).
26. **RGPD — droit d'accès/effacement/export** — aucune route dédiée · Majeur ·
    chantier (art. 15/17/20). Endpoint admin export/suppression par personne.
27. **Région Supabase UE** — à confirmer côté console (projet `iokraagfwrpklyhgwknv`)
    · quick win. Sinon transfert hors UE à encadrer.
28. **Routes recettes/nomenclatures globales sans `requireAdmin`** —
    `products/bom` PUT, `fabrication/recipes` PUT/DELETE, `production/recipes` PUT ·
    Majeur · quick win **après confirmation** que ce ne sont pas des actions
    opérationnelles entrepôt (sinon laisser `auth()`).
