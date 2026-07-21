# Storage & upload security posture (Roadmap S-4)

## Upload validation
`backend/services/upload_service.validate_upload` rejects, before any parser
ever sees the bytes:
- oversized files (size check first, cheapest rejection)
- wrong-MIME abuse (a `.pdf` extension with no `%PDF` magic bytes)
- corrupt/truncated PDFs (magic bytes present, but PyMuPDF fails to open the
  structure) — surfaced as a friendly `ValueError`, not a crash
- path-traversal filenames

Regression tests: `backend/tests/unit/test_upload_service.py`.

## Private-upload isolation
The `pdf-uploads` bucket is created with `public: False`
(`backend/services/upload_service.py`). RLS policies on `storage.objects`
(`supabase/migrations/20260224211000_storage_policies.sql`,
`20260503000002_fix_storage_policies.sql`) scope access to the owning user.
Regression: `backend/tests/db/test_student_uploads_rls.py`.

## Signed URLs
Read access to stored artifacts (e.g. worksheet PDFs) goes through
`bucket.create_signed_url(path, 3600)` — a 1-hour TTL
(`backend/api/v1/worksheets.py`) — never a permanent public URL.

## Takedown flow (documented, manual)
1. An admin (via the existing admin visibility toggle) sets the
   lecture/material's `is_hidden`/visibility flag, immediately cutting off
   API-level access for all students (enforced by the same RLS boundary
   above — no derived artifact, including cached AI content, is reachable
   once the parent record is hidden).
2. An operator with service-role access deletes the underlying storage
   object(s) via the Supabase dashboard or `sb.storage.from_(bucket).remove([path])`
   and the corresponding DB rows (lecture, slides, derived embeddings/cache
   entries) — a manual step today, not yet automated.
3. **Gap, explicitly out of scope for this pass:** there is no single
   "purge everything derived from lecture X" endpoint — takedown of derived
   artifacts (cached AI answers, analytics rollups referencing the content)
   is manual and best-effort. Automating a full cascading purge is future
   work, not attempted here.
