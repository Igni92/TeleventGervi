# TODO — Audit TeleVent (suivi)

> Établi à partir de l'audit complet du 16/06/2026 (console, stats/pilotage, imports,
> sécurité, données base de test, simulation 1 mois, rendu navigateur réel).
> Sévérité : 🔴 Bloquant/Critique · 🟠 Majeur/Élevé · 🟡 Mineur · ℹ️ Info.
> Effort : ⚡ quick win · 🛠️ chantier.
> Cases cochées = fait et vérifié (`tsc` 0 / `lint` 0 / `vitest` 115 / rendu OK).

---

## ✅ FAIT (branche `claude/practical-pasteur-58wk4g`)

### Lot 1 — Sécurité fondations
- [x] 🔴 **RLS activé sur 45/45 tables** (migration `enable_rls_deny_all_public_tables`). PostgREST anon/authenticated bloqué ; Prisma intact. Rollback : `ALTER TABLE public."X" DISABLE ROW LEVEL SECURITY;`
- [x] 🔴 **IDOR `/api/sap/orders` POST / cancel / [docEntry] / invoices/[docEntry]** → `clientInScope`/`cardCodeInScope`.
- [x] 🟠 **`/api/sap/environment` POST** → `requireAdmin`.
- [x] 🟠 **`/api/clients/[id]` PUT** : `commercial` réservé admin. **delivery-modes/[modeId] PATCH** : contrainte `clientId`.
- [x] 🟠 **Next.js 14.2.18 → 14.2.35** (CVE-2025-29927 bypass middleware).

### Lot 2 — Marge
- [x] 🟠 **Marge BRUTE % unifiée** sur le CA produit NET partout (`lib/margin.grossMarginPct`), libellé « coût SAP » corrigé, tests.

### Lot 3 — Sécurité (gating choisi par le métier)
- [x] 🟠 **`requireAdmin`** sur `/api/sap/sync/{mirror,backfill,products,client-groups}` (delta & full-reset inchangés).
- [x] 🟠 **`requireAdmin`** sur Promotions (`/api/promos` POST + `[id]` PATCH/DELETE) et Transporteurs (`/api/carriers` POST).
- [x] 🟠 **Masquage marges/COGS aux non-admins** : `sap/assembly`, `fabrication/options`+`runs`, `products/bom` (prix de vente conservé). *(Recettes/nomenclatures laissées ouvertes — choix métier.)*
- [x] 🟠 **`/api/temp-assignments`** : reprise réservée aux clients d'un commercial **absent ce jour** (Presence), admin toujours OK.
- [x] 🟡 **`/api/clients` POST** (commercial forcé au créateur), **`/api/entrees/incidents`** (session exigée), **contacts/[contactId]** (appartenance client).

### Lot 4 — Pilotage perf + UX
- [x] 🟠 **N+1** `topSalespersons`/`topSalespersonsOrder` → COUNT(DISTINCT) GROUP BY (1 requête).
- [x] 🟠 **`monthDrilldown`** : catalogue restreint aux itemCode du mois.
- [x] 🟠 **États erreur + chargement** écrans 1 & 2 (plus de « — »/« backfill » pendant le fetch).

### Lot 5 — Imports
- [x] 🟠 **CSV** : parser RFC4180 (guillemets), encodage UTF-8/windows-1252, dédoublonnage.
- [x] 🟠 **`/api/clients/import`** : borne 10000 lignes, upserts par lots de 500 en transaction.
- [x] 🟠 **`full-reset`** : `SapPurchaseReturn` ajouté (truncate + pull).
- [x] 🟠 **`lib/sapb1.call`** : retry/backoff sur erreurs réseau + 502/503/504.

### Lot 6 — Console / fuseau / DB
- [x] 🟠 **Fuseau Europe/Paris** (`lib/paris-time`) appliqué de façon cohérente : console (file/stats/présence/reprise) + `/api/commerciaux` (écriture présence) + `/api/temp-assignments` + onglet « Aujourd'hui ». Tests été/hiver/DST.
- [x] 🟠 **consoleSync** : purge PII (tel/email/notes) du localStorage à la fermeture (`pagehide`). Double-écran préservé.
- [x] 🟠 **ClientDeliveryMode** `@@unique([clientId, sapCardCode])` (index créé en base) + `ON CONFLICT` dans foldDotVariant.

---

## 🔴 SÉCURITÉ — reste

- [ ] 🟠 🛠️ **Fuite jeton Graph** : `lib/auth.ts:45-49` expose l'`accessToken` Microsoft via `/api/auth/session` (navigateur). Le garder dans le JWT chiffré ; adapter `/api/reminders`. **Différé** : touche le flux rappels Outlook, à tester avec une vraie session Microsoft (non reproductible en sandbox).
- [ ] ℹ️ Migration **Next 15/16** (advisories DoS/cache-poisoning/SSRF résiduelles, fixées seulement en majeure) — chantier à planifier.

---

## 🧭 IMPORT / SYNC — refonte UX (demande métier)

- [ ] 🟠 🛠️ **Regrouper les boutons import/sync** dans UN seul panneau admin (Paramètres › Données · SAP) : import clients, resync stats (rare), etc. — « le moins de boutons possible ».
- [ ] 🟠 🛠️ **Sync stock 30 s « ne marche pas »** : auditer `StockPanel`/`/api/sap/sync/delta` (polling toutes les 30 s) — diagnostiquer pourquoi le stock ne se rafraîchit pas, et soit fiabiliser, soit passer en rafraîchissement à la demande. (Annulation de doc non détectée = limite connue V1.)
- [ ] 🟡 ⚡ **`isDotVariant`** : ne gère que le suffixe `.` ; parent gelé SAP → variante en doublon. Valider les conventions transporteur.
- [ ] 🟡 ⚡ **`clients/resolve`** : normaliser la casse (`toUpperCase`) — l'import stocke en MAJUSCULES.
- [ ] 🟡 ⚡ **delta** : throttle `lastTickAt` non atomique → 2 pulls SAP concurrents possibles (advisory lock).

---

## 📞 CONSOLE — reste

- [ ] 🟠 ⚡ **Badge « à couvrir »/`ownerAbsent`** (`CallConsole.tsx`) basé sur `commercial` alors que la file filtre sur `vendeur` → incohérent post-#18. Retirer ou rebrancher.
- [ ] 🟡 ⚡ **`callNote` perdue au refresh** : persister par client.
- [ ] 🟡 ⚡ **Pas d'optimistic update** (refetch complet après action).
- [ ] 🟡 ⚡ **`joursAppel` malformé** (`console/route.ts`) : exclusion silencieuse (NaN) → signaler.
- [ ] 🟡 🛠️ **Duplication** `BLDialog.tsx` vs `Ecran2Order.tsx` → hook commun.
- [ ] 🟡 ⚡ **Bug latent** : warning React `forwardRef` (`CallConsole.tsx:1363`).

---

## 📊 STATS / PILOTAGE — reste

- [ ] 🟡 ⚡ **`/dashboard/ecran2/page.tsx`** ne propage pas `viewAs` (impersonation dual-écran).
- [ ] 🟡 ⚡ **`/api/pilotage/kpi`** orphelin (heatmap/spark12m non consommés) → brancher ou supprimer.
- [ ] 🟡 ⚡ **`invoiceHeatmap`** non scopé → supprimer/scoper.
- [ ] 🟡 ⚡ **CRM scopé `commercial` seul** (`pilotage.ts` `clientOwnerWhere`) vs périmètre réel `commercial OU vendeur`.
- [ ] 🟡 ⚡ **Δ N (en cours) vs N-1 (complète)** trompeur ; **`buildMonthlyTrend`** courbe vide en janvier ; **`familyOf`** vs CTE (repli `itemDescription`).
- [ ] ℹ️ Fallback COGS « première EM postérieure » (`cogs.ts`) : exposer un 2ᵉ indicateur de couverture / documenter. Confirmer index `SapPdnLine.itemCode` + `SapPurchaseDeliveryNote.docDate`.

---

## 🗃️ DONNÉES & MÉTIER (côté données/process, hors code)

- [ ] 🟠 🛠️ **285/339 clients sans `vendeur`** → file console vide sauf MM (filtre vendeur strict, choix confirmé). Compléter le champ `vendeur` (process / `sync-vendeurs`).
- [ ] 🟠 🛠️ **Mapping ≠ SAP** : `CM` (80 % du CA) sans compte, `AG` sans activité. Réconcilier `UserCommercial` ↔ slpName réels.
- [ ] 🟡 ⚡ **280/339 sans `type`** (badges/segmentation vides) ; **5,1 % CA produit sans `lineCost`** (couverture marge) ; **19 produits sans poids** (volume kg).
- [ ] 🟡 ℹ️ **`ProductBatch` vide** (DLC/lots/fabrication FIFO non alimentés) ; 1 stock négatif ; 3 clients actifs sans tel ; factures futures 12/2026.

---

## 🎨 UX / RGPD — reste

- [ ] 🟡 ⚡ Donut géo/familles : `Math.max(0, value)` masque les marges négatives → signaler.
- [ ] 🟡 🛠️ **RGPD** : durée de conservation `AppelLog`, journalisation accès PII, registre sous-traitants (Supabase UE ✅, Microsoft, SAP), base légale + droit d'accès/effacement.

---

## 🏆 TOP priorités restantes

1. 🟠 🛠️ **Refonte panneau Données/Sync** (regrouper boutons) + diagnostic sync stock 30 s.
2. 🟠 🛠️ **Sortir l'`accessToken` Graph** de la session client (à tester avec session Microsoft).
3. 🟠 🛠️ **Données métier** : compléter `vendeur` + réconcilier mapping CM/AG (sinon console hors MM inutilisable).
4. 🟡 ⚡ **Console** : badge « à couvrir » cohérent, persistance `callNote`, fix forwardRef.
5. 🟡 ⚡ **Pilotage** : `viewAs` ecran2, route `kpi` orpheline, CRM scope vendeur.
6. 🟡 🛠️ **RGPD** : conservation/journalisation/registre.
