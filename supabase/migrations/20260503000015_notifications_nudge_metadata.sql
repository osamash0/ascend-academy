-- ─────────────────────────────────────────────────────────────────────────────
-- Notifications: nudge metadata (Task #34 follow-up)
--
-- The daily nudge engine emits notifications with a computed priority and a
-- deep link (e.g. /assignments/{id}). The banner needs both to:
--   1. surface the highest-priority active nudge first (priority desc), and
--   2. navigate the user to the exact resource the nudge is about.
--
-- Both columns are nullable to stay backward-compatible with existing rows
-- and with non-nudge notifications written by other parts of the system.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS priority   INTEGER NULL,
    ADD COLUMN IF NOT EXISTS deep_link  TEXT NULL;

CREATE INDEX IF NOT EXISTS notifications_user_unread_priority_idx
    ON public.notifications(user_id, read, priority DESC, created_at DESC);
