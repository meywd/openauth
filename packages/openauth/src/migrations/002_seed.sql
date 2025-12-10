-- ============================================================================
-- SEED DATA: Default clients, users, roles, and permissions
-- ============================================================================
-- This seed file creates a baseline configuration for the OpenAuth system.
-- Run after 001_schema.sql to populate default data.
-- ============================================================================

-- ============================================================================
-- SECTION 1: DEFAULT OAUTH CLIENTS
-- ============================================================================

-- Admin Dashboard Client (confidential)
INSERT OR IGNORE INTO oauth_clients (
    id, tenant_id, name, client_secret_hash, grant_types, scopes,
    redirect_uris, metadata, enabled, created_at, updated_at
) VALUES (
    'client_admin_dashboard',
    'default',
    'Admin Dashboard',
    '', -- Secret should be set via API after creation
    '["authorization_code", "refresh_token"]',
    '["openid", "profile", "email", "admin:read", "admin:write"]',
    '["http://localhost:3000/callback", "https://admin.example.com/callback"]',
    '{"description": "Administrative dashboard application", "type": "confidential"}',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- API Service Client (M2M)
INSERT OR IGNORE INTO oauth_clients (
    id, tenant_id, name, client_secret_hash, grant_types, scopes,
    redirect_uris, metadata, enabled, created_at, updated_at
) VALUES (
    'client_api_service',
    'default',
    'API Service',
    '', -- Secret should be set via API after creation
    '["client_credentials"]',
    '["api:read", "api:write", "users:read"]',
    '[]',
    '{"description": "Backend API service for M2M communication", "type": "confidential"}',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Mobile App Client (public)
INSERT OR IGNORE INTO oauth_clients (
    id, tenant_id, name, client_secret_hash, grant_types, scopes,
    redirect_uris, metadata, enabled, created_at, updated_at
) VALUES (
    'client_mobile_app',
    'default',
    'Mobile Application',
    '', -- Public client, no secret required
    '["authorization_code", "refresh_token"]',
    '["openid", "profile", "email", "offline_access"]',
    '["com.example.app://callback", "https://app.example.com/callback"]',
    '{"description": "Mobile application client", "type": "public"}',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Web Application Client (confidential)
INSERT OR IGNORE INTO oauth_clients (
    id, tenant_id, name, client_secret_hash, grant_types, scopes,
    redirect_uris, metadata, enabled, created_at, updated_at
) VALUES (
    'client_web_app',
    'default',
    'Web Application',
    '', -- Secret should be set via API after creation
    '["authorization_code", "refresh_token"]',
    '["openid", "profile", "email"]',
    '["http://localhost:3000/auth/callback", "https://www.example.com/auth/callback"]',
    '{"description": "Main web application", "type": "confidential"}',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- ============================================================================
-- SECTION 2: RBAC APPLICATIONS
-- ============================================================================

-- Core Platform App (system-level permissions)
INSERT OR IGNORE INTO rbac_apps (id, name, tenant_id, description, created_at)
VALUES (
    'app_platform',
    'Platform',
    'default',
    'Core platform permissions for system administration',
    strftime('%s', 'now') * 1000
);

-- User Management App
INSERT OR IGNORE INTO rbac_apps (id, name, tenant_id, description, created_at)
VALUES (
    'app_users',
    'User Management',
    'default',
    'User and identity management permissions',
    strftime('%s', 'now') * 1000
);

-- Client Management App
INSERT OR IGNORE INTO rbac_apps (id, name, tenant_id, description, created_at)
VALUES (
    'app_clients',
    'Client Management',
    'default',
    'OAuth client management permissions',
    strftime('%s', 'now') * 1000
);

-- API Access App
INSERT OR IGNORE INTO rbac_apps (id, name, tenant_id, description, created_at)
VALUES (
    'app_api',
    'API Access',
    'default',
    'API access and integration permissions',
    strftime('%s', 'now') * 1000
);

-- ============================================================================
-- SECTION 3: RBAC PERMISSIONS
-- ============================================================================

-- Platform Permissions
INSERT OR IGNORE INTO rbac_permissions (id, name, app_id, description, resource, action, created_at)
VALUES
    ('perm_platform_admin', 'platform:admin', 'app_platform', 'Full platform administration', 'platform', 'admin', strftime('%s', 'now') * 1000),
    ('perm_platform_settings_read', 'platform:settings:read', 'app_platform', 'View platform settings', 'settings', 'read', strftime('%s', 'now') * 1000),
    ('perm_platform_settings_write', 'platform:settings:write', 'app_platform', 'Modify platform settings', 'settings', 'write', strftime('%s', 'now') * 1000),
    ('perm_platform_audit_read', 'platform:audit:read', 'app_platform', 'View audit logs', 'audit', 'read', strftime('%s', 'now') * 1000);

-- User Management Permissions
INSERT OR IGNORE INTO rbac_permissions (id, name, app_id, description, resource, action, created_at)
VALUES
    ('perm_users_read', 'users:read', 'app_users', 'View user profiles', 'users', 'read', strftime('%s', 'now') * 1000),
    ('perm_users_write', 'users:write', 'app_users', 'Create and update users', 'users', 'write', strftime('%s', 'now') * 1000),
    ('perm_users_delete', 'users:delete', 'app_users', 'Delete users', 'users', 'delete', strftime('%s', 'now') * 1000),
    ('perm_users_roles_assign', 'users:roles:assign', 'app_users', 'Assign roles to users', 'roles', 'assign', strftime('%s', 'now') * 1000),
    ('perm_users_roles_revoke', 'users:roles:revoke', 'app_users', 'Revoke roles from users', 'roles', 'revoke', strftime('%s', 'now') * 1000),
    ('perm_users_impersonate', 'users:impersonate', 'app_users', 'Impersonate other users', 'users', 'impersonate', strftime('%s', 'now') * 1000);

-- Client Management Permissions
INSERT OR IGNORE INTO rbac_permissions (id, name, app_id, description, resource, action, created_at)
VALUES
    ('perm_clients_read', 'clients:read', 'app_clients', 'View OAuth clients', 'clients', 'read', strftime('%s', 'now') * 1000),
    ('perm_clients_write', 'clients:write', 'app_clients', 'Create and update OAuth clients', 'clients', 'write', strftime('%s', 'now') * 1000),
    ('perm_clients_delete', 'clients:delete', 'app_clients', 'Delete OAuth clients', 'clients', 'delete', strftime('%s', 'now') * 1000),
    ('perm_clients_secrets_rotate', 'clients:secrets:rotate', 'app_clients', 'Rotate client secrets', 'secrets', 'rotate', strftime('%s', 'now') * 1000),
    ('perm_clients_tokens_revoke', 'clients:tokens:revoke', 'app_clients', 'Revoke client tokens', 'tokens', 'revoke', strftime('%s', 'now') * 1000);

-- API Access Permissions
INSERT OR IGNORE INTO rbac_permissions (id, name, app_id, description, resource, action, created_at)
VALUES
    ('perm_api_read', 'api:read', 'app_api', 'Read API resources', 'api', 'read', strftime('%s', 'now') * 1000),
    ('perm_api_write', 'api:write', 'app_api', 'Write API resources', 'api', 'write', strftime('%s', 'now') * 1000),
    ('perm_api_admin', 'api:admin', 'app_api', 'Full API administration', 'api', 'admin', strftime('%s', 'now') * 1000);

-- ============================================================================
-- SECTION 4: RBAC ROLES
-- ============================================================================

-- Super Admin Role (all permissions)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_super_admin',
    'Super Admin',
    'default',
    'Full system access with all permissions',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Admin Role (manage users and clients)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_admin',
    'Admin',
    'default',
    'Administrative access for user and client management',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- User Manager Role (manage users only)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_user_manager',
    'User Manager',
    'default',
    'Manage user accounts and roles',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Client Manager Role (manage OAuth clients)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_client_manager',
    'Client Manager',
    'default',
    'Manage OAuth clients and their configurations',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Auditor Role (read-only access to logs)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_auditor',
    'Auditor',
    'default',
    'Read-only access to audit logs and system information',
    1,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- API User Role (basic API access)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_api_user',
    'API User',
    'default',
    'Basic API read/write access',
    0,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Member Role (default user role)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_member',
    'Member',
    'default',
    'Standard member with basic access',
    0,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- Viewer Role (read-only)
INSERT OR IGNORE INTO rbac_roles (id, name, tenant_id, description, is_system_role, created_at, updated_at)
VALUES (
    'role_viewer',
    'Viewer',
    'default',
    'Read-only access to resources',
    0,
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
);

-- ============================================================================
-- SECTION 5: ROLE-PERMISSION MAPPINGS
-- ============================================================================

-- Super Admin: All permissions
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
SELECT 'role_super_admin', id, strftime('%s', 'now') * 1000, 'system'
FROM rbac_permissions;

-- Admin: User and client management
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
VALUES
    ('role_admin', 'perm_users_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_users_write', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_users_delete', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_users_roles_assign', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_users_roles_revoke', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_clients_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_clients_write', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_clients_delete', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_clients_secrets_rotate', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_platform_settings_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_admin', 'perm_platform_audit_read', strftime('%s', 'now') * 1000, 'system');

-- User Manager: User management only
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
VALUES
    ('role_user_manager', 'perm_users_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_user_manager', 'perm_users_write', strftime('%s', 'now') * 1000, 'system'),
    ('role_user_manager', 'perm_users_delete', strftime('%s', 'now') * 1000, 'system'),
    ('role_user_manager', 'perm_users_roles_assign', strftime('%s', 'now') * 1000, 'system'),
    ('role_user_manager', 'perm_users_roles_revoke', strftime('%s', 'now') * 1000, 'system');

-- Client Manager: Client management only
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
VALUES
    ('role_client_manager', 'perm_clients_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_client_manager', 'perm_clients_write', strftime('%s', 'now') * 1000, 'system'),
    ('role_client_manager', 'perm_clients_delete', strftime('%s', 'now') * 1000, 'system'),
    ('role_client_manager', 'perm_clients_secrets_rotate', strftime('%s', 'now') * 1000, 'system'),
    ('role_client_manager', 'perm_clients_tokens_revoke', strftime('%s', 'now') * 1000, 'system');

-- Auditor: Read-only audit access
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
VALUES
    ('role_auditor', 'perm_platform_audit_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_auditor', 'perm_platform_settings_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_auditor', 'perm_users_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_auditor', 'perm_clients_read', strftime('%s', 'now') * 1000, 'system');

-- API User: Basic API access
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
VALUES
    ('role_api_user', 'perm_api_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_api_user', 'perm_api_write', strftime('%s', 'now') * 1000, 'system');

-- Member: Basic read access
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
VALUES
    ('role_member', 'perm_users_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_member', 'perm_api_read', strftime('%s', 'now') * 1000, 'system');

-- Viewer: Read-only
INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id, granted_at, granted_by)
VALUES
    ('role_viewer', 'perm_users_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_viewer', 'perm_clients_read', strftime('%s', 'now') * 1000, 'system'),
    ('role_viewer', 'perm_api_read', strftime('%s', 'now') * 1000, 'system');

-- ============================================================================
-- SECTION 6: DEFAULT USERS (for development/testing)
-- ============================================================================
-- Note: In production, users should be created through the authentication flow.
-- These are placeholder entries for development environments.

-- System user (for automated operations)
INSERT OR IGNORE INTO rbac_user_roles (user_id, role_id, tenant_id, assigned_at, assigned_by)
VALUES (
    'user_system',
    'role_super_admin',
    'default',
    strftime('%s', 'now') * 1000,
    'system'
);

-- ============================================================================
-- VERIFICATION QUERIES (for testing - comment out in production)
-- ============================================================================
-- SELECT 'Clients:' AS entity, COUNT(*) AS count FROM oauth_clients
-- UNION ALL SELECT 'Apps:', COUNT(*) FROM rbac_apps
-- UNION ALL SELECT 'Permissions:', COUNT(*) FROM rbac_permissions
-- UNION ALL SELECT 'Roles:', COUNT(*) FROM rbac_roles
-- UNION ALL SELECT 'Role-Permissions:', COUNT(*) FROM rbac_role_permissions;
