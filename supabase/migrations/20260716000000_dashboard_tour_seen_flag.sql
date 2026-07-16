-- Migration: 20260716000000_dashboard_tour_seen_flag.sql
-- Description:
--   Tracks whether a student has already been shown the post-onboarding
--   Luna-guided dashboard tour (browse courses / My Materials), so it only
--   auto-plays once — even across devices/sessions — and can be dismissed
--   (skip or finish) without ever reappearing uninvited.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS has_seen_dashboard_tour BOOLEAN NOT NULL DEFAULT FALSE;
