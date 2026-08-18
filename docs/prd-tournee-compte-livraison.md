# PRD — Transporteur/tournée par défaut du COMPTE DE LIVRAISON actif

- **Statut** : implémenté (PR [#360](https://github.com/Igni92/TeleventGervi/pull/360))
- **Repo** : Igni92/TeleventGervi
- **Branche** : `claude/lpoi-bl-creation-smauk0`

## 1. Problème

Un client peut avoir plusieurs **comptes de livraison** SAP (`ClientDeliveryMode`) :
un compte **Direct** (CardCode du client, ex. `LPOI`) et un ou plusieurs comptes
alternatifs (ex. **SCACHAP**, CardCode `LPOI.`). Chaque compte est un magasin SAP
à part entière, avec sa propre affectation transporteur/tournée dans `SERG_TRCL`.

À la création d'un BL sur un compte **alternatif**, l'écran de commande
(Écran 2) et la fenêtre de création rapide (BLDialog) continuaient à
pré-sélectionner le transporteur et la tournée du compte **Direct** du même
client, et posaient cette valeur explicitement sur le bon (prioritaire sur
toute résolution serveur). Concrètement : un BL pour L. Poitiers sur son compte
SCACHAP (`LPOI.`) partait avec le transporteur **Delanchy** / tournée **FT86**
(ceux du compte Direct), au lieu du transporteur/de la tournée propres au
compte SCACHAP — obligeant une correction manuelle à chaque bon.

## 2. Cause racine

`useTourneeSelection(clientId)` (hook partagé Écran 2 / BLDialog) résolvait le
transporteur/tournée par défaut via `GET /api/clients/[id]/carriers`, une route
qui interrogeait **toujours** `SERG_TRCL` / l'historique / la tournée
mémorisée pour le **CardCode direct** du client — jamais pour le CardCode du
compte de livraison réellement sélectionné dans l'UI. Changer de compte
(Direct ↔ SCACHAP) dans le sélecteur ne déclenchait donc aucune re-résolution :
la valeur affichée (et postée) restait celle du compte Direct.

*(Une première tentative de correction avait ajouté un repli « si le compte
point n'a pas de donnée propre, reprendre celle du compte Direct » — rejetée :
le compte SCACHAP a sa PROPRE affectation SAP et ne doit jamais hériter de
celle d'un autre compte du même client.)*

## 3. Objectifs

- Un BL créé sur n'importe quel compte de livraison (Direct ou alternatif)
  pré-sélectionne le transporteur et la tournée **propres à ce compte**,
  résolus exactement comme pour n'importe quel autre magasin (SERG_TRCL →
  mémoire app → tournée unique).
- Changer de compte dans le sélecteur re-résout immédiatement transporteur et
  tournée pour le nouveau compte (pas de valeur périmée affichée).
- Aucune régression sur le comportement existant du compte Direct.

## 4. Non-objectifs

- Ne modifie pas la logique de résolution SERG_TRCL / historique / mémoire
  elle-même (`lib/clientCarriers.ts`, `lib/clientTournee.ts`) : le fix ne
  change QUE le CardCode transmis à cette résolution.
- Ne traite pas le cas (non observé) où `ClientDeliveryMode` serait mal
  renseigné côté import SAP (`foldDotVariant`) — hors périmètre.

## 5. Solution

- **`lib/useTourneeSelection.ts`** : le hook accepte un 3ᵉ argument
  `cardCode?: string` = CardCode du compte de livraison actif. Il fait partie
  des dépendances de l'effet de résolution : tout changement de compte
  redéclenche le fetch et la pré-sélection.
- **`GET /api/clients/[id]/carriers`** : accepte une query `?cardCode=`.
  Si fourni et différent du code client de base, vérifié comme appartenant au
  client via `ClientDeliveryMode` (`WHERE clientId = ... AND sapCardCode = ...`)
  avant d'être utilisé pour `getClientCarriers` / `getClientTournee` — sinon
  repli silencieux sur le code client de base (comportement inchangé si le
  paramètre est absent).
- **`components/console/BLDialog.tsx`** et **`components/console/Ecran2Order.tsx`** :
  calculent le CardCode du compte actif (`modes`/`deliveryModes`.find(mode
  sélectionné)`.sapCardCode`) et le passent au hook.

## 6. Impact / Risques

- **Sécurité** : le CardCode demandé est vérifié appartenir au client avant
  usage — impossible de faire résoudre les données d'un autre client.
- **Perf** : un changement de compte déclenche un fetch réseau supplémentaire
  (déjà le cas pour tout changement de client) ; TTL de cache 10 min côté
  `clientCarriers.ts` inchangé, indexé par CardCode.
- **UX** : cas limite identifié — passer directement d'un compte alternatif à
  un transporteur choisi manuellement dans la même interaction peut déclencher
  un re-fetch qui écrase la sélection manuelle avant qu'elle soit visible à
  l'écran (interaction existante avant ce fix, non aggravée dans son
  fonctionnement nominal). Accepté comme limite connue, non bloquant.

## 7. Validation

- `npx tsc --noEmit` : aucune erreur sur les fichiers modifiés.
- `npx vitest run` : 658/658 tests passent (dont `useTourneeSelection.test.ts`,
  inchangé).
- **Manuel (à faire en prod)** : créer un BL sur le compte SCACHAP de LPOI et
  confirmer que le transporteur/tournée pré-sélectionnés correspondent à la
  ligne `SERG_TRCL` du CardCode `LPOI.` (pas à celle du compte Direct).

## 8. Suivi

- Confirmer en prod sur au moins un client à comptes multiples (LPOI/SCACHAP)
  que le comportement observé sur la capture d'écran initiale (Poitiers
  regroupé à tort sous Delanchy/FT86) ne se reproduit plus.
