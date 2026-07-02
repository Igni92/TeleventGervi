# Audit UI/UX/graphisme/praticité — Vue « Détail livraison »

> Audit visuel & ergonomique de la vue détail livraison, **par rôle** (les vues diffèrent
> selon le rôle) et **par taille d'écran**. Traque : mots coupés, boutons peu accessibles,
> doublons, débordements, contrastes, praticité terrain.
>
> Méthode : 8 lentilles d'audit en parallèle → chaque finding revérifié en adversarial
> (logique responsive `hidden/sm:/md:` + gating `canDispatch` relus ligne à ligne) →
> 50 findings confirmés → dédoublonnés en 24 items. Points porteurs recontrôlés à la main.
>
> Sévérité : 🔴 Critique · 🟠 Majeur · 🟡 Mineur · ℹ️ Info.
> Aucune modification de code n'a été faite : ce document est un état des lieux.

---

## Périmètre & modèle de rôles

Un **seul** composant, `components/livraisons/LivraisonDetail.tsx` (~1881 l.), sert **tous les rôles**.
Les différences de vue viennent de la prop `canDispatch` (`app/livraisons/page.tsx:18-25`) et de la nav
mobile `PreparateurNav`.

| Rôle | `canDispatch` | Nav mobile | Appareil réel | Ce qu'il voit en plus / en moins |
|---|---|---|---|---|
| **Préparateur** | `false` | `PreparateurNav` (Livraison + Inventaire) | smartphone entrepôt, 1 main | pas de rangée dispatch, pas de « Modifier », pas de « Changer le client » |
| **Livreur** | `false` | `PreparateurNav` (Livraison + Inventaire) | smartphone terrain | idem préparateur |
| **Commercial** | `true` | sidebar bureau | desktop / portable | rangée dispatch (`hidden md:flex`), bouton « Modifier », menu « Changer le client » |
| **Direction** | `true` | sidebar bureau | desktop | **identique au commercial** |

**Breakpoints Tailwind :** `sm=640` · `md=768` · `lg=1024` · `xl=1280` (base = `<640`, mobile).
**Chrome** (`AppLayout.tsx:35`) : `max-w-[1440px] px-4 sm:px-10 lg:px-14`, sidebar visible `≥ md`
(`W_FULL=236 / W_RAIL=68`, `Sidebar.tsx:48-49`), `MobileTopBar` visible `< md`.

### Deux causes racines

1. **Le clic droit** (`onContextMenu`) est la *seule* voie pour : changer l'état à l'unité (hors « Faite »),
   « Modifier », « Changer le client ». → **inexistant au doigt** sur smartphone, public préparateur/livreur.
2. **Le masquage `hidden sm:*`** ampute le contexte terrain sur mobile (Qté, poids, code client…), alors que
   mobile = précisément le public terrain.

---

## 1) Priorisation par sévérité

### 🔴 CRITIQUE (1)

#### C1 — Impossible de marquer une commande « Départ » à l'unité au doigt
- **Rôles :** livreur (métier = constater les départs), préparateur · **Écrans :** mobile / sm (tout tactile)
- **file:line :** `LivraisonDetail.tsx:1330` (le bouton d'état ne fait que `À préparer↔Faite` et `Parti→Faite`,
  jamais `Faite→Parti`), `:1109-1113` (`togglePrepared` refuse `departed`), `:1151` (`markDepart` = seule
  transition unitaire vers Départ), `:1807-1808` (item de menu), `:1297`/`:1323` (menu ouvert **uniquement**
  par `onContextMenu` = clic droit). Aucun handler `onTouch/onPointer/long-press`.
- **Impact :** le livreur ne peut pas marquer *une* commande partie au doigt. Seul recours tactile = le bouton
  **groupé** transporteur (`:807-818`, `:749`) qui bascule **tout le groupe** → des commandes non chargées
  passent « Parti », suivi faussé.
- **Correctif :** rendre « Départ » atteignable à l'unité au doigt — cycle du bouton d'état
  (`À préparer→Faite→Parti→À préparer`) **ou** bouton kebab (⋯) visible `<md` ouvrant le menu existant
  (réutilise `markAPreparer/markFait/markDepart`).

### 🟠 MAJEUR (11)

#### M1 — Nav livreur cassée : onglet « Inventaire » mort + « Clients » inatteignable + bouton « Accueil » mort
- **Rôle :** livreur · **Écrans :** mobile / sm (unique nav `< md` ; sidebar `hidden md:flex`)
- **file:line :** `PreparateurNav.tsx:14-17` (TABS codés en dur, non conscients du rôle) → onglet `:16`
  `/inventaire` **hors périmètre** livreur (`proxy.ts:58-66` n'autorise que `/livraisons /clients /api /login`
  → redirect silencieux vers `/livraisons` ; `lib/rolePreview.ts:42-44` corrobore). `/clients` (déclaré
  accessible, créneaux/GPS) n'est **dans aucun onglet**. `MobileTopBar.tsx:61-62` bouton Home → `/accueil`
  non autorisé → redirect vers `/livraisons`.
- **Impact :** 2 des 3 cibles de nav sont mortes + l'écran le plus utile au métier (adresse/créneau/GPS) en
  cul-de-sac. Impression d'appli cassée, main/gants en entrepôt.
- **Correctif (quick win) :** rendre `PreparateurNav` conscient du rôle — livreur → **[Détail livraison, Clients]**,
  préparateur → **[Détail livraison, Inventaire]** ; Home `MobileTopBar` → `/livraisons` pour les rôles restreints.

#### M2 — Rangée dispatch surcharge la colonne étroite en md/lg → wrap en escalier, nom client écrasé
- **Rôles :** commercial, direction · **Écrans :** md (768-1023) et lg (1024, sidebar déployée) — confortable
  seulement à **xl**
- **file:line :** `LivraisonDetail.tsx:1408` (`canDispatch ? "hidden md:flex" : "hidden"` + `flex-wrap`),
  enfants : transporteur `max-w-[200px]` `:1417`, tournée `max-w-[220px]` `:1440`, N° cmd `w-[140px]` **fixe**
  `:1470`, date native `:1477-1484`. Bloc dans `min-w-0 flex-1` `:1352`, coincé entre le bouton d'état et le
  bloc droit `shrink-0` `:1492`. À md=768 sidebar pleine (236px) ≈ 452px utiles → la colonne `flex-1`
  s'effondre, le N° cmd 140px fixe ne rentre pas et wrappe.
- **Impact :** cartes très hautes, nom client (`truncate` `:1357`) écrasé, chute de densité.
- **Correctif :** passer la rangée en `hidden lg:flex` ; N° cmd fluide (`flex-1 min-w-[110px]`) ; masquer le
  libellé « Modifier » sous lg. Idéalement sortir la rangée du bloc `flex-1` (2ᵉ ligne pleine largeur).

#### M3 — Rangée « À préparer » très dense à 360px : nom client réduit à 3-4 lettres
- **Rôle :** préparateur · **Écran :** mobile (`<640`)
- **file:line :** `LivraisonDetail.tsx:1324` (rangée `flex items-center gap-3 px-4`). Bouton d'état
  `h-11 px-3` + libellé « À préparer » sans variante responsive `:1336-1349` (~116-120px) ; bloc colis
  `min-w-[44px]` `:1493` + Maximize `h-11 w-11` `:1508` (~104px). Reste ~48px pour `ClientLink`
  (`min-w-0 flex-1 truncate` `:1352-1357`).
- **Impact :** nom client (identifiant primaire de sélection terrain) tronqué à ~4-6 caractères sur smartphone
  une main.
- **Correctif :** libellé du bouton d'état en icône-seule ou « À prép. » `< sm`, et/ou colis+loupe sur une
  2ᵉ ligne `< sm`.

#### M4 — Infos de préparation masquées sur mobile : Qté et poids par ligne, poids total
- **Rôle :** préparateur · **Écran :** mobile (`<640`)
- **file:line :** `LivraisonDetail.tsx:1401` (code client `hidden sm:inline`), `:1403` (HT `hidden sm:inline`),
  `:1497` (poids total `hidden sm:block`), `:1552-1553`/`:1577-1578` (colonnes Qté et kg `hidden sm:table-cell`),
  `:1571` (code article `hidden sm:inline`).
- **Impact :** sur smartphone le préparateur perd Qté/ligne (repère de picking) et poids (chargement) ;
  ne lui reste que colisage + nom + chips. Le masquage « bureau » ampute le contexte terrain.
- **Correctif (quick win) :** réafficher **Qté + poids** dès mobile ; laisser code article et HT masqués.

#### M5 — Aucune info de livraison (adresse, heure) pour le livreur ; adresse absente du composant entier
- **Rôle :** livreur · **Écrans :** toutes tailles (rangée dispatch `hidden` à toutes tailles pour lui)
- **file:line :** `LivraisonDetail.tsx:1408` (`canDispatch=false` → rangée `hidden`, seul endroit avec l'heure
  de tournée `:1443`). Ligne = client `:1354`, CardCode `:1401`, BL `:1402`, HT `:1403`, colis `:1494`,
  poids `:1497`. **Aucune adresse/ville/heure** au niveau ligne. `grep adresse|ville|city|street` = 0 →
  adresse absente de tout le fichier.
- **Impact :** le livreur hérite d'une vue préparateur (colis) ; l'info cœur métier (où livrer, à quelle heure)
  est masquée ou absente.
- **Correctif (chantier) :** exposer l'adresse dans le type `Doc`, afficher adresse/ville/heure en lecture
  seule au niveau ligne (dès mobile, sans réactiver les contrôles dispatch).

#### M6 — Vocabulaire « À préparer / Faite / Parti » inadapté au livreur ; onglet par défaut non pertinent
- **Rôle :** livreur · **Écrans :** tous
- **file:line :** `LivraisonDetail.tsx:1348` (`departed ? "Parti" : prepared ? "Faite" : "À préparer"`),
  StatusTabs `:913-915`, titres `:1332-1334`, « Fait par » `:1367`, « Préparation terminée » `:1640`,
  « remettre sur la file » `:1649`. Onglet par défaut `A_PREPARER` `:319` pour tous.
- **Impact :** le livreur voit un vocabulaire de préparation qu'il n'exécute pas, s'ouvre sur un onglet inutile,
  sans état « Livré ». Friction cognitive quotidienne.
- **Correctif :** libellés/onglet par défaut conditionnés au rôle (livreur → défaut « Départ », vocabulaire
  livraison, idéalement un état « Livré »).

#### M7 — Deux menus clic-droit divergents sans affordance ; « Changer le client » (irréversible SAP) sans autre accès + inatteignable clavier/tactile
- **Rôles :** commercial, direction · **Écrans :** desktop + tout tactile + clavier
- **file:line :** `LivraisonDetail.tsx:1297`/`1323` (menu ligne, clic droit only, ligne non focusable),
  `:755`/`:779` (menu en-tête), `:1795-1798` (« Modifier » + « Changer le client… », gate `canDispatch`),
  `:1798` = seul déclencheur de `setRebindOpen(true)` (action irréversible `:1280-1285`). Aucun
  `aria-controls`/kebab/déclencheur clavier.
- **Impact :** action métier irréversible (recodage BL) totalement inaccessible au clavier et au tactile,
  non découvrable à la souris.
- **Correctif :** bouton kebab (⋮) focusable ouvrant le menu (`role=menu` déjà présent `:1790`) ; gérer
  Menu/Shift+F10 sur une ligne rendue focusable ; a minima sortir « Changer le client… » vers une affordance
  visible.

#### M8 — Menu clic-droit inatteignable au tactile : « Modifier » (`< md`) et « Changer le client » perdus
- **Rôles :** commercial, direction · **Écrans :** mobile / sm tactile
- **file:line :** `LivraisonDetail.tsx:1297`/`1323` (contextmenu only), `:1518` (bouton Modifier
  `hidden md:inline-flex`), `:1798` (Changer client menu-only).
- **Impact :** sur portable étroit / 2-en-1 tactile `< 768px`, un commercial/direction n'a aucun accès tactile
  à Modifier ni à Changer le client.
- **Correctif :** kebab tactile `< md` portant le même menu, ou long-press (`onPointerDown` + timer).

#### M9 — Rangée dispatch inaccessible sous md pour les rôles complets (desktop-only assumé, sans repli tactile)
- **Rôles :** commercial, direction · **Écrans :** mobile / sm
- **file:line :** `LivraisonDetail.tsx:1408` (`hidden md:flex`), `:1518` (Modifier `hidden md:inline-flex`),
  menu clic-droit `:1297` n'offre PAS transporteur/tournée/réf/date.
- **Impact :** `< 768px`, aucun moyen de changer transporteur/tournée/réf/date. Impact borné (rôles bureau,
  smartphone = appareil secondaire).
- **Correctif :** point d'entrée tactile (panneau/dialog dispatch) ou rendre explicite le caractère desktop-only.

#### M10 — En-têtes repliables (transporteur + tournée) sans anneau de focus clavier
- **Rôles :** tous · **Écrans :** tous + dark
- **file:line :** `LivraisonDetail.tsx:783` (transporteur) et `:838` (tournée), `<div role="button" tabIndex={0}>`
  sans aucune classe focus, alors que les 6 inputs/selects (`:625,1417,1440,1470,1484,1734`) ont
  `focus:ring-2 focus:ring-brand-500/40`. Enter/Espace gérés (`:780,835`).
- **Impact :** le repliage/dépliage (action structurante, tout replié par défaut) se navigue au clavier sans
  indicateur visible.
- **Correctif (quick win) :** `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40
  focus-visible:ring-inset` sur les deux divs.

#### M11 — Code article `text-muted-foreground/70` sur `bg-secondary/20` : contraste ~2.6:1 (échoue WCAG AA)
- **Rôles :** tous · **Écrans :** sm/md/lg/xl + dark (masqué mobile)
- **file:line :** `LivraisonDetail.tsx:1571` (`font-mono text-[10px] text-muted-foreground/70 hidden sm:inline`),
  conteneur `bg-secondary/20` `:1541`. ~2.6:1 light / ~3.8:1 dark, sous 4.5:1.
- **Correctif :** `text-muted-foreground` pleine opacité ou `text-foreground/70` ; retirer `/70`.

### 🟡 MINEUR (10 — regroupés)

- **m1 — Menu contextuel = seule voie desktop pour états/corrections par commande (granularité).**
  Préparateur/livreur ; mobile/sm. `LivraisonDetail.tsx:1323`/`1297`. Le bulk transporteur (`:807-818`) donne
  2 états sur 3 au doigt ; manque la granularité par commande et le retour arrière individuel.
- **m2 — Correction d'état GROUPÉE (retour « Tout : à préparer ») uniquement au clic droit.**
  Préparateur/livreur ; mobile/sm. `:779`+`:885-890`. Le bouton `forward` (`:745-750`/`807-818`) n'avance que
  d'un cran ; `bulkSetStatus` (`:341-378`) supporte le retour mais est inaccessible au doigt.
- **m3 — « À reprendre » (requeue) accessible seulement via la vue en grand qui s'auto-affecte.**
  Préparateur. `:1644` (`requeue`, seul point d'appel), dans le Dialog `:1587-1653` ouvert par `openBig()`
  `:1154-1164` qui POST `claim` (auto-affectation). Correctif : exposer « À reprendre » comme MenuItem non gaté
  `canDispatch` appelant `requeue()` directement.
- **m4 — Détail des lignes toujours déplié sur mobile (pas de repli `< md`) → scroll interminable.**
  Préparateur ; mobile/sm. `:1540` (base `block`, repli `md:block`/`md:hidden`) ; chevron `:1525-1533`
  `hidden md:inline-flex`.
- **m5 — Badges d'état empilés poussent le nom client sur plusieurs lignes (flex-wrap).**
  Préparateur ; mobile. `:1353` (`flex items-center gap-2 flex-wrap`), badges `:1359-1397`.
- **m6 — ClientLink : `truncate` neutralisé (pas de `min-w-0`) → coupe nette au bord au lieu d'ellipse.**
  Tous ; toutes tailles (pire mobile). `:1353` (conteneur sans `min-w-0`) + `:1357`.
- **m7 — Selects transporteur/tournée + input N° cmd : libellés longs coupés sans ellipsis/title fiable.**
  Commercial/direction ; md/lg/xl. Tournée `:1440` (`max-w-[220px] truncate`, option `:1447`
  `{nom} (des) — heure`, info distinctive en fin) ; transporteur `:1417` `max-w-[200px]` ; N° cmd `:1470`
  `w-[140px]` fixe. `title` statique (`:1439/1416/1468`). Correctif : `title` dynamique = option courante.
- **m8 — Cibles tactiles sous 44px.**
  Onglets d'état & repli global `h-8` (32px, `:929`, `:945`, tous rôles, mobile/sm) ; dispatch `h-7` (28px,
  `:1417/1440/1470/1484`) ; bouton groupé `h-9` (36px, `:807-818`) au bord droit hors zone pouce, plus petit
  que le bouton de ligne `h-11 sm:h-9` (`:1336`). Header cliquable englobe ce bouton groupé (risque de mauvaise
  cible + bascule groupée sans confirmation, `bulkSetStatus :341-378` vs dialog unitaire `:1656`).
- **m9 — En-têtes transporteur/tournée : nom écrasé (~40px) et tronqué en tranche md, sidebar pleine.**
  Tous ; md. En-tête transporteur `:805` (`gap-3 sm:gap-8 shrink-0`, libellé long `:816` `hidden sm:inline`,
  3 Metric `min-w-[42px]`, kg `:821` `hidden sm:block`), nom `truncate` `:800`. Sous-en-tête tournée
  `:845`/`:843`.
- **m10 — Redondances d'état et de libellés.**
  Tous ; toutes tailles. (a) État exprimé **3×** (onglet filtré + mot du bouton `:1348` + badge `:1364-1374`).
  (b) **4 mécanismes concurrents** de changement d'état (bouton ligne `:1328` cycle vs menu absolu
  `:1803-1808` vs bouton groupé `:807` vs menu en-tête `:885`). (c) Verbe auteur instable (« Fait par »
  `:1367`, nom nu `:1385`, « Fait par/Préparée par » `:1605`). (d) « Modifier » dupliqué (bouton `:1513` +
  menu `:1797`). (e) **kg répété à 5-6 niveaux** (`:821,848,1497,1553/1578,1602,1671`).

### ℹ️ INFO (2 — regroupés)

- **i1 — Grille de synthèse déséquilibrée 3+2 en md.** `:680` (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`,
  pas de palier `md:`). Correctif : ajouter `md:grid-cols-5`.
- **i2 — Divers cohérence/lisibilité sans impact fonctionnel.** (a) Consigne J+1/samedi→J+2/férié `:457`
  `hidden md:block` masquée sur mobile (mais garde-fou férié conservé `:645-663`). (b) Sous-titre « commandes
  à préparer » `:457` orienté préparation, non conditionné rôle. (c) Libellés Metric 9-10px uppercase tracking
  large (`:958,690,842,1548-1553`). (d) Code article masqué `< sm` `:1571`. (e) Placeholder « N° commande »
  `muted-foreground/60` `:1470` contraste ~2.3:1. (f) `aria-label` loupe `:1507` n'annonce pas l'auto-affectation
  (`title :1506` le dit). (g) `aria-expanded` sans `aria-controls` (`:781,836,1529`).

---

## 2) Lecture par RÔLE (ce qui diffère)

**PRÉPARATEUR** (mobile, `canDispatch=false`) — spécifiques : **M3** (nom client écrasé 360px),
**M4** (Qté/poids masqués), m3 (requeue via auto-claim), m4 (détail toujours déplié), m5 (badges wrap).
Partagé avec livreur : C1, m1, m2. **Diffère du livreur :** il *utilise* colisage/Qté/poids (M4 le pénalise
directement) ; le vocabulaire préparation lui convient (M6 ne le concerne pas) ; sa nav (Inventaire) est
correcte (M1 ne le touche pas).

**LIVREUR** (mobile, `canDispatch=false`) — spécifiques : **M1** (nav entièrement cassée), **M5** (ni adresse
ni heure), **M6** (vocabulaire préparation inadapté, pas d'état « Livré »). Partagé avec préparateur :
**C1** (le plus grave pour lui — son métier EST le départ), m1, m2. **C'est le rôle le plus mal servi de
l'audit** : vue et nav pensées pour un autre métier.

**COMMERCIAL** (bureau/portable, `canDispatch=true`) — spécifiques : **M2** (dispatch qui wrappe en escalier
md/lg), **M7** (Changer le client irréversible, non découvrable/inaccessible clavier-tactile), M8/M9
(dispatch/Modifier inaccessibles tactile `< md`), m7 (selects tronqués), m8-dispatch (`h-7`), m10-d (Modifier
dupliqué). Il voit **toute** la surface dispatch — c'est là que se concentrent densité md/lg et découvrabilité.

**DIRECTION** — **identique au commercial** (`canDispatch=true`, mêmes findings). Aucun finding ne les
distingue.

**TOUS RÔLES** : M10 (focus clavier en-têtes), M11 (contraste code article), m6 (ClientLink truncate),
m9-tournée, m10-a/b (redondances état), i1 (grille md), i2-c/f/g.

---

## 3) Lecture par TAILLE D'ÉCRAN

**MOBILE (`<640px`)** — public terrain (préparateur/livreur). Le plus dense en problèmes graves : C1, M1, M3,
M4, M5, M6, m3, m4, m5, m6, m8, i2-a/c/d. Cause structurelle : **le clic droit** (unique voie pour états
unitaires/corrections/dispatch, jamais tappable) et le **masquage `hidden sm:*`** (`:1401,1403,1497,
1552-1553,1571-1578`) qui ampute le contexte terrain.

**TABLETTE md (768-1023px)** — portable commercial/direction. Problèmes de layout dans une colonne étroite
(~452px sidebar pleine) : **M2** (dispatch en escalier), m9 (noms transporteur/tournée écrasés), i1 (grille
3+2). Racine : blocs `shrink-0` + `sm:gap-8` non compressibles, sidebar en flux (236px), bascules calées sur
`sm`/`lg` en sautant `md`. Atténué en mode rail (68px).

**DESKTOP (`≥1024px` lg/xl)** — bureau commercial/direction. Peu de casse de layout ; surtout
**découvrabilité et redondance** : M7 (menus clic-droit divergents, Changer client caché), M10/M11
(focus/contraste), m7 (selects), m10 (redondances). La rangée dispatch n'est confortable qu'à **xl**.

---

## 4) Top correctifs

### Quick wins (1 ligne / faible risque, fort ROI)
1. **M1 — Nav livreur** : dériver `TABS` du rôle dans `PreparateurNav` (livreur → Clients au lieu d'Inventaire)
   + Home `MobileTopBar` → `/livraisons` pour restreints. *Débloque 3 défauts majeurs livreur d'un coup.*
2. **M4 — Réafficher Qté + poids sur mobile** : retirer `hidden sm:table-cell` (`:1552-1553/1577-1578`) et
   `hidden sm:block` (`:1497`).
3. **M10 — Focus clavier en-têtes** : `focus-visible:ring-*` sur `:783` et `:838`.
4. **M11 / i2-e — Contrastes** : retirer `/70` (`:1571`) et `/60` (`:1470`).
5. **M3 — Libellé bouton d'état** en icône-seule / « À prép. » `< sm` (`:1348`).
6. **m6 — `min-w-0`** sur ClientLink (`:1357`).
7. **i1 — `md:grid-cols-5`** sur `:680`.
8. **m10-c / i2-f — Cohérence libellés** : unifier le verbe auteur (`:1385`/`:1605`), aligner `aria-label`
   loupe sur son `title` (`:1507`).

### Chantiers (refonte, effet transversal)
1. **C1 + M8 + m1/m2 — Accès tactile aux états et au menu** : bouton **kebab (⋯) visible `< md`** (et/ou
   long-press) ouvrant le menu `role=menu` existant (`:1790`) au niveau ligne ET en-tête. *Le correctif le
   plus structurant : résout le critique + l'accessibilité clavier/tactile du dispatch + la correction groupée
   en arrière.*
2. **M2 + M9 — Refonte responsive dispatch/en-têtes en md** : sortir la rangée dispatch du bloc `flex-1`
   (2ᵉ ligne pleine largeur) ou `hidden lg:flex` ; N° cmd fluide ; gaps/kg/libellés différés à `lg`.
3. **M5 + M6 — Vue livreur dédiée** : exposer l'adresse dans le type `Doc`, afficher adresse/ville/heure au
   niveau ligne en lecture seule, adapter vocabulaire + onglet par défaut au rôle (état « Livré »).
4. **M7 — Sortir « Changer le client »** (irréversible SAP) vers une affordance visible + kebab focusable.

---

## Fichiers concernés
- `components/livraisons/LivraisonDetail.tsx` (la vue)
- `components/PreparateurNav.tsx` (nav restreints)
- `components/MobileTopBar.tsx` (barre mobile)
- `app/livraisons/page.tsx` (gating `canDispatch`)
- `components/AppLayout.tsx`, `components/Sidebar.tsx` (chrome / largeurs)
- `lib/rolePreview.ts`, `proxy.ts` (périmètres de rôle)
