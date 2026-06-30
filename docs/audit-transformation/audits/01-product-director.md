# Audit Product Director — TeleVent (GERVI / Gervifrais)

## Verdict en une phrase
**Un cœur télévente déjà excellent posé sur un socle ERP/SAP solide — mais il lui manque la colonne vertébrale CRM (cycle de vie, scoring de valeur/risque, moteur de « prochaine action ») qui le ferait passer de « miroir SAP très réussi » à « machine à reprise, fidélisation et encaissement ».**

Note de maturité de la dimension produit/vision : **62/100**. Le quotidien est là et bien fait ; la *thèse CRM* n'est pas encore construite.

---

## 1. Le produit a-t-il une colonne vertébrale CRM ?

**Réponse : à moitié.** Il y a un *centre de gravité client* (la console, la fiche 360, le plan d'appel), mais pas de *colonne vertébrale* au sens CRM (un cycle de vie qui relie tous les modules autour de l'état et de la prochaine action du client).

| Pilier CRM attendu | État dans TeleVent | Preuve |
|---|---|---|
| **Client au centre** | ✅ Réel et fort | `CallConsole.tsx`, `app/clients/[id]/page.tsx` (360 en 3 onglets) |
| **Vue 360** | ✅ Bien structurée | `ClientTabs.tsx`, `ComportementYoY.tsx`, produits récurrents, encours |
| **Cycle de vie (Actif→À risque→Perdu)** | ❌ Absent | `prisma/schema.prisma:101-160` (aucun `lifecycleState`) |
| **Scoring de valeur client (A/B/C/D)** | ❌ Absent | `lib/insights.ts:140-144` (`confidence` ≠ valeur) |
| **Scoring de risque / churn** | ⚠️ Signal brut, pas de score | `lib/insights.ts:128-138` (`trend30` par client, jamais consolidé) |
| **Tâches / to-do consolidée** | ⚠️ Objet `Rappel` présent, surface absente | `schema.prisma:545-554` |
| **Prochaine action recommandée** | ❌ Quasi absent | seule « reco » = heure d'appel, `lib/insights.ts:163` |
| **Relance proactive (poussée)** | ❌ Réactif (on va chercher) | `Encours.tsx`, `AlertesEncours.tsx` |
| **Pipeline / acquisition** | ❌ Absent (par choix probable) | tout client naît de SAP, `schema.prisma:144-146` |

**Diagnostic :** TeleVent est aujourd'hui un **outil d'exécution de la télévente** (très bon) plus qu'un **CRM de pilotage de la relation** (à construire). La bascule se joue sur trois objets manquants : **état de cycle de vie**, **score de valeur**, **moteur d'actions**.

---

## 2. Cartographie de valeur des modules (construire / garder / surveiller / ne pas étendre)

Sur 23 routes, le différenciateur (là où SAP est faible et où l'app gagne) tient en ~5 écrans. Le reste réplique l'ERP.

| Module | Rôle | Valeur métier | Verdict produit |
|---|---|---|---|
| **Console + écran 2** | Cœur télévente | 🟢 Très forte (le « Expert Fast ») | **Investir** — y brancher cycle de vie + DLC + actions |
| **Fiche client 360** | Connaissance client | 🟢 Forte | **Investir** — y poser état + tier de valeur |
| **Plan d'appel** | Distribution du travail | 🟢 Forte | **Garder / enrichir** (pondérer par valeur) |
| **Clients (liste)** | Base | 🟡 Moyenne (doublon partiel du plan d'appel) | **Fusionner** la logique avec le plan d'appel |
| **Encours / relance** | Recouvrement | 🟢 Forte mais réactive | **Investir** — rendre proactif (cf. §4) |
| **Dashboard ×3 + carte** | Pilotage | 🟢 Forte | **Garder** — y ancrer la north-star et une vue « mouvements » |
| **Entrées (litiges)** | Réception terrain | 🟡 Utile (litiges absents de SAP) | **Garder** |
| **Fabrication (kits DECO)** | Production fraise | 🟡 Spécifique métier | **Garder** |
| **Inventaire guidé** | Terrain | 🟡 Utile | **Garder** |
| **Cmd. fournisseurs** | Achat | 🟠 Miroir SAP | **Surveiller** (risque ERP-bis) |
| **Products / Livraisons** | Consultation | 🟠 Lecture seule | **Surveiller** (faible valeur ajoutée vs SAP) |
| **Promos** | Animation commerciale | 🟡 Moyenne | **Garder**, relier aux actions |

> **Risque stratégique (finding #5) :** chaque module qui re-miroite SAP est de la **dette de sync** et un **risque de confiance** pour une Direction faible-aisance (« lequel a raison, SAP ou l'app ? »). Règle : afficher « SAP fait foi » sur tout écran miroir, et **ne pas étendre la couverture ERP tant que le CRM n'a pas sa colonne vertébrale**.

---

## 3. Ce qui manque pour être un CRM (les 3 objets fondateurs)

### a) Cycle de vie client (finding #1 — 🔴)
Tout est calculable mais rien n'est posé. On a la médiane d'intervalle entre commandes (`insights.medianIntervalDays`) et la récence (`lastOrderDays`) — il « suffit » de les croiser en états :

- **Actif** : dans son cycle (récence < médiane × 1).
- **En retard** : a sauté ~1 cycle.
- **À risque** : ~2 cycles → c'est le moment de reprendre.
- **Endormi** : 3+ cycles.
- **Perdu** : > 90 j ou jamais.

> *Exemple fraise :* un CHR qui commande tous les 3 jours et qui saute 6 jours = **rouge** ; un export qui commande tous les 45 jours et qui est à J+30 = **vert**. Aujourd'hui les deux ont le même traitement (badge `+XJ`, `CallConsole.tsx:826-844`).

### b) Score de valeur (finding #9 — 🟠)
Le miroir `SapInvoice` permet un **tier A/B/C/D** (CA/marge 12 mois) par client. Sans lui, **on ne sait pas prioriser** : perdre un GMS à 200 k€ et un CHR à 4 k€ déclenchent la même alerte.

### c) Moteur de « prochaine action » (finding #2 — 🔴)
Score de priorité = **valeur × urgence**. Sources déjà branchées : rappels échus (`AppelLog`), incidents qualité (`Incident`), clients à risque (cycle de vie), encours en retard (`Encours`), pré-commandes arrivant à échéance (`AppelLog.scheduledFor`). Aujourd'hui, `/api/notifications` ne renvoie **que des promos** (`route.ts:43-83`).

---

## 4. Recouvrement : passer du réactif au proactif (finding #3 — 🟠)

Le modèle est mûr (`RelanceLog` R0→R5 horodaté, tranches d'âge), mais le **déclenchement est 100 % humain**. Pour un grossiste fraise (marge fine, BFR critique), un DSO qui dérive de 5 jours mange la marge d'un client.

**Cible :** quand une facture franchit J+30 / J+45 / J+90 → **tâche de relance auto-générée** (niveau pré-rempli), DSO en north-star secondaire, escalade visuelle vert/orange/rouge rassurante pour la Direction.

---

## 5. North-star & KPIs de la transformation (finding #4 — 🟠)

Le pilotage actuel **décrit le passé agrégé** (Volume BL, Marge, conversion — `PilotageScreen1.tsx`) ; il **n'incarne pas un objectif quotidien**. `CommercialObjectif` (CA annuel) existe en base mais **n'apparaît jamais dans la console** du commercial.

**North-star proposée : CA / commercial / jour vs objectif** (lisible par le commercial de 20 ans dans sa console *et* par la Direction). Métrique de santé jumelle : **taux de reprise client** (clients « à risque » réactivés).

### KPIs de succès de la transformation ERP→CRM

| KPI | Pourquoi (métier) | Source déjà présente |
|---|---|---|
| **CA/commercial/jour vs objectif** | Boucle de motivation + pilotage Direction | `SapOrder` + `CommercialObjectif` |
| **Taux de reprise** (clients à risque réactivés / mois) | Cœur de la valeur CRM (le CA se gagne sur la reprise) | cycle de vie + `AppelLog` |
| **DSO** (jours de retard moyen pondéré €) | Marge protégée, BFR | `Encours` / `SapInvoice` |
| **Taux de couverture des appels planifiés** | « rien d'important ne passe à travers » (rassure Direction) | file Console / `AppelLog` |
| **% clients sans état/tier** (qualité données) | Fiabilité du moteur d'actions | `Client` |
| **Démarque évitée via DLC** (à terme) | Différenciateur fraise n°1 | `ProductBatch.expirationDate` |

---

## 6. Spécifique métier fraise : la fraîcheur n'est pas branchée à la vente (finding #7 — 🟠)

Le modèle a `ProductBatch.expirationDate` + FIFO documenté (`schema.prisma:490-513`), mais **la DLC ne remonte jamais dans la console de vente**. Or écouler au bon prix les lots qui vieillissent est **le levier de marge le plus propre au métier**. (Bloqueur actuel : `ProductBatch` vide, cf. `TODO-AUDIT.md:60`.) Dès la donnée alimentée → panneau « À écouler en priorité » + source d'actions du moteur.

---

## 7. Vision produit proposée

> **TeleVent — le CRM télévente premium du grossiste fraise.**
> *« Beginner Friendly + Expert Fast » : reprendre les clients qui décrochent, fidéliser les fidèles, encaisser à l'heure — sans jamais faire peur à la Direction.*

**Trois promesses, trois personas :**
- *Pour le commercial (20 ans)* : « ma journée, dans l'ordre, sans réfléchir » — file d'actions priorisée, raccourcis, DLC à pousser, objectif du jour.
- *Pour la Direction (>50 ans, faible aisance)* : « je comprends en 3 s si on va bien » — north-star unique, mouvements de portefeuille, encours sous contrôle, codes couleur rassurants.
- *Pour l'admin* : « SAP fait foi, l'app oriente l'action » — sync fiable, périmètre net.

### Thèmes de roadmap (sans chiffrage)
1. **Colonne vertébrale CRM** — cycle de vie + tier de valeur + score de risque (findings #1, #9).
2. **Moteur de prochaine action** — file priorisée (valeur × urgence) en tête d'Accueil & Console (finding #2), tâches first-class (finding #11).
3. **Recouvrement proactif** — relances déclenchées par palier, DSO en KPI (finding #3).
4. **North-star incarnée** — objectif/jour dans la console + vue « mouvements de portefeuille » Direction (findings #4, #10).
5. **Différenciation fraise** — DLC/FIFO branchés à la vente (finding #7).
6. **Hygiène produit** — énoncé de vision + README à jour, vocabulaire commercial/vendeur clarifié, vigilance anti-sprawl ERP (findings #5, #6, #8, #12).

---

## 8. Forces à préserver absolument
La console (`CallConsole.tsx`), la fiche 360 (`app/clients/[id]/page.tsx`), le plan d'appel (`PlanAppel.tsx`), le moteur de signaux (`lib/insights.ts`), la segmentation (`lib/segments.ts`) et la discipline d'exécution UI (DESIGN-CHANGELOG) constituent un **socle rare**. La transformation CRM ne demande pas de tout refaire : elle demande de **poser trois objets (état, valeur, action)** par-dessus une matière déjà excellente.