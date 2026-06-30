## Audit Accessibilité (WCAG 2.2 AA) — TeleVent

### Périmètre & méthode
J'ai ouvert réellement `app/globals.css` (tokens HSL clair/sombre, 3 colorimétries, focus, sélection, `zoom:1.3`, reduced-motion), les primitives `components/ui/*` (button, input, select, dialog, dropdown-menu, textarea, badge, number-input, info-tip, date-stepper), `components/Sidebar.tsx`, l'intégralité de `components/console/CallConsole.tsx` (2193 lignes) + `lib/useConsoleShortcuts.ts`, ainsi que `ColorimetrieSwitcher`, `ThemeToggle`, `MobileTopBar` et des vérifications ciblées sur `Ecran2Order.tsx`. **Tous les ratios de contraste ci-dessous sont calculés** depuis les triplets HSL des tokens (luminance relative WCAG), pas estimés à l'œil.

### Verdict
Le socle a11y est **sérieux** : Radix pour modales/menus, `focus-visible` généralisé, delta non-couleur-seule, `reduced-motion` réellement implémenté, raccourcis clavier console exemplaires. Mais deux défauts **critiques** sapent l'exigence métier n°1 — « la Direction >50 ans doit toujours voir ce qui est actif, sans ambiguïté, et l'interface doit rassurer » :

1. **Le CTA jaune principal échoue AA en mode clair** (texte quasi-blanc sur or = **2,37:1**).
2. **La sidebar sombre repose sur des gris sous le seuil** (en-têtes à **2,66:1**, libellés inactifs à **4,55:1** sans marge).

### Tableau des contrastes calculés

| Élément | Couleurs (HSL token) | Ratio | Seuil AA | Verdict |
|---|---|---|---|---|
| **CTA primary — mode CLAIR** | `42 95% 44%` / `45 70% 99%` | **2,37:1** | 4,5:1 | 🔴 Échec |
| CTA primary — mode SOMBRE | `47 97% 55%` / `222 45% 9%` | 12,1:1 | 4,5:1 | ✅ |
| Sidebar — en-têtes groupe `white/30` | sur `#0b1018` | **2,66:1** | 4,5:1 | 🔴 Échec |
| Sidebar — boutons repli `white/35` | sur `#0b1018` | **3,20:1** | 4,5:1 | 🔴 Échec |
| Sidebar — libellés inactifs `white/45` | sur `#0b1018` | **4,55:1** | 4,5:1 | 🟠 Limite |
| Sidebar — item actif (texte + icône) | white / brand-400 | 13,8 / 11,5:1 | 4,5:1 | ✅ |
| `text-amber-600` (KPI « À demain ») | sur blanc | **3,19:1** | 4,5:1 | 🟠 Échec texte |
| `text-brand-600` (Or, liens/KPI) | sur blanc | **3,90:1** | 4,5:1 | 🟠 Échec texte |
| `text-muted-foreground/60` | sur blanc | **2,33:1** | 4,5:1 | 🟠 Échec |
| Agrume / Fraise — texte sombre sur accent | `222 45% 9%` sur accent | 6,66 / 5,03:1 | 4,5:1 | ✅ |
| `muted-foreground` (plein) clair / sombre | tokens | 4,83 / 6,22:1 | 4,5:1 | ✅ |

> Le défaut clair du CTA est **invisible en développement dark** : c'est le piège classique. En clair, valider une commande de fraises — le geste qui fait le CA — se fait sur le bouton le moins lisible de l'app.

### Ce qui est déjà solide (à conserver)
- **Focus visible** sur toutes les primitives (`focus-visible:ring-2 ring-ring ring-offset-2`). Le `outline:none` de `globals.css:625-629` est toujours couplé à un ring de remplacement — pas de piège clavier.
- **Raccourcis console (CallConsole l.367-405)** : rejet de Ctrl/Cmd/Alt, neutralisation quand une modale est ouverte, `e.repeat` ignoré, exclusion des champs de saisie, remappage persistant.
- **Radix** gère focus-trap, Esc, navigation flèches sur Dialog/Select/DropdownMenu.
- **reduced-motion** réellement respecté + double réglage utilisateur (`data-reduce-anim` / `data-anim=force`).

### Constats détaillés

**🔴 Critique — CTA clair 2,37:1.** Touche `Button` default, le téléphone géant (`CallConsole:1809`), « Commande (BL) » (`:1930`). Correctif d'une ligne : passer `--primary-foreground` clair en `222 45% 9%` (texte sombre sur or, ~7:1), aligné sur le parti pris déjà retenu pour Agrume/Fraise.

**🔴 Critique — sidebar gris faibles.** La boussole permanente s'efface. Remonter `white/30→white/55`, `white/45→white/65`, `white/35→white/55`. L'état actif reste détaché.

**🟠 Majeur — `aria-current` absent** sur le lien sidebar actif (`Sidebar:315`) : l'état « page courante » est peint mais pas exposé (WCAG 4.1.2).

**🟠 Majeur — réordonnancement souris seule** (`SortableSection`, déjà listé dans le changelog) : viole 2.1.1 et 2.5.7 (Dragging, nouveau en WCAG 2.2). `reorder()` existe ; il manque le branchement flèches clavier.

**🟠 Majeur — modales console sans `DialogDescription`** (RappelDialog, ShortcutsDialog) : warning Radix + annonce sans contexte (« Programmer un rappel » sans le nom du client).

**🟠 Majeur — cibles tactiles 24–28px** sur contrôles fréquents : surtout les **+/- colis** d'`Ecran2Order` (`:1287,1298`). Un colis de fraises en trop = perte sèche (DLC courte). Viser 36–44px sur la saisie de commande.

**🟠 Majeur — état « sélectionné » de la file trop discret** (`bg-brand-50/60` + liseré 2px) alors que le brief réclame un Selected « encore plus marqué ». Risque : valider le mauvais client → mauvais BL, litige.

**🟡 Mineurs** — `zoom:1.3` non standard (fragilité au zoom navigateur 200%, WCAG 1.4.4) ; absence de `prefers-contrast`/`forced-colors` (le profil même de la Direction qui active le contraste OS) ; indigo `rgb(99,102,241)` résiduel codé en dur sur l'indicateur actif (ne suit pas la colorimétrie — incohérent avec la « purge indigo » du council).

### Priorisation (ROI)
| Priorité | Action | Effort |
|---|---|---|
| 1 | Corriger `--primary-foreground` clair (CTA) | ⚡ |
| 2 | Remonter les gris de la sidebar | ⚡ |
| 3 | `aria-current="page"` sidebar | ⚡ |
| 4 | `DialogDescription` modales console | ⚡ |
| 5 | Renforcer l'état actif file + remplacer l'indigo par le token brand | ⚡ |
| 6 | Réordonnancement clavier | 🛠️ |
| 7 | Cibles tactiles ≥ 44px (saisie commande) | 🛠️ |
| 8 | Textes colorés → palier -700 ; `forced-colors` ; `zoom` | 🛠️ |

Les cinq premiers items sont des quick wins qui font passer le produit sous le seuil critique pour le persona Direction, sans refonte.