# TeleVent — Synthèse Lead Product (audit consolidé de 12 spécialistes)

> Document de direction · Français · niveau cabinet · fusion/dédoublonnage/arbitrage des 12 audits
> Périmètre : produit, UX, UI, DA, a11y, design cognitif, métier fraise, QA, sécurité, architecture, motion, CRM
> Base de preuves : citations `fichier:ligne` des auditeurs · état « déjà fait » tiré de TODO-AUDIT.md + DESIGN-CHANGELOG.md
> **Version 2 (consolidée à 12 audits)** — l'audit CRM dédié (07), initialement perdu sur troncature technique, a été rejoué avec succès et est désormais intégré (maturité CRM opérationnel 46/100, 15 constats).

---

## 1. Executive Summary

TeleVent est aujourd'hui un **excellent cœur de télévente posé sur un socle technique mûr, mais qui n'est pas encore un CRM**. Les forces réelles sont indiscutables et déjà livrées : une console d'appel de qualité métier (file triée, fiche active, verdicts journalisés, raccourcis clavier — `CallConsole.tsx`), une vue 360 structurée en trois onglets, un moteur de signaux comportementaux honnête (`lib/insights.ts`), une intégration SAP-miroir riche et idempotente (`lib/sapb1.ts`, `lib/sapMirror.ts`), une sécurité d'autorisation sérieuse (RLS 45/45, IDOR clients traités) et un design system ambitieux (tokens HSL, motion centralisé, a11y partielle). Le typage est quasi sans dette, les calculs métier sensibles (marge réelle au coût d'entrée, lots, fuseau Paris, recouvrement) sont testés.

Mais quatre faiblesses **structurelles** plafonnent l'ambition. Premièrement, **il manque la colonne vertébrale CRM** : aucun cycle de vie client, aucun scoring de valeur, aucun moteur de « prochaine action ». L'app montre des données, elle ne dit jamais quoi faire — ce qui contredit frontalement la devise « chaque écran répond en <3 s : quelle est la prochaine action ? ». Deuxièmement, **le métier de la fraise est invisible** : aucune DLC n'est jamais saisie, la rotation des lots est en réalité du LIFO (`lotResolver.ts:76`), et la fraîcheur — différenciateur n°1 — n'apparaît ni à la vente, ni à la préparation. Troisièmement, **la Direction (persona décideur, >50 ans, faible aisance) est mal servie** : contraste AA en échec sur le CTA principal (2,37:1), sidebar grise sous le seuil, tutoiement, fiche réorganisable qui détruit la mémoire spatiale, aucun next-best-action. Quatrièmement, **l'identité est empruntée** : zéro logo/favicon réel, nom générique « TeleVent », métaphore « radar/signal » hors-sujet, trois colorimétries qui diluent la marque, résidus indigo non purgés.

À cela s'ajoutent deux risques que la Direction ne voit pas mais qui coûtent cher : un **angle mort sécurité** (toute la chaîne documentaire fournisseur/stock est ouverte à n'importe quel commercial ; aucun journal d'audit) et des **trous de robustesse** (pas d'idempotence sur la création de commande → double-BL possible ; pas de cron de synchro → miroir périmé le soir/week-end ; pas d'error boundary → page d'erreur brute possible).

**L'apport de l'audit CRM dédié (07) confirme et précise le diagnostic T1.** Il chiffre la maturité CRM opérationnelle à **46/100** et apporte des preuves net-nouvelles : la file d'appel est un **calendrier statique** (inclusion = `joursAppel` contient aujourd'hui, `console/route.ts:160-162`) dont le tri à l'écran est purement cosmétique ; la liste « à relancer » est **mono-critère par ancienneté** (`pilotage.ts:890`), aveugle à la valeur ; le seuil de relance est **codé en dur (+7j)** identique pour un client quotidien et un client mensuel (`CallConsole.tsx:828`) ; et le moteur d'insights, pourtant calculé (`insights.ts:108-138`), n'est **jamais branché** sur la priorisation. La traçabilité d'appel est binaire (`COMMANDE`/`DEMAIN`, `validations.ts:90`), ce qui **biaise le taux de conversion**. Diagnostic central de l'audit 07 : *TeleVent a déjà le moteur de saisie d'un excellent outil de télévente ; il lui manque le cerveau CRM — la couche qui décide qui rappeler, pourquoi et dans quel ordre.* Toutes les données nécessaires existent déjà ; c'est de l'orchestration et du scoring, pas de la collecte.

**Les 3 leviers à plus fort ROI :**
1. **Construire le moteur CRM dérivé** (cycle de vie + valeur client + file d'actions priorisée) — la donnée existe déjà (`insights`, `SapInvoice`, `segments`), c'est de l'orchestration, pas de la nouvelle donnée. C'est ce qui transforme un « miroir SAP joli » en « machine à reprise et fidélisation ».
2. **Outiller la fraîcheur** (saisie DLC à la réception → badge fraîcheur en console → « à écouler en priorité ») — le levier de marge le plus spécifique et le plus rentable du métier.
3. **Rassurer la Direction par des quick-wins à très fort ROI/effort** (contraste AA, purge indigo, error boundary, next-best-action sur l'accueil, garde-fous sur les actions engageantes).

### Note de maturité par dimension

| # | Dimension | Note /100 | Pondération | Lecture |
|---|-----------|:---------:|:-----------:|---------|
| 1 | Vision produit / CRM | 62 | 9 % | Cœur télévente fort, colonne vertébrale CRM absente |
| 1bis | **CRM opérationnel (cycle de vie, scoring, file d'actions)** | **46** | **11 %** | **Décrit le passé, ne pilote pas le futur — file calendaire, priorisation mono-critère, insights non branchés (audit 07)** |
| 2 | UX Research | 74 | 10 % | Mûre côté commercial, sous-sert la Direction |
| 3 | UI / Design system | 68 | 7 % | Riche mais fragmenté (3 cartes, échelle typo fantôme) |
| 4 | Direction artistique / Identité | 58 | 6 % | Exécution soignée au service d'un ADN emprunté |
| 5 | Accessibilité WCAG 2.2 AA | 61 | 9 % | Fondations sérieuses, CTA et sidebar en échec |
| 6 | Design cognitif | 68 | 7 % | Bonnes bases sabotées par la sur-personnalisation |
| 7 | **Métier fraise** | **38** | **13 %** | **Aveugle à la fraîcheur — le cœur du métier manque** |
| 8 | QA / robustesse | 62 | 9 % | Noyau solide, validation d'entrée et concurrence trouées |
| 9 | Sécurité / RGPD | 68 | 9 % | CRM bien cloisonné, chaîne fournisseur ouverte, zéro audit |
| 10 | Architecture | 68 | 6 % | Mûre, minée par 3 dettes (couche service, sync, filet runtime) |
| 11 | Motion | 68 | 2 % | Doctrine excellente, reduced-motion partiel |
| 12 | Design graphique global | 66 | 2 % | Cohérent mais « template SaaS 2024 » |
| | **Note globale pondérée** | **≈ 60 / 100** | 100 % | **Bon produit en devenir, pas encore un CRM premium** |

**Ajout v2 :** l'audit CRM dédié (07) a été intégré sous la forme d'une ligne distincte **« CRM opérationnel (cycle de vie, scoring, file d'actions) — 46/100 »**, séparée de « Vision produit/CRM » : la première note la *capacité opérationnelle effective* (ce que l'app fait réellement pour prioriser et reprendre un client), la seconde note la *vision et le cadrage produit*. Pour faire de la place à cette dimension de poids 11 % sans dépasser 100 %, les pondérations ont été légèrement réajustées : Vision produit/CRM passe de 14 % à 9 % (la part « opérationnelle » est désormais portée par la ligne dédiée), et des décimales ont été reprises sur UX (11→10), UI (8→7), Cognitif (8→7), QA (10→9), Sécurité (10→9) et Motion (3→2). La note globale pondérée s'établit en conséquence à **≈ 60/100** (vs 62 en v1), tirée vers le bas par la note CRM opérationnel de 46 — ce qui est juste : c'est exactement l'axe sur lequel le produit doit gagner sa promesse. La pondération sur-pèse toujours délibérément le métier fraise (13 %) et l'ensemble CRM (vision 9 % + opérationnel 11 % = 20 %) car ce sont les deux axes où le produit doit gagner sa promesse ; les notes basses (métier 38, CRM opérationnel 46) tirent la moyenne vers le bas à juste titre — c'est le signal le plus important du document.

---

## 2. Thèmes transverses (les patterns qui reviennent)

### T1 — Pas de colonne vertébrale CRM (la transformation ERP→CRM n'est pas commencée)
**Constat consolidé :** aucun cycle de vie client (Actif/À risque/Endormi/Perdu), aucun scoring de valeur (A/B/C/D €), aucune file d'actions priorisée par valeur×urgence, aucune vue « mouvements de portefeuille » pour la Direction. La file console est triée par heure, pas par enjeu : un GMS à 200 k€ qui décroche passe après un petit CHR si son heure est plus tardive. L'accueil juxtapose des consultations, sans « à traiter maintenant ».
**Preuves net-nouvelles de l'audit CRM (07) :**
- **File d'appel = calendrier statique** : l'inclusion dans la queue se fait si `joursAppel` contient le jour courant (`console/route.ts:160-162`), puis on retire les déjà-appelés/snoozés. Le tri proposé à l'écran (« heure optimale », « dernière commande ») est purement cosmétique et calculé côté client (`CallConsole.tsx:190-208`) : il réordonne une liste déjà figée, il ne la *priorise* pas.
- **« À relancer » mono-critère par ancienneté** : `clientsToRelance` (`pilotage.ts:890`) prend les clients planifiés sans facture sur 30 jours et les trie *uniquement* par `b.lastInvoiceDays - a.lastInvoiceDays` — aucune pondération par CA/marge, fenêtre fixe 30 j absurde pour un client quotidien.
- **Seuil de relance codé en dur, identique quotidien/mensuel** : `d > 7` (`CallConsole.tsx:828-831`) et `last30` (`pilotage.ts`) traitent de la même façon un client qui commande tous les jours et un client mensuel → faux positifs/négatifs garantis sur un grossiste fraises.
- **Insights calculés mais non branchés** : `medianIntervalDays`, `trend30` sont calculés (`insights.ts:108-138`) mais consommés en *affichage seul* (`CallConsole.tsx:768`), jamais utilisés pour scorer ni alerter.
- **Proactivité absente** : le canal de notifications existe mais ne diffuse que les promos (`notifications/route.ts:43-83`) ; les rappels sont 100 % manuels ; la liste « à relancer » est planquée dans l'écran 2 du dashboard. Rien ne *vient à* l'utilisateur.
- **Valeur client absente de toute la chaîne de priorisation** : ni la file (`console/route.ts:103-123`), ni « à relancer », ni le plan d'appel (`plan-appel/route.ts:71-94`) n'affichent le CA/poids du client → on traite un petit et un gros pareil.
**Audits concernés :** **Expert CRM (07 — findings #1,#2,#3,#6,#10,#11,#15)**, Product Director (findings #1, #2, #4, #9, #11, #13), Design Cognitif (#3 next-best-action), UX Researcher (wording churn incohérent).
**Enjeu métier :** la reprise/fidélisation est LE levier de CA d'un grossiste en télévente sur portefeuille. Sans cycle de vie ni priorisation, impossible de mesurer la rétention ni de protéger les gros comptes. **Preuves :** `prisma/schema.prisma:101-160`, `lib/insights.ts:121-144`, `CallConsole.tsx:190-212`, `AccueilHub.tsx:73-96`, `console/route.ts:160-162`, `pilotage.ts:890`, `CallConsole.tsx:828`, `insights.ts:108-138`.

### T2 — La fraîcheur / DLC n'est jamais outillée (le métier est absent du produit)
**Constat consolidé :** aucune DLC n'est saisie à la réception (`GoodsReceiptForm.tsx:29-40`), donc `ProductBatch.expirationDate` reste vide ; la rotation des lots est un LIFO (`lotResolver.ts:76` sélectionne le DocNum le plus grand = la réception la plus récente), exactement l'inverse de la fraîcheur ; la DLC n'apparaît ni en console de vente, ni au panier, ni sur le bon de préparation. Aucun garde-fou contre la vente à perte alors que le COGS réel est calculable (`lib/cogs.ts`).
**Audits concernés :** Expert Métier (findings #1, #2, #3, #5 — les 3 plus critiques du document tous dimensions confondues), Product Director (#7 fraîcheur), QA (vente à découvert non bornée).
**Enjeu métier :** la fraise a 2-4 jours de durée de vie. Ne pas voir la DLC = casse/démarque non pilotée (poste de perte n°1), litiges GMS (lot à J-0 refusé), marge faussée sur la référence la plus volatile.

### T3 — La Direction (persona décideur, faible aisance) est structurellement mal servie
**Constat consolidé :** contraste AA en échec sur le CTA jaune principal en mode clair (2,37:1, `globals.css:16-17`) et sur la sidebar (en-têtes à 2,66:1) ; tutoiement systématique (`CallConsole.tsx:671`) ; fiche client réorganisable/renommable qui détruit la mémoire spatiale sur poste partagé ; page Paramètres à 8 réglages (surcharge de Hick) ; aucun next-best-action ; ambiance « salle de signal » chargée potentiellement anxiogène ; pas d'error boundary (page d'erreur brute possible).
**Audits concernés :** Accessibilité (#1, #2, #8), Design Cognitif (#2, #3, #4), UX Researcher (#2, tutoiement), Architecte (error boundary), UI/DA (ambiance), Expert CRM (07 — la next-best-action doit *venir à* la Direction, pas être planquée dans l'écran 2 du dashboard).
**Enjeu métier :** confiance Direction = adoption et budget. Un décideur qui ne « comprend pas ce qui se passe » ou qui a peur de « tout dérégler » n'utilise pas l'outil et ne le finance pas.

### T4 — Dette de duplication sur le cœur de saisie de commande
**Constat consolidé :** `Ecran2Order.tsx` (1516 l.) et `BLDialog.tsx` (1023 l.) réimplémentent deux fois le même flux (découpe multi-entrepôt, promos X+Y, payload `/api/sap/orders`, conversion net→brut). La logique métier critique (TPF INTERFEL/DDG, lot, encours) vit dans une route de 530 lignes, non testée. Une correction sur les colis offerts ou la marge faite dans un fichier et oubliée dans l'autre = deux BL différents pour la même situation.
**Audits concernés :** Architecte (#1 couche service, #5 duplication), QA (couverture tests zéro sur `buildApiLines`), déjà signalé TODO-AUDIT.md:72.
**Enjeu métier :** facturation fausse au client, divergence silencieuse, coût d'évolution élevé sur la prise de commande (l'acte qui fait le CA).

### T5 — Identité diluée et empruntée (rien ne dit « Gervi »)
**Constat consolidé :** zéro logo/favicon réel (l'onglet affiche l'icône Next.js), nom de catégorie « TeleVent », deux symboles concurrents (Phone au login, waveform en sidebar), métaphore radar/signal hors-sujet pour la fraise, **trois colorimétries** qui empêchent une identité unique, jaune « Controllino » importé sans lien produit, résidus indigo non purgés sur l'indicateur de page actif (présent sur 100 % des écrans), aucune charte d'ADN écrite.
**Audits concernés :** Directeur Artistique (#1, #2, #3, #4, #8, #12), UI Designer (#3 indigo, cartes), UX/A11y/Cognitif (indigo résiduel signalé par 5 audits indépendants).
**Enjeu métier :** une camionnette de livraison sans nom peint. La reconnaissance de marque (couleur > logo) rassure la Direction et professionnalise l'outil chez un grossiste premium.

### T6 — Sur-personnalisation et incohérences de système (mémoire spatiale et confiance)
**Constat consolidé :** **trois** mécaniques de réorganisation drag&drop concurrentes (console drag natif, fiche ReorderableSections avec renommage, plan-appel colonnes), persistances localStorage séparées **par poste** (pas par utilisateur), renommage libre qui fragmente le vocabulaire métier. Aucun mode édition opt-in : un glissement accidentel réorganise durablement. Trois systèmes de cartes (Card/SurfaceCard/SectionCard), échelle typo fantôme (736 px hard-codés, 30 tailles).
**Audits concernés :** UX Researcher (#3), Design Cognitif (#1, #2, #6, #9), UI Designer (#1 cartes, #2 typo).
**Enjeu métier :** sur poste de télévente tournant, le réglage du commercial du matin s'impose au dirigeant l'après-midi — « ce n'est plus mon outil ».

### T7 — Angle mort sécurité sur la chaîne fournisseur/stock + zéro traçabilité
**Constat consolidé :** 7+ routes d'écriture fournisseur/stock (annulation EM, réception, modif prix d'achat, retour) ne vérifient qu'une session, sans rôle ni scope — n'importe quel commercial peut annuler une réception ou fausser la marge. **Aucune table d'audit applicative** : impossible de savoir qui a annulé un BL, modifié un prix, supprimé un client, basculé la base SAP. Bypass d'auth en preview avec session admin sur données réelles. Hard-delete client accessible à un commercial en périmètre.
**Audits concernés :** Sécurité (#1, #2, #3, #6, #7), QA (bulk delete non borné), Architecte (bypass preview).
**Enjeu métier :** valorisation de stock et marge faussables sans trace ; en cas de litige (prime commerciale contestée, BL annulé), l'app ne produit aucune preuve. Trou de confiance Direction majeur (accountability RGPD art. 5.2).

### T8 — Robustesse runtime et fraîcheur de la donnée
**Constat consolidé :** pas d'idempotence sur la création de commande → double-clic = deux BL SAP réels (livraison/facturation doublées de denrée périssable) ; **aucun cron de synchro câblé** dans `vercel.json` → le miroir documentaire (KPI, encours, marge) ne se met à jour que si un admin clique, et le stock seulement si une console est ouverte (survente le soir/week-end) ; full-reset destructif non transactionnel (dashboards tronqués si timeout) ; aucune error boundary ; reduced-motion partiel (168 `animate-*` non gardés).
**Audits concernés :** QA (#idempotence, validation date/prix/quantité), Architecte (#2 full-reset, #3 cron, #4 error boundary), Motion (#1 reduced-motion).

### T9 — Traçabilité d'interaction trop maigre (le pilotage est aveuglé à la source)
**Constat consolidé (apport audit CRM 07) :** l'issue d'appel est **binaire** — `appelLogSchema` n'accepte que `COMMANDE` ou `DEMAIN` (`validations.ts:90`). Un appel non décroché, un répondeur, un refus, un litige produit ne sont jamais journalisés. Conséquences en cascade : (a) le **taux de conversion** affiché (`console/route.ts:222-224`) est gonflé — le dénominateur compte les appels *aboutis*, pas les appels *passés* ; (b) on ne peut pas mesurer la joignabilité réelle d'un client ni détecter un client qu'on n'arrive plus à joindre (signal de churn fort en télévente) ; (c) aucune analyse des **motifs de non-commande**. Enrichir `outcome` (NRP/Refus/Répondeur/Litige…) est un quick win à fort effet de levier sur tout le pilotage, et conditionne la justesse du scoring du T1.
**Audits concernés :** **Expert CRM (07 — findings #4 issue binaire, #5 conversion biaisée)**, Pilotage (KPI faussés), Product Director (mesure de la rétention).
**Enjeu métier :** un taux de conversion faux pilote de mauvaises décisions (primes, objectifs, allocation d'appels) ; l'absence de motif de non-vente prive la Direction de tout levier d'amélioration et masque les clients qui décrochent.

---

## 3. Les 4 personas (consolidé)

| Persona | Objectifs | Écrans clés | Besoins | Frustrations actuelles | Risques | Optimisations prioritaires |
|---------|-----------|-------------|---------|------------------------|---------|----------------------------|
| **DIRECTION** (>50 ans, faible aisance, décideur) | Comprendre en <3 s « va-t-on bien ? », être rassurée, zéro surprise | Accueil, Dashboard×3, Encours, Fiche client | Lisibilité, hiérarchie claire, next-best-action unique, vocabulaire stable, traçabilité « qui a fait quoi » | CTA illisible (2,37:1), sidebar grise, tutoiement, fiche qui change de disposition, 8 réglages anxiogènes, aucune vue « mouvements de portefeuille », page d'erreur brute possible, ambiance radar abstraite | Perte de confiance → non-adoption → non-financement | Contraste AA (#B1), encart « à traiter maintenant » (#B3), error boundary (#B6), fiche figée non éditable (#B12), vue mouvements de portefeuille (#21), vouvoiement transverse (#B10) |
| **COMMERCIAL** (~20 ans) | Vitesse maximale, enchaîner les appels, zéro friction, faire son CA/jour | Console, Console/ecran2, Plan-appel | Raccourcis, densité, file priorisée par valeur, feedback de succès, mobile | File triée par heure et non par enjeu, pas de jauge « où j'en suis de ma journée vs objectif », pas de fraîcheur à pousser, double-BL possible, pas de console mobile | Travail mal priorisé (rate les gros comptes), erreurs de saisie non bornées | File d'actions par valeur×urgence (#2/#5/#43), north-star CA/jour vs objectif (#7), garde quantité aberrante (#9), feedback succès commande (motion), idempotence BL (#10) |
| **PRÉPARATEUR** (terrain/entrepôt) | Recevoir juste, préparer sans erreur, signaler les problèmes | Entrées, Inventaire, Fabrication, Livraisons | Saisie DLC, lot/DLC sur bon de préparation, cibles tactiles ≥44px, claim atomique, signaler litige au point de constat | Pas de DLC à saisir ni à voir, picking aveugle (LIFO), pas de bouton « signaler » en livraison, +/- colis à 28px (gants), claim non atomique (double préparation) | Expédition de lot limite → litige GMS ; double préparation de denrée périssable | Saisie DLC réception (#8), lot+DLC sur bon de préparation (#3/#B14), claim conditionnel (#B16), cibles tactiles (#B7), bouton signaler litige (#15) |
| **ADMINISTRATEUR** (config, sync, droits) | Tenir la cohérence SAP, gérer droits, ne rien casser | Paramètres, Données·SAP, Commerciaux | Gating fournisseur/stock, journal d'audit, observabilité sync, confirmation forte sur actions lourdes | Chaîne fournisseur ouverte à tous, aucun audit trail, full-reset risqué, pas de cron, élévation de privilèges direction non tracée | Manipulation non détectable, miroir faux silencieux | Gating rôle fournisseur/stock (#B5/#23), AuditLog transverse (#22), crons + auth machine (#B4), SyncLog observabilité (#24), strictAdmin sur isDirection (#B5) |

---

## 4. Backlog priorisé (unique, dédoublonné)

> Tri par priorité décroissante (sévérité × impact métier × ROI ÷ effort). Sévérité : 🔴 critique · 🟠 majeur · 🟡 mineur. Effort : ⚡ quick win · 🛠️ chantier.

| # | Problème | Dimension(s) | Sév. | Impact métier | Effort | ROI | Reco |
|---|----------|--------------|:----:|---------------|:------:|:---:|------|
| 1 | Saisie DLC absente à la réception → toute la chaîne fraîcheur sans donnée source | Métier | 🔴 | Casse/démarque non pilotée, litiges GMS | 🛠️ | Fort | Champ DLC obligatoire par ligne fruits frais, poussé en SAP `BatchNumbers[].ExpiryDate` ; défaut = réception + durée de vie famille (`GoodsReceiptForm.tsx:29-40`) |
| 2 | Rotation lots = LIFO (plus récent d'abord), inverse de la fraîcheur | Métier | 🔴 | Vieillit le stock ancien → casse | 🛠️ | Fort | Picking par `expirationDate ASC` ; corriger le commentaire « FIFO » mensonger (`lotResolver.ts:76,81`) |
| 3 | CTA jaune principal échoue AA en mode clair (2,37:1) | A11y / Direction | 🔴 | Action qui fait le CA, illisible | ⚡ | Fort | `primary-foreground` sombre OU assombrir `primary` à 42 95% 36% (`globals.css:16-17`) |
| 4 | Aucun moteur de « prochaine action » (file par valeur×urgence) | CRM / Cognitif | 🔴 | Travail mal priorisé, gros comptes ratés | 🛠️ | Fort | File d'actions (rappels échus, à risque, incidents, encours) en tête Accueil+Console (`notifications/route.ts:43-83`) |
| 5 | Pas de cycle de vie client (Actif/À risque/Endormi/Perdu) | CRM | 🔴 | Impossible de mesurer reprise/rétention | 🛠️ | Fort | `lifecycleState` dérivé de `medianIntervalDays`, persisté, badge unifié partout (`schema.prisma:101-160`, `insights.ts:121-138`) |
| 6 | Fraîcheur invisible à la vente/préparation (console, panier, bon prépa) | Métier | 🔴 | Vend/expédie du périmé, litiges | 🛠️ | Fort | Badge fraîcheur console + lot/DLC sur bon de préparation + tuile « à écouler » (`Ecran2Order.tsx`, `livraisons/route.ts:159-166`) |
| 7 | Chaîne fournisseur/stock ouverte à tout commercial (7+ routes) | Sécurité | 🔴 | Marge/stock faussables | 🛠️ | Fort | `requirePreparateurOrAdmin` / `requireAdmin` selon route (`goods-receipts/cancel`, `purchase-orders/*`, modif prix) |
| 8 | Aucun journal d'audit applicatif (qui a annulé/modifié/supprimé/basculé) | Sécurité / Direction | 🔴 | Aucune preuve en litige | 🛠️ | Fort | Table `AuditLog` + helper `writeAudit()` sur cancel/modif prix/delete/bascule env/rôles + écran Journal |
| 9 | Création commande sans idempotence → double-clic = 2 BL SAP | QA | 🟠 | Livraison/facturation doublées | 🛠️ | Fort | Clé d'idempotence UUID front + refus POST identique <60 s (`orders/route.ts:95`) |
| 10 | Aucune synchro cron → miroir périmé soir/week-end | Architecture | 🔴 | Stock périmé → survente ; KPI datés | ⚡ | Fort | Crons Vercel (mirror 5-10 min, delta) + auth machine `CRON_SECRET` (`vercel.json`, `sync/mirror:24`) |
| 11 | Aucune error boundary → page d'erreur brute à la Direction | Architecture / Direction | 🟠 | Perte de confiance immédiate | ⚡ | Fort | `app/error.tsx` + `global-error.tsx` message FR rassurant ; boundaries sur dashboard/pilotage/carte |
| 12 | Pas de garde-fou quantité aberrante à la saisie | QA / Métier | 🟠 | 200 colis au lieu de 20 → litige + casse | ⚡ | Fort | Plafond souple (modale confirm) + dur serveur ; brancher `max` de `number-input.tsx:41-43` (`Ecran2Order.tsx:1290`) |
| 13 | Indigo/purple résiduel sur indicateur actif (100 % des écrans) | UI / DA / A11y | 🟠 | Identité trahie, doute « bug ? » | ⚡ | Fort | Remplacer `rgb(99 102 241)` et `to-purple-600` par tokens `--brand-*` (`Sidebar.tsx:248,334,416,469`) |
| 14 | Validation date/prix/quantité absente côté API commande | QA | 🟠 | 500 opaque, NaN/négatif silencieux | ⚡ | Fort | `isFinite` + bornes ; valider date dès le garde (`orders/route.ts:146,255`) |
| 15 | Trois systèmes de réorganisation + renommage qui détruit mémoire spatiale | UX / Cognitif | 🟠 | Direction perd ses repères | 🛠️ | Fort | UNE primitive opt-in, supprimer renommage, perso par utilisateur, reset visible, fiche Direction figée |
| 16 | Recouvrement réactif, pas de gel sur litige (la promesse `levels.ts:9` est fausse) | Métier / Recouvrement | 🟠 | Mise en demeure sur créance contestée | 🛠️ | Moyen | Flag litige facture/client, exclu de `suggestLevel`/envoi ; relier Incident→facture (`server.ts:97`) |
| 17 | Pas de scoring de valeur client (A/B/C/D €) | CRM | 🟠 | Gros et petit traités pareil | 🛠️ | Fort | Tier €/marge 12 mois depuis `SapInvoice`, badge + facteur du score priorité (`insights.ts:140-144`) |
| 18 | Sidebar : en-têtes/libellés sous le seuil AA (2,66-4,55:1) | A11y / Direction | 🔴 | Menu « où suis-je » illisible | ⚡ | Fort | Remonter à white/65 (libellés), white/55 (en-têtes) (`Sidebar.tsx:298,304,275,401`) |
| 19 | Hard-delete client + bulk-delete non borné accessibles trop largement | Sécurité / QA | 🟠 | Historique CRM effacé sans trace | ⚡ | Fort | DELETE client → `requireAdmin` ; soft-delete ; borne + récap d'impact bulk (`clients/[id]/route.ts:114`, `bulk/route.ts:54`) |
| 20 | Aucune vue « commandes en retard / non préparées » | Métier / Direction | 🟠 | Commande du matin oubliée → litige | 🛠️ | Fort | Bandeau « en retard & urgent » agrégeant jours passés non « faite » (`LivraisonDetail.tsx:371`) |
| 21 | Pas de north-star quotidienne (CA/commercial/jour vs objectif) | CRM / Pilotage | 🟠 | Commercial sans cap, Direction sans « gagne-t-on ? » | 🛠️ | Fort | Jauge journée en-tête Console + tuile Accueil, reliée à `CommercialObjectif` (`schema.prisma:95-99`) |
| 22 | Incidents sans quantité/montant ni avoir → pertes invisibles en pilotage | Métier | 🟠 | Poste de perte n°1 non quantifié | 🛠️ | Moyen | Qté+valeur (×coût EM) + statut avoir sur Incident/ReceptionIncident (`schema.prisma:184-200`) |
| 23 | Bypass auth preview = console admin sur données réelles | Sécurité | 🟠 | Fuite de toutes les données | ⚡ | Fort | DB de test en preview OU Deployment Protection ; jamais « pas d'auth + données réelles + admin » (`auth.ts:82-96`) |
| 24 | Trois systèmes de cartes + échelle typo fantôme (736 px) | UI | 🟠 | Décodage visuel ×3, rythme cassé | 🛠️ | Fort | UNE famille `SurfaceCard`, échelle typo en tokens (~8 tailles), supprimer demi-pixels (`card.tsx`, `surface-card.tsx`, `SectionCard.tsx`) |
| 25 | Reduced-motion partiel (168 `animate-*` non gardés) + `reducedFade` jamais câblé | Motion / A11y | 🔴 | Anime malgré « réduire » (Direction) | 🛠️ | Fort | Règle balai reduced-motion + hook `useAppMotion()` branchant `reducedFade` (`globals.css:524`, `motion.ts:113`) |
| 26 | Pas d'idempotence/observabilité sync (SyncLog absent sur mirror/delta) | Architecture | 🟠 | Miroir faux sans signal | 🛠️ | Moyen | Écrire SyncLog + badge « SAP synchronisé il y a X min » Accueil/Dashboard |
| 27 | Aucune couche service ; logique métier dans routes 600-800 l. et composants 1500-2200 l. | Architecture | 🔴 | Non testable, divergence (cf. #28) | 🛠️ | Fort | Extraire `services/order.ts` (`createOrder`) ; routes = glu (`orders/route.ts:95-627`) |
| 28 | Duplication `BLDialog`↔`Ecran2Order` (~2500 l.) | Architecture | 🟠 | Correction oubliée dans un des deux | 🛠️ | Fort | Hook `useOrderCart` + composants partagés, adossés à #27 (`TODO-AUDIT.md:72`) |
| 29 | Zéro test sur routes API + `buildApiLines` (promos/net→brut) | QA | 🟠 | Régression facturation invisible | 🛠️ | Fort | Extraire `buildApiLines` en lib testée ; tests permissions/cogs/mapping (`Ecran2Order.tsx:701`) |
| 30 | Élévation de privilèges : Direction peut octroyer isDirection (accès global) sans trace | Sécurité | 🟠 | Vision globale accordable hors contrôle | ⚡ | Fort | `requireStrictAdmin` sur isDirection + audit (`commerciaux/route.ts:72-83`) |
| 31 | AppelLog/Rappel sans auteur → primes/imputabilité non fiables | Sécurité / CRM | 🟠 | Conversion non attribuable | 🛠️ | Fort | `createdBy` sur AppelLog/Rappel (`schema.prisma:557,545`) |
| 32 | Avoir > facture due disparaît du suivi (net plancher 0) | QA / Recouvrement | 🟠 | Trop-perçu invisible, Direction croit soldé | 🛠️ | Moyen | Exposer `avoirResiduel`/`tropPercu`, ne pas filtrer hors liste (`encours/route.ts:334`) |
| 33 | Aucun actif de marque (logo/favicon), nom générique « TeleVent » | DA | 🔴 | Outil anonyme, ne dit pas « Gervi » | 🛠️ | Fort | Logo+favicon+apple-icon, composant `<Logo/>` unique, intégrer « Gervi » (`public/`, `layout.tsx:17`) |
| 34 | Trois colorimétries diluent l'identité ; jaune « Controllino » sans lien produit | DA | 🟠 | Pas de reconnaissance de marque | 🛠️ | Fort | Trancher UNE couleur (rouge-fraise mûr) ; switcher en réglage admin si maintenu (`ColorimetrieSwitcher.tsx`) |
| 35 | Inventaire : échec partiel verrouille sur stock incohérent | QA | 🟠 | Écart de stock figé, FIFO faussé | 🛠️ | Moyen | Reprise ciblée de l'étape non aboutie + alerte explicite (`inventaire/adjust/route.ts:95`) |
| 36 | Modif BL reconstruit la collection → perte de lignes texte/frais, dérive de lot | QA / Métier | 🟠 | Lignes supprimées silencieusement | 🛠️ | Moyen | Recharger+fusionner côté serveur, préserver lignes non éditables (`modif/route.ts:324`) |
| 37 | Tutoiement systématique vs persona Direction (incohérent avec Paramètres) | UX / Éditorial | 🟡 | Registre peu sérieux pour décideur | 🛠️ | Moyen | Vouvoiement sur écrans transverses (accueil/dashboard/encours/fiche) (`CallConsole.tsx:671`) |
| 38 | Page Paramètres à 8 réglages (surcharge Hick) | Cognitif / Direction | 🟠 | Direction craint de tout dérégler | 🛠️ | Moyen | Scinder « Affichage » (3) / « Avancé » replié ; SAP en onglet admin (`ParametresPanel.tsx:224`) |
| 39 | Désactivation télévente en 1 clic sans confirmation (unitaire + masse) | UX | 🟡 | Client GMS jamais rappelé, CA perdu | ⚡ | Moyen | Confirmation masse + toast réversible (`ClientTable.tsx:824`, `PlanAppel.tsx:343`) |
| 40 | README obsolète, aucune vision produit écrite | Produit | 🟡 | Dérive (sprawl ERP), vision floue | ⚡ | Moyen | `PRODUCT.md` (promesse, 4 personas, north-star, do/don't) + charte ADN 1-pager |

### Items net-nouveaux issus de l'audit CRM dédié (07)

> Ces items couvrent les constats CRM non déjà adressés par les 40 ci-dessus. Lorsqu'un constat 07 est déjà couvert, il est *référencé* sans être dupliqué : **#4** (moteur de prochaine action / file priorisée — couvre 07-#6), **#5** (cycle de vie — couvre 07-#1), **#17** (scoring de valeur — couvre 07-#2), **#21** (north-star / pilotage — connexe 07-#6), **#31** (auteur AppelLog/Rappel). Les items #41→#49 sont les apports strictement nouveaux.

| # | Problème | Dimension(s) | Sév. | Impact métier | Effort | ROI | Reco |
|---|----------|--------------|:----:|---------------|:------:|:---:|------|
| 41 | Issue d'appel binaire `COMMANDE`/`DEMAIN` → motifs de non-vente et joignabilité invisibles | CRM / Pilotage | 🔴 | Pas de NRP/Refus/Répondeur/Litige, churn de joignabilité non détecté | ⚡ | Fort | Enrichir `outcome` de l'AppelLog (NRP / Refus / Répondeur / Litige / Rappel demandé…) ; brancher l'UI verdict console (`validations.ts:90`, `CallConsole.tsx`) |
| 42 | Taux de conversion biaisé : appels non décrochés jamais logués → « commandes ÷ appels aboutis » surestime | CRM / Pilotage | 🟠 | Décisions de primes/objectifs faussées | ⚡ | Moyen | Logger tous les contacts (adossé à #41) ; recalculer la conversion sur **contacts réels** (appels passés au dénominateur) (`console/route.ts:222-224`, `insights.ts:63`) |
| 43 | File d'appel = calendrier statique ; tri à l'écran cosmétique (client) au lieu d'une priorisation serveur | CRM / Productivité | 🔴 | Gros comptes en retard noyés dans la liste, flair au lieu de données | 🛠️ | Fort | Trier la queue **côté serveur** par `valeur × urgence` (et non par nom/heure) ; brancher les insights en amont du tri (`console/route.ts:160-162`, `CallConsole.tsx:190-208`) — alimente le moteur #4 |
| 44 | Seuil de relance codé en dur (+7j / 30j), identique client quotidien et mensuel | CRM / Pertinence | 🟠 | Faux positifs/négatifs garantis sur grossiste fraises (quotidien « perdu » à J+5, pas J+30) | ⚡ | Fort | Seuil **relatif à l'intervalle médian** du client (`insights.medianIntervalDays`) au lieu du `d > 7` fixe (`CallConsole.tsx:828-831`, `pilotage.ts`) |
| 45 | Habitudes produit = tableau passif, aucune détection de rupture de réassort par article | CRM / Panier | 🟠 | Manque à gagner direct (« 20 colis fraise ronde/sem., rien cette semaine » jamais signalé) | 🛠️ | Fort | Détecter les **ruptures d'habitude produit** : croiser cadence attendue par article × date de dernier achat → liste de réassorts à pousser pendant l'appel (`ProduitsRecurrents.tsx:84-99`, `recurring/route.ts:81-83`) |
| 46 | Saisonnalité fraise ignorée : YoY en cumul YTD lisse le pic mai-juin, aucune réactivation de saison | CRM / Métier | 🟡 | Clients fraise de saison non réveillés au pic → CA de saison perdu | 🛠️ | Moyen | Comparatif **semaine N vs N-1** + campagne de **réactivation saisonnière fraise** (pré-pic), s'appuyant sur `lib/events` (`ComportementYoY.tsx:60-70`) |
| 47 | Encours non relié à l'action commerciale : compte gelé/>90j n'alerte ni en file d'appel ni au BL | CRM / Recouvrement | 🟠 | Vente à crédit possible à un client en contentieux ; recouvrement non poussé | 🛠️ | Moyen | Remonter « **gelé / >90j** » comme badge/alerte **dans la console et au moment du BL** (`EncoursCredit.tsx:70-101`, absent de `console/route.ts`) |
| 48 | Valeur client (CA 12 mois) absente de toute la chaîne de priorisation | CRM / CA | 🟠 | On traite un client à 2 k€ et un à 120 k€ au même rang | 🛠️ | Fort | **Joindre le CA 12 mois (mirror SAP)** partout où l'on priorise : fiche, file console, « à relancer », plan d'appel (`console/route.ts:103-123`, `plan-appel/route.ts:71-94`) — entrée du score #17 |
| 49 | Rappels 100 % manuels : aucune génération automatique de rappel/tâche sur événement | CRM / Fidélisation | 🟠 | Dormance/encours/baisse YoY ne déclenchent rien ; la Direction *cherche* au lieu d'être *alertée* | 🛠️ | Moyen | **Génération système de rappels/tâches sur événement** (dormance, franchissement de palier R0→R5, baisse YoY), poussés via la cloche de notifications existante (`reminders/route.ts:61-117`, `notifications/route.ts:5-19`) |

> *Note de dédoublonnage :* la redistribution automatique de la file d'un commercial absent (07-#9) et l'élargissement du canal de notifications aux signaux CRM (07-#14) sont des dérivés directs respectivement de la file priorisée (#43/#4) et de la génération de rappels (#49) ; ils sont traités comme sous-chantiers de ces items et non comme entrées distinctes.

---

## 5. Roadmap de transformation (par vagues)

### Vague 0 — Quick wins (0-2 semaines)
**Objectif :** corriger les défauts à très fort ROI/faible effort, surtout ceux qui rassurent la Direction et sécurisent l'argent.
**Items :** #3 (contraste CTA), #18 (sidebar AA), #13 (purge indigo réelle), #11 (error boundary), #10 (crons + auth machine), #12 (garde quantité), #14 (validation API), #19 (delete client gaté + bulk borné), #23 (bypass preview), #30 (strictAdmin isDirection), #39 (confirmation désactivation), #40 (PRODUCT.md + charte ADN), **#41 (outcome d'appel enrichi — quick win à fort effet de levier sur tout le pilotage)**, **#44 (seuil de relance relatif à l'intervalle médian)**. Bonus a11y quasi gratuits : `aria-current` sidebar, DialogDescription console.
**Résultat attendu (KPI) :** 100 % des CTA et libellés sidebar passent AA ; 0 page d'erreur brute ; fraîcheur du miroir < 10 min en continu ; 0 double-BL par double-clic ; chaîne destructive client tracée et gatée ; verdicts d'appel multi-issues opérationnels.

### Vague 1 — Fondations CRM & confiance Direction (1-2 mois)
**Objectif :** poser la colonne vertébrale CRM et faire de l'app un outil que la Direction comprend en <3 s.
**Items :** #5 (cycle de vie), #4 (moteur de prochaine action), #17 (scoring valeur), #7 (gating fournisseur/stock), #8 (AuditLog), #15 (unifier réorganisation, fiche Direction figée), #38 (simplifier réglages), #37 (vouvoiement transverse), #31 (auteur AppelLog/Rappel), #11/#25 (filet runtime + reduced-motion complet), **#42 (conversion recalculée sur contacts réels)**, **#43 (file d'appel triée serveur par valeur×urgence)**, **#47 (encours remonté en console et au BL)**, **#48 (CA 12 mois affiché partout où l'on priorise)**, **#49 (génération automatique de rappels/tâches sur événement)**.
**Résultat attendu (KPI) :** badge cycle de vie visible partout ; file « à traiter aujourd'hui » triée serveur par valeur×urgence en tête Accueil+Console ; tier valeur + CA 12 mois sur chaque client priorisé ; 0 action fournisseur/stock sans rôle ; journal d'audit consultable ; taux de conversion calculé sur appels passés ; encours gelé/>90j alerté dans la console.

### Vague 2 — Intelligence métier (2-4 mois)
**Objectif :** outiller la fraîcheur, le recouvrement proactif, la saisonnalité et l'identité propre — gagner la promesse métier.
**Items :** #1 (saisie DLC), #2 (FIFO réel), #6 (fraîcheur en console/préparation), #20 (commandes en retard), #16 (gel relance sur litige), #22 (incidents chiffrés+avoirs), #21 (north-star CA/jour), #32 (avoir résiduel), #33 (logo/favicon/identité), #34 (couleur de marque unique), **#45 (détection de rupture d'habitude produit / réassort)**, **#46 (comparatif saison semaine N vs N-1 + réactivation saisonnière fraise)**.
**Résultat attendu (KPI) :** DLC saisie sur 100 % des réceptions fruits frais ; tuile « à écouler » active ; 0 relance sur facture en litige ; identité Gervi visible (logo, favicon, couleur unique) ; alertes de réassort produit poussées en appel ; campagne de réactivation saisonnière déclenchée au pré-pic fraise.

### Vague 3 — Échelle & raffinement (4-6 mois)
**Objectif :** solder la dette technique et raffiner.
**Items :** #27 (couche service), #28 (hook commun panier), #29 (tests routes/buildApiLines), #24 (design system : cartes+typo), #26 (observabilité sync + SyncLog), #35 (reprise inventaire), #36 (fusion modif BL), #21 (vue mouvements de portefeuille Direction), redistribution auto de la file d'un commercial absent (sous-chantier de #43), RGPD (purge, opt-out Contact, registre), React Compiler readiness, doctrine motion (success-burst sur commande, marquee promos par défaut statique).
**Résultat attendu (KPI) :** couverture de tests sur le cœur facturation ; un seul système de cartes/typo ; DSO suivi ; dette `scripts/` DDL rapatriée en migrations.

---

## 6. Visions

### Vision Produit
TeleVent doit cesser d'être « un miroir SAP joli » pour devenir **la machine à reprise, fidélisation et encaissement du grossiste fraise**. Le produit ne montre pas des données, il dit quoi faire : chaque écran répond à « quelle est la prochaine action ? ». *Principes :* Beginner Friendly + Expert Fast tenu pour les deux personas opposés (Direction rassurée / commercial rapide) ; assumer un **CRM de portefeuille** (reprise+fidélisation+recouvrement), pas un outil d'acquisition ; ne pas étendre la couverture ERP tant que la colonne vertébrale CRM n'est pas posée ; une vision écrite (`PRODUCT.md`) pour cadrer la dérive.

### Vision CRM
Un client a un **état** (cycle de vie dérivé de son propre rythme), une **valeur** (tier €/marge), et un **flux d'actions** priorisé par valeur×urgence. La donnée existe (`insights`, `SapInvoice`, `segments`) — il s'agit d'orchestrer, pas de collecter. *Principes :* l'intervalle médian propre à chaque client définit « en retard » (un CHR à 3 jours ≠ un export à 45 jours) ; la priorisation pondère toujours par l'enjeu ; les rappels deviennent des tâches first-class avec une vue « Aujourd'hui » transverse ; la Direction obtient une vue « mouvements de portefeuille » (entrants/sortants/à risque pondérés €).

**Cible CRM (audit dédié 07).** La cible opérationnelle est une **file d'actions unique, priorisée par valeur × urgence**, fusionnant en une seule queue serveur les clients du jour (calendaire), les retards relatifs à la cadence, les dormants à réveiller, les ruptures d'habitude produit, la saison à relancer et les encours à recouvrer — chaque carte portant sa **next-best-action écrite en clair** (« Appeler — habituellement 18 colis Gariguette/sem., rien depuis 9 j »). Elle suppose une **traçabilité d'interaction complète** (`outcome` enrichi Commande/NRP/Répondeur/Refus/Litige, conversion et joignabilité recalculées sur contacts réels) et des **relances/tâches générées automatiquement** sur événement (dormance, franchissement de palier R0→R5, baisse YoY), poussées par la cloche de notifications : *la Direction est alertée, elle ne cherche plus*. En une phrase : TeleVent a déjà le **moteur de saisie** d'un excellent outil de télévente ; il lui manque le **cerveau CRM** — la couche qui décide *qui* rappeler, *pourquoi* et *dans quel ordre* — et toutes les données nécessaires (insights, mirror SAP, encours, habitudes produit) sont déjà là.

### Vision ERP (ce qu'on garde et comment l'effacer derrière le CRM)
SAP reste la **source de vérité** ; TeleVent en est le miroir et l'interface humaine. *Principes :* GARDER ce qui sert le terrain et n'existe pas bien dans SAP (réception avec litiges chiffrés, fabrication kits, inventaire guidé) ; SURVEILLER les modules de pure consultation (products/livraisons — risque de read-only à faible valeur) ; **documenter « SAP fait foi » sur chaque écran miroir** et afficher la fraîcheur de synchro pour rassurer la Direction (« lequel a raison ? » résolu). Effacer l'ERP derrière le CRM = l'utilisateur ne « gère » pas du stock, il « pousse la fraise qui périme au bon client ».

### Vision Graphique / Direction Artistique
Une marque, une couleur, un symbole — qui disent **Gervi et la fraise**, pas « template SaaS 2024 ». *Principes :* trancher UNE couleur de marque issue du produit (rouge-fraise mûr profond sur socle anthracite premium), le jaune/or relégué au sémantique (alertes) ; reconvertir la métaphore « radar/signal » vers la fraîcheur/marché du matin, et ne garder le « signal » que là où il a un sens (live console) ; créer un vrai système de marque (logo, favicon, `<Logo/>` unique) ; arbitrage tranché : **supprimer le switcher 3 colorimétries de la barre** (réglage admin au plus) car une marque ne peut pas avoir trois identités ; écrire une charte d'ADN (do/don't) qui rend les chantiers cohérents au lieu de cosmétiques.

### Vision Technique
Une base mûre qu'on solidifie par trois chantiers structurants : une **couche service** (la logique métier sort des routes et composants géants, devient testable et unique), une **orchestration de synchro fiable** (crons, swap atomique pour le full-reset, SyncLog observable), un **filet runtime** (error boundaries, idempotence, validation d'entrée systématique). *Principes :* un seul endroit construit le payload commande ; toute action engageante est idempotente, validée et tracée ; le schéma a une source de vérité unique (rapatrier les DDL `scripts/` en migrations Prisma) ; TanStack Query remplace les `setInterval` ad-hoc.

---

## 7. KPIs de succès & risques

### KPIs de la transformation
- **Productivité commerciale :** temps moyen de saisie d'une commande (cible : −30 %) ; nombre d'appels **utiles** (= sur clients priorisés par valeur×urgence) par commercial/jour ; CA/commercial/jour vs objectif (`CommercialObjectif`).
- **Reprise & fidélisation :** taux de reprise des clients qui décrochent (rentrent en « en retard » puis re-commandent) ; taux de réactivation des « endormis » ; % du portefeuille en état « actif » ; taux de réassort capté via les alertes de rupture d'habitude produit ; CA de réactivation saisonnière fraise (pré-pic).
- **Fraîcheur & marge :** % de réceptions fruits frais avec DLC saisie (cible 100 %) ; valeur de casse/démarque évitée via la tuile « à écouler » ; % de lignes vendues sous coût (cible ≈ 0 hors déstockage assumé) ; couverture du coût EM (réduire les 5,1 % de CA sans `lineCost`).
- **Recouvrement / trésorerie :** DSO et son évolution (north-star secondaire) ; nombre de relances déclenchées proactivement par paliers ; 0 relance envoyée sur facture en litige ; encours gelé/>90j signalé en console (cible 100 %).
- **Pilotage CRM (apport audit 07) :** taux de conversion calculé sur **appels passés** (et non aboutis) ; taux de joignabilité par client suivi ; % de clients du portefeuille avec un état de cycle de vie et un tier valeur renseignés (cible 100 %) ; part de la file d'appel priorisée serveur par valeur×urgence (cible 100 %).
- **Confiance Direction :** NPS interne « je comprends ce qui se passe en <3 s » ; 0 page d'erreur brute observée ; 100 % des actions sensibles tracées dans l'AuditLog.
- **Robustesse :** 0 double-BL ; fraîcheur du miroir SAP < 10 min en continu ; couverture de tests sur le cœur facturation (`buildApiLines`, `createOrder`).

### Top 5 risques de la transformation & mitigation
1. **Diluer l'effort sur l'ERP-bis** au lieu d'investir le différenciateur CRM (sprawl). *Mitigation :* `PRODUCT.md` qui tranche construire/surveiller/ne-pas-faire ; geler l'extension ERP jusqu'à la colonne vertébrale CRM (Vague 1).
2. **Données métier manquantes** (DLC, `vendeur`, `type`, lots vides) qui bloquent les fonctions fraîcheur/CRM. *Mitigation :* la saisie DLC (#1) et la complétion `vendeur`/`type` sont des prérequis process à lancer en parallèle de la Vague 1, côté SAP — pas du code à forcer à l'aveugle.
3. **Régression sur le cœur facturation** lors de la refonte couche service/hook commun. *Mitigation :* extraire et tester `buildApiLines`/`createOrder` AVANT toute refonte (#29 précède #27/#28) ; client SAP mocké.
4. **Rejet par la Direction** d'un outil qui change trop vite ses repères. *Mitigation :* fiche Direction figée non éditable, vocabulaire verrouillé, vouvoiement, ambiance sobre par défaut ; déployer les quick-wins de confiance (Vague 0) avant les chantiers visibles.
5. **Bascule/incohérence SAP non détectée** (base TEST oubliée, miroir partiel) qui fait perdre des commandes ou affole la Direction. *Mitigation :* bandeau permanent « BASE ACTIVE », SyncLog + badge fraîcheur, full-reset transactionnel (staging+swap), crons surveillés.

---

**Arbitrages notables (où les audits divergeaient) :**
- *Mobile commercial* (UX #11 le juge amputé / Cognitif le défend) : **tranché** — valider d'abord le besoin réel avec les commerciaux ; la densité console est mal adaptée au tactile, donc priorité basse (Vague 3+), pas un chantier de transformation.
- *Prospects/acquisition* (Product Director #6) : **tranché** — assumer le CRM de portefeuille, ne PAS construire de tunnel d'acquisition (ce n'est pas le besoin n°1 d'un grossiste en télévente).
- *Ambiance « salle de signal »* (UI/Motion la comptent en force / DA la juge hors-sujet) : **tranché** — c'est une force d'exécution mais un contresens d'ADN ; on garde la sobriété et la perf, on reconvertit la métaphore vers la fraîcheur et on coupe le superflu (radar, marquee permanent), sans tout jeter.
- *Trois colorimétries* (UI les voit comme architecture saine / DA comme dilution de marque) : **tranché côté DA** — une marque = une identité ; le switcher quitte la barre, devient au mieux un réglage admin avec défaut imposé.
- *Tri de la file d'appel* (la file calendaire actuelle est défendable côté simplicité / l'audit CRM 07 la juge structurellement insuffisante) : **tranché côté CRM** — le calendrier reste le filtre d'inclusion, mais le **tri devient serveur, par valeur×urgence relative à la cadence du client** (#43) ; le tri client cosmétique est supprimé. C'est le constat structurant de l'audit 07.
