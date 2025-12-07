-- Migration 000: Migration Tracking
-- Creates the _openauth_migrations table to track applied migrations
-- This migration is always run first and is idempotent
--
-- Run with: wrangler d1 execute openauth-db --file=./src/migrations/000_migration_tracking.sql

-- ============================================
-- MIGRATION TRACKING TABLE
-- ============================================

-- Tracks which migrations have been applied to this database
-- This enables safe re-running of the migrate command
CREATE TABLE IF NOT EXISTS _openauth_migrations (
    -- Migration filename (e.g., '001_oauth_clients.sql')
    name TEXT PRIMARY KEY,

    -- Timestamp when this migration was applied
    applied_at INTEGER NOT NULL,

    -- Hash of the migration file content (for drift detection)
    checksum TEXT
);

-- Index for listing migrations by application order
CREATE INDEX IF NOT EXISTS idx_migrations_applied ON _openauth_migrations(applied_at);
