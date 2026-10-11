-- Luna avatar loadout (Suit Locker).
--
-- Versioned 20261010000100 (not ...000000): 20261010000000 is taken by
-- v4_rehearsal_attempts on another branch, and a duplicate version can get a
-- migration silently skipped. Every statement here is idempotent, so the
-- copy already applied to prod by hand (2026-10-11) is safe to re-run.
--
-- One jsonb object, slot -> catalog item id, e.g.
--   {"suit":"suit-nebula","gear":"gear-halo","companion":"companion-owl", ...}
-- The catalog lives client-side (src/features/avatar/catalog.ts); the client
-- sanitizes on read (unknown or not-yet-earned ids fall back to defaults), so
-- this column only needs to stay small and object-shaped.
--
-- The legacy luna_suit_color / luna_visor_tint columns keep being written as
-- well, so every surface still rendering the old LunaAstronaut keeps matching.
--
-- RLS: profiles already restricts UPDATE to the owning user; no new policy.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS luna_loadout jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_luna_loadout_shape;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_luna_loadout_shape
  CHECK (jsonb_typeof(luna_loadout) = 'object' AND pg_column_size(luna_loadout) <= 2048);
