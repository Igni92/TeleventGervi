# Audit QA Lead — TeleVent (GERVI / Gervifrais)

## 0. Cadre et méthode

Audit **statique** (pas de DB ni SSO disponibles ici) des routes API critiques de saisie/modification de commande, recouvrement, inventaire, import et livraison, plus les composants UI de saisie (Écran 2, BLDialog), import CSV, rappels, et le handler clavier console. Chaque finding est relié à un **objectif métier de grossiste fraises** : fraîcheur/lot, recouvrement, productivité télévente, confiance Direction, justesse de facturation.

**Acquis confirmés** (cf. TODO-AUDIT.md / DESIGN-CHANGELOG.md) : IDOR SAP traité, RLS 45/45, fuseau Europe/Paris, anti-doublon relance, idempotence inventaire, durcissement clavier (e.repeat, modificateurs, neutralisation modale). Je ne les re-propose pas — je pointe les **trous résiduels** et les **edge cases non couverts**.

---

## 1. Synthèse exécutive

Le **raisonnement métier du noyau est de très bon niveau** : la décision de lot FIFO avec filet anti-faux-négatif (bug BL 24011560), l'encours au net avec anti-double-comptage des avoirs, l'idempotence partielle de l'inventaire montrent une vraie maturité. **La faiblesse est en périphérie** : la **validation d'entrée des routes API** est minimale (présence, pas conformité) et la **gestion de concurrence** repose trop sur les gardes client. Sur un flux télévente rapide, ces trous produisent des conséquences concrètes : double-BL, prix aberrants silencieux, 500 opaques, stock faussé.

Point de cohérence frappant : **la relance a un anti-doublon serveur, la commande — opération bien plus coûteuse (client livré et facturé) — n'en a aucun**.

---

## 2. Edge cases par module

### 2.1 Saisie de commande (`/api/sap/orders` POST + Ecran2Order/BLDialog)
| Edge case | Comportement actuel | Risque fraises |
|---|---|---|
| `deliveryDate` non parsable | `new Date(...).toISOString()` **hors try** → RangeError → 500 non-JSON | Commercial voit « erreur réseau » opaque |
| Prix négatif / NaN / Infinity | Ignoré silencieusement (`price > 0`) | Erreur de saisie masquée, marge faussée |
| Quantité 0.0001 ou 1e9 | Seul `quantity > 0` vérifié | « 1200 » au lieu de « 12 » → BL ×100, stock −1200 |
| Double-clic / Enter répété / 2 onglets | Garde **client only** (`submitting`) | **Deux Sales Orders SAP** → client livré 2× |
| Article inexistant DB SAP courante | Pré-validation 2.1, message clair ✅ | — |
| Vente à découvert (stock 0) | EM_PENDING, **sans borne ni alerte** | Survente illimitée, traçabilité lot suspendue |

### 2.2 Modification de BL (`/api/sap/orders/[docEntry]/modif`)
- **Remplacement complet de collection** : toute ligne SAP non modélisée par le front (frais manuel, texte multiple, add-on) **silencieusement supprimée** à la moindre modif de quantité.
- Lot préservé **seulement si** `keep+lot` ; un lot null fait repartir en FIFO une ligne « conservée ».
- Le serveur ne revérifie pas qu'une ligne `keep` correspond à un LineNum existant non clôturé.

### 2.3 Import CSV (`/api/clients/import` + ImportModal)
- Parser RFC4180 **solide** ✅ (quotes, séparateurs, CRLF, UTF-8→1252).
- **Update destructif** : un CSV partiel (code+tel) écrase `nom` par le code et efface les téléphones absents.
- **Pas de revalidation format** à l'import ; numéro EXPORT 12 chiffres **tronqué à 10** en silence.

### 2.4 Recouvrement (`/api/encours`, `/api/relance/send`)
- **Avoir > facture due** : net plafonné à 0, client **sort de la liste**, surplus d'avoir **invisible** (litige qualité fraises typique).
- **Anti-doublon relance non atomique** : deux envois concurrents → **deux courriers** au débiteur.
- Solde compte créditeur (trop-perçu) absorbé sans alerte.

### 2.5 Inventaire (`/api/inventaire/adjust`)
- **Échec ENTRÉE après SORTIE OK** : session **verrouillée** sur un stock incohérent, **non re-régularisable** → 409.

### 2.6 Console clavier (`CallConsole` + `useConsoleShortcuts`)
- Bien durci ✅ (e.repeat, Ctrl/Cmd/Alt rejetés, modale neutralise, champs éditables exclus). Pas de bloquant.

### 2.7 Livraisons (`/api/livraisons/preparer`)
- **Claim non atomique** : deux préparateurs s'attribuent le même BL (dernier gagne) → double préparation. Release/requeue sans contrôle d'appartenance ni de rôle.

### 2.8 Fuseau / dates
- Backend Europe/Paris cohérent (paris-time) ✅, mais **ReminderModal** : `min` UI en heure locale vs validation/stockage en heure serveur (UTC) → décalage horloge/DST, rappel calendrier Microsoft à la mauvaise heure.
- Filtre « Aujourd'hui » : bascule de minuit / passage heure été-hiver non couverte par test.

### 2.9 Montants négatifs / avoirs
- Anti-double-comptage **prudent** ✅, mais résiduel d'avoir non exposé (cf. 2.4).

### 2.10 Robustesse paramètres
- `?last=abc` → `$top=NaN` SAP ; `parseInt` non protégé par `Number.isFinite` (orders GET, products limit).

---

## 3. Findings classés (détail dans `findings[]`)

| # | Finding | Sév. | ROI |
|---|---|---|---|
| 1 | deliveryDate invalide → 500 brut | 🟠 | Fort |
| 2 | Avoir résiduel / trop-perçu invisible en encours | 🟠 | Moyen |
| 3 | Inventaire : échec entrée après sortie verrouille un stock incohérent | 🟠 | Moyen |
| 4 | bulk delete clients non borné, sans récap d'impact | 🟠 | Fort |
| 5 | Commande sans validation prix/quantité (négatif/NaN/aberrant) | 🟠 | Fort |
| 6 | Pas d'idempotence création commande → double-BL | 🟠 | Fort |
| 7 | Anti-doublon relance non atomique (race) | 🟡 | Moyen |
| 8 | Enum type client en triple définition + casse non normalisée | 🟡 | Moyen |
| 9 | Import CSV update destructif + troncature tel EXPORT | 🟡 | Moyen |
| 10 | Modif BL : perte de lignes texte/frais + dérive de lot | 🟠 | Moyen |
| 11 | Décrément stock optimiste non compensé à l'annulation | 🟡 | Faible |
| 12 | Onglet « Aujourd'hui » : filtre/pagination mémoire + DST | 🟡 | Faible |
| 13 | `last=NaN` → `$top=NaN` (parseInt non protégé) | 🟡 | Moyen |
| 14 | ReminderModal : décalage fuseau/DST sur rappel | 🟡 | Faible |
| 15 | Claim préparateur non atomique + sans rôle | 🟡 | Moyen |
| 16 | Zéro test routes API + buildApiLines (cœur facturation/promo) | 🟠 | Fort |
| 17 | Vente à découvert sans borne ni vue Direction | 🟡 | Faible |

---

## 4. SMOKE TEST — checklist numérotée (4 personas)

> Format : **N. [Persona] Parcours → Action → Résultat attendu**. À exécuter en environnement avec DB + SSO + SAP de test.

### A. COMMERCIAL — saisie de commande (Écran 2)
1. [Com] Console → ouvrir un client de mon périmètre → la file ne montre QUE mes clients (commercial OU vendeur = mon trigramme).
2. [Com] Écran 2 → cliquer un produit en stock → ligne ajoutée, prix conseillé pré-rempli, step = 1 colis.
3. [Com] Saisir 12 colis fraise Gariguette à 7,20 € → Total HT cohérent ; créer → toast « Commande #… créée », lot EM<DocNum> assigné.
4. [Com] **Double-clic rapide** sur « Créer la commande » → **une seule** Sales Order doit exister dans SAP (finding #6 — actuellement échoue).
5. [Com] Saisir un prix **négatif** -3 → doit être **refusé** avec message (finding #5 — actuellement ignoré).
6. [Com] Saisir quantité **1200** au lieu de 12 → avertissement sur-vente ; vérifier le stock décrémenté après création.
7. [Com] Activer « + Rupture », ajouter un article à stock 0 → badge « À DÉCOUVERT », créer → BL avec U_NoLot = EM_PENDING.
8. [Com] Promo PERCENT −10 % sur une ligne → prix affiché net ; à la création, le **net SAP** retombe sur le prix affiché (conversion net→brut).
9. [Com] Promo X+Y (5+1) avec qté 10 → **2 colis offerts** en ligne séparée à 0 € ; qté 5 → 1 ; qté 4 → 0.
10. [Com] Forcer un `deliveryDate` vide/invalide (DevTools) → message **clair** « date invalide », pas « erreur réseau » (finding #1).
11. [Com] Client avec encours dépassé → modale « Encours dépassé » ; « Annuler » → toast « Commande non envoyée » ; « Forcer » → créée.
12. [Com] Client **gelé** SAP (Frozen=tYES) → blocage dur 409, commande impossible, message compta.
13. [Com] « Rejouer la dernière commande » (BLDialog) → lignes pré-remplies, ajustables.
14. [Com] Modifier un BL ouvert : changer une quantité → **les lignes texte/promo existantes restent** (finding #10) ; le lot des lignes conservées **ne change pas**.
15. [Com] Modifier un BL **clôturé** → refus (UI + SAP), message « créez une nouvelle commande ».
16. [Com] Annuler une commande → disparaît des agrégats ; vérifier que le stock dispo se recale (finding #11).

### B. COMMERCIAL — console clavier / rappels
17. [Com] Touche `c` (hors champ) → ouvre la saisie BL ; `d` → « À demain » ; `r` → rappel ; `s` → passer ; ↑/↓ → navigation.
18. [Com] Modale ouverte + appui `d` → **aucun** « À demain » fantôme (neutralisation).
19. [Com] Ctrl+R → recharge le navigateur (PAS détourné) ; Ctrl+D → favori navigateur.
20. [Com] Maintenir une touche → **un seul** log (e.repeat ignoré).
21. [Com] Créer un rappel à +2 min → planifié à la **bonne heure** Europe/Paris dans le calendrier Microsoft (finding #14).
22. [Com] Rappel à une date passée (DevTools) → refusé « date dans le futur ».

### C. DIRECTION — recouvrement / pilotage (rassurer, zéro ambiguïté)
23. [Dir] Encours → liste triée par net décroissant ; tranches >30/45/90 j cohérentes (grâce 30 j).
24. [Dir] Client avec **avoir 800 € > 300 € de factures** → le client **ne disparaît pas** ; indicateur « avoir non consommé 500 € » visible (finding #2 — actuellement absent).
25. [Dir] Relance R3 → un seul courrier ; re-cliquer dans les 2 min → 409 anti-doublon.
26. [Dir] **Double envoi concurrent** R3 (2 onglets, clic simultané) → **un seul** courrier (finding #7).
27. [Dir] Envoi relance sans jeton Graph valide → message d'échec clair, log ECHEC, pas de crash.
28. [Dir] Pilotage : KPI du jour reflètent une commande créée < 30 s (miroir optimiste).

### D. ADMIN — clients / import / sync
29. [Adm] Import CSV avec en-tête + séparateur `;` + accents Excel FR → lignes correctes, accents préservés.
30. [Adm] CSV avec doublons de code → fusion (dernier gagne) + toast « N doublons fusionnés ».
31. [Adm] CSV > 10 000 lignes → 413 « scindez le fichier ».
32. [Adm] Re-import partiel (code+tel) sur clients existants → le **nom saisi à la main n'est pas écrasé** (finding #9 — actuellement écrasé).
33. [Adm] CSV avec numéro EXPORT 12 chiffres → signalé/non tronqué silencieusement (finding #9).
34. [Adm] Bulk « setType » avec valeur hors {EXPORT,GMS,CHR} → 400 ; « gms » minuscule en création → normalisé MAJUSCULES (finding #8).
35. [Adm] Bulk **delete** de N clients → récap d'impact (commandes/appels liés) + confirmation avant exécution (finding #4 — actuellement direct).
36. [Adm] assign-bulk vendeur/commercial → normalisation trigramme (MM/JMG/AG).
37. [Adm] `?last=abc` sur /api/sap/orders → réponse propre (pas de $top=NaN) (finding #13).

### E. PRÉPARATEUR — inventaire / livraisons
38. [Prep] Régularisation inventaire (aperçu GET) → mouvements listés, valeurs et lots EM corrects.
39. [Prep] Régularisation **qui réussit** → session verrouillée, re-POST → 409.
40. [Prep] Régularisation où la **sortie réussit mais l'entrée échoue** → message explicite « sortie #X postée, entrée manquante » + chemin de reprise (finding #3 — actuellement verrouillé sans reprise).
41. [Prep] Régularisation où **rien n'est posté** (sortie refusée) → **non verrouillée**, re-tentable.
42. [Prep] Deux préparateurs claim le **même BL** simultanément → le second voit « déjà pris par X » (finding #15 — actuellement écrasement).
43. [Prep] Requeue d'un BL incomplet → remis sur file + signalé incomplet.

### F. Transverse / robustesse
44. [Tous] Réseau coupé pendant un POST commande → message clair, pas de double création au retour réseau (finding #6).
45. [Tous] Session expirée → 401 propre, redirection login.
46. [Tous] Appel d'une route hors périmètre (autre commercial) → 403 (orders, modif, cancel, encours, relance).
47. [Tous] Bascule minuit / passage heure été-hiver sur l'onglet « Aujourd'hui » → clients corrects (finding #12).

---

## 5. Recommandations prioritaires (par ROI)

**Quick wins à fort ROI** (d'abord) :
- #1 valider `deliveryDate` (isNaN) dans le bloc de garde — 5 lignes.
- #5 valider quantité/prix (Number.isFinite, bornes) en entrée de POST.
- #4 borner + récap d'impact sur bulk delete.
- #13 parseInt défensif partout (helper `clampInt`).
- #8 enum type client centralisé dans lib/segments.
- #15 claim préparateur conditionnel (WHERE preparer IS NULL).

**Chantiers à fort ROI** :
- #6 idempotence création commande (clé UUID + détection doublon récent).
- #16 extraire `buildApiLines` en lib testée + tests d'intégration routes.
- #10 fusion non destructive des lignes SAP en modif.
- #2 exposer avoir résiduel / trop-perçu.
- #3 reprise ciblée de l'inventaire en échec partiel.

La **dette de tests** (#16) est le multiplicateur : sans test sur `buildApiLines` (conversion net→brut PERCENT, carve des offerts, découpe entrepôt) et sur la validation des routes, chacun des autres findings peut **régresser silencieusement** et partir en BL réel — facturation fausse au client fraises.