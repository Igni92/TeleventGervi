# Refonte UI/UX — état d'avancement et reste à faire

> Document de pilotage de la refonte graphique complète (style Apple).
> Branche : `refonte-ui` · dépôt de travail : `/home/ubuntu/refonte` (clone).
> **La prod (`/srv/televent/app`, branche `audit-robustesse`) n'est PAS touchée** tant que la refonte n'est pas validée.
> Mise à jour à chaque vague. Dernière mise à jour : 18 août 2026.

---

## Le plan en 7 vagues

| Vague | Contenu | État |
|---|---|---|
| 0 | Fondations : design system tokenisé, primitives | ✅ committée `fb12624` |
| 1 | Coquille : navigation, sidebar, badges, login, tab bar | ✅ committée `233fc44` |
| 2 | Livraisons (frustration n°1 mesurée) | 🔴 À REFAIRE (panne de crédit, 0 fichier écrit) |
| 3 | Console + Écran 2 (1 779 clics morts mesurés) | ⬜ à faire |
| 4 | Commerce : clients, fiche, prospection, encours, effectifs | ⬜ à faire |
| 5 | Marchandise : entrées, CF, bons de commande, inventaire, fabrication, stock/articles | ⬜ à faire |
| 6 | Pilotage + RH + réglages + nettoyages finaux | ⬜ à faire |
| — | Bascule en prod | ⬜ après validation utilisateur |

---

## Décisions actées (validées par GO utilisateur)

1. **Un seul système visuel** : le « skin apple » en surcouche et le thème classique sont morts.
   Les tokens Apple sont LE thème (`:root`/`.dark`). Réglage Jour/Nuit conservé.
2. **Navigation 24 → ~13 entrées**, source unique `lib/navigation.ts`.
   Console fusionnée (`/console` + écran 2), groupe SYSTÈME supprimé.
3. **Régime à deux vitesses** : écrans de production denses (console, livraisons, saisie),
   hubs/fiches/réglages aérés. L'échelle typo fermée s'applique partout.
4. **« Extraire avant de re-styler »** : chaque monolithe est découpé en modules
   AVANT sa refonte visuelle.
5. **Space Grotesk retirée** — pile système partout (SF sur Apple, Inter ailleurs).
6. **Segments unifiés** : GMS = teal · CHR = ambre · EXPORT = violet, une seule
   constante `SEGMENT_BADGE` dans `lib/segments.ts`.

## Contrat du design system (rappel pour les prochaines vagues)

- **Typo** (Tailwind, la seule autorisée — pas de `text-[NNpx]`) :
  `caption2` 11 · `caption` 12 · `body` 13 · `callout` 15 · `title3` 17 · `title2` 22 · `title1` 28.
- **Rayons** : `md` 6 · `lg` 10 · `xl` 14 · `2xl` 20. **Ombres** : `shadow-card/card-hover/nav/modal`.
- **Filet** : `--hairline` 0,5 px. **Mouvement** : `--ease-apple`, `--dur-fast` 140 ms, `--dur-base` 240 ms.
- **Couleur** : or = seul accent ; vert/ambre/rouge/bleu = états uniquement ; violet réservé au tarif client.
- **Primitives** (`components/ui/`) : `GroupedList`/`GroupedRow`, `SegmentedControl`, `StatLine`,
  `EmptyState`, `Banner`, `ConfirmDialog` (+ Button hiérarchie UIKit, Badge pilule, Dialog `size=`).
- **Doctrine** : listes groupées > cartes empilées · badges max 2 + « +n » · toute action au clic droit
  doit exister AUSSI dans un menu « ⋯ » visible (tablettes) · états vides = `EmptyState`,
  chargements = `Skeleton` · `window.confirm` interdit.

---

## ✅ Fait — vague 0 (`fb12624`)

- `globals.css` 1 378 → 589 lignes ; tokens promus, CSS mort purgé
  (data-theme fantômes, grain, aurora, nudge, `svg.lucide{zoom:1.3}`).
- Échelle typo fermée + rayons + ombres dans `tailwind.config.ts`.
- 6 primitives créées ; Button/Badge/Dialog/FullscreenPanel refondus (API intactes).
- Segments unifiés (6 écrans migrés). Gardes `data-floating-root` intouchées.

## ✅ Fait — vague 1 (`233fc44`)

- `lib/navigation.ts` source unique ; palette ⌘K, tuiles mobiles, MobileTopBar en dérivent.
- Sidebar réécrite (924 → ~430 lignes) : claire au thème clair, sans voile de navigation,
  mode édition extrait en chargement différé (`SidebarEditMode.tsx`).
- `/api/nav-badges` : 5 pollings → 1 endpoint (cache 60 s, split global/utilisateur).
- Login re-designé ; porte d'entrée unique `/accueil` (login + racine + proxy).
- `TabBar` basse tactile (5 onglets), TopStrip local à l'accueil, AmbientBackground démonté.

### Effets de bord assumés (vague 1)
- Favoris des tuiles mobiles réinitialisés (changement de taxonomie).
- Un renommage admin stocké sur `/console` masque le nouveau libellé jusqu'à ré-enregistrement.
- Un label de catégorie disparu référencé par une surcharge peut réapparaître en bas de barre
  jusqu'au prochain enregistrement admin (cf. `buildNavLayout`).

---

## 🔴 Vague 2 — Livraisons (À REFAIRE INTÉGRALEMENT)

La tentative du 18/08 a été tuée par la panne de crédit : **aucun fichier écrit**.
Script réutilisable : `workflows/scripts/refonte-vague-2-wf_43e63722-5a1.js` (session data).

### Étape A — découpe (séquentielle, AVANT la refonte)
`components/livraisons/LivraisonDetail.tsx` (3 551 lignes) → modules sous `components/livraisons/detail/` :
`DatePanel` · `CarrierGroup` · `OrderRow` · `dialogs` · `menus`. Zéro changement de comportement,
orchestrateur < 900 lignes, tests au vert avant de continuer.

### Étape B — refonte (4 chantiers parallèles)
1. **Page** : 7 bandeaux → 2 étages (titre = « Livraison du mardi 19 août » + DateStepper ;
   une seule barre d'outils en SegmentedControl neutre) ; SummaryRow → StatLine ;
   bons export en ligne repliée ; **auto-refresh 45 s (onglet visible) + revalidation au focus**
   en préservant état déplié et saisies en cours ; ConfirmDialog ; Skeleton.
2. **Lignes** : transporteurs en GroupedList (nom + « 12 cmd · 340 colis · 1,2 t » tabulaire) ;
   ligne = bouton d'état (seule action colorée, cible h-9 min) + 2 badges max + menu « ⋯ » visible
   reprenant TOUT le clic droit ; articles dépliés en liste hairline, chips → texte muted.
3. **Ventes du jour** : rattachée aux onglets Livraisons (5ᵉ onglet), retirée de la nav Télévente ;
   BigStateMessage → EmptyState ; 5 tuiles → StatLine ; 2 coches → 1 indicateur 3 crans ;
   une seule affordance de clic.
4. **Satellites** : /preparations en GroupedList par date **avec totaux de charge (colis, kg)** ;
   pastille « À préparer » répétée supprimée ; /manquants et « Par article » au même langage.

### Étape C — intégration
tsc + 717 tests (TZ=Europe/Paris) + build ; vérifier : deep-link `?date=&open=&t=`,
5 onglets de section, aucun `window.confirm` restant dans le pôle, **le polling n'écrase
jamais un champ en cours de frappe**.

### Flux métier à préserver (liste de contrôle)
Date auto J+1/samedi→J+2 + férié + report · deep-links · états optimistes + rollback
(mise en prépa BL/groupée, fait avec **saisie palettes**, départ avec garde-fou lots) ·
remise sur file + manquants cochables · claim préparateur · ré-attribution « Fait par » ·
dispatch inline (canDispatch) · saisie lot inline + LineToolMenu + échange d'article ·
avoir/exclu · impressions (bon de prépa, bon de transport ORIGINAL+COPIE, mail) · PreparateurNav.

---

## ⬜ Vague 3 — Console + Écran 2

Extraction d'abord : `CallConsole.tsx` (2 799 l.) et `Ecran2Order.tsx` (3 251 l.) → modules
(`QueueRow`, `CartLine`, `StockRow`, panneaux). Puis :

**Console (écran 1)** — réponses aux clics morts mesurés (656) :
- 5 tuiles stats hover-lift non cliquables → **ligne de texte calme** dans le header.
- Téléphone `<span>` → lien `tel:` ; pastilles « jours d'appel » → texte passif ou vrais toggles.
- Tuiles « Familles régulières » → cliquables (historique produit / pré-remplir écran 2).
- 3 bandeaux d'alerte concurrents → une section « Rappels dus » épinglée en tête de file.
- File en liste groupée sticky (Rappels dus / À appeler / Faits) ; 1 signal couleur + 1 badge max
  par ligne ; le reste (tier, lifecycle, incidents) au panneau central.
- Un seul langage de section au centre (titre 13 semibold + hairline) ; fusion NotesCluster ;
  max 3-4 métriques visibles, le reste derrière « Plus ».
- Poignées de réordonnancement visibles + Monter/Descendre dans le kebab (tactile).
- États : skeletons, état « tout est fait » sobre (fin du néon + emoji).
- ~15 InfoTip → dégraissage massif.

**Écran 2** — réponses aux 1 123 clics morts :
- Tuile panier : **clic simple = sélection/édition** + bouton « ⋯ » visible par ligne
  (dupliquer/remplacer/réordonner) ; récap au clic simple sur l'en-tête (fin du double-clic).
- Chips marque/condi/calibre/variété/pays → **texte muted** « Karima · 8×500g · cal. 20 · Belgique »
  (l'alerte DDM seule reste colorée) — sur les DEUX colonnes.
- « N° de commande » + « Texte du BL » déplacés au pied de la colonne COMMANDE.
- Bandeau client compacté 1 rangée ; frise semaine + notes → popover cliquable « Historique ».
- En-tête panier : « Commande — total » + « Dupliquer la dernière » (avec libellé) ;
  Sofruce dans une section « Options » repliable du pied ; en modif, fusion bandeau ambre + en-tête.
- Panneau marge réduit à 1 ligne (feu tricolore + chiffre) ; détail en popover.
- Palette : 4 rôles (brand action / vert validé / ambre attention / rouge bloquant),
  violet = tarif uniquement ; fin des emojis dans les `<option>`.
- Tablette : barre de validation sticky en bas (total + Créer).
- Garde-fous, consoleSync, mode MODIF, favoris, Sofruce, tournée obligatoire : intouchés.

## ⬜ Vague 4 — Commerce

- **/clients** : 8 tuiles → 3-4 KPI-filtres réels ; 6 selects → recherche + bouton « Filtres »
  (popover + chips actives) ; vue liste par défaut ; une seule cible de clic (fiche),
  actions secondaires en menu ; admin (« Déduire vendeurs », import) dans « ⋯ » ; skeleton.
- **/clients/[id]** : header aplati (fin radar/halo/grille/pastille pulsante) ; un accent ;
  sections en GroupedList ; onglet Commercial en 2 zones (principal + rail) ;
  « Personnaliser » dans un menu ⋯ ; rappels + journal fusionnés en timeline.
- **/clients/new** : 3 groupes titrés (Identité · Contact · Plan d'appel), tokens (fin bg-white).
- **/prospection** : couleurs → tokens (fin des hex sombres) ; cartes allégées ; admin dans « ⋯ » ;
  vrais menus Radix (fin des selects déguisés) ; zone Perdus consultable ; FichePanel en feuille standard.
- **/encours** : 3 colonnes de tranches → 1 colonne « Retard » avec pastille de sévérité ;
  une affordance par ligne ; relance en feuille 2 étapes ; R0-R5 en liste radio libellée ;
  skeleton (SAP lent) ; fin des emojis.
- **/commerciaux** : carousel → liste comparative (3 rangées, colonnes alignées, sparkline) ;
  scission Performance / Équipe ; StatBlock partagé ; alerte « sans commercial » actionnable en tête.
- **/commerciaux/[slp]** : accent unique, période dans le header, skeleton au changement de période.

## ⬜ Vague 5 — Marchandise

- **`DocumentLinesEditor` partagé** entre /entrees et /commandes-fournisseurs (~400 lignes dédupliquées).
- **/entrees** : un flux — bouton « Nouvelle entrée » ouvre le formulaire, la liste du jour est LA une ;
  tableau de saisie 12 → ~5 colonnes (article = nom + code + chips regroupés) ;
  « Affecté à » en SegmentedControl neutre (fin des 4 couleurs pleines) ;
  historique en liste groupée par jour ; badge statut unique à 4 tons ;
  actions du détail avec libellés (fin des icônes seules).
- **/commandes-fournisseurs** : « À réceptionner aujourd'hui » en tête ; « Réceptionner » en action
  primaire du FullscreenPanel ; création derrière un bouton du PageHeader ; agréage en liste unifiée.
- **/bons-commande** : offres + bons en UNE liste à étapes ; ligne lot restructurée (2 niveaux) ;
  menu de lot en groupes titrés (fin de l'émoji 🍓) ; pipeline en 2 StatBlocks-filtres ;
  fin des `window.confirm`.
- **/inventaire** : home en 2 zones (héros progression + familles en liste) ; récap en une surface
  + barre d'envoi sticky ; historique en lignes compactes ; fin des emojis-boutons ;
  `EcartBadge` partagé (sémantique unifiée manque/excédent).
- **/fabrication** : « Fabriquer » seul à l'écran (assistant 3 étapes, marge en gros près du bouton) ;
  Recettes/Historique en onglets ; suppression `ui.tsx` local (→ DesignationChips + lib/format) ;
  supprimer les composants morts (RecipeAdmin/BomAdmin/FabricationForm non référencés — vérifier).
- **/products + /articles** : trancher fusion ou lien croisé ; ligne unique « Article »
  (nom + chips + code) ; barre sync réduite à une ligne discrète ; jours de livraison CF
  accessibles au tap ; th sticky sur tokens (fin des slate en dur) ; tri aligné.

## ⬜ Vague 6 — Pilotage, RH, réglages, nettoyages

- **/dashboard** : 6 accents → 1 ; bande KPI sans cartes ; popovers hover → tap ;
  échelle typo (fin des 8,5-10,5 px) ; fin du glow jaune rgba en dur ; un seul état de chargement ;
  modales → routes sheet partageables.
- **/dashboard/magasins** : Podium fusionné avec le board marges ; 6 boards → une liste à segments ;
  scatter relié à la table (clic point → ligne) ; textes lisibles en clair.
- **/dashboard/ecran2** : header cockpit commun (fin du pl-36) ; 3 vues en onglets visibles ;
  une seule implémentation de matrice.
- **/transport** : 2 onglets par audience (Coûts & tarifs / Dépenses) ; prix position en héros ;
  lignes de coût en liste groupée ; barre sticky si modifications non enregistrées.
- **/planning** : sélecteur de mois global unique ; palette 10 → 4 familles + légende ;
  formulaire de demande en barre contextuelle sticky ; popover au tap sur cellule (fin des title) ;
  équipe mobile en liste par personne.
- **/heures** : CongesPanel SUPPRIMÉ (renvoi vers /planning — un seul circuit) ;
  profil replié derrière un disclosure ; synthèse hiérarchisée (fin des 9 badges) ;
  « PDF compta (tous) » déplacé en bas de la section équipe.
- **/salaires** : EmployeeCard aplatie en 3 zones ; manquants en checklist actionnable ;
  commissions en tableau 4 colonnes + menu ⋯ ; « Envoyer au comptable » en barre sticky ;
  orthographe accentuée ; fin des `window.confirm`.
- **/parametres** : scission Préférences / Administration ; descriptions visibles en sous-titre
  (fin du « ? » hover-only) ; effets festifs réduits à un toggle ; boutons admin hiérarchisés ;
  **suppression du réglage « skin »** (un seul thème désormais).
- **/etat-documentaire** : racine en liste groupée ; aperçu vs actions dissociés dans la cellule ;
  **boutons explicites « Facturer »/« Créer un avoir »** (le drag-drop Kanban ne marche pas au tactile) ;
  constante partagée couleurs de type de doc.
- **/promos** : fin du fond noir forcé ; badge promo en héros à gauche ; vrai Switch Actif/Inactif ;
  sections Actives/Inactives ; « se termine dans 3 j » en accent.
- **Nettoyages finaux** :
  - Purger le système de skins : `lib/useSkin.ts` (plus aucun consommateur),
    `data-skin` dans `app-settings.ts` + script anti-FOUC de `layout.tsx`, réglage /parametres.
  - Supprimer `components/AmbientBackground.tsx` (orphelin), composants fabrication morts.
  - `proxy.ts` : vérifier qu'il ne reste aucune redirection vers /clients.
  - Dernier balayage : `grep -rn 'text-\[' components/ app/` et hex `#[0-9a-f]{6}` → zéro
    hors documents imprimés ; `window.confirm` → zéro.
  - Variantes Button `success`/`warning` : migrer les ~7 usages vers tone, puis supprimer.

## ⬜ Bascule en prod (dernière étape, sur validation explicite)

1. Validation visuelle par l'utilisateur sur l'aperçu (desktop + **tablettes d'entrepôt**).
2. Merge `refonte-ui` → `audit-robustesse` (la branche que la prod suit), build, restart.
3. Surveiller la télémétrie (`UsageScreenView`/`UsageEvent`) : les clics morts sur console/écran 2
   et les relances sur /livraisons doivent chuter — c'est LE critère de succès mesurable.
4. Démonter l'aperçu : `sudo rm /etc/nginx/sites-enabled/refonte-preview.conf && sudo systemctl reload nginx`
   puis `sudo ufw delete allow 8443/tcp`. Supprimer `/home/ubuntu/refonte` une fois mergé.

---

## Chantiers connexes hors refonte (notés pour ne pas les perdre)

- **Emails sortants** (relances R0-R5, mails transporteur, compta) : porteront l'ancienne
  identité après la refonte — à re-templater.
- **Mode dégradé hors-ligne** (Wi-Fi entrepôt) : aucun écran d'erreur réseau, pas d'error boundary.
- **Doctrine notifications** : unifier badges, bandeaux, toasts, PromoNotifications, TopStrip.
- **Formats transverses** : normaliser dates (3 formats sur /entrees), montants, unités colis/kg.
- **Accessibilité** : contrastes opacity-70, cibles < 44 px, navigation clavier des menus maison.
- **PR #360 GitHub** : mergée dans audit-robustesse (fait) — vérifier qu'elle survit au merge refonte.
- **Sécurité** : le PAT GitHub utilisé pendant la session est en clair dans l'historique de
  conversation — à révoquer/régénérer une fois les travaux finis.
- **Sauvegardes `.env.bak-*`** dans /srv/televent/app : contiennent des secrets, à supprimer.

## Infra de l'aperçu (référence)

- Clone : `/home/ubuntu/refonte` (propriétaire ubuntu, `.env` copié de la prod — MÊME base de données
  et MÊME SAP que la prod : les écritures depuis l'aperçu sont réelles, prudence).
- Serveur d'aperçu : `next start` port **3002** — démarrage :
  `NODE_OPTIONS="--max-http-header-size=65536" nohup npx next start -p 3002 > /tmp/refonte-preview.log 2>&1 &`
  (limite d'en-têtes élargie : le domaine est partagé avec la prod, les cookies cumulés
  dépassent les 16 Ko par défaut de Node ; côté nginx, `large_client_header_buffers 8 32k`
  dans `refonte-preview.conf`). Après un nouveau build : tuer le PID écoutant sur 3002 puis relancer.
- Accès : `https://televent.gervifrais.com:8443` via nginx (`refonte-preview.conf`) — port 8443
  ouvert dans ufw. Certificat Let's Encrypt partagé avec la prod.
- La prod reste sur le port 3000 / https standard, intouchée.
