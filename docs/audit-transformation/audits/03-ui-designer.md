## Audit UI Design — TeleVent (GERVI)

**Verdict :** Un design system **ambitieux et différenciant** (la patte « salle de signal » est un vrai atout, rare dans un ERP), mais dont la **discipline d'exécution n'a pas suivi l'ambition**. Trois faiblesses systémiques minent la cohérence : (1) **trois systèmes de cartes** concurrents, (2) une **échelle typographique inexistante** (tout en px hard-codé), (3) des **résidus indigo/violet/slate** qui trahissent l'identité or/jaune et **cassent les colorimétries commutables** — alors même que le changelog affirme ces points réglés.

> Note de maturité UI : **68/100**. La fondation (tokens HSL, dark, colorimétries, motion, a11y) est de bon niveau ; ce qui manque, c'est la **rigueur de tokenisation** et la **convergence des primitives**.

---

### 1. Cohérence des composants — le point le plus coûteux

#### Trois grammaires de carte
| Primitive | Rayon | Padding | Signal d'accent | Taille titre | Fichier |
|---|---|---|---|---|---|
| `Card` (shadcn) | `rounded-lg` | `p-6` | ombre `shadow-sm` | **24px** (`text-2xl`) | ui/card.tsx |
| `SurfaceCard` | `rounded-xl` | `p-4` | **bord gauche** `border-l-4` | 10.5px (kicker) | ui/surface-card.tsx |
| `SectionCard` | `rounded-2xl` | `p-5` | **barre haute** 3px + radar | 14.5px | clients/SectionCard.tsx |

Trois rayons, trois mécaniques d'accent, trois échelles de titre. Le changelog (l.157) annonçait « SurfaceCard remplace l'ancien Card » — **Card existe toujours**. Pour la **Direction** qui doit lire « qu'est-ce qui est important ? » en moins de 3 s, passer de la fiche client (SectionCard) à l'accueil (SurfaceCard) oblige à **réapprendre la grammaire visuelle**. → *Converger sur SurfaceCard, faire de SectionCard une variante, supprimer Card.*

#### Boutons hors-tokens
`button.tsx` code outline/secondary/ghost en **slate + blanc en dur** (`border-slate-200 bg-white`, `bg-slate-100`), alors qu'`Input`/`Select` utilisent les tokens (`border-input bg-background`). Conséquence concrète : en colorimétrie **Fraise** (surfaces dark bordeaux) ou **Agrume** (ambre), un bouton « Annuler » reste **gris-bleu froid**, étranger à l'ambiance. Discipline de tokens incohérente *à l'intérieur de la même couche de primitives*.

---

### 2. Typographie & espacement — l'échelle fantôme

`tailwind.config.ts` ne définit **aucun** `fontSize`. Résultat : le texte est piloté par **30 valeurs px distinctes**, **736 occurrences** sur 40 fichiers.

| Taille | Occurrences | | Taille | Occurrences |
|---|---|---|---|---|
| `text-[12px]` | 246 | | `text-[12.5px]` | 112 |
| `text-[11px]` | 214 | | `text-[10.5px]` | 111 |
| `text-[13px]` | 160 | | `text-[11.5px]` | 100 |
| `text-[10px]` | 126 | | + 23 autres tailles… | |

On trouve **12 / 12.5 / 13 / 13.5 / 14 / 14.5px** côte à côte : ces **demi-pixels** ne se voient pas isolément mais produisent un **bruit que l'œil perçoit sans le nommer**. Idem pour les dimensions : `rounded-[9px]`, `h-[18px] w-[20px]`, `h-[21px]`, `min-w-[15px]`… une grille d'espacement non tokenisée. → *Définir ~8 tailles de texte en tokens, bannir les demi-pixels.*

---

### 3. Identité & couleur — l'or trahi

Le changelog (l.77) clame « **Purge indigo** ». La réalité du code :

| Endroit | Couleur réelle | Problème |
|---|---|---|
| `Sidebar.tsx:334` | `rgb(99 102 241)` | **L'item de nav ACTIF est souligné en indigo**, pas en jaune — visible sur 100 % des écrans |
| `Sidebar.tsx:248,469` | `rgba(99,102,241,…)` | glow logo + voile nav indigo |
| `Sidebar.tsx:416`, `ClientTable.tsx:785`, `CommercialCard.tsx:146`, `MobileTopBar.tsx:94` | `to-purple-600` | **les avatars utilisateur dégradent vers le violet** |
| `CallConsole.tsx:812` | `bg-purple-100` | badge « récup. » violet |
| `globals.css:252` | `rgba(37,99,235,.40)` | sélection input **bleue** (4e accent hors-charte) |

En Fraise/Agrume, ces violets/bleus **jurent franchement**. C'est l'incohérence la **plus visible** car portée par la chrome permanente. → *Quick win à fort ROI : remplacer par `hsl(var(--brand-*))` / `to-brand-600`.*

**Badges sans dark mode** — `badge.tsx` n'a **aucun** variant `dark:` : EXPORT/GMS/CHR et statuts rappel restent en `bg-X-50` (quasi-blanc) sur carte anthracite. Or ces badges **typent le client** (un GMS et un CHR ne se traitent pas pareil en télévente) : information métier centrale rendue **illisible en dark**, alors que `SectionCard` gère déjà le dark proprement (modèle à copier).

---

### 4. États, densité, responsive

- **`svg.lucide { zoom: 1.3 }`** (globals.css:580) : magic number global, propriété non-standard (Firefox), qui **se compose** avec toutes les tailles explicites (`h-4` → ~21px, `h-[21px]` → ~27px). La relation icône/texte n'est plus contrôlable. → *Token `--icon-size` lié à la densité.*
- **Hauteurs de contrôle désalignées** : Input/Select `h-10`, Button défaut `h-9`. Dans la barre de filtres clients (qui mêle les trois), le bouton est 4px trop court → décrochage visible toute la journée pour les commerciaux.
- **`.kicker` masqué < 768px** (globals.css:362) : en mobile, les cartes `Stat` perdent leur **label** → un « 12 450 € » sans intitulé. Anti-pattern direct pour la Direction qui consulte au téléphone. KpiStrip a déjà contourné en n'utilisant pas `.kicker` (signal que la règle gêne).
- **Primitives incomplètes** : pas d'état `aria-invalid` sur Input, pas de `loading` sur Button, pas d'`EmptyState` partagé → chaque écran réimplémente, incohérence garantie.
- **Overlay modale `bg-black/80`** : voile quasi-noir anxiogène pour la Direction (« que s'est-il passé sous la fenêtre ? »), en rupture avec le nav-veil travaillé de la sidebar (`/55` + blur). À adoucir.

---

### 5. Ce qui est déjà solide (à conserver)

La patte « salle de signal » (aurora, grille télémétrie, anneaux radar, `SignalLoader` égaliseur) **différencie vraiment** l'app et rassure par son sérieux. Les **tokens HSL light/dark + 3 colorimétries** sont une architecture saine. La **densité commutable** (compact/normal/aéré) est un levier malin pour servir commerciaux ET Direction. `Delta` est **exemplaire en a11y** (icône+signe, pas couleur seule). `prefers-reduced-motion` est traité sérieusement. `tabular-nums` global garantit l'alignement des colonnes de prix/kg — crucial et bien fait.

---

### Plan d'action priorisé (ROI décroissant)

| Priorité | Action | Effort |
|---|---|---|
| 1 | Purger indigo/purple/slate → tokens brand (chrome + avatars + boutons) | ⚡ Quick win |
| 2 | Ajouter variants `dark:` aux badges métier (GMS/CHR/EXPORT) | ⚡ Quick win |
| 3 | Recoder Button outline/secondary/ghost sur tokens | ⚡ Quick win |
| 4 | Aligner hauteurs contrôles (h-10) + adoucir overlay modale | ⚡ Quick win |
| 5 | Ne plus masquer `.kicker` en mobile | ⚡ Quick win |
| 6 | Converger les 3 cartes en 1 famille (SurfaceCard) | 🛠️ Chantier |
| 7 | Échelle typographique tokenisée (8 tailles) + purge demi-pixels | 🛠️ Chantier |
| 8 | Remplacer `zoom:1.3` par token densité d'icône | 🛠️ Chantier |
| 9 | Compléter primitives : Input invalid, Button loading, EmptyState | 🛠️ Chantier |

Les 5 premiers points sont des **quick wins à fort/moyen ROI** : ils suppriment les incohérences les plus visibles (identité, dark, alignements) sans refonte. Les chantiers 6-7 sont la vraie dette de fond qui, une fois traitée, rendra l'app **« beau et cohérent »** au niveau de l'ambition affichée.