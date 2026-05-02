-- Migration: Add a generic backend cache table for expensive computations
-- Date: 2024-05-02

CREATE TABLE IF NOT EXISTS backend_cache (
    cache_key TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for expiry lookups
CREATE INDEX IF NOT EXISTS idx_cache_expiry ON backend_cache(expires_at);

-- Add a comment for documentation
COMMENT ON TABLE backend_cache IS 'Generic cache for backend services to store expensive JSON results with a TTL.';
