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
