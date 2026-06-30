# Audit UX & Personas — TeleVent (GERVI / Gervifrais)

*Périmètre : navigation (Sidebar, CommandPalette), accueil, console télévente, liste clients, fiche client 360° (page + onglets + header + sections réorganisables), plan d'appel, encours, paramètres, lanceur mobile. Audit statique du code + raisonnement métier grossiste fraises.*

---

## 1. Synthèse

TeleVent est un produit **déjà solidement travaillé sur l'axe « Expert Fast »**. La console télévente, cœur du métier, est un excellent poste de travail : verdict en barre fixe basse (loi de Fitts), CTA d'appel géant, avance automatique au client suivant, raccourcis clavier robustes (les deux P0 clavier du council sont réellement corrigés dans le code, `CallConsole.tsx:367-381`). États vides rassurants, InfoTip pédagogiques omniprésents, téléphones cliquables partout.

La **dette UX restante se concentre sur deux fronts** :

1. **Le persona Direction est sous-servi.** L'app suppose un utilisateur à l'aise (drag&drop natif, raccourcis remappables, personnalisation tous azimuts, popup `window.open`, tutoiement). Pour un décideur >50 ans à faible aisance numérique, il manque le « parcours par défaut rassurant » : une fiche client qui répond aux 4 questions en < 3 s, des signaux vitaux dans l'en-tête plutôt que du décor, zéro action irréversible déclenchable par accident.

2. **La sécurité de l'action métier centrale.** La création de **bon de livraison** — qui engage du stock de fraises périssable et déclenche facture + préparation — n'a **ni état busy/disabled ni confirmation** (`l.1868`), contrairement à l'action anodine « À demain » qui, elle, a un état de chargement (`l.1879`). C'est l'incohérence la plus coûteuse du périmètre.

**Note maturité UX : 74/100.** Très bon pour le commercial rapide ; en retrait pour la Direction et sur la robustesse des actions engageantes.

---

## 2. Les 4 personas

### 2.1 DIRECTION — décideur, >50 ans, faible aisance numérique

| | |
|---|---|
| **Objectifs** | « Est-ce que ça va ? » : CA du jour vs N-1, retards de paiement, clients qui décrochent. Décider, pas opérer. |
| **Écrans utilisés** | Accueil (KpiStrip, AlertesEncours), Dashboard, Encours, Fiche client (consultation), parfois mobile. |
| **Besoins** | Comprendre en < 3 s. Zéro ambiguïté. Ne jamais avoir peur. Que l'écran « ressemble à hier ». |
| **Frustrations probables** | Fiche client = mosaïque de 7 sections de poids égal sans hiérarchie (#2). En-tête fiche plein de décor (radar, barres « live ») mais **sans aucun indicateur de santé** (#2). Tutoiement « bravo ! », « ton compteur » qui sonne peu sérieux (#7). Règle des paliers d'encours non expliquée à l'écran (#11). |
| **Risques** | Glissement accidentel de sections (persisté) → « mon écran a changé » (#3). Désactivation télévente d'un client en 1 clic kebab → client GMS jamais rappelé (#5). Bouton BL qui « ne réagit pas » sous latence SAP → reclique → BL double (#1). |
| **Optimisations** | Signaux vitaux dans le FicheHeader. Personnalisation **opt-in verrouillée** par défaut + « Réinitialiser » visible. Vouvoiement sur les écrans transverses. Confirmations sur tout ce qui retire un client de la vente. |

> **Parcours clés au prisme « rassurant, sans ambiguïté, < 3 s ? »**
> - *Accueil* : **OUI** — salutation, KPI du jour avec N-1, alertes encours vertes quand RAS.
> - *Encours* : **PARTIEL** — chiffres clairs, mais logique de retard non expliquée (#11).
> - *Fiche client* : **NON** — pas de hiérarchie, pas de santé en haut (#2).
> - *Réorganisation* : **NON** — déclenchable par accident, pas de retour arrière évident (#3).

### 2.2 COMMERCIAL — télévendeur, ~20 ans

| | |
|---|---|
| **Objectifs** | Enchaîner les appels, prendre un max de commandes, zéro friction. |
| **Écrans utilisés** | Console (+ écran 2), Plan d'appel, Fiche client, CommandPalette. |
| **Besoins** | Rapidité, raccourcis, densité, clavier. |
| **Frustrations probables** | Très peu côté console (bien faite). Mobile **n'a pas de console** (#10). Footer de raccourcis `hidden md:flex` invisible petit écran (#9). Décalage configurable/affiché sur « skip » (#9). |
| **Risques** | Double-clic BL sous latence (#1). |
| **Optimisations** | Console mobile minimale si la télévente nomade est un vrai besoin. Documenter les raccourcis dans ⌘K. |

> **Au prisme « assez rapide / raccourci ? »** : **OUI** sur poste fixe (avance auto, verdict clavier, ⌘K, recherche client live). C'est le point fort du produit.

### 2.3 PRÉPARATEUR — terrain/entrepôt

| | |
|---|---|
| **Objectifs** | Réception marchandise, inventaire, fabrication ; signaler litiges (fraise non conforme, casse). |
| **Écrans utilisés** | Entrées, Inventaire, Fabrication (hors périmètre détaillé), + badges sidebar/MobileTiles. |
| **Besoins** | Mobile-first, gros boutons tactiles, peu de saisie. |
| **Observations** | Les badges « incidents réception / inventaire à revoir » sont bien remontés en sidebar (`Sidebar.tsx:119-178`) **et** sur l'axe Acheteur de MobileTiles — bonne continuité multi-support. |
| **Risques / Optim.** | À auditer hors périmètre (modules entrées/inventaire) ; vérifier la taille des cibles tactiles côté terrain. |

### 2.4 ADMINISTRATEUR — config, sync SAP, droits

| | |
|---|---|
| **Objectifs** | Synchroniser SAP, gérer clients/commerciaux, régler l'app. |
| **Écrans utilisés** | Paramètres (ParametresPanel), Plan d'appel (assignation), Effectifs. |
| **Forces** | Hub unique « Données · SAP » gardé admin (`ParametresPanel.tsx:392`), wording rassurant sur les actions lourdes. Plan d'appel = vrai poste d'admin (assignation série, masquage colonnes, filtres santé). |
| **Frustrations / Risques** | Désactivation télévente **en série** sans confirmation (`PlanAppel.tsx:343`) (#5). 3 systèmes de personnalisation à maintenir (#3). |
| **Optimisations** | Confirmer les actions de masse destructives. Unifier la personnalisation. |

---

## 3. Analyse transversale

### 3.1 Charge cognitive
- **Console** : maîtrisée (3 colonnes à rôles clairs, InfoTip partout).
- **Fiche client** : **surchargée par défaut** (3 onglets × jusqu'à 7 sections égales, #2). Aucune réponse imposée à « qu'est-ce qui est urgent ? ».
- **Personnalisation** : 3 mécaniques drag&drop concurrentes (#3) = surface d'apprentissage et de risque démultipliée.

### 3.2 Navigation
- Sidebar 2 niveaux (Télévente / Stock&stats visibles, Gestion repliable) = bon compromis « televent first ».
- **Mais** le repère « page active » est figé en **indigo** (#4), incohérent avec Or/Agrume/Fraise.
- CommandPalette ⌘K excellente pour les experts.

### 3.3 Wording & cohérence
- **Tutoiement** systématique vs **vouvoiement** dans Paramètres (#7).
- **Ancienneté de commande** libellée/seuillée 3 façons (#6) : `+12J/JAMAIS` (console, seuil 7 j) vs `12 j/jamais` (plan-appel, 14/30) vs `il y a 12 j` (fiche). Sur un produit où le décrochage client est un signal fort, cette divergence brouille la lecture.

### 3.4 Actions dangereuses
| Action | Écran | Garde-fou actuel | Manque |
|---|---|---|---|
| **Créer BL** | Console | Aucun état busy/disabled | Anti-double-submit + récap (#1) 🔴 |
| Désactiver télévente | ClientTable / PlanAppel | Item rose | Confirmation / annulation (#5) |
| Réorganiser fiche | Console (drag natif) | Aucun (drag immédiat) | Mode édition opt-in (#3) |

### 3.5 Longueur des parcours
- **Télévente desktop** : optimale (sélection → verdict → avance auto).
- **Commander sur mobile** : rallongée — pas de console, on passe par la fiche (#10).
- **Comprendre la santé d'un client** : trop d'étapes — rien en un coup d'œil dans l'en-tête (#2).

---

## 4. Priorisation (ROI)

| # | Finding | Sévérité | Effort | ROI |
|---|---------|----------|--------|-----|
| 1 | BL sans busy/disabled ni confirmation | 🔴 Critique | ⚡ | **Fort** |
| 4 | Indigo résiduel sidebar (repère actif) | 🟠 Majeur | ⚡ | **Fort** |
| 2 | Fiche client sans signaux vitaux / hiérarchie | 🟠 Majeur | 🛠️ | **Fort** |
| 5 | Désactivation client 1-clic sans confirm | 🟡 Mineur | ⚡ | Moyen |
| 11 | Règle encours non expliquée (InfoTip) | ℹ️ Info | ⚡ | Moyen |
| 8 | 2e écran popup fragile (pas de fallback) | 🟡 Mineur | ⚡ | Moyen |
| 3 | 3 drag&drop concurrents / non-clavier | 🟠 Majeur | 🛠️ | Moyen |
| 6 | Wording ancienneté incohérent | 🟡 Mineur | 🛠️ | Moyen |
| 7 | Tutoiement vs Direction | 🟡 Mineur | 🛠️ | Moyen |
| 9 | Raccourcis peu découvrables / décalage skip | 🟡 Mineur | ⚡ | Faible |
| 10 | Pas de console mobile | 🟡 Mineur | 🛠️ | Faible |
| 12 | Sticky onglets incohérent multi-écran | 🟡 Mineur | 🛠️ | Faible |

---

## 5. Trois quick wins immédiats
1. **Sécuriser le BL** : prop `loading` + désactivation pendant l'envoi + garde anti-double-submit (#1). De la marchandise fraîche engagée à tort sinon.
2. **Purger l'indigo de la sidebar** : 4 occurrences `rgb(99 102 241)` → tokens `--brand-*` (#4). Cohérence visuelle immédiate sur le repère permanent.
3. **Confirmer les désactivations télévente** (au moins en série) + toast réversible (#5).

Ces trois éléments adressent à la fois la robustesse métier et la confiance de la Direction, pour un coût d'une demi-journée.