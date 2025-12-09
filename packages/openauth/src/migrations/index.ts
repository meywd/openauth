/**
 * Database Schema for OpenAuth Enterprise Features
 *
 * Run migrations using the CLI:
 *
 * ```bash
 * npx openauth migrate
 * ```
 *
 * Or specify the database name explicitly:
 *
 * ```bash
 * npx openauth migrate my-auth-db --remote
 * ```
 *
 * ## Schema File
 *
 * All tables are defined in a single file:
 * - `001_schema.sql` - Complete OpenAuth database schema
 *
 * The schema is idempotent (uses CREATE TABLE IF NOT EXISTS).
 * Safe to run multiple times.
 *
 * ## Tables
 *
 * - `_openauth_migrations` - Migration tracking
 * - `tenants` - Multi-tenant support
 * - `oauth_clients` - OAuth 2.0 clients with secret rotation
 * - `browser_sessions` - Browser/device sessions
 * - `account_sessions` - User account sessions (multi-account)
 * - `users` - User accounts
 * - `user_identities` - Identity provider links
 * - `identity_providers` - Dynamic provider configuration
 * - `rbac_apps` - RBAC applications
 * - `rbac_roles` - Role definitions
 * - `rbac_permissions` - Permission definitions
 * - `rbac_role_permissions` - Role-permission mapping
 * - `rbac_user_roles` - User-role assignments
 *
 * @packageDocumentation
 */

// This module is documentation-only.
// Migrations are run via the CLI: npx openauth migrate
