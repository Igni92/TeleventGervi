-- Produits : calibre (SAP Items.U_GER_CALIBRE, ex. « 3AE »).
--
-- Nouveau champ décomposé de la désignation, à côté de marque / conditionnement /
-- variété / origine. Alimenté par la synchro produits (route sync/products) et
-- affiché en tag « calibre » (teal) sur la fiche stock mobile.
--
-- Additif, non destructif, idempotent. Colonne nullable : les articles sans
-- calibre renseigné côté SAP restent simplement sans tag calibre.

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "uCalibre" TEXT;
