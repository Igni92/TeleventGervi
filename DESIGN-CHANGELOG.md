# Refonte UI/UX — Guide avant / après

> Phase 1 : **Fondation design-system v2 + Console**. Animations légères via **Framer Motion**
> (pas Remotion — outil vidéo inadapté aux micro-interactions), graphiques via **visx**.
> Identité conservée (anthracite + jaune « Controllino »), exécution élevée.

## 🎬 Animations — `lib/motion.ts` (NOUVEAU)

| Avant | Après |
|------|-------|
| Quelques keyframes CSS éparses (`fade-up`, `client-swap`), durées/easings ad-hoc. | **Tokens de motion centralisés** : durées (`fast/base/slow/exit`), easings bézier, springs (`snappy/soft/press`), variants réutilisables (`fadeUp`, `scaleIn`, `slideRight`, `staggerContainer/Item`). Rythme cohérent partout. |
| Aucune prise en compte de `prefers-reduced-motion`. | **Reduced-motion respecté** systématiquement (fallback fondu instantané, données lisibles immédiatement). |

## 🔢 `AnimatedNumber` (NOUVEAU) — `components/ui/animated-number.tsx`

- Compteur **count-up** animé (Framer Motion), locale `fr-FR`, `tabular-nums` (pas de saut de layout).
- Anime de l'ancienne → nouvelle valeur quand la granularité change.
- Respecte reduced-motion (affiche direct la valeur finale).

## 📊 Graphiques visx (NOUVEAU) — `components/charts/`

| Composant | Usage |
|-----------|-------|
| `Sparkline` | Micro-tendance inline (KPI, lignes). Tracé animé, dégradé d'aire, point terminal. |
| `TrendArea` | Graphe de tendance responsive : aire + ligne, **comparatif N-1 en pointillé**, grille discrète, **tooltip + crosshair**, axe auto-skip. |
| `BarList` | Top classé (clients/fournisseurs) : barres animées, labels directs. |
| `Donut` | Répartition (≤ 5 catégories), libellé central, légende texte. |

Tous : couleurs alignées sur les tokens, **aria-label** résumant l'insight (accessibilité), états vides.

## 🧩 Primitives UI v2

| Composant | Avant | Après |
|-----------|-------|-------|
| `Delta` (NOUVEAU) | Variation YoY portée par la couleur seule. | Pastille **icône + signe +/−** (pas couleur seule → accessible), « nouveau » si pas de N-1. |
| `Stat` (NOUVEAU) | — | Carte KPI unifiée : label → valeur animée → delta + sparkline. Hiérarchie claire. |

## ☎️ Console (`components/console/CallConsole.tsx`)

| Élément | Avant | Après |
|---------|-------|-------|
| Compteurs en-tête (Restants / Appelés / Commandes / Conv.) | Chiffres statiques. | **Count-up animé** à chaque rafraîchissement + hover discret sur chaque stat. |
| File d'appel | Lignes apparaissant d'un coup. | **Entrée en cascade** (stagger 36 ms), **AnimatePresence** : ajout/retrait fluides, réordonnancement animé (`layout`). |
| Taux de conversion | Passé en string `"x%"`. | Valeur numérique animée + suffixe `%`. |

## 📈 Dashboard (`components/pilotage/bento.tsx` + `PilotageScreen1`)

| Élément | Avant | Après |
|---------|-------|-------|
| Gros KPI (Volume BL, Marge) | Chiffre statique. | **Count-up** animé via `AnimatedNumber` (formateur euro/num/%). |
| Mini-KPI (Cdes, Appels, Conv, Panier) | Statiques. | Count-up animé. |
| État de chargement | `"—"`. | Conservé tel quel pendant le fetch, puis anime à l'arrivée des données. |

## 🔌 Dépendances ajoutées

- `framer-motion` (animations interactives)
- `@visx/*` (scale, shape, group, axis, grid, gradient, curve, responsive, tooltip, text, event) — graphiques sur mesure thémés.

## ✅ Garde-fous

- `npx tsc --noEmit` : **0 erreur**
- `npm test` : **35/35** verts
- Accessibilité : reduced-motion, aria-labels charts, delta non-couleur-seule.

---

---

## 🏛️ Council — Round 1 (3 reviewers : design-polish · UX · data-viz)

**Verdict initial : CHANGES_NEEDED (3/3).** Fond jugé solide ; corrections appliquées :

| # | Retour council | Correctif appliqué |
|---|----------------|--------------------|
| P0 | `BarList` : `scaleX` déforme le rayon des barres | Animé en **`width`** (rayon intact) |
| P1 | Count-up balaye 0→valeur comme un chargement | `AnimatedNumber` **seed au montage** : valeur finale directe au 1er rendu, count-up seulement sur vrai changement |
| P1 | Indigo résiduel sur app jaune (`::selection`, glow slider, `.text-gradient-indigo`) | **Purge indigo** → tokens or/jaune ; `.text-gradient-brand` |
| P1 | Pill active slider `bg-brand-500 text-white` peu contrasté | `bg-primary text-primary-foreground` + glow jaune |
| P1 | Deux sparklines (visx vs maison) | bento délègue à **`charts/Sparkline`** (responsive, a11y, baseline réelle) |
| P1 | Deux pastilles delta (`Delta` vs `YoYPill`) | `YoYPill` **délègue à `Delta`** ; base N-1 négative gérée (`/|prev|`) |
| P1 | Garde clavier console incomplète | Exclut **SELECT + contentEditable** (parité slider) |
| P1 | Action encours : no-op silencieux à l'annulation | **Toast** « Commande non envoyée » |
| P1 | Cibles tactiles < 44px (panier Écran 2) | Inputs qté/prix **h-9** + focus ring + aria-label |
| P1 | « + Découvert » peu clair | `aria-pressed`, libellé explicite, **bandeau persistant** quand actif |
| P2 | Donut : rotation décorative | Supprimée (scale+fade) ; durées de tracé ramenées ≤ 340 ms |
| P2 | `.surface` CSS invalide (`ring:`) | Corrigé en `border` |
| P1 | `CATEGORICAL` pas colorblind-safe | 5 premières teintes ré-ordonnées (proche Okabe-Ito) |

Vérif post-round 1 : **tsc 0 erreur · 35/35 tests**.

---

## 🏛️ Council — Round 2

**Verdicts : design-polish ✅ APPROVE · data-viz ✅ APPROVE · UX ⚠️ CHANGES_NEEDED** (2 bugs P0 clavier réels).

| # | Retour | Correctif |
|---|--------|-----------|
| **P0** | Les raccourcis se déclenchent **modale ouverte** → faux « À demain » + `advance()` sous la modale | Handler `keydown` **neutralisé** si `blOpen/rappelOpen/shortcutsOpen` |
| **P0** | `matches()` ignore les modificateurs → **Ctrl/Cmd+R détourné** (rappel), Ctrl+D (demain) | `matches()` rejette toute combinaison **Ctrl/Cmd/Alt** |
| P1 | Double-log si touche maintenue / appuis rapides | `e.repeat` ignoré + garde `actionLoading` sur « demain » |
| P0→P1 (encours) | `window.confirm` natif | Remplacé par **Dialog thémé** (focus-trap, Esc, Annuler/Forcer) + `DialogDescription` (a11y) |
| P2 | `BarsYoY` code mort | **Supprimé** (+ helper) |
| P2 | File : `layout`+exit en conflit | `AnimatePresence mode="popLayout"` |
| P2 | Δ comptable : +0,4 % arrondi à 0 % avec flèche verte | **Dead-band** sur le % arrondi (état neutre) |

Vérif post-round 2 : **tsc 0 erreur · 35/35 tests**.
Items P2 restants (non bloquants) : skeletons de chargement, raccourci clavier « Passer », réordonnancement clavier des sections, micro-encodage visuel de la matrice annuelle.

---

---

## 🏛️ Council — Round 3 (vérification) → ✅ CONSENSUS

| Reviewer | R1 | R2 | R3 |
|----------|----|----|----|
| Design-polish | CHANGES | **APPROVE** | — |
| Data-viz | CHANGES | **APPROVE** | — |
| UX | CHANGES | CHANGES | **APPROVE** |

**Les 3 reviewers approuvent.** Les 2 P0 clavier vérifiés corrigés, zéro régression.
Note hors-scope relevée (P2, future) : 2 `window.confirm` résiduels (`SapOrderHistory.tsx`, `BLDialog.tsx`) à migrer vers Dialog pour une cohérence totale.

Vérif finale : **tsc 0 erreur · 35/35 tests**.

---

---

## 🚀 Phase 2 — Propagation aux pages + P2

| Page / zone | Apport |
|-------------|--------|
| **Fabrication** | **Donut visx** « répartition du coût matière » (part de chaque composant, libellé central = coût total). |
| **Products** | KPIs d'en-tête en **count-up** (`AnimatedNumber`) — la table reste l'idiome (pas de graphe gratuit). |
| **Clients** | Total clients en **count-up**. |
| **Entrées** | Bandeau résumé **count-up** : nb réceptions · valeur cumulée (€) · lignes. |
| **P2 — `window.confirm`** | **SapOrderHistory** (annulation BL) → Dialog destructive thémé ; **BLDialog** (encours) → barre de confirmation **inline** (pas de modale imbriquée). Plus aucun `window.confirm` natif dans le parcours commande. |
| **P2 — Raccourci** | Nouvelle action clavier **« Passer sans loguer »** (`s`), affichée sur le bouton + dans les hints, personnalisable. |

Vérif Phase 2 : **tsc 0 erreur · 35/35 tests**.

### 🏛️ Council final (Phase 2) → ✅ CONSENSUS (2/2 APPROVE)
- **design/consistance** ✅ · **UX/a11y** ✅ — aucun item bloquant.
- 3 P2 corrigés dans la foulée : clé React du Donut (collision si noms identiques), libellé « auto 30 s » (au lieu de 5 min), raccourci « Passer » ajouté à la légende clavier.
- Hors-scope signalé (à faire un jour) : 2 `confirm()` natifs résiduels dans `DeliveryModesEditor` / `ContactsEditor` (édition fiche client).

---

---

## 🎨 Harmonisation DA (DA du dashboard adoptée partout)

Référence = la « tuile » du dashboard : `bg-card` + **bordure d'accent gauche** colorée (`border-l-4`) + label kicker majuscules + gros chiffres tabulaires.

- **NOUVEAU `components/ui/surface-card.tsx`** — composant canonique (`SurfaceCard`) qui encode cette DA (rounded-xl, border, accent gauche, titre kicker, entrée fade-up). Remplace l'ancien shadcn `Card` (rounded-lg + shadow) là où c'est pertinent.
- **Console** : les 5 cartes KPI passent en **accent gauche** (au lieu de la barre du haut) → identiques aux tuiles du dashboard.
- **Entrées** : `GoodsReceiptForm` (accent brand) + `GoodsReceiptHistory` (accent sky) via `SurfaceCard`.
- **Fabrication** : `FabricationForm` (accent brand) + `BomAdmin` (accent violet) via `SurfaceCard`.
- **Products** : bandeau de synchro reçoit l'accent gauche brand (le reste était déjà en rounded-xl/border).
- **Clients** : conteneur tableau passé du legacy `rounded-2xl + ring + shadow` → `rounded-xl + border-border` (cohérent).

Résultat : même langage visuel (cartes, accents, kickers, chiffres) sur Console / Stats / Clients / Stock / Entrées / Fabrication.
Vérif : **tsc 0 erreur · 35/35 tests**.

---

---

## 🎨 Colorimétries commutables (peps) — council brand + a11y

Council (stratégie couleur + accessibilité/implémentation), consensus :
- **Ship 3 colorimétries commutables** ; **éviter l'émeraude** (collision avec succès-vert).
- **Agrume (orange)** = meilleur peps sûr ; **Fraise (framboise)** = peps max (texte sombre sur le bouton, attention au rouge-erreur) ; **Or** = classique.

**Implémenté (pattern shadcn var-driven)** :
- Échelle Tailwind `brand` passée en **CSS vars** (`hsl(var(--brand-N) / <alpha-value>)`).
- `globals.css` : `:root` = Or (défaut) ; **`[data-theme="agrume"]`** + **`[data-theme="fraise"]`** surchargent l'accent (brand + `--primary`/`--ring`/`--primary-foreground`).
- **`ColorimetrieSwitcher`** dans la navbar (icône palette) : Or / Agrume / Fraise, **persisté** (localStorage) + **anti-FOUC** (script inline `<head>` appliqué avant le 1er paint).
- Toute l'UI (cartes, boutons, accents, textes, chips) suit le choix ; **erreur/avertissement/succès inchangés**.
- Limite connue : les **graphes visx gardent un accent fixe** (SVG n'évalue pas `var()` dans les attributs) — peut suivre le thème via un refacto `currentColor` ultérieur.
- **Défaut = Or** (pas de surprise d'identité) — l'utilisateur bascule via la palette ; on peut fixer Agrume/Fraise par défaut sur demande.

Vérif : **tsc 0 erreur · 35/35 tests**.

---

---

## 🌌 DA « salle de signal » — atmosphère de fond designée

Plus qu'un changement de couleur : une vraie ambiance, **pilotée par l'accent** (suit la colorimétrie) et **discrète derrière les données**.

- **NOUVEAU `components/AmbientBackground.tsx`** — couche fixe globale (`-z-10`, pointer-events none) montée dans `app/layout.tsx` :
  - **Aurora** : 4 dégradés radiaux flous teintés accent (`--brand-*`) + bleu/violet de profondeur, **dérive lente** (34 s, désactivée en reduced-motion).
  - **Grille technique** masquée en ellipse (feel télémétrie).
  - **Anneaux radar** concentriques (écho au logo waveform) en haut-droite + bas-gauche.
- **Wrappers rendus transparents** (`AppLayout`, layout dashboard) → l'ambiance transparaît dans les marges/gouttières ; les cartes restent **opaques** (lisibilité des données intacte).
- **Login refondu** : aurora accent + grille + anneaux radar centrés derrière la carte glass (fini les glows indigo).
- **Empty state console** : motif radar + pastille emerald (état vide « designé »).
- Tout suit la **colorimétrie** (Or/Agrume/Fraise) et le **reduced-motion**.

Vérif : **tsc 0 erreur · 35/35 tests**. (CSS/JS → HMR, F5 si besoin.)

---

### Reporté (non bloquant, post-consensus)
- `window.confirm` encours → vraie **Dialog** stylée (focus-trap/Esc).
- État **busy/disabled** sur le verdict « Commande (BL) » + toast succès/échec sur tous les chemins.
- Réordonnancement de sections **accessible au clavier** (aujourd'hui souris seule).
- Fusion complète `Stat` ⇄ `BigKpi`/`MiniKpi` (un seul système KPI).
- `BarsYoY` = **code mort** (jamais rendu) → suppression ou remplacement par `TrendArea`.
- Skeletons de chargement (vs `—`).
- Propager les primitives aux pages **clients / products / entrées / fabrication**.
- Itérations council suivantes jusqu'à convergence (max 5).

---

## 🗺️ Carte « Où je livre le plus » — Écran 3 du dashboard (NOUVEAU)

3ᵉ écran du slider `/dashboard` (à côté de Commercial · BL et Comptable · Annuel),
pour visualiser **où l'on livre le plus**, à partir de l'adresse SAP des clients.

| Élément | Détail |
|---------|--------|
| `FranceChoropleth` (NOUVEAU) | Choroplèthe des départements métropolitains + Corse — remplissage par intensité de la métrique (rampe brand, cohérente avec la Heatmap). Tooltip CA/marge/volume/BL/clients. Fond statique `public/geo/fr-departements.json`. |
| `WorldBubbleMap` (NOUVEAU) | Carte monde à **bulles** (export + DOM : Guadeloupe, Réunion, Maldives…). Le fond monde est décoratif ; la donnée est portée par les bulles placées au centroïde de chaque pays/DOM → même les micro-États apparaissent. |
| `Donut` (réutilisé) | Camembert de **répartition EXPORT / GMS / CHR** selon la métrique active. |
| Top zones + Totaux | `BarList` des zones les plus livrées + panneau totaux (CA, marge, volume, BL, clients) avec part **non localisée** (adresse SAP manquante). |

- **Métrique commune** sélectionnable : CA facturé · Marge € · Volume (kg/t) · Nb de BL.
- **Périmètre** : segments **EXPORT + GMS + CHR** uniquement, regroupés (cf. `lib/segments`).
- **Source** : `/api/pilotage/geo` → `lib/pilotageGeo` (facturé 12 mois glissants, marge réelle coût EM `lib/cogs`, scope commercial + « voir comme » comme le reste du pilotage).
- **Localisation** : `Client.city/zipCode/country` (cache adresse SAP, alimenté par l'import clients) → département FR déduit du code postal (`lib/geo/zip`), pays pour l'export (`lib/geo/countries`). DDL : `scripts/ddl-client-geo.mjs`. Fonds de carte régénérables via `scripts/prepare-geo-assets.mjs`.
- Cartes via **visx** (`@visx/geo` — Mercator/NaturalEarth), responsive, reduced-motion respecté.

> ⚠️ Pré-requis données : lancer `node scripts/ddl-client-geo.mjs` puis **relancer l'import clients SAP** une fois pour peupler ville/CP/pays.

---

## 📦 Détail livraison — Onglet « Manquants » (stock SAP) + bon de préparation imprimable (NOUVEAU)

Deux besoins terrain sur `/livraisons` : **voir les achats à faire** (articles en
rupture SAP sur les commandes du jour) et **imprimer un vrai bon de préparation**
par commande.

| Élément | Détail |
|---------|--------|
| Manquants = stock SAP négatif | Détection **automatique** : sur les articles des commandes du jour, stock SAP total (tous entrepôts) interrogé **en direct** (le miroir local ne conserve pas les stocks négatifs, requêtes par lots de 20, best-effort). Stock < 0 → article « manquant ». Ligne barrée + fond rosé + chip « Manquant » sur la commande. |
| Onglet « Manquants » | 4ᵉ onglet (rose) à côté d'À préparer / Fait / Départ — vue **transverse** (tous états confondus) des commandes du jour ayant ≥ 1 article en rupture. Badge « X manquant(s) » sur la ligne commande. Pas d'action groupée sur cet onglet (états mélangés). |
| Synthèse « achats à prévoir » | Encart en tête de l'onglet : par article, **stock SAP (négatif) + colis/qté commandés + nb de commandes** — la liste de courses de la personne en charge. |
| Bon de préparation imprimable | Bouton 🖨 par commande (ligne desktop + vue en grand) → fenêtre A4 autonome (`printOrderRecap`) : BL n° + date de livraison, **nom complet du client** (fiche télévente, pas le CardName SAP tronqué), transporteur / tournée / préparateur, lignes avec **gros colisage** + cases à cocher, manquants barrés + encart rappel, totaux. Impression auto. |

---

## 🚚 Bon de transport par transporteur + fiche transporteur (NOUVEAU)

Récap de **toutes les commandes (palettes) d'un transporteur** pour un jour de
livraison, à faire **signer au chauffeur** — et envoyable par mail.

| Élément | Détail |
|---------|--------|
| Bon de transport imprimable | Bouton 🖨 sur l'en-tête du groupe transporteur → **2 exemplaires (ORIGINAL + COPIE)**, une page chacun (`lib/bonTransport`, partagé client/serveur). Par tournée : client (nom complet), BL n°, colis, poids ; colonne **Palettes vide** (remplie à la main au chargement) ; totaux ; zones de signature **expéditeur Gervifrais / chauffeur**. Couvre TOUTES les commandes du transporteur (pas seulement l'onglet affiché), hors BL avoirés. |
| Envoi par mail | Bouton ✉ (commerciaux/admins) + dialog de confirmation (destinataire affiché) → `POST /api/livraisons/bon-transport` : données **reconstruites côté serveur depuis SAP**, envoi depuis la boîte partagée **commercial@gervifrais.com** (Graph `sendMailAsShared`, surchargeable `BON_TRANSPORT_FROM`) vers l'email de la fiche transporteur. |
| Fiche transporteur | Bouton 📞 sur l'en-tête → dialog : **email + téléphones ajoutables** (libellé + numéro, ajout/retrait). Persistée par code transporteur (`AppSetting carrierinfo:<CODE>` — aucune migration), API `GET/POST /api/transporteurs/fiche`. Lecture ouverte, écriture commerciaux/admins. Coordonnées reprises sur le bon de transport. |

---

## 🕐 Détail livraison — heures « fait » / « départ » + recherche d'un bon (NOUVEAU)

| Élément | Détail |
|---------|--------|
| Heures d'état conservées | Chaque clic « Fait » / « Départ » garde son **heure** (le `at` AppSetting, désormais exposé par l'API et renvoyé par les POST). Affichée sur le bon : badges de ligne « Fait par X · 14:32 », « Parti · 14:32 » et chips de la vue en grand (préfixe jj/mm si autre jour). Mises à jour optimistes, y compris en action groupée. |
| Recherche d'un bon | Champ 🔍 à côté des onglets : filtre par **n° de BL, client (nom / nom complet / code) ou réf. client**, insensible aux accents. S'applique avant les onglets (compteurs recalculés), **déplie tout** pendant la recherche, Échap/✕ pour effacer, état vide dédié. |

---

## 📱 Confort mobile / écran zoomé — respire sur tout appareil (NOUVEAU)

Cible les téléphones dont le viewport effectif est **étroit** — en particulier
l'**iPhone en « Affichage zoomé » / gros texte** (préparateur de commande) où la
largeur tombe vers 320-375 px et où l'UI se tassait. Le texte garde la taille
lisible voulue ; c'est la **densité** et l'agrandissement d'UI cumulé qu'on corrige.

| Élément | Avant | Après |
|---------|-------|-------|
| Zoom d'interface applicatif (`--app-zoom`) | S'appliquait aussi sur mobile → se **cumulait** avec le zoom d'affichage iOS et cassait la grille. | **Neutralisé sous 640 px** (`.app-zoom-root { zoom: 1 }`) : sur téléphone c'est l'OS qui gère l'agrandissement, pas un 2ᵉ zoom logiciel. |
| Icônes (lucide, +30 % partout) | +30 % même sur téléphone → icônes surdimensionnées mangeant la largeur des lignes. | **+12 % sous 640 px** : icônes encore plus grandes que nominal (lisibilité) mais les lignes retrouvent de l'air. Bureau/tablette gardent +30 %. |
| Titres de section | Retours à la ligne « bancals » (mot orphelin) sur écran étroit. | `text-wrap: balance` sur `.font-display` → répartition propre sur 2-3 lignes. |
| Palier responsive | Rien entre la base et `sm` (640 px). | Palier **`xs` (380 px)** ajouté : la base reste la plus sobre, `xs:` réintroduit l'info secondaire dès qu'il y a un peu de largeur. |
| Liste « Préparations à faire » | Ligne dense (nom + BL + transporteur + colis + segment + pastille « À préparer »). | Sur le plus étroit : pastille de statut et **colis** masqués (redondants), segment masqué, lignes **aérées** (`py-3`) — l'essentiel d'abord (client, BL, transporteur, alerte manquants). Tout réapparaît dès `xs`/`sm`. |

---

## 📱 Détail livraison — refonte mobile (testée sur le vrai composant) (NOUVEAU)

Écran principal du préparateur, **testé de bout en bout** (composant réel monté dans
Chromium à 320/390 px, action « Fait » exercée : POST `prepared:true`, bascule
d'onglet, vue en grand + « Préparation terminée » — zéro débordement horizontal à
chaque étape). Constats et correctifs :

| Élément | Avant (320 px — iPhone zoomé) | Après |
|---------|-------------------------------|-------|
| Ligne commande (OrderRow) | Nom client écrasé (« G.. »), badge « Manquant » **chevauchant** le compteur colis, méta « BL n° · Prise » empilée mot à mot. | **Deux rangées** sur mobile : identité client pleine largeur, puis l'action d'état (« À préparer / Faite / Parti ») en **grande cible tactile** (`flex-1`) + colis + agrandir. ≥ sm : une rangée, comme avant. |
| En-tête transporteur | Nom tronqué à une lettre (« A.. ») par le bouton groupé + 2 métriques. | Métrique « Cmd. » masquée sur mobile (se lit en dépliant), icône du bouton groupé masquée (libellé + couleur suffisent), gaps resserrés → **nom complet visible**. Même règle sur le sous-en-tête tournée. |
| Onglets segment / état | `flex-wrap` → onglet orphelin sur une 2ᵉ ligne (« GMS 2 », « Départ 1 »). | **Rail défilant** (nowrap + overflow-x-auto, scrollbar masquée) sur mobile ; wrap conservé ≥ sm. |
| Bandeau de synthèse | 4-5 grosses cartes en 2×2 poussant les transporteurs sous le pli. | **Une bande compacte** (chiffres en ligne, libellés courts) sur mobile ; cartes détaillées ≥ sm. |
| Dialogs (GLOBAL — `ui/dialog.tsx`) | Piste de grille **non bornée** : le min-content du plus large enfant (ex. bouton « Pas terminée — remettre sur la file ») faisait déborder TOUT le contenu du panneau (vue en grand illisible à 320 px). Panneau bord à bord. | `grid-cols-1` (minmax(0,1fr)) borne la piste ; largeur `calc(100%-1.5rem)` (marge 12 px), coins `rounded-2xl` partout, `p-4` mobile. **Tous les dialogs de l'app en profitent.** |
| Vue en grand — actions | Boutons compressés côte à côte. | **Empilés pleine largeur** sur mobile (« Préparation terminée » dominant, h-12) ; en ligne ≥ sm. |
| Bande de synthèse mobile — contenu | Cmd. · Clients · Colis · Poids (· HT). | **Clients et Colis retirés** (demande) : le préparateur garde Commandes + Poids (+ HT commercial) ; les colis par commande restent sur chaque ligne (info picking). Bureau inchangé (toutes les cartes). |

---

## 🔑 Rôles livreur / agréeur — rafraîchis sans se reconnecter (NOUVEAU)

| Élément | Avant | Après |
|---------|-------|-------|
| Flags `isLivreur` / `isAgreeur` du jeton | Résolus **uniquement à la connexion** : un rôle coché en base après coup (ex. passer un préparateur agréeur) n'apparaissait jamais — les téléphones d'entrepôt gardent leur session des semaines (PWA, cookie 30 j). L'agréeur ne voyait ni « Cdes fourn. » ni « Entrées march. », et le middleware le renvoyait vers /livraisons. | **Re-résolution périodique (TTL 5 min)** dans le callback `jwt` : le rôle coché dans Paramètres se propage tout seul en ≤ 5 minutes, sans déconnexion/reconnexion. Coût borné : ~1 requête SQL par utilisateur / 5 min (proxy.ts Next 16 = runtime Node). |

---

## 🕐 Gestion des heures — mobile responsive + après-midi masquée (NOUVEAU)

« Mes heures » (saisie perso de tous + état mensuel + vue équipe des managers)
reposait sur 3 tableaux larges (`min-w-[680-760px]`) qui forçaient un scroll
horizontal sur téléphone. Testé au harnais Playwright (composant réel, 320/1280 px).

| Élément | Avant | Après |
|---------|-------|-------|
| Après-midi | 2 plages **toujours affichées** (matin début/fin + a-midi début/fin). | **Masquée par défaut** (on ne travaille que très rarement l'après-midi) : bascule « + Après-midi » pour la révéler. Ré-affichée d'office si une saisie après-midi existe déjà (jamais de donnée cachée). Enlève 2 colonnes → tableau desktop plus lisible aussi. |
| Saisie de la semaine (tous) | Tableau Lun→Dim à 7 colonnes, scroll horizontal sur mobile. | **Une carte par jour** sous `md` : jour + date + total, ligne « Matin » (2 champs), note en pleine largeur ; grande cible tactile, week-end grisé. Tableau conservé ≥ md. |
| État mensuel « Mon mois » (tous) | Tableau 7 colonnes. | **Cartes par semaine** sous `md` (total + écart/25 %/50 %/équiv. payé/récup en puces) + carte « Total du mois ». Tableau ≥ md. |
| Équipe (managers) | Tableau 10 colonnes. | **Cartes par employé** sous `md` (nom + total + bouton PDF, détails en puces). Tableau ≥ md. |
| En-têtes de carte | Libellé de semaine complet + « PDF compta (tous) » débordaient sur mobile. | Libellé court (« Sem. 28 »), bouton « PDF » compact sur mobile ; bouton « Enregistrer » pleine largeur. |

---

## 🕐 Heures supp — option « récupération / paiement » reportée sur l'état (NOUVEAU)

Reprend le **formulaire papier hebdomadaire** (« Options » : *Récupération en nombre
de jours* — dates concernées — vs *Paiement des heures supp* ; choix à placer sur
l'état PDF transmis au comptable et au salarié). Une décision **par semaine**,
enregistrée avec les heures (`WeekEntry.option` / `recupDates`, AppSetting `rhsem:`)
et reportée sur l'état mensuel. Mobile-first, propre dans tous les états d'affichage.

| Élément | Avant | Après |
|---------|-------|-------|
| Choix récup / paiement | Sur papier, hors app. | Bloc **« Heures supp — que faire ? »** sous la saisie, affiché dès qu'il y a des heures supp (ou si un choix existe déjà). Deux cases exclusives façon radio (icône + libellé + puce), re-clic = « à décider ». |
| Dates de récupération | Cases « …… …… …… » manuscrites. | Champs **date** ajoutables/retirables (amorce d'un champ vide au choix « récup »), validés/dédupliqués/triés côté serveur (ISO, plafond 7). |
| Report sur l'état (compta + salarié) | — | Ligne **« ▪ Récupération — 08/07, 10/07 »** ou **« ▪ Paiement des heures supp. »** sous chaque semaine concernée du PDF mensuel + mention en légende. Pastille « Récup / Payé » aussi à l'écran (« Mon mois »). |
| Responsive | — | Cases empilées `< sm`, côte à côte `≥ sm` ; lignes de dates pleine largeur sur téléphone, en ligne qui s'enroule ≥ sm ; libellé de semaine tronqué + pastille qui ne déborde jamais. |

---

## 🧹 Nettoyage lisibilité — bandeau événements, module Promo, n° de documents

| Élément | Avant | Après |
|---------|-------|-------|
| Bandeau événements (tous les écrans, `EventsBanner`) | Libellé générique **« Événements »** répété en tête du bandeau. | Mot retiré : chaque puce porte déjà son événement (emoji + nom + date) ; un discret repère calendrier ouvre la ligne. |
| Module Promo (`PromoBanner`) | **Accolade rose** à gauche (`border-l-4 border-l-rose-500`). | Retirée — contour neutre ; l'identité promo reste portée par le label rouge « PROMOS ». |
| N° de documents (BL, commandes, entrées, EM, sorties/entrées SAP…) | **`#2700`** collé — lecture contrainte, confusion. | **`# 2700`** (espace après `#`) dans tous les affichages de documents : listes, cartes, tableaux, détails, dialogues, confirmations d'ajout et infobulles. |

---

## 🕐 Heures supp — décision EMPLOYEUR + garde-fou récup + sélection facilitée

Le choix récup / paiement des heures supp est désormais une **décision de l'employeur**,
avec un garde-fou légal (pas de récup sur une semaine déjà au contrat) et une
sélection des jours de récup en un clic.

| Élément | Avant | Après |
|---------|-------|-------|
| Qui décide | Chaque salarié réglait récup/paiement dans « Mes heures ». | **Réservé au manager.** Le salarié voit la décision en **lecture seule** (cadenas, « en attente de la décision de l'employeur »). Le serveur ignore toute modif du choix venant d'un non-manager (la décision enregistrée est conservée). |
| Régler pour un salarié | Impossible (écran perso uniquement). | Le manager choisit un **salarié dans un sélecteur** en tête de « Mes heures » et pose sa décision (via `?user=` déjà supporté par l'API). |
| Récup sur semaine pleine | Aucun contrôle. | **Interdit** de poser un jour de récup dans la semaine des heures supp (ex. 36h15 lun→ven ⇒ pas de récup le samedi de cette semaine) : le repos compensateur se prend sur une **autre** semaine (`isDateInWeek`). |
| Choix des jours de récup | Champs date ajoutés un par un. | **Puces « jour » cliquables** (jours des semaines suivantes, dimanches exclus) + « autre date » bornée après la semaine (`daysAfterWeek`). Un clic = ajout/retrait. |
| Récup fantôme | Une récup pouvait rester posée même si la semaine repassait à ≤ 35 h. | **Recalcul serveur à chaque enregistrement** : sans heures supp (les 35 h faites sans dépassement), l'option récup/paiement est **annulée** (rien à récupérer). Bloc masqué à l'écran, chip/PDF n'affichent la récup que pour une semaine réellement en supp. |

---

## 🔔 Validation mensuelle des heures — employeur ⇄ salarié (notif + popup)

Nouveau flux d'accord sur les heures du mois, avec **vraies notifications (push
PWA)** ET **notifications in-app (popup à l'ouverture)**.

- **Au 1er du mois**, l'employeur (direction) reçoit un **push** + un **popup à
  chaque ouverture** — qui revient tant qu'il n'a pas **envoyé** les heures du mois
  précédent aux salariés pour validation.
- Le salarié reçoit à son tour push + popup : **Valider** (entente) ou **Proposer
  une autre date** (récup + message). L'employeur **Accepte** ou **Renvoie** —
  la boucle continue **jusqu'à l'entente** (`sent` → `counter` → `agreed`).
- État par salarié et par mois en `AppSetting` (`rhvalid:<email>:<mois>`), machine
  à états pure et testée (`lib/heuresValidation`), verrou métier employeur ⇄ salarié
  côté serveur. Push nominatif via `notifyEmails` (réutilise l'infra Web-Push
  existante — actif dès que les clés VAPID sont configurées). Popup monté dans
  `AppLayout` (présent sur tous les écrans), « Plus tard » masque pour la session.

---

## 🛒 Console — ligne produit épurée + détail des lots au clic droit

| Élément | Avant | Après |
|---------|-------|-------|
| Ligne produit | Le **code article** figurait sur la ligne ; tags collés (`gap-1`). | Code article **retiré** de la ligne ; tags **légèrement espacés** (`gap-1.5`). |
| Détail des lots | Aucun accès rapide. | **Clic droit** sur une ligne → popup **« Lots »** (`LotDetailsDialog`) : lots connus (EM récentes · `/api/lots/candidates`), **DLC** (`/api/lots/dlc`), entrepôt et affectation. *(La quantité par lot en direct nécessite une requête stock-par-lot SAP dédiée — à ajouter ensuite.)* |

---

## 🌴 Congés — demande salarié → validation direction (notif + suivi)

Sur « Mes heures » : le salarié pose une demande de congés (type CP / RTT / récup /
sans solde / maladie / autre + plage de dates + motif) ; la **direction** valide ou
refuse, avec **push** + suivi in-app.

- Salarié : formulaire (type + du/au + décompte de jours) et suivi de ses demandes
  (statut, annulation tant qu'en attente).
- Direction : liste **« à valider »** (Valider / Refuser) — push au salarié à la décision.
- État par demande en `AppSetting` (`rhconge:<email>:<id>`) ; logique pure testée
  (`lib/conges` : validation de plage, décompte, chevauchement), persistance
  `lib/congesRh` (séparée pour garder le client sans Prisma). Validation réservée
  à `isDirection` (comme les heures) ; push via `notifyEmails`.

---

## 🛒 Console — clic droit : menu (Détails · Tout mettre) + lots EN STOCK

| Élément | Avant | Après |
|---------|-------|-------|
| Clic droit | Ouvrait directement le détail des lots. | **Menu déroulant** : **« Détails (lots en stock) »** et **« Tout mettre »** (ajoute le produit au panier avec sa quantité dispo). |
| Détail des lots | Lots issus des EM récentes (`/api/lots/candidates`) : **lent** (scan SAP) et incluait des lots **plus en stock**. | Source **table locale `ProductBatch`** (`/api/products/[id]/batches?inStock=1`) : **rapide** (aucun appel SAP), **uniquement les lots encore en stock** (`quantity > 0`), avec **quantité** + **DLC** + entrepôt, triés **FEFO** (DLC la plus proche d'abord). |

---

## 📦 Inventaire — ventes comptoir « préparées + livrées » d'office

Les commandes de clients **hors des 3 segments livrés** (GMS / CHR / Export) sont
des **ventes comptoir** : la marchandise part à la vente, elles n'ont rien à faire
dans la file « à préparer ». Elles restaient pourtant marquées **non préparées /
non parties**, faussant le suivi et l'inventaire.

| Élément | Avant | Après |
|---------|-------|-------|
| Nouvelle vente comptoir | Créée comme une commande à préparer (« pas préparé »). | Marquée **« faite » + « départ »** dès la création du bon (`/api/sap/orders`), uniquement pour une vraie commande (jamais une offre client). Segment déduit du **groupe SAP** (repli type client) via `isComptoirClient`. |
| Existant | Des dizaines de commandes comptoir ouvertes traînaient en « non préparé ». | Bouton **« Régulariser »** (pré-étape inventaire, responsables) → `POST /api/inventaire/backfill-comptoir` : scanne les commandes ouvertes, marque **préparé + livré** celles hors GMS/CHR/Export. **Idempotent** ; ne touche **jamais** un CardCode non résolu (prudence : pourrait être une adresse GMS). |

- Persistance : `markComptoirDelivered(docEntry, by)` écrit d'un coup `livfaite:` +
  `livdepart:` (AppSetting) — aucun appel ni écriture SAP.
- Décision de segment **pure et testée** (`lib/segments` : `isComptoirClient`) —
  le groupe SAP prime, repli sur le `type` client ; par défaut (aucun signal) =
  comptoir.

### Filet « d'office » au read time (`GET /api/livraisons`)

Le marquage à la création + la régularisation manuelle ne couvraient que les
commandes **passées par l'app**. Une vente comptoir créée **directement dans SAP**
(ou par conversion d'offre, ou avant la feature) retombait en « pas préparé » dans
**Ventes du jour / Préparations / Manquants** tant qu'on ne cliquait pas
« Régulariser ».

| Avant | Après |
|-------|-------|
| Vente comptoir non passée par l'app → « pas préparé » jusqu'à régularisation manuelle. | `GET /api/livraisons` force **`prepared` + `departed`** pour tout client **résolu** hors GMS/CHR/Export (`isComptoirClient`, groupe SAP + repli type). **Automatique**, quelle que soit la provenance de la commande — plus aucune dépendance au marqueur persistant ni au bouton « Régulariser ». |

- Le CardCode **non résolu** n'est **jamais** présumé comptoir (pourrait être une
  adresse de livraison GMS) — même prudence que la régularisation.
- Aucun impact sur le **Détail livraison** (déjà restreint aux 3 segments livrés
  via `keepDeliverableClients`) ; le filet agit sur les écrans qui listent **tous**
  les clients.

---

## 🛒 Console — lots au clic droit : plus de « aucun lot » sur un article en stock

Le détail des lots (clic droit → **Détails**) affichait « aucun lot en stock »
même pour un article manifestement en stock.

| Élément | Avant | Après |
|---------|-------|-------|
| Filtre lots | `/api/products/[id]/batches?inStock=1` filtrait sur `quantity > 0`. Or **cette colonne n'est jamais alimentée** par la synchro (défaut 0) : le filtre masquait donc **tous** les lots. | Filtre sur la **DLC** (`expirationDate` non dépassée, ou absente) — le seul signal fiable « encore en stock » pour du frais. Tri **FEFO** conservé. |
| Quantité | « Qté 0 » trompeur (donnée inexistante). | **Quantité en stock réelle** en tête (le dispo de la ligne, en colis) ; la « Qté » par lot n'apparaît **que si** elle est vraiment renseignée. Lot verrouillé SAP → tag **« Bloqué »**. |
| Article épuisé vs non suivi | Message unique. | « Épuisé » si dispo = 0 ; « article non géré par lot » si en stock sans lot en base. |

## 🧾 Bons de commande — l'offre disparaît une fois passée en livraison

Une **offre client** (bon de commande) « passée en commande » restait affichée
dans la liste des offres à passer.

- Après la conversion offre → commande (`/api/bons-commande` action `convert`), on
  **clôture l'offre** (Quotation) côté SAP (repli `Cancel` si besoin, best-effort :
  « déjà clôturée » = OK). Le GET ne listant que les devis ouverts, l'offre quitte
  aussitôt l'onglet — plus de doublon fantôme après le passage en livraison.

---

## 📒 Registre des lots TeleVent — quantité / fournisseur / prix, décrémentés à la vente

Le stock **par lot** n'existe pas dans le Service Layer SAP de cette base (seul le
stock par article est exposé). TeleVent le tient désormais **lui-même** (registre
`lib/lotLedger`, dans `ProductBatch.quantity`, repère `EM<DocNum>` — aucune
migration : la synchro n'écrit jamais cette colonne).

| Moment | Effet |
|--------|-------|
| **Réception** (`/api/sap/goods-receipts`) | Le lot `EM<DocNum>` est **crédité** : quantité reçue + **fournisseur** + **prix d'achat** mémorisés. |
| **Vente** (`/api/sap/orders`) | La quantité vendue est **décrémentée** du lot affecté (U_NoLot). Idem à l'affectation d'un lot sur un bon de commande (`/api/bons-commande` PATCH). |
| **Clic droit → Détails** | Chaque lot affiche sa **quantité restante** (en colis), son **fournisseur** et son **prix d'achat** ; les lots avec stock en tête. |

- `creditLots` / `debitLots` : résolution des `productId` en une requête, cumul par
  lot, plancher à 0, **best-effort** (une erreur de registre ne bloque JAMAIS une
  vente ni une réception). Ne visent que les **vrais lots** `EM<DocNum>`
  (`isRealLot`, pur & testé) — les lignes `EM_PENDING` / `EM_FAM` sont ignorées.
- Démarrage à froid honnête : les lots reçus **après** activation portent la
  quantité/fournisseur/prix ; les lots antérieurs restent affichés (DLC) et se
  garnissent au fil des réceptions.

---

## ⭐ Note qualité de la marchandise (1–5 étoiles) — saisie à la réception, visible en console

À la réception, chaque article reçu peut recevoir une **note qualité 1★–5★**. La
note remonte ensuite **en étoiles** sur la ligne de l'article dans la console (et
par lot dans le détail au clic droit).

| Où | Quoi |
|----|------|
| **Réception** (`GoodsReceiptForm`) | Sélecteur **étoiles** par ligne (mobile + desktop). Envoyé dans le corps de l'entrée (`lines[].rating`). |
| **Serveur** (`/api/sap/goods-receipts`) | Enregistre la note du **lot** (`EM<DocNum>`) et la note **courante de l'article** — best-effort, ne bloque jamais la réception. |
| **Console** (`Ecran2Order`) | Étoiles **lecture seule** à côté du nom de l'article (fetch `/api/marchandise-notes`). |
| **Détail des lots** (clic droit) | Étoiles du **lot** précis à côté de son numéro. |

- Stockage `AppSetting` (`artnote:<itemCode>`, `lotnote:<itemCode>:<lot>`) — clé/valeur
  JSON, **aucune migration**. Note bornée 1..5 (`sanitizeRating`).
- Composant `StarRating` réutilisable (interactif à la saisie, lecture seule à
  l'affichage). Les quantités restent exprimées dans l'unité de chaque article
  (colis, ou kg pour les articles au poids) — cohérent avec la console.

---

## 📈 Accueil — tuile « Marge du jour » (marge brute % de la journée)

Nouvelle 4ᵉ tuile KPI sur l'accueil, aux côtés de « CA du jour / Volume / Commandes » :
le **taux de marge brut % DU JOUR** (valeur de la journée), avec un indicateur de
**fiabilité**.

- Lue depuis la même requête que les autres KPI (`/api/pilotage/activity?g=day`,
  champ `marginPct`) — aucun appel supplémentaire.
- Calcul depuis le **coût RÉEL d'entrée marchandise** (`lib/cogs`, jamais la marge
  SAP) : chaque vente (BL) est costée au prix de la dernière **réception** de l'article.
- **Fiabilité = « stock propre »** : part du CA du jour dont la marchandise a
  effectivement été **REÇUE** (`salesReceptionCoverage`). Modèle négoce frais
  (achat & vente le même jour) : par article, couverture = min(1, reçu / vendu).
  Une **vente à découvert** (vendue avant d'avoir reçu) tire la fiabilité **sous
  100 %** ; elle remonte à mesure que les réceptions rentrent → « fiabilité X%,
  à découvert » (vert ≥ 80 %, ambre ≥ 50 %). Calcul global (les réceptions sont à
  l'échelle de l'entreprise), best-effort (un échec masque la sous-ligne sans
  casser les autres KPI).
- La grille KPI passe à 4 tuiles (2×2 en medium, 1×4 en large).

---

## 🔔 Notifications (toasts) — refonte visuelle globale

| Avant | Après |
|-------|-------|
| Sonner `richColors` quasi brut : carte plate, couleur criarde sur toute la surface, emojis (✅ ❌ 🚫 📄) en début de message. | **Carte « verre »** sur les tokens `popover` (translucide + blur), ombre douce, rayon 14 px. La couleur du type (succès / erreur / avertissement / info) ne teinte plus que la **pastille d'icône** (Lucide) — plus calme, lisible dans les deux thèmes. Emojis purgés : l'icône porte le sens. |
| Toast à boutons (« Encours dépassé ») : titre + description + `Abandonner` + `Créer quand même` **sur une seule ligne** → colonne de texte écrasée, phrase dupliquée, mention « La commande n'est PAS créée ». | **Grille 2 lignes** : icône + contenu en haut, **boutons sur leur propre ligne** alignés à droite (action = pilule or pleine, abandon = fantôme, press `scale(0.97)`). Message réduit à l'essentiel : titre `Encours dépassé — client`, description `Solde X € · limite Y €.` (chiffres lus depuis `json.encours`) — les boutons disent le reste. |
| Toast succès BLDialog : 7 lignes (HT, TVA, poids, frais, lots, DB…). | 1–2 lignes : `Commande #N créée` + `client — n ligne(s) · total TTC`. Le détail reste dans SAP / l'historique. |
| Croix de fermeture absente. | Croix en haut-droit, révélée au survol (toujours visible sur tactile `data-ui="touch"`). |

- Composant : `components/ui/toaster.tsx` (`AppToaster`) ; styles : section « Sonner toast » de `globals.css` (pilotés par les tokens → thèmes clair/sombre/colorimétries suivent d'office).
- Messages retravaillés (titre court, chiffres en description) : Écran 2, BLDialog, console mobile, bons de commande, bons de préparation, sync produits.
- Descriptions multi-lignes : `white-space: pre-line` (les `\n` composés restent des retours).

---

## ☀️ Mode jour « papier chaud » — refonte complète

| Avant | Après |
|-------|-------|
| Fond quasi blanc (`220 20% 97%`), cartes blanc pur, bordures à 90 % : tout se confond, « ça pique les yeux ». | **Canvas ivoire-greige teinté marque** (`42 24% 92%`), cartes **blanc cassé chaud** qui se détachent nettement, bordures/gris textuels assombris (muted-foreground 46 % → 38 %), ombres **teintées sépia** (jamais grises). |
| Ambiance (aurora, grille, anneaux radar) réglée pour le sombre — invisible en clair. | Alphas d'aurora relevés (+40 %), grille télémétrie et anneaux **visibles par thème** (`.ambient-rings-a/-b`, `--ambient-grid-alpha`). Le jour a la même « matière » que la nuit. |
| Scrollbar et sélection gris froid. | Scrollbar gris chaud assortie au papier. |

## ✨ Étincelles au clic (NOUVEAU) — `components/ClickSparks.tsx`

- Éclat de 12–16 particules or + anneau de choc au **clic sur une zone vide** — jamais sur un élément interactif (détection par ancêtre interactif **et** par curseur calculé).
- Canvas plein écran unique, rAF actif **seulement** pendant l'animation (coût nul au repos), ~600 ms, gravité + friction, palette marque adaptée jour/nuit.
- Désactivable : réglage « Étincelles au clic » (`televente:clickSparks`), coupé d'office par animations=off et `prefers-reduced-motion`.

## ⚙️ Paramètres — refonte UX complète

| Avant | Après |
|-------|-------|
| 8 cartes empilées sans ordre (thème, confort, contraste, logos, DLC, animations, promos, SAP), descriptions verbeuses, copie périmée (« colorimétrie »). | **4 sections nettes** : Apparence / Confort de lecture / Console & catalogue / Administration (admin), avec **sommaire ancré + scroll-spy** sur desktop. Descriptions raccourcies, copie à jour. |
| 3 lignes de réglages pour les logos de marque. | **Puces à bascule** compactes (Console · Livraisons · Inventaire) sur une seule ligne. |
| Aperçu du contraste de survol sur 3 lignes + bouton reset détaché. | Slider + % + « Réinit. » inline, aperçu 2 lignes. |
| Clé morte `televent-theme` (colorimétrie retirée) encore déclarée. | Purgée de `SETTING_KEYS`. |

---

## 🗓️ Planning congés & récup + tags de journée (heures)

Refonte de la gestion des horaires autour d'un principe : **à l'avantage du
salarié, validé par l'employeur** — chaque camp valide ce que l'autre pose
(circuit **boomerang**).

### Nouvel onglet « Planning » (`/planning` — Sidebar › Pilotage, tuiles mobiles, palette ⌘K)

| Élément | Comportement |
|---------|--------------|
| **Calendrier mensuel** (1 par personne) | Grille lun→dim, jours cliquables (plage), congés VALIDÉS en aplat coloré par type, EN ATTENTE en pointillé, récup posée + tags de la feuille d'heures en pastilles. |
| **Compteurs au-dessus de CHAQUE calendrier** | **CP restants** (solde annuel employeur − jours ouvrables pris, période 1/6→31/5) + **récup disponible** (heures) + plafond & « à payer M+1 ». |
| **Boomerang** | Salarié **demande** → direction valide. Direction **propose** (congés/récup au vu des compteurs) → le salarié **accepte/refuse**. Push web dans les deux sens, carte « À traiter » en tête d'écran. |
| **Calendrier d'ÉQUIPE** (managers) | Une ligne par salarié × jours du mois, compteurs (récup/CP/payé M+1) sous chaque nom, clic sur un nom → son calendrier. S'incrémente automatiquement des jours acceptés. |
| **Réglages employeur** (direction) | Solde CP annuel (jours) + **plafond récup (heures)** par salarié. |

### Règles métier (lib/planning — pur, 24 tests vitest)

- **Un CP validé compte comme TRAVAILLÉ** : le jour est taggé « Congés » dans la
  feuille d'heures et **crédité d'une journée type** (jamais de déficit créé).
- **Récup décomptée AU PASSAGE DE LA SEMAINE seulement** : si la semaine atteint
  quand même le contrat (les 35 h sont faites), le déficit est nul → **rien n'est
  déduit**. Débit borné par min(déficit réel, jours posés × journée type).
- **Plafond de récup** : les heures au-delà partent au **paiement des heures supp
  sur le bulletin du mois suivant** — ligne dédiée (rouge) sur l'état mensuel PDF
  envoyé à la compta (page employé + colonne « Payé M+1 » en synthèse équipe).

### Heures (« Mes heures »)

| Avant | Après |
|------|-------|
| Note libre par jour sur mobile (« CP, récup, maladie… »). | **Tags** une-touche par jour : Présent / Absent / **Congés** / Récup / Maladie (chips colorées, 1 seul tag, re-clic = retrait). Desktop : sélecteur de tag + note conservée. |
| Le CP saisi ne comptait pas dans les heures. | Jour taggé « Congés » sans heures ⇒ **journée type créditée** (badge « Congés crédités », hint « le congé compte comme travaillé »). |
| État mensuel sans compteurs. | Récap fin de mois : solde récup, plafond, **« à payer M+1 »**, CP — à l'écran (équipe) et sur le **PDF compta**. |

- Stockage inchangé (`AppSetting` : `rhsem:`, `rhprofil:` enrichis, `rhconge:` + champ `origin`) — **aucune migration**.
- Un congé validé est reporté automatiquement dans les semaines concernées (tags), le calendrier d'équipe se met à jour tout seul.

---

## 📣 Planning — notifications employeur multi-canal + sélection au glisser

| Élément | Comportement |
|---------|--------------|
| **Demande salarié** (congés / récup / sans solde — types déjà tous ouverts au salarié) | Part vers le patron sur TOUS les canaux configurés : **push in-app** (existant), **email** (Graph applicatif, boîte `CONGES_FROM_ADDRESS`, repli relances) avec bouton « Valider / refuser dans TeleVent », **WhatsApp** (Meta Cloud API, si `WHATSAPP_*` configurés) avec lien vers l'app. Chaque canal est best-effort : jamais bloquant. |
| **Validation** | L'évènement (journée entière, « libre », rappel J-1) est **poussé dans le calendrier Outlook** de chaque membre de la direction — Graph applicatif, permission d'application `Calendars.ReadWrite`. |
| **Calendrier du planning** | **Sélection au glisser** (souris + tactile) : on pose le doigt sur un jour et on glisse jusqu'au dernier ; `pan-y` préserve le scroll vertical, un geste repris par le navigateur (scroll) **restaure** la sélection précédente (pointercancel). Clic droit ignoré. |
| **Mobile** | Libellé de mois court (« 07/2026 ») dans les en-têtes, titre du calendrier tronqué, bouton Demander/Proposer pleine largeur (h-11). |

- Nouveaux réglages `.env` documentés : `CONGES_FROM_ADDRESS`, `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_DIRECTION_TO` / `WHATSAPP_TEMPLATE_NAME`, `APP_PUBLIC_URL`.
- `lib/congesNotify.ts` : constructeurs de contenu PURS (email HTML échappé, texte WhatsApp, évènement Outlook all-day fin-exclusive) couverts par 5 tests.

---

## 🖱️ Effet au clic — 3 effets au choix + spam-clic

| Avant | Après |
|-------|-------|
| Étincelles or, on/off, sur `click`. | **3 effets au choix** dans Paramètres › Apparence : **Étincelles** (or), **Onde d'eau** (anneaux concentriques bleutés), **Cascade** (gouttes qui giclent puis tombent jusqu'en bas de l'écran) — ou **Aucun**. |
| `click` → délai (attend le relâchement), spam-clic mou. | Déclenché sur **`pointerdown`** : zéro délai, spam-clic fluide. |
| Double-clic → sélection de texte → étincelles bloquées. | Double/triple-clic en zone morte : **sélection de texte annulée** (`preventDefault` sur mousedown multi-clic) → on peut spammer. |
| Tactile déclenchait aussi (tap). | **PC uniquement** (`pointerType === "mouse"`) — tablette/téléphone jamais. |

- Clé `televente:clickSparks` élargie : `sparks` (défaut, ex-« on ») · `ripple` · `rain` · `off`. Rétro-compatible (« on » → étincelles). Toujours coupé par animations=off et `prefers-reduced-motion`.

---

## 🏷️ Charte codes article + format date — CF · EM · Stock

Uniformisation de la **charte graphique des codes article** (cartouches couleur)
et du **format de date** sur les états SAP.

| Avant | Après |
|-------|-------|
| Codes article en **texte gris** dans les tableaux Commandes fournisseurs (CDE FOURNS), Entrée marchandise (EM) et Stock. | **Cartouches couleur** partout, même charte que l'Écran 2 : marque = **violet** · condt = **bleu** · calibre = **teal** · variété = **rose** · origine = **ambre**. |
| Variété affichée dans le créneau **teal** (couleur du calibre). | Variété dans son propre créneau **rose** (`variete`), le teal redevient réservé au calibre (`cal. …`). |
| Dates au format `10.07.26` (ou `10/07/2026` sur les sélecteurs). | **`VEN 10.07.26`** (jour court + date) sur tous les états — CF, EM, sélecteurs de date. |

- `lib/date-fr.ts` (NOUVEAU) : `fmtJourDate` / `fmtDateCourte` / `fmtJourDateHeure` — source unique du format « jour + date », plus de `fmtDate` local dupliqué par fichier.
- `DesignationChips` : nouveau tag `variete` (rose) distinct du `calibre` (teal, préfixe `cal.` auto). `Chip` unitaire aligné sur la même palette.
- `DateStepper` : rappel `VEN 10.07.26` sous le sélecteur (CDE FOURNS, EM, détails livraison).
- Écrans redéfinis : `PurchaseOrderForm` / `PurchaseOrderHistory` (CDE FOURNS), `GoodsReceiptForm` / `GoodsReceiptHistory` (EM), `ProductsTable` (Stock — variété `frgnName` désormais câblée).

---

## 📱 Planning — calendrier mobile repensé

- **Cellules façon appli** sur mobile : numéro du jour dans une pastille ronde plus grande, cellule **teintée par le type du congé validé** (lecture immédiate), statuts en **points ronds** (validé plein, en attente creux, récup, tag feuille d'heures ; max 4 + « … »). Sur desktop, barres pleines conservées.
- **En-têtes d'une seule lettre** (L M M J V S D) sous `sm` → plus de largeur par colonne.
- **Liste « Ce mois-ci »** sous le calendrier (mobile) : chaque congé/récup du mois avec type, plage et statut ; un tap sélectionne la plage. Les pastilles disent « quoi », la liste dit « quand & quel statut ».
- Sélection liée (bandeau continu) et choix clic début/clic fin inchangés.

---

## 🚚 Livraisons — hub à onglets (fin des « états doublons »)

Audit smoke-test métier : **4 entrées de navigation lisaient déjà la même donnée**
(`/api/livraisons`, types `lib/livraisonView`) sous 4 angles. On les fusionne sous
une seule entrée à onglets in-page — même pattern que « Clients & plan d'appel ».

| Avant | Après |
|-------|-------|
| **4 entrées Entrepôt** : « Préparation livraisons » (titre H1 *Détail livraison*), « Détails livraison », « Préparations à faire », « Manquants » — quasi-homonymes, ressenties comme des doublons. | **1 entrée « Livraisons du jour »** avec bandeau d'onglets : **Préparation · Par article · À préparer · Manquants**. Chaque route reste adressable (deep-link), l'entrée sidebar reste active sur ses routes secondaires (`also`). Sidebar Entrepôt : **8 → 5 entrées**. |
| Homonymie **« Détail livraison » / « Détails livraison »** (singulier/pluriel) — la confusion pointée. | Vue maître = **« Livraisons du jour »** (H1 + onglet *Préparation*) ; vue article = **« Détails par article »** (onglet *Par article*). Plus de collision. |
| Tuiles mobiles : « Préparation livraisons », « Préparations à faire », « Manquants » éparpillées sur 2 axes (Commercial / Acheteur). | Une tuile **« Livraisons du jour »** (axe Commercial) ; les sous-vues deviennent des onglets du hub. |

- `components/livraisons/LivraisonsSectionTabs.tsx` (NOUVEAU) : bandeau d'onglets par route, pastille active animée (`layoutId`), rail défilant sur mobile — calqué sur `ClientsSectionTabs`.
- **Masqué aux rôles terrain confinés** (préparateur/livreur) : `proxy.ts` ne leur ouvre que `/livraisons` (+ `/preparations`) — ils gardent `PreparateurNav`.
- Aligné partout : `Sidebar`, `MobileTiles`, `CommandPalette` (⌘K — les 4 routes groupées sous « Livraisons · … », `/details-livraison` ajouté), `MobileTopBar`.
- **Aucune page ni fonctionnalité supprimée** : uniquement un regroupement de navigation. `tsc` 0 · `eslint` 0 · `next build` 51 pages · 458 tests verts.

---

## ✨ Effets au clic — 3 signatures « salle de signal » + cascade 3D

`components/ClickSparks.tsx` — le micro-feedback ludique au clic (zone morte, PC
uniquement, canvas plein écran unique, boucle rAF active seulement tant que des
particules vivent) passe de **3 à 6 effets**. Réglable dans **Paramètres →
Apparence → Effet au clic**.

| Effet | Rendu |
|-------|-------|
| **Supernova** (`nova`) | Cœur incandescent (blanc chaud → marque), **éclat en croix** façon lens-flare (étoile 8 branches), onde de choc, puis **constellation** : les éclats projetés scintillent et se relient par de fines lignes lumineuses avant de s'éteindre. |
| **Radar** (`radar`) | Ping sonar raccord avec la DA : **réticule/crosshair**, 3 **anneaux de scan** concentriques décalés, **balayage rotatif** avec traîne en éventail, et **échos (blips)** qui pulsent le long du sweep. |
| **Aurore** (`bloom`) | **Halos radiaux diffus** teintés marque en mode additif (`lighter`), qui dérivent puis se dissolvent (fondu entrée + sortie), ponctués de **scintillements** — feel soft/luxe, non « gamer ». |

- **Colorimétrie-aware** : nova / radar / aurore lisent `--brand-500` à chaud → ils
  suivent **Or / Agrume / Fraise** selon le thème (les effets historiques restaient
  figés en or/bleu).
- **Cascade refondue « 3D »** (`rain`) : chaque goutte devient une **bille vitreuse
  ombrée** — dégradé radial DÉCENTRÉ (point chaud → corps → bord/ombre) = volume, plus
  un **reflet spéculaire** blanc décentré — avec **filament de traîne** (motion-blur) et
  **parallaxe de profondeur** (z : les gouttes proches sont plus grosses, plus saturées
  et accélèrent davantage ; les lointaines restent petites et atmosphériques, rendues du
  plus LOIN au plus PRÈS pour une occlusion correcte). Ajout d'une **couronne
  d'éclaboussure** (tension de surface) au point d'impact.
- Garde-fous inchangés : coupé par `animations=off` (data-reduce-anim) et
  `prefers-reduced-motion` (sauf « forcé »), tactile exclu, plafond de particules
  (anti-spam), jamais déclenché sur un élément interactif.

---

## 📄 « Bons de commande » — icône plus lisible

L'icône `ScrollText` (parchemin) se lisait comme une **accolade `{`** au format
sidebar, surtout à l'état actif en `brand-400` : forme ambiguë, peu reconnaissable.

| Avant | Après |
|-------|-------|
| `ScrollText` — parchemin dont la boucle supérieure évoque une accolade, peu lisible en petit. | **`FileText`** — document à lignes, silhouette nette de « bon / formulaire », plus visible et immédiatement reconnaissable. |

- Aligné partout : `Sidebar`, `MobileTiles`, `CommandPalette` (⌘K).
- Distincte des voisines : `ClipboardCheck` (Inventaire) et `Receipt` (Encours) restent identifiables.
- Aucune autre modification — simple échange d'icône.

---

## 💸 Célébration « grosse marge » + effets au clic affinés

Volet « dynamiser les ventes » + finitions des micro-interactions.

### Célébration des grosses marges (NOUVEAU) — `components/SaleCelebration.tsx`

Quand une commande est validée dans la Console avec une **marge nette ≥ seuil**
(défaut **200 €**, éditable), une **pluie de billets** (billets euros stylisés qui
culbutent en 3D + pièces d'or) s'abat sur l'écran, avec un **éclat doré central** et
un **badge « +X € »** animé (framer-motion). L'intensité et la mention montent avec le
ratio marge/seuil (« 🎉 Belle marge » → « 🔥 Grosse marge »).

- Déclenché par un évènement global `televente:celebration` émis par
  `celebrateSale(margeNette)` (`app-settings.ts`) — n'émet QUE si la fonction est
  activée, la marge atteint le seuil, et les animations ne sont pas coupées
  (data-reduce-anim / prefers-reduced-motion). Overlay canvas unique, rAF actif
  seulement tant que des particules vivent.
- Accroché dans `Ecran2Order.tsx` : la marge nette de la commande (`margeNetteTotal`,
  quand elle est costée) est transportée dans le job d'envoi puis passée à
  `celebrateSale` au succès de création (jamais sur une offre / un BL / une modif).
- **Réglages** (Paramètres → Console & catalogue) : interrupteur ON/OFF, **seuil en €**
  éditable, **style** (Billets · Confettis · Les deux), + bouton **Tester**.
  Entièrement désactivable.

### Effets au clic — affinages

| Sujet | Avant | Après |
|-------|-------|-------|
| **Étincelles** | Points or plats, teinte figée. | Teintées **marque** (suivent Or/Agrume/Fraise), **halo additif** + cœur blanc-chaud, **double anneau de choc**, braises scintillantes qui s'attardent. |
| **Onde d'eau** | 3 anneaux nus. | + **point d'impact** lumineux, **corps d'eau** translucide qui monte sous les anneaux, **gouttelettes de couronne** 3D qui giclent puis retombent. |
| **Délai entre effets** (NOUVEAU) | Toujours instantané. | **Cooldown réglable** (Instantané · 0,2 · 0,4 · 0,8 s) — réglage `clickSparksDelay`. |
| **Rester appuyé pour sélectionner** | L'effet partait dès l'appui → il se déclenchait au début d'une sélection de texte. | L'effet ne se déclenche qu'au **relâché d'un VRAI clic** (pointeur quasi immobile ET aucune sélection) : un press-drag n'active plus jamais l'effet. Le spam-clic reste possible. |

### Planning — pastilles allongées, présence par défaut, fériés & événements

Refonte des **pastilles du calendrier** (onglet Planning) — `components/planning/PlanningPanel.tsx`,
`lib/planning.ts` (logique pure testée), `lib/events.ts`.

| Sujet | Avant | Après |
|-------|-------|-------|
| **Lisibilité des pastilles** | Petits **points** ronds (couleur seule, sans texte) — il fallait ouvrir le jour pour savoir « quoi ». | **Pastilles ALLONGÉES** pleine largeur portant le **libellé de la catégorie** (CP, Récup, Présent, Maladie, Absent, Férié…). Libellé abrégé sur mobile (case étroite → pas de « … »), plein dès `md`. |
| **Présence par défaut** | Un jour sans congé/tag n'affichait **rien**. | **Présent par défaut** sur l'horaire type (**lun→ven** du mois, à tout le monde). La pastille ne « change » que pour un **CP / récup / absence / maladie / autre**, un **congé en attente** (pointillés) ou un **jour férié**. Week-ends et jours hors mois restent vides. |
| **Jours fériés** | Absents du calendrier. | **Fériés français** (réutilise `frenchHolidays`, `lib/livraison`) affichés en pastille **orange « Férié »** (couleur distincte de la maladie) + teinte de colonne dans le calendrier d'équipe. Prioritaires (jour chômé). |
| **Événements** | Uniquement dans la bannière du haut. | **Événements commerciaux** (Noël, 14 juillet, Saint-Valentin…) posés sur la case du jour via un **repère emoji** (coin supérieur droit) — `eventsByDate`. |
| **Calendrier d'équipe** | Barres de congés + points de tag. | Même résolution : présence en **ligne de fond discrète** (verte), congés en barres colorées, fériés en colonne teintée + emoji d'événement dans l'en-tête. |
| **Légende** | Types de congé seulement. | + **Présent**, **Férié**, **absent**, **en attente / posé**, **événement**. |

La résolution « une case → une catégorie dominante » vit dans `resolveCalendarDay` (pur, testé) :
férié → congé validé → tag feuille d'heures → congé en attente → récup posée → **présent par défaut** → rien.

### Planning — récup à la place des CP + CP hors dimanches/fériés + décompte ouvrable notifié

Suite de la refonte Planning — `lib/planning.ts`, `components/planning/PlanningPanel.tsx`,
`lib/congesNotify.ts`, `app/api/effectif/conges/route.ts`.

| Sujet | Avant | Après |
|-------|-------|-------|
| **CP & jours fériés** | Le décompte des CP en jours ouvrables (`expandOuvrables`) excluait le **dimanche** mais **comptait les jours fériés**. | Les **jours fériés chômés** sont désormais **exclus** du décompte (comme le dimanche) — un férié compris dans un CP ne consomme plus de congé. Toujours à l'avantage du salarié. |
| **Récup au lieu de CP** (NOUVEAU) | Poser un CP incluant un **samedi** (jour ouvrable décompté mais non travaillé) « gaspillait » un CP, sans alternative proposée. | Si de la **récup est disponible**, une **suggestion courte** apparaît **côté salarié uniquement** (jamais la direction) à la saisie du CP : « ce CP décompte N samedi(s) — bascule en récup pour préserver tes CP ». Bouton **Basculer en récup** → la demande part en récup, **validée par la personne en charge** (circuit boomerang existant). |
| **Décompte notifié** | La notification à la personne en charge des congés indiquait les **jours calendaires** bruts (`X j`). | Elle indique le **décompte réel en jours ouvrables** (lun→sam, **hors dimanches ET fériés**) sur tous les canaux : push in-app, email, WhatsApp/Outlook. |
| **Saisie** | « N jours ouvrables ». | « N jours ouvrables **(hors dimanches et fériés)** » — le coût réel est explicite. |

Helpers purs testés ajoutés à `lib/planning.ts` : `saturdaysInRange` (samedis « à vide » d'un CP,
fériés exclus) et exclusion des fériés dans `expandOuvrables`.

### Planning — récup : seuls les jours ouvrés (lun→ven) décomptent

Correctif du compteur de récup (`lib/planning.ts`, `computeRecupCounter`).

| Cas (contrat 35 h, journée 7 h, lun→ven) | Avant | Après |
|---|---|---|
| Poser **vendredi + samedi** en récup, sans saisie d'heures | **14 h** décomptées (2 jours pleins — le samedi coûtait à tort) | **7 h** (seul le vendredi, jour de contrat) |
| **Samedi seul** posé en récup | jusqu'à 1 jour | **0 h** (jour non travaillé → rien à récupérer) |
| Vendredi + samedi **avec** saisie (lun→jeu = 28 h) | 7 h | 7 h (inchangé) |

Règle : un **samedi / dimanche / jour férié** posé en récup n'est **jamais** décompté —
il n'y a aucune heure à récupérer sur un jour hors du contrat lun→ven (35 h). Le débit reste
plafonné par le déficit réel de la semaine (contrat atteint → rien déduit). Toujours à l'avantage du salarié.

### Planning — récup créditée en heures MAJORÉES (repos compensateur de remplacement)

`lib/planning.ts` (`computeRecupCounter`).

Le compteur de récup crédite désormais les heures supp **majorées** (+25 %/+50 % inclus),
et non plus les heures brutes — un repos compensateur de remplacement doit valoir la paie
qu'il remplace.

| Semaine (contrat 35 h, journée 7h15) | Récup créditée — avant | après |
|---|---|---|
| 6 jours (43h30) = 8h30 supp (8 h à +25 %, 0h30 à +50 %) | 8h30 | **10h45** |
| 39 h = 4 h supp (+25 %) | 4 h | **5 h** |
| 45 h = 10 h supp (8 h +25 %, 2 h +50 %) | 10 h | **13 h** |

**Rétroactif** : le compteur est recalculé à la volée depuis les saisies de semaines, donc
toute la récup déjà acquise est **revalorisée automatiquement** (aucune migration de données).
Combiné au débit à l'heure brute (jour de récup posé = journée type) et à l'exclusion
samedi/dimanche/férié, la récup est **doublement à l'avantage du salarié**.

---

## 🧾 Écran 2 — bandeau compact + pied de commande allégé

Prise de commande (`app/console/ecran2/page.tsx` + `components/console/Ecran2Order.tsx`).
Objectif : **agrandir la colonne COMMANDE en hauteur** en dégraissant le bandeau
et le pied, et remonter les contrôles clés **à côté du client**.

| Élément | Avant | Après |
|---------|-------|-------|
| **Recherche + « Créer / Modifier un bon »** | Bloc vertical de 320 px empilé (bascule au-dessus, champ en dessous), poussé tout à droite. | **Une seule rangée** (bascule + champ + « Suivre l'écran 1 ») posée **juste à côté du client**. Bandeau plus court → COMMANDE plus haute. |
| **Compte / mode de livraison** (« Direct (AKREM) ») | `<select>` pleine largeur en **pied** de la colonne commande, toujours affiché. | Remonté **à côté du nom client** (haut à gauche) et **masqué s'il n'y a qu'un seul compte** (le défaut est appliqué silencieusement) — n'apparaît que quand il y a un vrai choix. État remonté au parent, passé au constructeur via `deliveryModeId`. |
| **« Bon de commande »** (lots affectés plus tard) | Bandeau pleine largeur sur sa propre rangée. | **Puce compacte** placée sur la rangée de la date de livraison — mêmes règles (forcé + verrouillé si précommande / découvert), détail dans l'infobulle. |
| **Total HT** | Ligne dédiée « Total HT estimé … € » au-dessus du bouton. | **Porté sur le bouton d'action** (« Créer la commande (n) … 152,40 € HT ») — une rangée de gagnée. |
| **Bandeau client** | `py-2.5`, marges internes plus larges. | Rythme vertical resserré (`py-2`, marges réduites) — quelques pixels rendus à la commande. |

### Planning — récup utilisée AVANT les CP par défaut

`components/planning/PlanningPanel.tsx`.

Côté salarié, dès qu'il reste de la récup au compteur, le formulaire de demande part
sur **« Récupération » par défaut** (au lieu de « Congés payés ») : la récup se consomme
**avant** les CP, elle les remplace — les CP sont préservés. Reste modifiable manuellement.

Si le salarié repasse malgré tout sur **CP** alors qu'il a de la récup, un rappel s'affiche —
« Il te reste X de récup — utilise-la avant tes CP » + bouton **Utiliser ma récup** (et signale
au passage un éventuel samedi décompté). Réservé au salarié (jamais la direction), validé
ensuite par la personne en charge (circuit boomerang).

---

## 🧱 Écran 2 — bloc client + stock regroupés, commande pleine hauteur

Suite de la refonte de l'Écran 2 : le **bandeau client** n'est plus une rangée
pleine largeur au-dessus des colonnes — il est **regroupé avec le stock dans un
seul bloc à gauche**, ce qui laisse la **colonne commande s'aligner sur toute la
hauteur** (plus de lignes produit visibles sans scroller).

| Élément | Avant | Après |
|---------|-------|-------|
| **Bloc gauche** | Bandeau client (panneau plein) au-dessus, puis colonne stock en dessous. | **Un seul bloc** : identité client + méta + recherche « créer / modifier un bon » **intégrées en tête de la colonne stock** (bandeau « plat », séparateur, plus de panneau séparé). Passé au constructeur via `clientHeader`. |
| **Colonne commande** | Démarrait sous le bandeau client → écourtée. | S'**aligne sur toute la hauteur** du bloc → nettement plus de lignes visibles sans scroller. |
| **N° de commande (réf. client) + note BL** | Rangée dédiée au **pied** de la commande. | **Calées en tête du bloc gauche** (avec le client) — le pied de la commande est allégé d'autant. |
| **« Dupliquer la dernière cde »** | Bouton texte + icône, à **gauche** des raccourcis. | **Icône seule**, posée **à droite** des raccourcis. |
| **Raccourcis produits** | Nombre illimité. | **Limités à 4** (bouton « + Raccourci » masqué au-delà). |

### Planning — découpe automatique récup + CP (jours ENTIERS)

`lib/planning.ts` (`splitLeaveRecupCp`, pur/testé), `components/planning/PlanningPanel.tsx`.

Quand le salarié pose des **congés payés** et qu'il lui reste de la récup, celle-ci est
consommée **d'abord**, mais uniquement en **journées entières** : N = ⌊solde ÷ journée type⌋.
Le reste part en CP. Deux demandes sont créées automatiquement (récup + CP), avec un **aperçu**
avant l'envoi. Remplace le « défaut tout-récup » précédent (qui pouvait dépasser le solde).

Exemple (journée 7h15) : poser une semaine avec **18 h de récup** → **2 j en récup** (14h30,
`floor(18 ÷ 7,25) = 2`) **+ le reste en CP** ; jamais une 3ᵉ journée partielle (21h45 > 18 h).
Un samedi éventuel restant en CP est signalé. Toujours à l'avantage du salarié (récup majorée
au crédit, débit plafonné au manque réel vs 35 h).

---

## 🏷️ Préparation — tags variété + calibre sur les articles

Les écrans de **préparation** (Détail livraison + récap par article) affichent
désormais, en plus de la marque · conditionnement · origine, la **variété** et le
**calibre** de chaque article — pour lever les ambiguïtés entre deux lots d'un
même fruit (ex. Fraise *Belorta / Karima* vs *Lady Gold*, calibre différent).

| Écran | Avant | Après |
|-------|-------|-------|
| **Détail livraison** (console de préparation, lue au téléphone) | Tags marque · condt · origine. | + **calibre** (teal) et **variété** (rose) — mêmes couleurs que l'Écran 2. |
| **Récap par article** | marque · condt · variété · origine. | + **calibre**. |

- **Variété** = `Product.frgnName` (SAP `FrgnName`), déjà synchronisée.
- **Calibre** = SAP `Items.U_GER_CALIBRE`, **lu en direct** dans `/api/livraisons`
  (piggyback sur la requête stock existante) — aucun champ local ni migration :
  le calibre n'apparaît que pour les articles où SAP le renseigne.

---

## 🐛 Fix — création d'un type de contact/incident impossible (menu rogné)

`components/TypeCombobox.tsx` (types de contact & d'incident réutilisables).

**Symptôme** : impossible de créer un nouveau type de contact — le bouton
« Créer « … » » semblait absent / inopérant.

**Cause** : le menu déroulant était un enfant `absolute` d'une carte
`SectionCard` en **`overflow-hidden`** → le **bas du menu était rogné**, or c'est
là que vit le bouton « Créer » (le haut, « — Aucun », restait visible, d'où
l'effet « étrange »).

| Sujet | Avant | Après |
|-------|-------|-------|
| **Menu déroulant** | Enfant `absolute`, rogné par la carte parente. | Rendu dans un **portal** (position fixe) → s'affiche par-dessus tout, plus jamais coupé. |
| **Entrée (⏎) sur un libellé existant** | Ne faisait **rien** (impasse). | **Sélectionne** la correspondance exacte ; sinon **crée**. |
| **Erreurs (création / réseau)** | **Avalées en silence** (« ça ne marche pas »). | **Toast** explicite ; création idempotente (pas de doublon). |

---

## 🐛 Fix — un chef livreur/préparateur ne voyait pas les livraisons à préparer

`lib/permissions.ts` (`isLivraisonRestricted`, nouveau) + routes/pages du module
livraisons.

**Symptôme** : Jean-Michel (direction + commercial **et** livreur) ne voyait pas
les livraisons « en cours » à venir et ne pouvait donc pas les **mettre en
préparation** — l'action semblait réservée au commercial qui avait vendu.

**Cause** : le rôle « accès restreint » du module livraisons était
`préparateur restreint OU livreur`. Comme Jean-Michel porte le flag `isLivreur`
(il aide à livrer), il était confiné comme un pur livreur : il ne voyait que les
BL déjà mis en prépa et le bouton « mettre en prépa » lui était refusé.

**Fix** : un rôle **élevé** (admin / direction / commercial) garde l'**accès
complet** même s'il porte aussi un flag terrain. Un préparateur/livreur **pur**
reste confiné (inchangé). Appliqué de façon homogène à tout le module
(Détail livraison, mise-en-prépa, exclusions, bon de transport, ventes du jour,
fiche transporteur) via l'unique helper `isLivraisonRestricted`.

### Planning — hiérarchie visuelle des pastilles (présence en filigrane)

`components/planning/PlanningPanel.tsx` (`DayPill`).

Le « Présent » par défaut remplissait tout le calendrier de pastilles vertes pleines et
bordées, aussi marquées que les exceptions → surchargé. Nouvelle hiérarchie (« juste milieu » :
lisible mais aéré) :

| Avant | Après |
|-------|-------|
| Présent = pastille pleine + bordure, même poids que CP/récup | Présent = **filigrane** (fond très doux 7 %, texte allégé, `font-medium`, **sans bordure**) — la présence ne noie plus la grille |
| Toutes les pastilles bordées | **Plus de bordure** sur les pastilles pleines ; le **pointillé** reste réservé aux congés **en attente / posés** |
| Exceptions peu distinctes | **CP, récup, férié, absence, maladie** ressortent nettement (pastille pleine colorée, `font-semibold`) |

Lisibilité conservée (libellés partout, abrégés sur mobile) ; le calendrier respire.
