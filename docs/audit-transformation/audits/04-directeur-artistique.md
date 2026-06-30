# Audit Direction Artistique — Identité visuelle TeleVent / Gervi

## 0. Verdict en une phrase

**Belle exécution, mauvaise marque.** Le code graphique est d'un niveau studio (tokens propres, dark anthracite premium, motion sobre et perf-consciente), mais il habille un **ADN emprunté et flou** : métaphore « radar/signal » importée de l'aviation, **3 colorimétries** qui interdisent toute reconnaissance, **jaune « Controllino »** hérité d'un automate industriel, **résidus indigo** non purgés malgré le changelog, et — le plus grave — **aucun actif de marque réel** : zéro logo fichier, zéro favicon, nom générique « TeleVent ». Un client ou un dirigeant ne peut pas regarder un écran et dire « ça, c'est Gervi ».

**Note de maturité DA : 58/100.** L'artisanat est là ; la direction artistique, non.

---

## 1. Ce que raconte l'identité actuelle (lecture à froid)

J'ai ouvert le fond (`AmbientBackground.tsx`), les tokens (`globals.css`), le login, le logo (`Sidebar.tsx:248-256`) et le switcher. Voici le message involontaire envoyé :

| Élément | Ce qui est codé | Ce que ça raconte au cerveau | Ce qu'on voudrait raconter |
|---|---|---|---|
| Fond | Aurora + grille + 2 radars (`AmbientBackground.tsx:28-49`) | « Cockpit / trading / télémétrie » | Fraîcheur, marché du matin, confiance |
| Logo | Waveform 5 traits inline (`Sidebar.tsx:249-255`) | « Outil audio/signal générique » | « Gervi, primeur fraises » |
| Login | Icône Phone (`login/page.tsx:55`) | « Une appli de téléphone » | Vitrine de marque |
| Couleur défaut | Jaune « Controllino » (`globals.css:68`) | « Industriel / avertissement / agrume » | Fruit rouge phare |
| Switcher | Or / Agrume / Fraise au choix de chacun | « Pas de marque, une préférence » | UNE identité |

**Le problème central n'est pas le goût — c'est le SENS.** Tout est joli et rien ne signifie *fraise*, *fraîcheur*, *Gervi*. Pour un grossiste dont le produit phare a une **DLC de 2-3 jours** et dont tout le métier est la rotation et la confiance, l'identité devrait crier « frais, rapide, fiable ». Elle murmure « SaaS tech 2024 ».

---

## 2. Le test décisif : « ça ressemble-t-il à un dashboard IA générique ? »

La mission demande explicitement de ne ressembler ni à un dashboard IA ni à ChatGPT/Cursor/Claude. **Or l'app coche aujourd'hui la check-list du template générique :**

- Aurora dégradée en fond (`globals.css:453-483`)
- Grille technique masquée en radial (`globals.css:484-493`)
- Effet glass + backdrop-blur (`globals.css:292-299`, login)
- Anthracite + un accent saturé
- Inter partout, gros chiffres tabular

C'est *exactement* la signature visuelle des starters Vercel / Linear-likes de 2023-2024. **L'exécution est meilleure que la moyenne, mais la recette est la recette de tout le monde.** Une DA reconnaissable repose sur UN parti pris fort et propriétaire, pas sur l'addition d'effets à la mode.

---

## 3. Les 4 ruptures d'identité, par gravité

### 🔴 Rupture 1 — La marque n'existe pas matériellement
`public/` ne contient que `public/geo`. **Aucun** `app/icon.*`, `app/favicon.ico`, aucun SVG de marque. Le « logo » est un bout de JSX dans la sidebar, *différent* de l'icône Phone du login. L'onglet navigateur affiche l'icône Next.js par défaut. Le nom du client — **Gervi/Gervifrais** — n'apparaît QUE dans des chaînes backend SAP (codes entrepôt, refs fournisseur), **jamais dans l'UI**. Pour la Direction qui doit se sentir « chez elle », l'outil est anonyme.

### 🟠 Rupture 2 — Trois identités au lieu d'une
`ColorimetrieSwitcher.tsx:21-25` laisse **chaque utilisateur** reteinter toute l'app (accent + fond) en Or / Agrume / Fraise. Une marque = UNE identité. Là, l'outil change de couleur d'un poste à l'autre. Et aucun des trois n'est tranché : les *hints* eux-mêmes hésitent (« agrume · conseillé », « fraise · peps max »).

### 🟠 Rupture 3 — Le jaune n'est pas une couleur Gervi
Le défaut est un jaune hérité du thème **« Controllino »** (`globals.css:68`), une marque d'automate industriel. Aucune racine fraise, aucune racine Gervi. La couleur est le vecteur n°1 de reconnaissance : la bâtir sur un import industriel est un contresens stratégique.

### 🟠 Rupture 4 — L'indigo n'a jamais été purgé
Le changelog affirme « Purge indigo » (`DESIGN-CHANGELOG.md:77`). **Faux.** Il reste 6 violets codés en dur, dont le **glow du logo lui-même** (`Sidebar.tsx:248`, `rgba(99,102,241,.55)`) et l'**indicateur de page active** de la sidebar (`Sidebar.tsx:334`, `rgb(99 102 241)`). On survole un logo « jaune » et il s'allume en violet ; le repère « où suis-je » de la Direction est dans une couleur qui n'appartient à aucun thème.

| Fichier:ligne | Indigo résiduel | Élément touché |
|---|---|---|
| `Sidebar.tsx:248` | `rgba(99,102,241,0.55)` | Glow hover du **logo** |
| `Sidebar.tsx:334` | `rgb(99 102 241)` | **Indicateur page active** |
| `Sidebar.tsx:416, 469` | `rgba(99,102,241,…)` | Avatar + glow panneau |
| `MobileTopBar.tsx:94` | `to-purple-600` | Avatar mobile |
| `CommercialCard.tsx:146` | `to-purple-600` | Avatar commercial |

---

## 4. Ce qui est déjà excellent (à garder absolument)

Soyons justes : ce produit a un vrai socle.

- **Architecture de tokens HSL** (`globals.css:9-104`) exemplaire et maintenable. On changera les *valeurs*, pas la structure.
- **Dark anthracite « Controllino »** (`:67-104`) : reposant pour des sessions longues de télévente, shadows crédibles. À garder comme mode signature.
- **Discipline typo** : une seule famille assumée (Inter), `tabular-nums` partout — critique pour aligner prix/quantités/marges. `.font-display` au tracking serré donne du caractère sans police gadget.
- **Micro-décisions de pro** : grain sans `mix-blend-mode` (perf, `:229-241`), **sélection bleue dans les champs** vs jaune ailleurs (`:252-256`), motion opt-in pour ne pas faire ramer le scroll (`:524-548`).
- **Touches signature réussies** : liseré « signal » en bord de sidebar (`Sidebar.tsx:243`), point live emerald pulsant (`:256`).
- **Densité commutable** (compact/aéré, `:199-200`) : sert le commercial 20 ans ET la Direction 50+.

---

## 5. L'ADN proposé — « La Maison Fraîcheur »

Direction argumentée, ancrée métier, différenciante du marché agro (qui tire vers le vert pâle ou le rouge tomate criard).

### Métaphore directrice
**« Le marché du petit matin »** — l'instant où la télévente fraise se joue (commandes passées tôt pour livraison du jour, fraîcheur = nerf de la guerre). Lumière basse, anthracite reposant, accent fruit qui *éclaire* comme une fraise sous halo. On abandonne le radar militaire ; on garde l'idée de **signal temps réel** UNIQUEMENT là où elle a du sens (console d'appel, live).

### Palette
| Rôle | Proposition | Justification métier |
|---|---|---|
| Socle | Anthracite actuel **conservé** (`globals.css:67-104`) | Premium, repos visuel, déjà maîtrisé |
| **Marque** | **Rouge-fraise mûr / grenat** (pas le `#f43f5e` « gaming », un rouge Gariguette/Mara profond) | Fruit phare = couleur de marque, comme Veuve Clicquot a son orange |
| Sémantique succès / frais | **Vert feuille** très contrôlé | « Produit frais / en stock / OK » lisible d'un coup d'œil |
| Alerte / DLC courte | **Ambre/jaune** (recyclage du jaune actuel, *rétrogradé* d'identité à sémantique) | Urgence fraîcheur (J-1 avant DLC) |
| Danger | Rouge destructif distinct du rouge-marque | Litige qualité, retard livraison |

→ **Une seule couleur de marque.** Le switcher disparaît de la barre (au mieux : réglage *admin*, défaut imposé).

### Typographie
Garder Inter en texte (excellent choix, justifié). **Trancher la mono** : embarquer une mono via `next/font` (Geist Mono / JetBrains) — aujourd'hui déclarée (`tailwind.config.ts:22`) mais **jamais chargée**, donc fallback aléatoire poste par poste. Envisager une **display** à léger caractère pour les seuls gros titres de marque (login, hero) afin de sortir du « Inter-everywhere » générique — sans toucher au corps de texte.

### Iconographie
Garder lucide pour l'UI, mais **remplacer le hack `svg.lucide { zoom: 1.3 }`** (`globals.css:580`, non-standard, casse l'optical sizing) par des tailles définies au contexte. Dessiner **5-6 pictos métier signature** propriétaires (fraise, cageot/clayette, camion frigo, DLC/horloge, FIFO) — c'est eux qui rendront l'app reconnaissable, à la Garmin.

### Traitement signature (le « truc » qu'on reconnaît)
- **Garder** : grain filmique, liseré signal sidebar, point live.
- **Abandonner** : radar, grille technique, ticker « façon BFM » (`globals.css:631`, registre télé anxiogène, à l'opposé de « rassurer la Direction »).
- **Introduire** : un motif propriétaire discret (texture clayette/kraft de cageot, ou trame de pictos fruits ultra-subtile) + une aurora « lumière de marché » réduite. **Objectif-test : un screenshot du fond, sans logo, doit déjà dire « Gervi ».**

### Garder / Abandonner — synthèse
| On garde | On abandonne |
|---|---|
| Architecture tokens HSL | Switcher 3 couleurs |
| Dark anthracite premium | Jaune « Controllino » comme marque |
| Inter + tabular-nums + densité | Radar / grille technique |
| Grain, liseré signal, point live | Résidus indigo/purple |
| Motion sobre + reduced-motion | Icône Phone du login |
| | `zoom:1.3` global · ticker BFM |

---

## 6. Logo & système de marque (le chantier-pivot)

Tout le reste en découle. Livrables minimum :
1. **Un symbole monogramme** déclinable (fraise stylisée + initiale, ou « G » avec calice de fraise) → `app/icon.svg`, `app/apple-icon.png`, og-image, favicon.
2. **Un logotype** intégrant le **nom du client** (« Gervi » / « Gervi · Télévente ») — pas « TeleVent » seul, qui est un nom de catégorie.
3. **Un composant `<Logo/>` unique** réutilisé sidebar + login + mobile + loader (aujourd'hui : 2 symboles différents).
4. `metadata.icons` renseigné dans `layout.tsx:17` (aujourd'hui absent).

---

## 7. Feuille de route DA par ROI

| Priorité | Action | Effort | ROI |
|---|---|---|---|
| 1 | **1-pager d'ADN écrit** (couleur unique, métaphore, règles logo) — préalable à tout | 🛠️ | Fort |
| 2 | **Logo + favicon + og** + composant `<Logo/>` unifié | 🛠️ | Fort |
| 3 | **Purge réelle de l'indigo** + indicateur actif en couleur de marque | ⚡ | Fort |
| 4 | **Trancher la couleur** (rouge-fraise) + retirer le switcher de la barre | 🛠️ | Fort |
| 5 | **Login = vitrine de marque** (tokens + visuel signature + baseline) | 🛠️ | Moyen |
| 6 | **Embarquer/retirer la mono** (promesse fantôme `tailwind.config.ts:22`) | ⚡ | Moyen |
| 7 | Reconvertir le fond (radar → motif métier ; ticker BFM → statique) | 🛠️ | Moyen |
| 8 | Remplacer `zoom:1.3` par tailles d'icônes contextuelles | ⚡ | Faible |

---

## 8. Conclusion

L'équipe a construit une **excellente cuisine** (tokens, dark mode, motion, perf) mais sert un **plat sans recette** : l'identité est empruntée à un automate industriel pour la couleur, à l'aviation pour la métaphore, et au générateur de templates pour le fond — pendant que la fraise, le seul actif de marque évident, n'apparaît nulle part. La bonne nouvelle : **rien n'est à jeter dans le moteur.** Il manque une décision — une couleur, une métaphore, un logo, un nom assumé (Gervi) — et les chantiers ci-dessus deviennent une montée en gamme cohérente plutôt qu'une suite de retouches cosmétiques.