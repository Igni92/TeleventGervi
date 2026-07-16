# Audit visuel & plan de redesign — TeleVent Gervi

> Audit complet du 16/07/2026 (3 passes d'exploration : écrans achats/réceptions,
> kit UI & doublons, pages principales & coquille). Objectifs client :
> **1.** moins « IA », plus agréable à regarder · **2.** info importante en
> blanc/jaune et EN GRAND · **3.** détails secondaires derrière un pictogramme
> « ? » cerclé au survol · **4.** sur mobile, l'info secondaire est supprimée ·
> **5.** les onglets déroulants (réceptions, commandes fournisseurs…) passent en
> PLEIN ÉCRAN (on oublie le fond) · **6.** boutons/polices/couleurs plus beaux,
> doublons purgés.

---

## I. AUDIT — constats

### A. Ce qui fait « template IA » aujourd'hui

| Constat | Où | Gravité |
|---|---|---|
| Fond d'ambiance « salle de signal » : 2 auroras en dégradés radiaux (jaune + bleu + violet), grille technique, anneaux radar | `AmbientBackground.tsx`, `globals.css:489-605` | 🔴 le marqueur IA n°1 |
| Une seule police (Inter) partout — `font-display` était un alias de la même fonte, donc aucune vraie voix typographique | `layout.tsx`, `tailwind.config.ts` | 🔴 |
| Kickers/eyebrows uppercase gris PARTOUT (10.5px, tracking 0.18em) + sous-titres explicatifs verbeux sous chaque h1 | toutes les pages | 🟠 |
| Barres d'accent multicolores posées par index, pas par sens (Paramètres enchaîne 6 couleurs de cartes) | `SurfaceCard` + ~22 fichiers | 🟠 |
| Spotlight qui suit le curseur (bento), étincelles au clic (`ClickSparks`), badges qui vacillent, point qui pulse | `pilotage/bento.tsx:78`, `layout.tsx:58` | 🟡 |

### B. Hiérarchie de l'info — trop de gris, pas assez de héros

- Les **montants et noms** (l'important) sont souvent en 12-13px gris : sur
  Réceptions desktop, le **nom du fournisseur n'était même pas affiché** (seul
  le cardCode mono) ; réf. BL, lot, dates techniques au même niveau visuel que
  le total HT.
- **2 262 occurrences de `text-[Npx]`** sur **33 tailles distinctes** — aucune
  échelle typographique. Chaque écran improvise au demi-pixel.
- **Aucun `PageHeader` partagé** : 4 patterns de `<h1>` concurrents (26/28/32/34px,
  `font-semibold` vs `font-bold` vs `font-light`, avec/sans `font-display`).

### C. Doublons (composants et styles)

| Doublon | Détail |
|---|---|
| **8+ clones de `Stat`/`Kpi`/`Metric`** | `GoodsReceiptHistory:559` ≡ `PurchaseOrderHistory:93`, `InventairePanel:1559`, `Encours:476`, `CallConsole:1076`… pendant que `ui/stat.tsx` a **0 import** |
| **2 systèmes de tooltip** | `InfoTip` (icône « i », 21 usages) vs **355 `title=` natifs** dans 78 fichiers (hors design system, pas de dark mode) |
| **Badge SAP copié-collé** | `SupplierTable:116` ≡ `fournisseurs/[id]/page.tsx:72` |
| **Helpers `eur`/`fmtColis`/`WAREHOUSES`** | redéfinis dans 4+ fichiers entrees/* |
| **`ReceiptDetail` rendu 2 fois** | accordéon inline + modale, avec double jeu de tailles `big` |
| **419 `<button>` bruts** vs `ui/button` · **39 tables maison** vs `ui/table` · `ui/card.tsx` mort (0 import) | toute la feature layer |

### D. Couleurs hors palette

- `slate-*` ×140, `blue-*` ×57, `zinc-*` ×18, `white/black` en dur ×249.
- Top fichiers : `Sidebar.tsx` (94 !), `ImportModal` (32), `LivraisonDetail` (28),
  `CallConsole` (28), **le kit lui-même** (`ui/button` 27, `ui/badge` 8 — sans
  variantes dark → badges illisibles en mode sombre).

### E. Patterns déroulants (cible « plein écran »)

| Écran | Pattern actuel | Cible |
|---|---|---|
| Réceptions (`GoodsReceiptHistory`) | accordéon inline dans le tableau (2ᵉ `<tr>`) **ET** modale centrée `max-w-5xl` — deux chemins pour le même détail | un seul chemin : plein écran |
| Commandes fournisseurs (`PurchaseOrderHistory`) | modale centrée `max-w-5xl` (overlay noir, fond visible) | plein écran |
| Bons de commande (`BonsCommandePanel`) | 2 accordéons inline (offres `:445`, bons `:544`) sans animation + menu lot portalé | plein écran |

### F. Mobile

- Le socle existe déjà (`.kicker` masqué < 768px, sous-titres `hidden md:block`,
  variante `touch:`), mais les cartes mobiles affichent encore lot, nb lignes,
  réf. internes, mag. — à élaguer.

---

## II. PLAN DE REDESIGN — détaillé

### Phase 1 — Fondations (design system)

1. **Typographie** : ajout de **Space Grotesk** comme fonte display (titres +
   gros chiffres) — personnalité géométrique-industrielle assortie à l'identité
   anthracite/jaune, chiffres tabulaires conservés. Inter reste en texte courant.
2. **`<PageHeader>` partagé** (`ui/page-header.tsx`) : UN SEUL pattern de titre
   (`font-display` 26→34px bold) ; le sous-titre explicatif passe derrière le
   « ? » ; appliqué à toutes les pages.
3. **`ui/button`** : variantes 100 % tokens (fini le slate), transitions sur
   propriétés explicites, press feedback conservé (`scale 0.97`).
4. **`ui/badge`** : teintes translucides lisibles clair ET sombre.
5. **Fond d'ambiance apaisé** : suppression de la grille technique et des
   anneaux radar ; une seule nappe de teinte très discrète. Fini l'effet
   « génération IA ».

### Phase 2 — Hiérarchie de l'info

6. **`<InfoHint>`** (`ui/info-hint.tsx`) : pictogramme « ? » cerclé, bulle au
   survol/focus (portal, 150 ms ease-out), **masqué sur mobile/tactile** —
   l'info secondaire y est supprimée, conformément à la demande.
7. Règle appliquée écran par écran : **montants, quantités, statuts, noms en
   blanc (foreground) ou jaune (primary), en grand, font-display** ; réf.
   internes, lots, dates techniques, métadonnées → `InfoHint`.
8. **`<StatBlock>`** (`ui/stat-block.tsx`) : mini-stat unifiée (label kicker +
   valeur héros 24px display) remplaçant les clones locaux.

### Phase 3 — Plein écran des déroulants

9. **`<FullscreenPanel>`** (`ui/fullscreen-panel.tsx`) : détail pleine page sur
   fond OPAQUE (Radix Dialog : focus trap, Échap, scroll lock) ; en-tête avec
   retour + titre héros + montant en jaune ; actions dans l'en-tête.
10. **Réceptions** : suppression de l'accordéon inline, un seul chemin plein
    écran ; nom fournisseur promu en liste ET en titre du plein écran.
11. **Commandes fournisseurs** : modale → plein écran ; modes édition/réception
    aérés.
12. **Bons de commande** : accordéons offres/bons → plein écran.

### Phase 4 — Dédoublonnage & nettoyage

13. Helpers de formatage partagés (`lib/format.ts` : `eur`, `fmtColis`).
14. Fusion des `Stat` locaux → `StatBlock` ; suppression `ui/card.tsx` mort ;
    badge SAP partagé.
15. Purge des couleurs hors palette dans les fichiers les plus touchés
    (kit, écrans refondus, ImportModal, Sidebar en partie).

### Phase 5 — Vérifications

16. `tsc` 0 · `eslint` 0 · `vitest` verts · `next build` OK · revue visuelle.

### Backlog assumé (chantiers suivants, hors de cette passe)

- Migration des **355 `title=`** restants vers `InfoHint` (fichiers les plus
  denses : `LivraisonDetail` 35, `Ecran2Order` 28, `ParametresPanel` 25).
- **`LivraisonDetail.tsx`** (184 Ko) : refonte dédiée (le fichier le plus
  incohérent du repo — 172 tailles ad hoc, 52 boutons bruts).
- Généralisation `ui/table` (39 tables maison) et `ui/button` (419 boutons bruts).
- Tokens sémantiques de statut (`--success/--warning/--danger/--info`) pour les
  ~120 badges de statut hardcodés.
- Sidebar : tokenisation complète des 94 couleurs en dur.
