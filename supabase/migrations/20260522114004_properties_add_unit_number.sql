-- Migration: 20260522114004_properties_add_unit_number
-- Applied via Supabase MCP. Captured into the repo on 2026-05-22 for traceability.
--
-- properties.unit_number — condo / townhouse / lot identifier from the
-- Paragon RETS feed's L_Address2 field. Carries values like:
--   "Unit 207", "Unit 108", "#9", "#172", "Lot #MJ-01", "Unit B"
--   "Shannon Oaks" (building/subdivision name — also useful to show)
--   "65", "304" (bare numeric units)
--
-- A small fraction of rows carry marketing copy in this field (e.g.
-- "On the Intracoastal WATERWAY"). The mls-rets-sync sanitizer drops
-- anything that doesn't look unit-like; this column is the cleaned
-- result.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS unit_number TEXT;

COMMENT ON COLUMN public.properties.unit_number IS
  'Condo / townhouse / lot identifier from RETS L_Address2 — used by the multi-OH hero card + per-property post cards. NULL for single-family homes.';
