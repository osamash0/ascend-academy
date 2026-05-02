-- ─────────────────────────────────────────────────────────────────────────────
-- Test bootstrap for nightly DB / RLS suite.
-- Stubs the parts of the Supabase environment that vanilla Postgres does not
-- ship: the `auth` and `storage` schemas, role names, JWT-claim helpers, and
-- the out-of-band cache tables that several migrations only ALTER.
-- This file is applied BEFORE any migration under supabase/migrations/.
-- ─────────────────────────────────────────────────────────────────────────────

-- pgcrypto is needed by gen_random_uuid() in older Postgres versions; on 15+
-- gen_random_uuid is built-in but the extension is harmless.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Supabase roles ──────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END
$$;

-- ── auth schema ─────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email               text,
    raw_user_meta_data  jsonb DEFAULT '{}'::jsonb,
    raw_app_meta_data   jsonb DEFAULT '{}'::jsonb,
    created_at          timestamptz DEFAULT now()
);

-- auth.uid() / auth.role() / auth.email() read from per-transaction
-- request.jwt.claim.* GUCs. Tests set these via set_config(...).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')::text
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.email', true), '')::text
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO authenticated, service_role;

-- ── storage schema ──────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
    id          text PRIMARY KEY,
    name        text NOT NULL,
    public      boolean DEFAULT false,
    created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id   text REFERENCES storage.buckets(id) ON DELETE CASCADE,
    name        text,
    owner       uuid,
    metadata    jsonb DEFAULT '{}'::jsonb,
    created_at  timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- storage.foldername mirrors Supabase: 'a/b/c.png' -> {'a','b','c.png'}
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
    SELECT string_to_array(name, '/')
$$;

GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON storage.buckets, storage.objects TO authenticated, service_role;

-- ── Default privileges on public ────────────────────────────────────────────
-- Mirror Supabase's defaults so SET ROLE authenticated still has the basic
-- privileges needed for INSERT/UPDATE/SELECT (RLS is the gate). This must run
-- BEFORE any tables are created in this bootstrap so they inherit the grants.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;

-- ── Out-of-band cache tables ────────────────────────────────────────────────
-- Several migrations only ALTER these tables (e.g. 20260501000001_fix_cache_rls
-- uses ALTER TABLE IF EXISTS / CREATE POLICY ON pdf_parse_cache). They were
-- created out-of-band on the live project, so we recreate the minimum schema
-- here so the migrations apply cleanly and we can assert on their RLS state.
CREATE TABLE IF NOT EXISTS public.pdf_parse_cache (
    pdf_hash    text PRIMARY KEY,
    slides      jsonb NOT NULL DEFAULT '[]'::jsonb,
    deck        jsonb DEFAULT '{}'::jsonb,
    created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.slide_embeddings (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pdf_hash    text NOT NULL,
    slide_index int  NOT NULL,
    embedding   bytea,
    created_at  timestamptz DEFAULT now()
);

-- The cache tables exist on the live project with grants baked in. Mirror
-- those explicitly because ALTER DEFAULT PRIVILEGES only affects FUTURE
-- objects (and these were created in this same bootstrap).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pdf_parse_cache TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slide_embeddings TO anon, authenticated;
GRANT ALL ON public.pdf_parse_cache, public.slide_embeddings TO service_role;
