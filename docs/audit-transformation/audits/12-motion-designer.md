## Audit Motion Design — TeleVent (GERVI)

### Synthèse exécutive

TeleVent possède **une des fondations motion les plus mûres** que l'on puisse trouver sur un produit de cette taille : un design-system d'animation centralisé (`lib/motion.ts`), un compteur animé honnête et performant (`AnimatedNumber`), des loaders pensés pour le thread compositeur, et une chasse au jank déjà engagée (film-grain dé-blendé, aurora statique par défaut). L'intention est juste : *« le mouvement exprime une cause→effet, jamais décoratif »*.

Mais l'exécution trahit l'intention sur **trois axes** :

1. **L'accessibilité reduced-motion est annoncée comme totale, elle est partielle.** Le filet `@media (prefers-reduced-motion)` ne couvre qu'une poignée de classes ; les 168 animations d'entrée Tailwind et toute la couche framer-motion passent au travers. Le garde-fou `reducedFade`, écrit exprès, n'est **jamais branché**.
2. **Le budget motion est mal alloué.** On dépense de l'animation sur le **décor** (aurora, anneaux radar, barres « live » de la fiche, marquee « façon BFM »), et on **n'en met pas** là où elle servirait le métier : continuité de la file d'appel (documentée mais absente du code) et **confirmation de prise de commande** (`success-burst` défini, inutilisé).
3. **Le registre « salle de signal » parle au commercial de 20 ans, pas à la Direction >50 ans.** Boucles infinies décoratives, rouge breaking-news défilant, halos qui suivent le curseur : autant de mouvements perpétuels qui contredisent l'objectif « charge mentale minimale, jamais faire peur ».

---

### 1. Reduced-motion : la promesse non tenue (priorité absolue)

`lib/motion.ts` ouvre sur *« TOUT respecte prefers-reduced-motion »*. Le code dit autre chose.

| Couche d'animation | Coupée en reduced-motion ? | Preuve |
|---|---|---|
| `.ambient-*`, `.skeleton`, `.signal-bar`, `.animate-soft-pulse` | ✅ Oui | `globals.css:524-531` |
| `animate-fade-up / fade-in / scale-in / slide-right` (**168 usages / 73 fichiers**) | ❌ **Non** | `tailwind.config.ts:112-119` |
| `animate-client-swap` (flou + translate de bascule de fiche) | ❌ **Non** | `globals.css:587` |
| `animate-success-burst`, `dot-pulse`, `animate-spin` | ❌ **Non** | `globals.css:595,437` |
| `motion.*` framer (Stat, sidebar width-spring, pastille `layoutId`, voile) | ❌ **Non** (aucun `useReducedMotion`) | `CallConsole.tsx:710`, `Sidebar.tsx:238,330` |

**Conséquence métier.** Un décideur qui coche « réduire les animations » dans Windows/macOS — réflexe fréquent chez un utilisateur sensible au mouvement ou à faible aisance numérique — **voit toujours** chaque page glisser, chaque fiche client se flouter à la bascule, la sidebar rebondir. Le réglage applicatif `/parametres` ne sauve pas non plus les `animate-*` ni les count-up. On promet le calme, on livre le mouvement : c'est une **rupture de confiance**, exactement le contraire de « je comprends ce qui se passe ».

Le plus frustrant : **`reducedFade` (lib/motion.ts:113-117) a été écrit pour ça** et n'est importé nulle part. Le système est conçu à 90 %, il manque le câble.

> **Doctrine à poser.** Une seule règle balai en CSS — `@media (prefers-reduced-motion:reduce){ [class*="animate-"]{animation:none!important} }` + même règle sous `html[data-reduce-anim="1"]` — et un hook `useAppMotion()` qui substitue `reducedFade` et neutralise les springs côté framer. Coût : faible. Impact : l'accessibilité passe de déclarative à réelle.

---

### 2. Le motion mal alloué : décor riche, métier pauvre

#### Ce qui anime et ne devrait pas (ou moins)

- **Marquee promos « façon BFM »** (`PromoBanner.tsx:233-250`) : défilement linéaire continu, séparateurs losange, label rouge. Trois torts : l'œil est happé en périphérie pendant la saisie de commande au centre ; lire un texte qui bouge est **plus lent** (à l'opposé de l'objectif « la promo sous les yeux du vendeur ») ; et un bandeau **rouge qui défile en boucle** évoque l'alerte permanente — anxiogène pour la Direction. Le mode « rotation douce 6 s + flèches » est **déjà entièrement codé** (branche `else`, l.252-281) : il suffit d'en faire le défaut.
- **Fiche client 360, en-tête** (`FicheHeader.tsx`) : status-light vert en `soft-pulse` infini (l.95) qui **ment** sur un statut « live » inexistant, barres « live » `signal-bar` en boucle (l.124-128), anneaux radar. Trois mouvements perpétuels sur une page de **consultation figée** que la Direction ouvre en permanence.
- **Spotlight curseur** sur chaque tuile du dashboard (`bento.tsx:61-82`) : techniquement propre (pas de re-render), mais c'est du sucre sur un écran de lecture de chiffres.

#### Ce qui devrait animer et n'anime pas

| Animation utile attendue | État réel | Preuve |
|---|---|---|
| File d'appel : entrée en cascade, sortie fluide d'un client traité, lignes qui remontent | **Absent** — `<ol>` brut, malgré le changelog qui décrit `stagger 36ms` + `AnimatePresence popLayout` | `CallConsole.tsx:512-522` vs `DESIGN-CHANGELOG.md` |
| Confirmation de prise de commande (le geste-clé du métier) | **Absent** — toast seul ; `success-burst` défini mais jamais câblé | `CallConsole.tsx:264`, `globals.css:589` |

La file d'appel est **le cœur du métier télévente** : un commercial enchaîne 60-80 clients/jour. Quand il valide une commande (fraises à expédier le jour même, fraîcheur oblige), le client disparaît **sec** de la file. Une sortie en fondu + remontée douce des lignes du dessous répondrait à « où en suis-je ? » sans le faire réfléchir. C'est l'animation au **plus fort ROI métier** du produit — et c'est celle qui manque, alors qu'on documente qu'elle existe.

---

### 3. Cohérence des timings

Le système vise un rythme unique (`fast 160 / base 240 / slow 340 ms`) mais flotte aux jointures :

| Effet | Durée | Devrait | Preuve |
|---|---|---|---|
| `animate-fade-up` (entrée CSS) | **400 ms** | `slow` 340 ou `base` 240 | `tailwind.config.ts:115` |
| `fadeUp` (entrée framer) | 240 ms | — | `lib/motion.ts:57-61` |
| `client-swap` | 320 ms, easing ad-hoc | aligner sur `EASE.out` | `globals.css:587` |
| `success-burst` | 400 ms, overshoot 1.4 ad-hoc | tokeniser | `globals.css:595` |

Deux vitesses pour « apparaître » selon qu'on est en CSS ou en JS : perceptible quand deux voisins s'animent ensemble. Remède : exposer `--dur-base/--dur-slow` en CSS vars partagées JS↔CSS.

Par ailleurs, le hack global `svg.lucide{zoom:1.3}` (`globals.css:580`) s'applique aussi aux **icônes animées** (`RefreshCw animate-spin`, `Loader2`) : `zoom` n'est pas composité, force un recalcul de layout et a un support historiquement inégal (Firefox/Safari) → centre de rotation et netteté de spinner potentiellement variables d'un poste à l'autre.

---

### 4. AnimatedNumber : honnête mais incomplet

`animated-number.tsx` est excellent (rAF natif, `tabular-nums`, défaut honnête). Deux réserves :
- Il lit `matchMedia` **une fois** dans l'effet, **n'écoute pas** les changements en session, et **ignore le réglage applicatif** `televente:animations` : couper les animations dans `/parametres` n'arrête **pas** les compteurs.
- `animateOnMount` est posé sur les **5 Stat de la Console** (`CallConsole.tsx:727`) **et** les KPI dashboard : à chaque arrivée, 5-10 chiffres balaient 0→valeur. Pour la Direction, voir le CA « grimper depuis zéro » à chaque visite est précisément ce que le council R1 voulait éviter — ré-introduit ici sur la vitrine.

---

### Doctrine motion recommandée (quand animer / quand s'abstenir)

| Catégorie | Règle | Exemple TeleVent |
|---|---|---|
| **Feedback d'action** | TOUJOURS animer (récompense le geste) | Validation Commande/BL → coche `success-burst` 250-400 ms |
| **Continuité spatiale** | Animer (aide « où suis-je ») | Pastille sidebar `layoutId` ✅, retrait de la file d'appel ❌ à faire |
| **Chargement / état vivant réel** | Animer en boucle, sur le thread compositeur | `SignalLoader` ✅ |
| **Décor / ambiance** | Statique par défaut, opt-in, jamais en boucle sur une page figée | aurora ✅ (opt-in), status-light fiche ❌ (boucle gratuite) |
| **Lecture de chiffres (Direction)** | Sobriété : pas de mouvement périphérique, count-up honnête | marquee ❌, spotlight à atténuer |
| **Accessibilité** | `reduced-motion` ET réglage app coupent TOUT le non-essentiel, partout | à généraliser (priorité 1) |

**Verrou d'or :** une animation en **boucle infinie** doit signaler un **état vivant réel** (chargement, live). Sinon, elle décore — et le décor ne boucle pas.

---

### Conclusion

La maturité technique est là (tokens, perf, loaders). Ce qui manque relève de la **discipline de doctrine** : fermer réellement le reduced-motion (un quick win à fort impact, le système est déjà écrit), **réallouer** le motion du décor vers les deux gestes métier qui comptent (continuité de file, confirmation de commande), et **calmer** le registre « salle de signal » sur les écrans Direction. Aucun de ces chantiers n'est lourd ; ensemble ils feraient passer la dimension motion de « brillante mais bavarde » à « brillante et au service du métier ».