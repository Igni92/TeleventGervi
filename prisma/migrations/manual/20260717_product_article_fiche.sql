-- Fiche article éditable — colonnes locales additionnelles sur "Product".
--
--   • "barCode"     : code-barres / EAN13 (miroir du champ SAP Items.BarCode).
--                     Édité depuis la fiche article → poussé dans SAP + mis en
--                     cache ici pour l'affichage/recherche hors-ligne.
--   • "commentaire" : note libre INTERNE (n'existe pas dans SAP) — remarques,
--                     historique, alertes qualité… propre à l'app.
--
-- Additif et idempotent (IF NOT EXISTS) : sans risque à ré-exécuter. Ces
-- colonnes sont lues/écrites en SQL brut côté app (même convention que
-- salesItemsPerUnit / uCalibre) pour ne pas dépendre de la régénération du
-- client Prisma.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "barCode" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "commentaire" TEXT;
