# TeleVent — Vision produit

> Le cap écrit. Ce document cadre la dérive (sprawl ERP), aligne les futurs chantiers et tranche ce qu'on construit, ce qu'on surveille, ce qu'on ne fait pas.
> Source : `docs/audit-transformation/00-SYNTHESE-CONSOLIDEE.md` (audit consolidé de 12 spécialistes).

---

## La promesse

**TeleVent est le CRM métier premium du grossiste de fraises Gervi : la machine à reprise, fidélisation et recouvrement de son portefeuille de clients en télévente.**

Ce n'est pas un outil d'acquisition, ni un « ERP-bis » : SAP Business One reste la source de vérité. TeleVent est le miroir humain de SAP — l'écran qui ne montre pas seulement des données, mais qui **dit quoi faire** : qui rappeler, pourquoi et dans quel ordre.

Trois leviers de chiffre d'affaires, dans cet ordre :

1. **Reprise** — repérer le client qui décroche (selon *son* rythme) et le reprendre avant qu'il soit perdu.
2. **Fidélisation** — pousser la bonne fraîcheur au bon client, capter les réassorts d'habitude, réveiller la saison.
3. **Recouvrement** — encaisser proprement : relances par paliers, gel sur litige, alerte encours au bon moment.

---

## La devise

**Beginner Friendly + Expert Fast.**

Le même écran doit rassurer la Direction (>50 ans, faible aisance, zéro surprise) **et** laisser filer le commercial (~20 ans, vitesse maximale, raccourcis). On ne sacrifie ni l'un ni l'autre : on rend l'évident immédiat et on garde le raccourci à portée.

---

## Les 4 personas (une ligne chacun)

- **DIRECTION** (>50 ans, décideur, faible aisance) — veut comprendre en moins de 3 s « va-t-on bien ? », être rassurée, ne jamais avoir peur de tout dérégler.
- **COMMERCIAL** (~20 ans) — veut enchaîner les appels sans friction et faire son CA du jour, sur une file priorisée par enjeu (pas par heure).
- **PRÉPARATEUR** (terrain / entrepôt) — veut recevoir juste, préparer sans erreur (lot + DLC), et signaler un problème au point de constat.
- **ADMINISTRATEUR** (config, sync, droits) — veut tenir la cohérence SAP, gérer les droits et ne rien casser, avec un journal de qui a fait quoi.

---

## North-Star metric

**CA par commercial et par jour, rapporté à l'objectif — couplé au taux de reprise du portefeuille.**

- Le **CA/commercial/jour vs objectif** (`CommercialObjectif`) donne le cap quotidien : un cap pour le commercial, un « gagne-t-on ? » immédiat pour la Direction.
- Le **taux de reprise** (clients passés « en retard » qui re-commandent) mesure la promesse n°1 du produit : on ne perd pas le portefeuille.

Le CA seul mesurerait l'activité ; le couple CA + reprise mesure la **santé du portefeuille**, qui est la vraie raison d'être de TeleVent. Métriques secondaires de pilotage : % du portefeuille en état « actif », taux de réactivation des endormis, DSO (recouvrement), % de réceptions fruits frais avec DLC saisie.

---

## Do / Don't produit

**Do**

1. **Chaque écran répond à : « quelle est la prochaine action ? »** — si un écran ne fait que montrer des données sans dire quoi faire, il n'est pas fini.
2. **Prioriser par valeur × urgence**, jamais par heure ou par ordre alphabétique — un gros compte qui décroche passe avant un petit, toujours.
3. **« En retard » se mesure au rythme propre du client** — un CHR quotidien à J+3 ≠ un export mensuel à J+45. Pas de seuil fixe (le `> 7 jours` codé en dur est une erreur connue).
4. **Outiller la fraîcheur de bout en bout** — DLC saisie à la réception, FIFO réel au picking, badge fraîcheur à la vente, lot + DLC sur le bon de préparation. C'est le différenciateur n°1 du métier.
5. **Rassurer la Direction par défaut** — vouvoiement sur les écrans transverses, contraste AA tenu, vocabulaire stable, disposition figée (pas de fiche réorganisable qui détruit la mémoire spatiale), filet runtime (jamais de page d'erreur brute).
6. **Tracer toute action engageante** — qui a annulé un BL, modifié un prix, supprimé un client, basculé la base SAP. Pas de preuve = pas de confiance.
7. **« SAP fait foi »** — chaque écran miroir l'affiche, avec la fraîcheur de synchro, pour résoudre l'angoisse « lequel a raison ? ».

**Don't**

1. **Ne pas étendre la couverture ERP tant que la colonne vertébrale CRM n'est pas posée** (cycle de vie + valeur client + file d'actions priorisée). C'est la règle anti-dérive n°1.
2. **Ne pas construire de tunnel d'acquisition / prospects** — on assume le CRM de **portefeuille**. Ce n'est pas le besoin d'un grossiste en télévente.
3. **Ne pas ajouter de modules de pure consultation** read-only à faible valeur (risque ERP-bis) — surveiller, ne pas étendre.
4. **Ne pas multiplier les options de personnalisation** (réorganisation, renommage, 3 colorimétries, 8 réglages) : sur un poste partagé, le réglage du matin s'impose à l'après-midi. Un défaut sobre et stable, pas un atelier de configuration.
5. **Ne pas exposer une action engageante sans garde-fou** — quantité aberrante, double-clic (double-BL), suppression de client, relance sur facture en litige : toujours confirmer, valider, borner.
6. **Ne pas inventer la donnée métier manquante** (DLC, vendeur, type) — la collecter à la source (process SAP / réception), pas la deviner dans le code.

---

*Document vivant. Toute nouvelle fonctionnalité doit pouvoir se rattacher à la promesse (reprise / fidélisation / recouvrement) et passer le filtre des Don't ci-dessus. Sinon, elle attend.*
