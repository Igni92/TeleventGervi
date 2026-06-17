# TODO — Audit TeleVent (suivi)

> Établi à partir de l'audit complet du 16/06/2026 (console, stats/pilotage, imports,
> sécurité, données base de test, simulation 1 mois, rendu navigateur réel).
> Sévérité : 🔴 Bloquant/Critique · 🟠 Majeur/Élevé · 🟡 Mineur · ℹ️ Info.
> Effort : ⚡ quick win · 🛠️ chantier.
> Cases cochées = fait et vérifié (`tsc` 0 / `lint` 0 / `vitest` 110 / rendu OK).

---

## ✅ FAIT (session du 16/06/2026, branche `claude/practical-pasteur-58wk4g`)

- [x] 🔴 **Base : RLS activé sur 45/45 tables publiques** (migration `enable_rls_deny_all_public_tables`). PostgREST anon/authenticated bloqué ; Prisma intact (rôle `postgres`, owner + bypassrls). Réversible : `ALTER TABLE public."X" DISABLE ROW LEVEL SECURITY;`
- [x] 🔴 **IDOR `/api/sap/orders` POST** → `clientInScope` (commit `9898f1a`).
- [x] 🔴 **IDOR `/api/sap/orders/cancel`**, **`/orders/[docEntry]` GET+PATCH**, **`/invoices/[docEntry]` GET** → `cardCodeInScope`.
- [x] 🟠 **`/api/sap/environment` POST** → `requireAdmin` (bascule prod/test).
- [x] 🟠 **`/api/clients/[id]` PUT** : champ `commercial` réservé admin (non-admin ne peut plus se réattribuer un client).
- [x] 🟠 **IDOR `/api/clients/[id]/delivery-modes/[modeId]` PATCH** → contrainte `clientId` au WHERE.
- [x] 🟠 **Next.js 14.2.18 → 14.2.35** : corrige CVE-2025-29927 (bypass middleware) (commit `ac11090`).
- [x] 🟠 **Marge BRUTE % unifiée** sur le CA produit NET partout (écran 1 + Tops alignés sur matrice/KPI) via `lib/margin.ts` (`grossMarginPct`), libellé « coût SAP » corrigé, tests ajoutés (commit `fda3e32`).

---

## 🔴 SÉCURITÉ — à finir

### Gardes `requireAdmin` (⚠️ confirmer qu'aucun cron/workflow non-admin ne les appelle avant d'appliquer ; **`delta` doit rester ouvert** aux commerciaux)
- [ ] 🟠 ⚡ `/api/sap/sync/mirror` (`route.ts:28`), `/sync/backfill` (`:33`), `/sync/products` (`:27`), `/sync/client-groups` (`:20`) → `requireAdmin`.
- [ ] 🟠 ⚡ `/api/promos` POST + `/api/promos/[id]` PATCH/DELETE → `requireAdmin`.
- [ ] 🟠 ⚡ `/api/products/bom` PUT, `/api/fabrication/recipes` PUT, `/api/production/recipes` PUT, `/api/carriers` POST → `requireAdmin`.

### Sur-exposition & autres contrôles d'accès
- [ ] 🟠 🛠️ **Fuite jeton Graph** : `lib/auth.ts:45-49` met l'`accessToken` Microsoft dans la session → exposé au navigateur via `/api/auth/session`. Le garder dans le JWT chiffré uniquement ; adapter `/api/reminders` pour lire le token côté serveur. (Touche le flux rappels Outlook → tester.)
- [ ] 🟠 🛠️ **COGS exposés aux commerciaux** : `/api/sap/assembly` (`:378-380` : totalCost/parentValue/margin + mouvements stock SAP sans admin), `/api/fabrication/options|runs`, `/api/products/bom` GET → gater admin ou retirer les champs coût pour non-admin.
- [ ] 🟠 ⚡ **`/api/temp-assignments` POST** : un commercial peut s'attribuer le portefeuille de n'importe qui (pas seulement un absent). Restreindre aux absents du jour + journaliser.
- [ ] 🟡 ⚡ **`/api/clients` POST** non scopé : tout commercial crée des clients globaux. Vérifier/limiter.
- [ ] 🟡 ⚡ **`/api/entrees/incidents` POST** : pas de contrôle d'appartenance du `docEntry`.
- [ ] 🟡 ⚡ **`/api/clients/[id]/contacts/[contactId]` PATCH/DELETE** : vérifier que `contactId` appartient bien à `params.id` (idem fix delivery-mode).
- [ ] ℹ️ Migration **Next 15/16** (advisories DoS/cache-poisoning/SSRF restantes, fixées seulement en majeure) — chantier à planifier.

---

## 📞 CONSOLE (module clé)

- [ ] 🟠 ⚡ **Fuseau horaire** : `/api/console/route.ts:22,146` (`now/getDay/setHours`) en heure **serveur (UTC)** alors que la France est UTC+2 → file & « appels du jour » faux entre 00h-02h Paris et aux bornes de mois. Forcer `Europe/Paris`.
- [ ] 🟠 🛠️ **`consoleSync.ts:48`** : fiche client (tel/email/notes) écrite **en clair dans localStorage**, persiste après fermeture (poste partagé = fuite). `sessionStorage` + purge à l'unmount.
- [ ] 🟠 ⚡ **Badge « à couvrir »/`ownerAbsent`** (`CallConsole.tsx:744`) basé sur `commercial` alors que la file filtre sur `vendeur` (résidu post-#18) → incohérent. Retirer ou rebrancher.
- [ ] 🟡 ⚡ **`callNote` perdue au refresh** (`CallConsole.tsx:114`) : persister la note d'appel par client (localStorage/session).
- [ ] 🟡 ⚡ **Pas d'optimistic update** : `fetchData()` complet après chaque action → latence + « saut » de sélection sur réseau lent.
- [ ] 🟡 ⚡ **`joursAppel` malformé** (`console/route.ts:147`) : `split(",").map(Number)` → `NaN`, client exclu silencieusement de la file sans alerte.
- [ ] 🟡 ⚡ **Admin sans slpName** (`console/route.ts:51`) → repli sur file globale (surcharge). Préférer un sélecteur « voir comme ».
- [ ] 🟡 ⚡ **Double-clic** : garder `onBL`/`onRappel`/`onSkip` par `disabled={actionLoading}`.
- [ ] 🟡 🛠️ **Duplication** `BLDialog.tsx` (~1k l.) vs `Ecran2Order.tsx` (logique prix/encours/split en double) → extraire un hook commun.
- [ ] 🟡 ⚡ **Bug latent** : warning React `forwardRef` sur `PopChild`/`QueueRow` (`CallConsole.tsx:1363`).

---

## 📊 STATS / PILOTAGE

- [ ] 🟠 🛠️ **N+1** : `topSalespersons` (`pilotage.ts:1066`) + `topSalespersonsOrder` (`:454`) bouclent un `findMany distinct` par commercial → 1 seul `GROUP BY … COUNT(DISTINCT)`.
- [ ] 🟠 🛠️ **`monthDrilldown` (`pilotage.ts:846`)** : `product.findMany()` global (catalogue entier) + lignes du mois rapatriées en JS → restreindre aux itemCode du mois / agréger en SQL.
- [ ] 🟠 ⚡ **États erreur/chargement** : `PilotageScreen1` ignore `err` (`usePilotageData.ts:80`) → écran figé sur « — » ; matrice affiche « Aucune donnée — lancer un backfill » pendant le fetch (faux négatif). Ajouter skeleton + retry.
- [ ] 🟡 ⚡ **`/dashboard/ecran2/page.tsx`** ne propage pas `viewAs` → impersonation incohérente en dual-écran.
- [ ] 🟡 ⚡ **`/api/pilotage/kpi`** (heatmap, spark12m) semble **orphelin** (aucun écran ne le consomme) → brancher ou supprimer (calcul lourd inutile).
- [ ] 🟡 ⚡ **`invoiceHeatmap` (`pilotage.ts:208`)** non scopé → supprimer ou scoper (fuite si branché un jour).
- [ ] 🟡 ⚡ **CRM scopé `commercial` seul** (`pilotage.ts:66`, `clientOwnerWhere`) alors que le périmètre réel = `commercial OU vendeur` → KPI CRM sous-comptés pour un « vendeur » non « commercial ».
- [ ] 🟡 ⚡ **Δ année en cours vs N-1 complète** (`DeltaCell`) trompeur → annoter « N en cours » ou comparer au prorata.
- [ ] 🟡 ⚡ **`buildMonthlyTrend` (`Screen2:242`)** : courbe vide tout janvier (`capM = getMonth()-1 = -1`).
- [ ] 🟡 ⚡ **`familyOf` vs CTE SQL** (`pilotage.ts:903` utilise `itemDescription` en repli, la CTE non) → uniformiser le regroupement familles.
- [ ] ℹ️ **Fallback COGS « première EM postérieure »** (`cogs.ts:68-72`) : peut décaler la marge historique. Exposer une 2ᵉ métrique « % coût réellement antérieur » ou documenter.
- [ ] ℹ️ Confirmer présence des index annoncés (`SapPdnLine.itemCode`, `SapPurchaseDeliveryNote.docDate`) sinon seq scan répété du LATERAL COGS.

---

## 📥 IMPORTS

- [ ] 🟠 🛠️ **CSV clients** (`components/ImportModal.tsx`) : parser naïf `split(',')` **sans guillemets** (`:34`) → décalage colonnes ; lecture **forcée UTF-8** (`:80`) → accents cassés sur exports Excel Latin1 ; détection séparateur par ligne (`:52`) ; heuristique d'en-tête (`:44`). Passer à une vraie lib CSV + choix d'encodage.
- [ ] 🟠 🛠️ **`/api/clients/import`** : **1 requête SQL/ligne**, **aucune transaction**, **aucune borne de taille** → sature le pooler / état partiel en cas d'échec. Upsert bulk + transaction + limite.
- [ ] 🟠 ⚡ **`/api/sap/clients/import` `clear=true`** (`:224`) : `TRUNCATE Client CASCADE` gardé seulement par un `window.confirm`. Exiger une confirmation typée serveur (`confirm:"RESET"`).
- [ ] 🟠 ⚡ **`ClientDeliveryMode`** : ajouter `@@unique([clientId, sapCardCode])` + `ON CONFLICT DO NOTHING` (sinon `foldDotVariant` crée des modes en double).
- [ ] 🟠 🛠️ **`full-reset`** : (a) inclure `SapPurchaseReturn` au TRUNCATE **et** au pull (sinon retours fournisseurs périmés → marge/Achats NET faux) ; (b) ne truncater qu'**après** pull réussi (sinon miroir vide si échec).
- [ ] 🟠 🛠️ **`lib/sapb1.ts` `call`** : retry **uniquement sur 401** → un `ECONNRESET` fait échouer tout un backfill (curseur non avancé). Ajouter retry/backoff réseau.
- [ ] 🟠 ⚡ **Pull clients SAP** (`sapb1.ts:329` / `clients/import:205`) : pas de `$orderby` ni dédup CardCode sur la pagination `$skip` → risque de rater/dupliquer des clients.
- [ ] 🟡 ⚡ **`isDotVariant`** (`clients/import:97`) : ne gère que le suffixe `.` ; parent gelé en SAP → la variante revient en doublon. Valider les autres conventions transporteur.
- [ ] 🟡 ⚡ **Throttle delta** (`sync/delta:25,43`) : basé sur `lastTickAt` écrit en fin de run → 2 requêtes concurrentes lancent 2 pulls SAP. Advisory lock / `FOR UPDATE`.
- [ ] 🟡 ⚡ **`/api/clients/resolve:20`** : recherche par `code` sans `toUpperCase()` alors que l'import stocke en MAJUSCULES → `?code=lpoi` ne résout pas `LPOI`.

---

## 🗃️ DONNÉES & MÉTIER (base de test — à corriger côté données/process)

- [ ] 🟠 🛠️ **285/339 clients (84 %) sans `vendeur`** → la file console est **vide pour tous sauf MM**. **35 clients actifs sans vendeur** = appelés par personne. Lancer `/api/clients/sync-vendeurs` + process de complétion.
- [ ] 🟠 🛠️ **Mapping ≠ réalité SAP** : comptes mappés = JMG/AG/MM, mais `slpName` des factures = **CM (80 % du CA, sans compte)**, JMG, MM, « . », ADM ; **AG = 0 activité SAP**. Réconcilier `UserCommercial` ↔ slpName réels (créer le compte de CM, statuer sur AG).
- [ ] 🟡 ⚡ **280/339 sans `type`** (EXPORT/GMS/CHR) → badges/segmentation quasi vides. Compléter (import SAP ou saisie).
- [ ] 🟡 ⚡ **5,1 % du CA produit (305 k€ / 1 321 lignes) sans `lineCost`** → marge rattrapée par EM mais pas à 100 %. Surveiller `marginCoverage` ; compléter les EM manquantes.
- [ ] 🟡 ⚡ **19 produits sans `salesUnitWeight`** → volume kg = 0 pour eux. Compléter le poids SAP.
- [ ] 🟡 ℹ️ **`ProductBatch` = 0 ligne** → DLC/lots/fabrication FIFO non alimentés (alertes péremption inopérantes). Vérifier la sync batches.
- [ ] 🟡 ℹ️ **1 produit en stock négatif** (vente à découvert) ; **3 clients actifs sans téléphone** ; **factures futures 12/2026** & **5 factures à 0 €** (données de seed — surveiller les compas YTD/N-1).

---

## 🎨 UX / PREMIUM / RGPD

- [ ] 🟠 ⚡ **Crédibilité chiffres** : ✅ marge % unifiée (fait) — vérifier visuellement qu'écran 1 et écran 2 affichent bien la même marge % sur la même période.
- [ ] 🟡 ⚡ Donut géo & familles : `Math.max(0, value)` masque les marges négatives (apparaissent à 0 %) → signaler le négatif.
- [ ] 🟡 ⚡ **RGPD** : durée de conservation des logs d'appels (`AppelLog`) + journalisation des accès aux PII ; registre sous-traitants (Supabase UE ✅ eu-west-1, Microsoft, SAP). Documenter base légale & droit d'accès/effacement.

---

## 🏆 TOP priorités restantes (impact × effort)

1. 🟠 ⚡ **`requireAdmin`** sur sync/promos/bom/recipes/carriers (après confirmation « pas de cron »).
2. 🟠 ⚡ **Fuseau `Europe/Paris`** console (jour/stats faux le soir).
3. 🟠 🛠️ **Remplir `vendeur`** + réconcilier mapping CM/AG (sinon console inutilisable hors MM).
4. 🟠 🛠️ **Import CSV** robuste (guillemets + Latin1 + transaction + bornage).
5. 🟠 🛠️ **Sortir l'`accessToken` Graph** de la session client.
6. 🟠 🛠️ **`full-reset`** : inclure `SapPurchaseReturn` + truncate après pull.
7. 🟠 🛠️ **N+1** tops + `monthDrilldown` global.
8. 🟠 🛠️ **COGS non exposés** aux commerciaux (assembly/fabrication/bom).
9. 🟠 ⚡ **États erreur/chargement** pilotage + purge localStorage console.
10. 🟡 🛠️ **`ClientDeliveryMode @@unique`** + dédup import.
