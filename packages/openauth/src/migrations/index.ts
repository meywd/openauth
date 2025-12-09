/**
 * Database Migrations for OpenAuth Enterprise Features
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
 * npx openauth migrate my-auth-db
 * ```
 *
 * Add to your build script for automatic migrations:
 *
 * ```json
 * {
 *   "scripts": {
 *     "build": "openauth migrate && tsc"
 *   }
 * }
 * ```
 *
 * ## SQL Files
 *
 * The source SQL files are in this directory:
 * - 000_migration_tracking.sql - Migration state tracking
 * - 001_oauth_clients.sql - OAuth client management with tenant isolation
 * - 002_add_tenant_support.sql - Tenant management tables
 * - 003_session_management.sql - Browser and account sessions
 * - 004_rbac_schema.sql - Role-based access control
 * - 005_user_management.sql - User and identity management
 * - 006_identity_providers.sql - Dynamic provider configuration
 *
 * @packageDocumentation
 */

// This module is documentation-only.
// Migrations are run via the CLI: npx openauth migrate
