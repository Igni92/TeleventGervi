# TODO — Audit TeleVent (suivi)

> Établi à partir de l'audit complet du 16/06/2026 (console, stats/pilotage, imports,
> sécurité, données base de test, simulation 1 mois, rendu navigateur réel).
> Sévérité : 🔴 Bloquant/Critique · 🟠 Majeur/Élevé · 🟡 Mineur · ℹ️ Info.
> Effort : ⚡ quick win · 🛠️ chantier.
> Cases cochées = fait et vérifié (`tsc` 0 / `lint` 0 / `vitest` 220 verts / rendu OK).

---

## ✅ FAIT (branche `claude/practical-pasteur-58wk4g`)

### Lot 1 — Sécurité fondations
- [x] 🔴 **RLS activé sur 45/45 tables** (deny-all public). PostgREST anon/authenticated bloqué ; Prisma intact.
- [x] 🔴 **IDOR `/api/sap/orders`** (POST / cancel / [docEntry] / invoices/[docEntry]) → scope.
- [x] 🟠 **`/api/sap/environment` POST** + **`/api/clients/[id]` PUT** (commercial admin) + **delivery-modes/[modeId]** (appartenance).
- [x] 🟠 **Next.js 14.2.18 → 14.2.35** (CVE-2025-29927).

### Lot 2 — Marge
- [x] 🟠 **Marge BRUTE % unifiée** sur le CA produit NET (`lib/margin.grossMarginPct`), libellés corrigés, tests.

### Lot 3 — Sécurité (gating métier)
- [x] 🟠 `requireAdmin` sur `/api/sap/sync/{mirror,backfill,products,client-groups}`, Promotions, Transporteurs.
- [x] 🟠 **Masquage marges/COGS aux non-admins** (assembly, fabrication, bom). Recettes laissées ouvertes (choix métier).
- [x] 🟠 **`/api/temp-assignments`** : reprise réservée aux clients d'un commercial **absent ce jour**.
- [x] 🟡 `/api/clients` POST (commercial = créateur), incidents (session), contacts (appartenance).

### Lot 4 — Pilotage perf + UX
- [x] 🟠 **N+1** tops (COUNT DISTINCT) · **monthDrilldown** ciblé · **états erreur/chargement** écrans 1 & 2.

### Lot 5 — Imports
- [x] 🟠 **CSV** parser RFC4180 + encodage UTF-8/Latin1 · **import** transaction + borne 10000 · **full-reset** retours fournisseurs · **sapb1** retry réseau.

### Lot 6 — Console / fuseau / DB / UX sync
- [x] 🟠 **Fuseau Europe/Paris** cohérent (console, présence, reprise, onglet Aujourd'hui), testé.
- [x] 🟠 **consoleSync** purge PII à la fermeture · **ClientDeliveryMode** `@@unique` + ON CONFLICT.
- [x] 🟠 **Fix sync stock 30 s** (auto-rattrapage du curseur) + **claim atomique** du throttle delta.
- [x] 🟠 **Hub unique Paramètres › Données · SAP** (boutons regroupés ; capture validée).

### Lot 7 — Sécurité jeton, console UX, pilotage cleanup
- [x] 🟠 **Jeton Graph hors session client** : reste dans le JWT chiffré, relu serveur via `getToken()` ; non bloquant (rappel créé même sans jeton).
- [x] 🟠 **Console** : badge « à couvrir » cohérent (reprise réelle d'un absent, plus l'account manager) ; `callNote` persistée par client ; warning `forwardRef` corrigé.
- [x] 🟠 **Pilotage** : `viewAs` propagé à l'écran 2 ; route `/api/pilotage/kpi` orpheline + ~155 lignes de code mort supprimées ; Donut/BarList gèrent les marges négatives.
- [x] 🟡 **`/api/clients/resolve`** : normalisation casse (MAJUSCULES).
- [x] 🟠 **Périmètre CRM pilotage** (décision métier validée) : aligné sur **commercial OU vendeur** — KPI CRM non-admin via `clientIdsForOwner` (union raw SQL, vendeur inclus) ; admin = vision globale inchangée.

### Lot 8 — UI/UX & migration Next 16
- [x] 🟠 **Événements** : système pur `lib/events` (fenêtre ±1 semaine, passage d'année, testé), bannière `EventsBanner` en haut à gauche **en remplacement du ruban promos** (doublon). Bandeau promo principal conservé.
- [x] 🟠 **Moins d'onglets** : accueil épuré (grille « Modules » retirée = doublon de la nav) ; sidebar 2 niveaux (cœur *Télévente* + *Stock & stats* visibles, groupe **Gestion repliable**) ; code mort supprimé (`Navbar`, `PromoRibbon`, `ModuleGrid`).
- [x] 🟠 **Mapping commerciaux** : `UserCommercial` = AG/JMG/MM uniquement (CM & autres absents — vérifié en base). « Televent first » : stats par commercial reportées.
- [x] 🟠 **Migration Next 14.2.35 → Next 16.2.9 / React 19.2.7** : `next build` vert (51 pages), `tsc` 0, `eslint` (flat config) 0, `vitest` 121 verts (projet). APIs request async (params/searchParams), `middleware.ts → proxy.ts`, overrides @visx React 19, next-auth beta.31 compatible.
  - ⚠️ **À valider en runtime réel** (non testable ici sans DB/SSO) : flux OAuth Microsoft + `proxy.ts` (redirections login) ; rendu graphes `@visx` / carte `maplibre` sous React 19.

---

## 🟠 RESTE — nécessite TA décision ou des DONNÉES (hors code pur)

- [ ] 🟠 🛠️ **Données métier** (côté SAP/process, pas du code) :
  - ✅ **Mapping** réconcilié : `UserCommercial` = AG/JMG/MM seulement (CM & autres retirés). Reste : **compléter `vendeur`** sur les fiches clients (sinon file console vide hors MM) — donnée SAP/process.
  - 280/339 sans `type` ; 5,1 % CA produit sans `lineCost` ; 19 produits sans poids ; `ProductBatch` vide (DLC/FIFO).
- [x] ✅ Migration **Next 16 / React 19** faite (cf. Lot 8) — reste à valider en runtime (auth/SSO Microsoft, rendu visx).
- [ ] 🟡 🛠️ **RGPD** : durée de conservation `AppelLog`, journalisation accès PII, registre sous-traitants (Supabase UE, Microsoft, SAP), base légale + droit d'accès/effacement.

---

## 🟡 MINORES restantes (faible valeur / nuancées)

- [ ] 🟡 **`buildMonthlyTrend`** : courbe quasi vide en janvier (peu de mois N) — comportement attendu, à polir éventuellement.
- [ ] 🟡 **Δ N (en cours) vs N-1 (complète)** : libellé potentiellement trompeur (préciser « à date »).
- [ ] 🟡 **`familyOf`** vs CTE (repli `itemDescription`) — qualité données, nuancé.
- [ ] 🟡 **`isDotVariant`** (suffixe `.` uniquement) ; **delta** : annulation de doc seule non détectée (limite V1).
- [ ] 🟡 Duplication `BLDialog.tsx` vs `Ecran2Order.tsx` → hook commun (dette technique).

---

## 🏆 Synthèse

Le **backlog code actionnable et sûr est traité** (lots 1→8 : sécurité, marges, perf, imports, fuseau, sync stock, jeton Graph, UX console/accueil/sidebar, événements, **migration Next 16 / React 19**). Sur la branche : `next build` vert · `tsc` 0 · `eslint` 0 · `vitest` 121 verts (périmètre projet).

Ce qui reste demande **des données/process** (compléter `vendeur` sur les clients ; `type`/poids/lots), une **validation runtime** de la migration (auth SSO Microsoft, rendu visx sous React 19), ou un **chantier planifié** (RGPD). Je n'y touche pas à l'aveugle pour ne pas dégrader.
