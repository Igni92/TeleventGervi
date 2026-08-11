# Guide d'utilisation — TeleVent (par rôle)

> `PRODUCT.md` explique *pourquoi* l'application existe (vision, personas,
> Do/Don't). Ce document explique *comment s'en servir au quotidien*, par
> rôle, pour quelqu'un qui découvre l'outil. `docs/OPS-DEPLOIEMENT.md` et
> `DEPLOIEMENT.md` couvrent la partie technique/hébergement.

---

## 1. Comment un compte obtient son rôle

Un compte se connecte via **Microsoft (Azure AD, `@gervifrais.com`)** — pas de
mot de passe applicatif. Une fois connecté, ses droits dépendent de flags
stockés en base, gérés depuis **Paramètres → Effectifs** :

| Rôle | Donne accès à | Où c'est activé |
|---|---|---|
| **Commercial** | Sa file de clients (console d'appel, rappels, encours) — filtré sur son trigramme SAP (`slpName`, table `UserCommercial`) | Rattachement commercial ↔ email (mapping SAP) |
| **Direction** (`isDirection`) | Vision globale comme un admin + validation mensuelle des heures/congés | Écran Effectifs |
| **Préparateur** (`isPreparateur`) | Réception commandes fournisseurs, entrées marchandise, annulation/modif | Écran Effectifs |
| **Agréeur** (`isAgreeur`) | Un seul geste : « passer » une commande fournisseur en entrée marchandise (pas de création) | Écran Effectifs |
| **Livreur** (`isLivreur`) | Vue restreinte : livraisons déjà mises en préparation | Écran Effectifs |
| **Admin** (`isAdmin`) | Accès global + 2 actions réservées : bascule base SAP prod/test, promotion admin d'un autre compte | Un admin existant le fait depuis Effectifs, **ou** email en dur dans `ADMIN_EMAILS` (cf. `docs/PASSATION-ACCES.md`) |

Un compte connecté mais **non rattaché à un commercial** ne voit aucune
donnée (message *"Compte non relié à un commercial"*) — c'est volontaire
(anti-fuite), pas un bug : il faut le rattacher via le mapping SAP
(`scripts/ddl-user-commercial.mjs` / table `UserCommercial`).

---

## 2. Par rôle — les écrans du quotidien

### Direction
- **`/accueil`** puis **`/dashboard`** : vision globale du jour, CA vs objectif
  par commercial, alertes portefeuille.
- **`/pilotage`** (accessible depuis le dashboard) : deux écrans — vue globale
  et *drill-down* par commercial. Un admin/direction peut « voir comme » un
  commercial (`?as=`) pour vérifier ce qu'il voit lui-même.
- **`/encours`** : recouvrement, relances clients (cf. `docs/relance-recouvrement.md`).
  ⚠️ **`RELANCE_LIVE` n'est pas activé en prod** : par défaut, tous les emails
  de relance partent vers une boîte de test, jamais vers le vrai client — c'est
  un choix assumé tant que les modèles n'ont pas été validés (cf. `.env.example`).
- **Planning / congés** (`/planning`) : validation des demandes de congés/récup
  de l'équipe.
- **`/salaires`** : éléments de paie (les gérants, `GERANT_EMAILS` dans
  `lib/permissions.ts`, en sont exclus — ils saisissent leurs heures mais n'ont
  pas de bulletin).

### Commercial
- **`/console`** (ou `/console2`) : poste de travail principal — file d'appels
  priorisée par enjeu (pas par ordre alphabétique ni par heure), création de
  rappels (pousse automatiquement un événement dans le calendrier Outlook).
- **`/clients`** : fiche client, historique, badges (EXPORT bleu / GMS orange /
  CHR vert).
- **`/plan-appel`** : préparation de tournée d'appels.
- **`/ventes-du-jour`** : suivi du CA du jour.
- **`/prospection`** : gestion des prospects GMS/hypers (cf. `docs/prospection-crm.md`).
- Un commercial ne voit **que ses propres clients** (`commercial` ou `vendeur`
  = son trigramme SAP) — c'est structurel, pas un filtre optionnel.

### Préparateur / Agréeur (entrepôt)
- **`/commandes-fournisseurs`** : création/réception des commandes.
- **`/entrees`** : entrées marchandise (réceptions), saisie DLC/lot — c'est le
  point d'entrée de la traçabilité fraîcheur (FIFO, badge fraîcheur en aval).
- **`/fabrication`** : ordres de fabrication.
- **`/inventaire`** : ajustements de stock.
- Un **agréeur** n'a droit qu'à « réceptionner » une commande déjà créée par un
  préparateur/admin — il ne peut ni créer une commande ni créer une entrée
  marchandise seul.

### Livreur
- **`/livraisons`** : uniquement les BL déjà « mis en préparation » — pas le
  dispatch (réservé au commercial), pas la mise en préparation elle-même.
- **`/details-livraison`** : détail d'une tournée.

### Admin
- Tous les écrans ci-dessus, sans filtre, **plus** :
  - **`/parametres`** : gestion des effectifs/rôles, marques, bascule SAP prod↔test.
  - Resynchronisation manuelle SAP (*Paramètres → Données · SAP*).
  - Promotion/rétrogradation admin d'un autre compte.

---

## 3. Limitations connues à ne pas prendre pour des bugs

(Détail complet : `TODO-AUDIT.md`, `AUDIT-REDESIGN.md`.)

- **Seuil « client en retard »** : actuellement un seuil fixe (`> 7 jours`)
  dans le code, alors que la doctrine produit (`PRODUCT.md`) prévoit un rythme
  propre à chaque client (CHR quotidien ≠ export mensuel). Connu, pas encore
  corrigé.
- **`vendeur` incomplet sur les fiches clients** (280/339 sans `type` à la
  dernière mesure) : la file console peut sembler vide pour certains
  commerciaux tant que le mapping SAP n'est pas complété — c'est une donnée à
  corriger côté SAP/process, pas un bug applicatif.
- **Synchronisation SAP** : automatisée via un workflow GitHub Actions
  (`.github/workflows/sap-sync.yml`, toutes les 30 min) en attendant une
  bascule prévue vers un cron centralisé sur un VPS OVH (cf. `DEPLOIEMENT.md`
  §8). Si les chiffres semblent « figés », c'est le premier point à vérifier
  (onglet *Actions* du repo GitHub, ou resynchro manuelle admin).
- **Relances de recouvrement en mode test** : voir §2 Direction ci-dessus.

---

## 4. Qui contacter en cas de blocage

- Problème de connexion / compte non rattaché : [À COMPLÉTER — contact admin interne]
- Donnée SAP incohérente (montants, stock, clients) : [À COMPLÉTER — contact SAP/ERP]
- Panne technique de l'application (page blanche, erreur 500) : voir
  `docs/PASSATION-ACCES.md` pour la chaîne d'escalade technique.
