-- Objectifs commerciaux multi-métriques : en plus du CA (objectifCa), une cible
-- de MARGE BRUTE (€) et de VOLUME (kg). Additif, non destructif, idempotent.
-- Appliqué via le MCP Supabase le 2026-06-20.
ALTER TABLE "CommercialObjectif" ADD COLUMN IF NOT EXISTS "objectifMarge"  double precision;
ALTER TABLE "CommercialObjectif" ADD COLUMN IF NOT EXISTS "objectifVolume" double precision;
