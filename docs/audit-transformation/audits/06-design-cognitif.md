# Audit Design Cognitif — TeleVent (charge mentale, automatismes, repères constants)

## Synthèse

TeleVent possède une **base cognitive de qualité** : états vides rassurants (le silence devient « tout est sous contrôle »), `InfoTip` pédagogique sur chaque KPI/action, et plusieurs **défauts intelligents** (tri de file par heure optimale, rappel pré-rempli à demain 10h, retrait optimiste avec toast nominatif). C'est du « Beginner Friendly + Expert Fast » bien amorcé.

Le problème transversal n'est pas un manque de soin, c'est un **excès de personnalisation**. À force de tout rendre déplaçable, masquable, renommable, réglable, l'app multiplie les **degrés de liberté** au détriment des deux choses dont la Direction (>50 ans, faible aisance numérique) a le plus besoin : des **repères stables** et **une seule prochaine action évidente**. Loi de Hick (moins de choix = décision plus rapide) et loi de Jakob (cohérence interne) sont enfreintes à plusieurs endroits.

**Note de maturité de la dimension cognitive : 68/100.**

---

## 1. Le péché capital : la sur-personnalisation détruit les repères

### 1.1 Deux systèmes de réorganisation concurrents (🔴)

| | Fiche client (`ReorderableSections.tsx`) | Console (`CallConsole.tsx`) |
|---|---|---|
| Entrée en édition | Bouton **« Personnaliser »** (mode dédié) | Aucun — drag direct au **survol** |
| Réordonner | Poignée visible en mode édition | Poignée au survol (`:1546`) |
| Masquer | Bouton **œil** par bloc | Menu **kebab** séparé (`:1399`) |
| Actions/bloc | **4** (déplacer, renommer, masquer, pleine largeur) | 1 (masquer) + drag |

Apprendre l'un n'aide pas à utiliser l'autre. **La loi de Jakob s'applique d'abord à l'intérieur du produit.**

### 1.2 La fiche renommable/réordonnable casse la mémoire spatiale (🔴)

`ReorderableSections` persiste **par poste** un ordre + masques + **libellés réécrits** + largeurs, appliqués **à toutes les fiches** (`:17, 73-115`). Le repère clé d'un dirigeant — *« l'encours est toujours en haut à droite »* — devient mouvant, partagé sur poste mutualisé, et le **renommage libre** (`:108-115`) transforme *« Encours / crédit »* en *« bidule »*.

> **Exemple fraises :** avant une grosse commande de gariguette, la Direction veut vérifier l'encours d'un GMS export ; le bloc a été glissé en bas et renommé la veille → elle croit l'info disparue. **La confiance, valeur cœur du persona Direction, est entamée.**

### 1.3 Réglages liés au poste, pas à l'utilisateur (🟡)

Tout l'affichage est en localStorage donc **lié au navigateur** — *sauf* le contraste de survol, suffixé par utilisateur (`ParametresPanel.tsx:160-183`). Le bon réflexe est appliqué à demi.

---

## 2. Loi de Hick : trop de choix au mauvais persona

**Paramètres (🟠)** : 8 cartes / 7 réglages dont un **slider de contraste 0-100 %** superflu et trois réglages animations/promos qui se chevauchent. → Scinder « Affichage » (3 contrôles) et « Avancé » replié ; bloc SAP dans un onglet Administration.

**Console (🟡)** : 6 raccourcis + remap personnalisable + 3 verdicts aux **dorés trop voisins** (`:1928-1933`). → Replier les raccourcis ; différencier À demain (neutre) / Rappel (bleu).

---

## 3. Une action principale par écran : le maillon manquant

**Accueil (🟠)** : tableau de consultation, **aucun next-best-action** (grep = 0). Les alertes encours sont au même poids que les promos. → Encart « À traiter maintenant » à CTA unique, priorisé par risque.

**Arc-en-ciel d'accents (🟠)** : 5 cartes à couleurs décoratives aplatissent la hiérarchie. → Rouge/rose réservé à l'urgent, lecture Urgent → Important → Neutre.

> **Exemple fraises :** un CHR à 90j+ d'impayé apparaît à côté d'une carte Promotions de taille identique → l'œil glisse vers le positif et rate le risque.

---

## 4. Micro-interactions (Jakob)

- **Affordances flottantes** (🟡) : lien italique vs lien fléché vs bouton plein (`CallConsole:1326` / `AlertesEncours:109` / `FicheActions:61`).
- **Kebab trompeur** (🟡) : « Glissez pour réorganiser » mais le drag est hors menu (`:1440` vs `:1546`).
- **Indigo résiduel Sidebar** (ℹ️) : `rgb(99 102 241)` (`Sidebar.tsx:248,333,416`) ne suit pas la colorimétrie.

---

## 5. Priorisation (ROI)

| # | Finding | Sévérité | Effort | ROI |
|---|---------|----------|--------|-----|
| 1 | Deux systèmes de réorganisation | 🔴 | Chantier | Fort |
| 2 | Fiche renommable casse la mémoire spatiale | 🔴 | Chantier | Fort |
| 3 | Pas de next-best-action sur l'Accueil | 🟠 | Chantier | Fort |
| 4 | Paramètres en surcharge | 🟠 | Chantier | Moyen |
| 5 | Accents arc-en-ciel | 🟠 | Chantier | Moyen |
| 6 | Renommage libre des sections | 🟠 | Quick win | Moyen |
| 7 | Console trop dense | 🟡 | Quick win | Moyen |
| 8 | Réglages par poste | 🟡 | Chantier | Moyen |
| 9 | Onglets + mosaïque | 🟡 | Chantier | Faible |
| 10 | Affordances incohérentes | 🟡 | Quick win | Faible |
| 11 | Kebab trompeur | 🟡 | Quick win | Faible |
| 12 | Indigo Sidebar | ℹ️ | Quick win | Faible |

---

## 6. Trois automatismes à instaurer

1. **Next-best-action unique** sur l'Accueil et en tête de fiche (« Pas de commande depuis 9 j → Relancer » / « Encours 92 j → Relancer le paiement »).
2. **Défauts verrouillés rôle-dépendants** : Direction = fiche colonne unique non éditable, ordre métier figé, libellés canoniques.
3. **Un seul mode d'édition partout** : « Personnaliser » explicite, 2 actions par bloc, reset toujours visible — supprimer renommage et drag-au-survol accidentel.

> Cible : la Direction doit dire *« je sais toujours où regarder, et l'app me dit quoi faire »* ; le commercial doit aller **vite sans que la Direction paie le prix de sa vitesse**.