-- Migration: 20260713010000_luna_companion_customization.sql
-- Description:
--   Onboarding's "Avatar" step lets the student customize their Luna companion
--   (suit color, visor tint, patch/insignia) but the choice was never persisted
--   anywhere — handleFinish only wrote the legacy avatar_url field, which the
--   Luna step no longer sets. Every LunaAstronaut render elsewhere in the app
--   (sidebar, profile chip, dashboard, badge modal) used hardcoded defaults.
--
--   Adds 3 nullable, freely user-editable columns to store the choice. These
--   are cosmetic (not trust/integrity flags), so they fall under the same
--   category as avatar_url/display_name in the RLS policy from
--   20260620000000_protect_profile_privileged_columns.sql — no trigger/RLS
--   changes needed.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS luna_suit_color TEXT,
  ADD COLUMN IF NOT EXISTS luna_visor_tint TEXT,
  ADD COLUMN IF NOT EXISTS luna_patch TEXT;
