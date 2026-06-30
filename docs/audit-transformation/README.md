# Dossier d'audit — Transformation ERP → CRM métier premium

> **TeleVent** (GERVI / Gervifrais — grossiste distributeur de fraises & fruits frais)
> Audit conduit le **30/06/2026** · Français · niveau cabinet de conseil
> Phase d'**observation exhaustive** uniquement — **aucune ligne de code applicatif n'a été modifiée.**

---

## Ce que contient ce dossier

| Fichier | Contenu |
|---------|---------|
| [`00-SYNTHESE-CONSOLIDEE.md`](./00-SYNTHESE-CONSOLIDEE.md) | **Synthèse Lead Product** : Executive Summary, table de maturité, 8+ thèmes transverses, 4 personas, **backlog priorisé unique (40+ items)**, roadmap en 4 vagues, visions (Produit / CRM / ERP / Graphique / Technique), KPIs & risques, arbitrages. **À lire en premier.** |
| [`audits/01-product-director.md`](./audits/01-product-director.md) | Vision produit, positionnement ERP→CRM, valeur business, roadmap |
| [`audits/02-ux-research.md`](./audits/02-ux-research.md) | Audit UX complet + les 4 personas (objectifs/besoins/frustrations/risques) |
| [`audits/03-ui-designer.md`](./audits/03-ui-designer.md) | Hiérarchie, composants, contrastes, espacements, typographie, responsive |
| [`audits/04-directeur-artistique.md`](./audits/04-directeur-artistique.md) | Identité visuelle, ADN de marque, métaphore métier |
| [`audits/05-accessibilite.md`](./audits/05-accessibilite.md) | WCAG 2.2 AA : contrastes, focus, clavier, tailles, cibles tactiles |
| [`audits/06-design-cognitif.md`](./audits/06-design-cognitif.md) | Charge mentale, lois de Hick/Jakob, repères constants, automatismes |
| [`audits/07-expert-crm.md`](./audits/07-expert-crm.md) | Logique CRM : cycle de vie, scoring, file d'actions, traçabilité |
| [`audits/08-expert-metier.md`](./audits/08-expert-metier.md) | Grossiste fraises : fraîcheur/DLC, retards, litiges, préparation, recouvrement |
| [`audits/09-qa-lead.md`](./audits/09-qa-lead.md) | Edge cases + smoke tests + casse volontaire des workflows |
| [`audits/10-securite.md`](./audits/10-securite.md) | Permissions, actions critiques, audit trail, traçabilité, RGPD |
| [`audits/11-architecte.md`](./audits/11-architecte.md) | Architecture, dette, maintenabilité, scalabilité, tests |
| [`audits/12-motion-designer.md`](./audits/12-motion-designer.md) | Interactions : utiles vs décoratives, performance, reduced-motion |

---

## Méthode

12 auditeurs spécialisés ont **lu réellement** le code de leur périmètre (routes, composants, `lib`, schéma Prisma, design system), chaque critique étant **argumentée** et **sourcée en `fichier:ligne`**, puis classée par **sévérité × impact métier × ROI**. Un **Lead Product** a ensuite **fusionné, dédoublonné et priorisé** l'ensemble en une synthèse de direction.

- **Sévérité** : 🔴 Critique · 🟠 Majeur · 🟡 Mineur · ℹ️ Info
- **Effort** : ⚡ Quick win · 🛠️ Chantier
- L'audit s'appuie sur l'existant déjà livré (`DESIGN-CHANGELOG.md`, `TODO-AUDIT.md`) pour **ne pas re-proposer ce qui est fait** (RLS, IDOR, marges, perf pilotage, migration Next 16).

> **Limite assumée :** l'application n'est pas exécutable dans cet environnement (pas de base de données ni de SSO Microsoft). L'audit est donc **statique** (lecture de code + raisonnement métier) ; les écrans sont décrits précisément plutôt que capturés.

---

## Le verdict en bref

**Un excellent cœur de télévente, posé sur un socle technique mûr — mais qui n'est pas encore un CRM.**

| Indicateur | Lecture |
|------------|---------|
| **Note globale de maturité** | **≈ 62 / 100** — bon produit en devenir |
| **Point le plus faible : métier fraise** | **38 / 100** — DLC jamais saisie, rotation des lots en **LIFO au lieu de FIFO**, fraîcheur invisible à la vente |
| **CRM opérationnel** | **46 / 100** — pas de cycle de vie client, pas de scoring, file d'appel calendaire (non priorisée par valeur×urgence) |
| **Forces réelles déjà livrées** | Console d'appel de qualité métier, vue 360 client, moteur d'insights honnête, intégration SAP-miroir, sécurité d'autorisation sérieuse (RLS 45/45), design system ambitieux |

**Les 3 leviers à plus fort ROI :**
1. **Construire le cerveau CRM** (cycle de vie + valeur client + file d'actions priorisée) — la donnée existe déjà, c'est de l'orchestration.
2. **Outiller la fraîcheur** (DLC à la réception → badge en console → « à écouler en priorité ») — le levier de marge le plus spécifique du métier.
3. **Rassurer la Direction** par des quick-wins à très fort ROI (contraste AA, error boundary, next-best-action, garde-fous sur les actions engageantes).

---

*Dossier produit par une équipe de 12 sous-agents spécialisés + consolidation Lead Product. La dimension CRM (audit 07) a été produite en deux temps pour des raisons techniques ; elle est intégrée à la synthèse et figure en annexe.*
