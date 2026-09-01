# Module Transporteur — plan de développement (réponse au CDC)

Source : `CDC-Module-Transporteur-1.docx` (Gervifrais, 9 juin 2026). Objectif :
planifier les tournées + suivre les expéditions (livraison propre + affrètement),
autonome (aucune dépendance SAP B1 / Orderlion en v1), hébergé sur le VPS OVH,
**architecturé pour alimenter plus tard une e-boutique** (jalon « Expédié »).
Contrainte forte : saisie **en quelques secondes** sur tablette, tôt le matin ;
**priorité export avant 6h30**, pic 10h30–11h30.

## 1. Décision d'architecture (recommandée)
**Construire le module DANS l'app TeleVent existante** (Next.js 16 + Prisma +
Postgres local + Auth.js déjà en prod sur le VPS), sous la route `/transport`,
avec ses **propres tables** (préfixe `Transport*`). « Autonome » = **aucune
lecture/écriture SAP ni Orderlion** ; on réutilise seulement l'infra (auth, DB,
déploiement, impression, PWA mobile déjà en place). Avantages : zéro nouveau
serveur à administrer, rôles/PWA/hébergement France/sauvegardes déjà là, et le
**découplage métier/UI** demandé (§8) est respecté via des services isolés.
> Alternative (app séparée) possible mais ~2× plus de charge (auth, déploiement,
> sauvegardes à redéployer) sans bénéfice à ce stade. À trancher avec toi.

## 2. Modèle de données (Prisma — tables Transport*)
- **TransportChauffeur** : `nom`, `type` (INTERNE|EXTERIEUR), `societe` (ex. STM
  pour un extérieur), `tel`, `email`, `actif`. (Hugo = interne.)
- **TransportTournee** : `date`, `libelle`, `chauffeurId`, `notes`. (1 tournée =
  1 chauffeur × 1 jour.)
- **TransportExpedition** (le cœur) :
  `date`, `numCommande` (réf interne), `clientNom`, `clientAdresse`, `creneau`
  (quai/réception GMS), `canal` (GMS|EXPORT|DIRECT), `chauffeurId?`, `tourneeId?`,
  `ordre` (passage), `statut` (A_PREPARER|PREPAREE|EXPEDIE|LIVREE|INCIDENT),
  `tempChargement?`, `immatriculation?`, `observations?`, `refSuivi` (ex. EX-1041),
  horodatages `prepareeAt? / expedieAt? / livreeAt? / arriveeAt? / departAt?`.
- **TransportStatutLog** (traçabilité + futur e-boutique) : `expeditionId`,
  `statut`, `at`, `by`. Historise chaque transition (le jalon « Expédié » sera lu
  par l'e-boutique).
- Migration **additive en raw SQL** (jamais `prisma db push` — cf. drift prod).

## 3. Rôles (réutilise l'auth existante)
- **Admin / Direction** : tout (paramétrage chauffeurs, historique).
- **Exploitation / prépa** : créer expéditions, affecter tournées, saisir relevés.
- **Chauffeur** : sa feuille de route + maj statuts. → **décision** ci-dessous
  (les extérieurs n'ont pas de compte @gervifrais : lien tokenisé plutôt que login).

## 4. Écran clé — « Expéditions du jour » (tablette, §Annexe A)
- Bandeau rouge **« Départ export avant 06:30 »** en tête ; **export trié en
  premier**, puis GMS, puis Direct.
- **Une cartouche par expédition**, fond plein coloré selon statut, libellé blanc :
  rouge = À préparer, orange = Préparée, **vert = Expédié**. **1 clic = étape
  suivante** (boucle), couleur qui change. Zones tactiles larges, sans clavier.
- **Température saisie dans la ligne** au chargement (pavé numérique ; sonde
  connectée = évolution).
- Réf. suivi (EX-1041) en gris léger. Bouton **« Clôturer le départ export »** en
  bas. Cas **Incident** accessible depuis la cartouche (appui long / menu).

## 5. Phasage & charge (chantiers, pour déploiement incrémental)
| # | Livrable | Phase | Charge |
|---|----------|-------|--------|
| A | Modèle de données + CRUD chauffeurs (paramétrage) | 1 | S |
| B | Saisie expéditions + affectation chauffeur/tournée | 1 | M |
| C | Écran tablette « Expéditions du jour » (cartouches, export, T°C) | 1 | L |
| D | Tournées (création/édition, ordre de passage) | 1 | M |
| E | Feuille de route imprimable + vue mobile chauffeur | 1 | M |
| F | Tableau de bord statuts temps réel | 1 | S |
| G | Transmission : email annonce/feuille de route (Graph) + **SMS STM** | 1* | M (dépend infra) |
| H | Historique + export CSV/Excel | 2 | S |
| I | API interne statuts + refSuivi (pré e-boutique) | 3 | S |

*G dépend des décisions infra (SMS/email) ci-dessous. Ordre de dev conseillé :
A → B → C → D → E → F, puis G, puis H, puis I. Chaque lettre = un déploiement
testable (même méthode bundle+SSH que le reste).

## 6. Décisions à trancher avant de coder
1. **Emplacement** : dans l'app TeleVent (recommandé) ou app séparée ?
2. **Accès chauffeur extérieur** : lien tokenisé par tournée (sans compte) —
   recommandé — ou compte dédié ?
3. **SMS à STM** : quel fournisseur ? (OVH SMS API — cohérent avec l'hébergement —
   ou Twilio/autre). Il faut un compte/API key. Sans ça, je livre G « email » et
   je stubbe le SMS.
4. **Email** : réutiliser la boîte Graph déjà branchée (archive-sync) pour envoyer
   annonces/feuilles de route ? (recommandé).
5. **« Direct Rungis »** : simple 3ᵉ canal d'affichage/tri, ou logistique
   particulière (retrait sur place, pas de tournée) ?
6. **Source des expéditions** : 100 % saisie manuelle en v1 (CDC dit autonome),
   ou pré-remplissage optionnel depuis les BL du jour déjà dans TeleVent pour
   gagner du temps (sans coupler SAP — on lit le miroir local) ? (option qui sert
   fort la contrainte « rapide le matin »).

## 7. Note « rapidité matin »
Le point 6 (pré-remplir depuis les livraisons du jour du miroir local) éliminerait
la ressaisie et servirait directement la contrainte d'exploitation. À valider :
c'est de la LECTURE du miroir TeleVent, pas un couplage SAP.
