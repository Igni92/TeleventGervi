# Charte d'ADN visuel — TeleVent (Gervi)

> 1-pager. **Proposition de cadrage**, pas une décision finale : le choix de la couleur de marque appartient au client.
> Objectif : rendre les futurs chantiers graphiques **cohérents** au lieu de cosmétiques. Une marque = une identité.
> Source : `docs/audit-transformation/00-SYNTHESE-CONSOLIDEE.md` (Vision Graphique / DA).

---

## Personnalité de marque

Quatre traits, dans cet ordre :

1. **Solidité** — un outil de grossiste premium, pas une démo. Socle anthracite, contrastes francs, rien qui tremble.
2. **Rapidité** — l'interface suit le geste du commercial : feedback immédiat, transitions courtes, zéro fioriture qui ralentit.
3. **Confiance** — la Direction comprend en moins de 3 s et n'a jamais peur. Lisibilité, stabilité, états explicites.
4. **Précision** — c'est un métier de marge, de lots et de dates. La donnée chiffrée est nette, alignée, jamais ambiguë.

**Métaphore directrice : la fraîcheur du marché du matin / le primeur** — la fraise mûre, le cageot, le tri par fraîcheur. On reconvertit l'ancienne métaphore « radar / signal » (hors-sujet) vers ce registre. Le « signal » live ne survit que là où il a un sens réel (console d'appel en direct).

---

## Couleur

**Principe : un socle anthracite premium + UNE seule couleur de marque.** Le jaune/or est **relégué au sémantique** (alerte / attention), il n'est plus l'identité.

- **Socle (neutre, dominant)** — anthracite à légère pointe (mode sombre par défaut, premium et reposant pour de longues sessions). Tokens existants : `--background: 222 18% 8%` (charcoal), `--foreground: 210 22% 95%`. C'est la toile, elle ne change pas.

- **Couleur de marque — PROPOSITION : rouge-fraise mûr profond.** Issue du produit, immédiatement « Gervi ». Le thème `fraise` existe déjà dans `globals.css` et sert de base chiffrée :
  - accent vif (CTA, état actif) : `--brand-500 ≈ 350 89% 60%` → `--brand-600 ≈ 347 77% 50%`
  - profondeur (hover, socle bordeaux) : `--brand-800 ≈ 343 80% 35%` → `--brand-900 ≈ 342 75% 30%`
  - anthracite rosé du mode sombre : `--background: 344 28% 7%` (charcoal bordeaux)

- **Couleurs sémantiques (réservées, jamais décoratives)** :
  - **Succès / fraîcheur OK** : vert.
  - **Attention / DLC proche / encours** : jaune-or (l'ancien primaire, recyclé ici à sa juste place).
  - **Erreur / danger / rupture** : rouge sémantique `--destructive: 0 72% 51%` — à **distinguer visuellement** du rouge-fraise de marque (saturation/teinte différentes) pour ne pas confondre « marque » et « danger ».

- **Arbitrage tranché par l'audit** : **supprimer de la barre le switcher 3 colorimétries** (or / agrume / fraise). Une marque ne peut pas avoir trois identités. Au mieux, réglage admin avec un défaut imposé. Purger les **résidus indigo / purple** (indicateur de page actif présent sur 100 % des écrans) au profit des tokens `--brand-*`.

---

## Typographie

- **Une seule famille** sans-serif neutre et solide (la pile système / Geist déjà en place convient), aucune fantaisie décorative.
- **Une échelle typo en tokens, ~6 à 8 tailles** — supprimer l'échelle fantôme (valeurs hard-codées type 736 px, demi-pixels, ~30 tailles flottantes constatées à l'audit).
- **Hiérarchie franche** : un titre se distingue d'un libellé par la taille ET le poids, pas par une nuance de gris subtile.
- **Chiffres** : tabulaires / alignés pour les colonnes de montants, marges et quantités (lisibilité de tableau).
- **Confort Direction** : taille de corps généreuse, interlignage aéré ; on ne tasse jamais pour gagner de la densité au détriment du décideur.

---

## Iconographie

- **Un jeu d'icônes unique** (outline, trait régulier — Lucide déjà présent), pas de mélange de styles.
- **Un seul symbole de marque** — aujourd'hui deux concurrents (Phone au login, waveform en sidebar) : trancher, créer un `<Logo/>` unique, un favicon et un apple-icon réels (l'onglet affiche encore l'icône Next.js).
- **Vocabulaire visuel ancré dans le métier** : fraise, cageot, fraîcheur, téléphone — pas de « radar » abstrait.
- **Icône = renfort, jamais seule porteuse de sens** (toujours doublée d'un libellé pour la Direction).

---

## Do / Don't graphiques

**Do**

1. **Contrastes forts** — viser et tenir WCAG 2.2 AA partout (le CTA principal et la sidebar sont aujourd'hui en échec : 2,37:1 et 2,66:1). Un libellé doit se lire sans effort par un œil de >50 ans.
2. **États « Selected » / actif très marqués** — pour la Direction, l'élément actif (onglet, ligne, filtre) doit être évident d'un coup d'œil : fond plein de marque + contraste, pas une simple bordure fine.
3. **Sobriété par défaut** — l'ambiance « salle de signal » (aurora, marquee permanent, radar) est une force d'exécution mais un contresens d'ADN : on garde la perf, on coupe le superflu, on met le calme en défaut.
4. **Une seule famille de cartes** (aujourd'hui trois : Card / SurfaceCard / SectionCard) — un seul système de surface, un seul rythme.
5. **Respecter `reduced-motion`** — toute animation est gardée ; « réduire les animations » réduit réellement (essentiel pour la Direction).

**Don't**

1. **Ne pas faire « template SaaS 2024 »** — dégradés violets génériques, glassmorphism par défaut, micro-animations partout : rien qui dise « Gervi grossiste fraise ».
2. **Pas de couleur décorative** — aucune teinte qui ne porte pas de sens (marque OU sémantique). On ne colore pas « pour faire joli ».
3. **Pas de gris sous le seuil** pour du texte porteur d'information (libellés de menu, en-têtes).
4. **Pas d'indigo / purple résiduel** nulle part — c'est un bug d'identité, pas un choix.
5. **Pas de disposition réorganisable / renommable** sur les écrans Direction : la mémoire spatiale prime sur la personnalisation.

---

*Statut : PROPOSITION. À valider avec le client, en priorité le choix de la couleur de marque (rouge-fraise mûr proposé). Une fois tranchée, cette charte devient la référence de tous les chantiers graphiques.*
