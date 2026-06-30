## Audit Sécurité — Permissions, actions critiques, audit trail & RGPD

### Synthèse exécutive

TeleVent a déjà absorbé un **gros chantier de durcissement** (cf. `TODO-AUDIT.md` : RLS 45/45, IDOR sur les commandes CLIENT, `requireAdmin` sur les syncs, masquage des marges). Ce travail est **réel et de qualité** : le cloisonnement CRM côté *client* (fiche, contacts, appels, incidents, relance) est rigoureux et homogène.

Mais l'audit fait apparaître **un angle mort entier non couvert par le TODO** et **une lacune transverse de traçabilité** :

1. 🔴 **Toute la chaîne documentaire FOURNISSEUR / STOCK est ouverte à n'importe quel commercial.** Le périmètre IDOR déjà traité ne concerne QUE les commandes *client* (`/api/sap/orders`). Les annulations de commandes fournisseurs, les réceptions, les **modifications de prix d'achat**, les retours et les créations d'entrée marchandise ne vérifient **que la présence d'une session**.
2. 🔴 **Aucun journal d'actions sensibles.** Impossible de répondre à « qui a annulé ce BL ? », « qui a baissé ce prix ? », « qui a supprimé ce client ? ». Seuls des `console.log` éphémères existent.

Pour une **direction >50 ans à faible aisance numérique** dont la devise produit est « je comprends ce qui se passe », ce trou de traçabilité est aussi un **trou de confiance**.

---

### 1. Contrôle d'accès — état des lieux

#### Ce qui est solide (à conserver)

Le moteur de permissions (`lib/permissions.ts`) est bien pensé :

| Helper | Rôle | Usage |
|---|---|---|
| `getAccessScope` | admin/direction = global, sinon `slpName` | base de tout |
| `clientInScope` / `cardCodeInScope` | IDOR client (commercial **OU** vendeur) | routes `/clients/[id]/*`, relance |
| `requireAdmin` | admin **OU** direction | gestion d'équipe, syncs, bulk |
| `requireStrictAdmin` | admin **seul** | bascule base SAP, promotion *admin* |

Le double critère `commercial = slpName OR vendeur = slpName` est appliqué partout de façon cohérente. Le pattern `updateMany/deleteMany { id, clientId }` sur les contacts/modes ferme l'IDOR de second niveau. Le repli anti-lock-out (try/catch en cascade dans `getAccessScope`) ne tombe **jamais** en accès global par défaut. **C'est du bon travail.**

#### Le trou : périmètre ACHAT / STOCK (🔴 Critique)

| Route | Effet métier | Garde actuel | Garde attendu |
|---|---|---|---|
| `POST /sap/goods-receipts/cancel` | Annule une EM → **sort le stock** | `auth()` seul | préparateur / admin |
| `POST /sap/goods-receipts/[docEntry]/modif` | **Modifie le prix d'achat** des lignes | `auth()` seul | préparateur / admin |
| `POST /sap/goods-receipts/[docEntry]/return` | Crée un **retour fournisseur** | `auth()` seul | préparateur / admin |
| `POST /sap/goods-receipts` | Crée une entrée marchandise | `auth()` seul | préparateur / admin |
| `POST /sap/purchase-orders/cancel` | Annule une commande fournisseur | `auth()` seul | admin |
| `POST /sap/purchase-orders/receive` | Valide réception → **clôture la commande** | `auth()` seul | préparateur / admin |
| `POST /sap/purchase-orders/[docEntry]/modif` | Modifie la commande fournisseur | `auth()` seul | préparateur / admin |

**Scénario fraise concret :** un commercial de 20 ans, depuis le navigateur (DevTools ou un simple `fetch`), appelle `POST /api/sap/goods-receipts/[docEntry]/modif` et **abaisse le prix d'achat** d'un lot de fraises gariguette Espagne. La **marge réelle** (`lib/cogs`) est faussée, et donc la **prime** calculée dessus (`/api/commerciaux/prime`). Ou il annule la réception d'une palette qui vient d'entrer : le stock disparaît de SAP. Tout cela est aujourd'hui **autorisé et non tracé**.

> Recommandation : introduire `requirePreparateurOrAdmin(session)` (symétrique de `requireAdmin`, basé sur `User.isPreparateur`) et gater ces 7 routes. L'annulation de documents → `requireAdmin`.

---

### 2. Suppressions & opérations destructives

| Opération | Garde | Soft-delete ? | Audit ? | Verdict |
|---|---|---|---|---|
| `DELETE /clients/[id]` (unitaire) | `clientInScope` | ❌ hard delete cascade | ❌ | 🟠 incohérent avec le bulk |
| `POST /clients/bulk` (delete) | `requireAdmin` ✅ | ❌ | ❌ | OK gating, audit manquant |
| `DELETE /incidents` | scope (si existe) | ❌ `.catch(()=>{})` | ❌ | 🟡 suppression silencieuse |
| `POST /sap/sync/full-reset` | `requireAdmin` ✅ | n/a (TRUNCATE) | ❌ | 🟡 trace = `console.log` |
| `POST /inventaire/adjust` | `requireAdmin` ✅ + verrou | n/a | partiel (session) | bon, mais pas de journal central |

**Le delete client unitaire est le plus gênant :** un commercial *en périmètre* peut effacer définitivement une fiche 360 (cascade → appels, rappels, contacts, incidents), alors que le **delete en masse est, lui, réservé admin**. Cette incohérence est dangereuse (un junior « nettoie un doublon » et efface le mauvais client export régulier, sans trace). Le doc RGPD §6.4 recommande pourtant explicitement **anonymisation > suppression dure, tracée et à double contrôle**.

---

### 3. Audit trail — la lacune transverse (🔴 Critique)

**Aucune table `AuditLog`.** Les actions à enjeu n'ont qu'un `console.log` (logs Vercel, non requêtables, purgés) :

- annulation BL client / EM / PO
- **modification de prix** d'un BL client (`orders/[docEntry]/modif`) et d'un prix d'achat
- suppression de client
- **bascule base SAP prod↔test** (`environment` : `console.log("[SAP env] Bascule…")`)
- **changements de rôle** (`commerciaux` : `UPDATE "User" SET "isDirection"…` en raw SQL, aucune trace)

Le doc RGPD le reconnaît (§6.5 : *« pas de journal d'audit dédié »*). En cas de litige client (« vous avez annulé mon BL de fraises de jeudi sans me prévenir ») ou de contrôle de prime, **l'application ne peut produire aucune preuve nominative**. C'est aussi une faiblesse RGPD d'*accountability* (art. 5.2).

**Imputabilité existante (à conserver) :** `Incident.createdBy` et `RelanceLog.sentBy/sentAt` *sont* renseignés — les deux flux les plus sensibles (litige, recouvrement) ont un auteur. Le manque est ailleurs.

**Manque criant côté CRM :** `AppelLog` et `Rappel` n'ont **aucun champ d'auteur** (`schema.prisma:557`, `:545`). Or l'historique d'appels nourrit conversion, activité et **primes**. Avec la couverture d'absents (`TempAssignment`), savoir *qui* a passé l'appel est indispensable — et impossible aujourd'hui.

---

### 4. Élévation de privilèges & rôles

`PATCH /api/commerciaux` gate toute la route sur `requireAdmin` (admin **ou** direction). Seul `isAdmin` est protégé par `requireStrictAdmin`. **Mais `isDirection`, `isPreparateur`, `isCommercial` sont modifiables par un compte direction** sans contrôle strict ni trace (raw SQL `UPDATE "User"`).

Conséquence : un utilisateur **direction peut accorder `isDirection`** (= `scope.all`, vision globale de **toutes** les marges et de **tous** les clients) à un tiers — voire se le confirmer — **hors du contrôle de l'admin système et sans audit**. Or `isDirection` confère le même périmètre de lecture global qu'un admin sur la donnée métier. Accorder « vision globale » devrait être strict + tracé.

---

### 5. Injection SQL & secrets

**Aucune injection trouvée**, malgré l'usage massif de `$queryRawUnsafe`/`$executeRawUnsafe` (~60 occurrences recensées). Toutes les **valeurs** passent en paramètres positionnels (`$1,$2…`) ou via `Prisma.sql`. Les rares noms de **table** interpolés (`sap/clients/import`) viennent de **constantes internes**, jamais d'une saisie utilisateur. Les `console.log` inspectés impriment des **codes/totaux** (CardCode, DocNum, ΣHT/Σkg), pas des PII brutes (tel/email/notes). Le **jeton Graph** reste dans le JWT chiffré httpOnly, jamais exposé au client (`auth.ts`). **Hygiène correcte.**

**Réserve (🟠) :** le bypass préversion (`VERCEL_ENV === "preview"`) désactive **toute** authentification (`proxy.ts:9-11`) et injecte une **session admin factice sur données réelles** (`auth.ts:82-96`, commentaire : *« la préversion voit les données réelles »*). Chaque déploiement de branche expose alors l'intégralité des données (clients, marges, encours, PII) en tant qu'admin sur une URL `*.vercel.app` publique, sans login. À neutraliser (base de test pour les previews et/ou Deployment Protection Vercel).

---

### 6. RGPD — ce qui reste

Le `docs/rgpd-conformite.md` est **sérieux et honnête** (registre, base légale B2B/intérêt légitime, parti pris d'anonymisation). L'export art. 15/20 est implémenté (admin, lecture seule, paramétré). **Ce qui reste à exécuter :**

| Manque | Article | Statut |
|---|---|---|
| Purge/anonymisation automatique `AppelLog`/`Rappel`/`Incident` | 5.1.e | ❌ aucune (accumulation infinie) |
| Drapeau opt-out « ne pas démarcher » sur `Contact` + exclusion des files | 21 | ❌ inexistant |
| Région Supabase UE confirmée + DPA Supabase/Microsoft/SAP signés | 28/44 | ⚠️ à confirmer |
| Hébergement Next.js (Vercel US par défaut) en UE | 44 | ⚠️ non tranché |
| Journal d'accès en lecture aux PII | 5.2 | ❌ inexistant |
| `Client.email` déprécié mais toujours alimenté/exporté | 5.1.c/d | ⚠️ migration à finir |

Le contexte **strictement B2B** (pas de données sensibles) atténue le risque, mais une demande CNIL ou une opposition d'interlocuteur trouverait l'app **en défaut sur l'exécution** (notamment opt-out et purge).

---

### Conclusion & priorisation

**ROI fort, à traiter en premier :**
1. 🔴 Gater le périmètre **achat/stock** (préparateur/admin) — angle mort le plus dangereux.
2. 🔴 Table **`AuditLog`** + écriture sur cancel/modif-prix/delete/bascule env/rôles.
3. 🟠 Réserver le **delete client** à `requireAdmin` (aligner sur le bulk) ou passer en anonymisation tracée.
4. 🟠 `requireStrictAdmin` sur `isDirection` + audit des changements de rôle.
5. 🟠 Auteur sur `AppelLog`/`Rappel`.
6. 🟠 Neutraliser le bypass préversion (données de test / Deployment Protection).

**Note de maturité sécurité : 68/100** — socle d'autorisation client de bon niveau, plombé par l'ouverture du périmètre fournisseur/stock et l'absence d'audit trail, deux points qui touchent directement la **rentabilité** (marge, valorisation stock) et la **confiance Direction**.