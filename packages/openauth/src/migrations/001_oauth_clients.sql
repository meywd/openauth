-- Migration 001: OAuth Clients Table
-- Complete schema for OAuth 2.0 client management with tenant isolation and secret rotation
--
-- Run with: wrangler d1 execute openauth-db --file=./src/migrations/001_oauth_clients.sql

-- Enable foreign keys (D1/SQLite specific)
PRAGMA foreign_keys = ON;

-- ============================================
-- OAUTH CLIENTS TABLE
-- ============================================

-- OAuth Clients table
-- Stores OAuth 2.0 client registrations for both confidential and public clients
CREATE TABLE IF NOT EXISTS oauth_clients (
    -- Primary identifier for the OAuth client
    id TEXT PRIMARY KEY,

    -- Tenant ID for multi-tenant isolation
    tenant_id TEXT NOT NULL,

    -- Human-readable name for the client application
    name TEXT NOT NULL,

    -- Hash of the client secret for confidential clients
    -- NULL for public clients (SPAs, mobile apps) that cannot securely store secrets
    client_secret_hash TEXT,

    -- JSON array of allowed OAuth grant types
    -- Example: ["authorization_code", "refresh_token", "client_credentials"]
    grant_types TEXT DEFAULT '[]',

    -- JSON array of allowed OAuth scopes
    -- Example: ["openid", "profile", "email"]
    scopes TEXT DEFAULT '[]',

    -- JSON array of allowed redirect URIs
    -- Example: ["https://app.example.com/callback", "http://localhost:3000/callback"]
    redirect_uris TEXT DEFAULT '[]',

    -- JSON object for storing arbitrary client metadata
    metadata TEXT DEFAULT '{}',

    -- Whether the client is enabled (1) or disabled (0)
    enabled INTEGER DEFAULT 1,

    -- Timestamps as Unix epoch milliseconds
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    -- Secret rotation support
    -- Timestamp when secret was last rotated
    rotated_at INTEGER,

    -- Hash of the previous secret (for grace period during rotation)
    previous_secret_hash TEXT,

    -- Unix timestamp when previous secret expires
    previous_secret_expires_at INTEGER
);

-- ============================================
-- INDEXES
-- ============================================

-- Index for tenant + name lookups (uniqueness check)
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_clients_tenant_name ON oauth_clients(tenant_id, name);

-- Index for listing clients by tenant
CREATE INDEX IF NOT EXISTS idx_oauth_clients_tenant ON oauth_clients(tenant_id);

-- Index for listing clients sorted by creation time
CREATE INDEX IF NOT EXISTS idx_oauth_clients_created ON oauth_clients(created_at);

-- Index for filtering by enabled status
CREATE INDEX IF NOT EXISTS idx_oauth_clients_enabled ON oauth_clients(enabled);
