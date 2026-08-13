-- Seuil de commission par commercial : un client n'est commissionné qu'à partir
-- d'un poids livré cumulé (kg) — mesuré depuis la date « since » de la prime du
-- commercial. Au franchissement du seuil, TOUTES les factures du client (depuis
-- la 1ʳᵉ de la fenêtre) basculent d'un coup en commission (rétroactif).
-- 0 (défaut) = pas de seuil → comportement inchangé. Additif, idempotent.
-- Appliqué via le MCP Supabase le 2026-08-05.
ALTER TABLE "CommercialPrime" ADD COLUMN IF NOT EXISTS "seuilKg" double precision NOT NULL DEFAULT 0;
