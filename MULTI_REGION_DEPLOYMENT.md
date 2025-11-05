# Multi-Region D1 Deployment Guide

This guide explains how to deploy OpenAuth with multi-region D1 for global performance.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│ Cloudflare Workers (Global Edge)               │
├─────────────────────────────────────────────────┤
│                                                 │
│ KV (Global, 5ms) ──────────────────────────────│
│  └── Tokens, sessions (automatic replication)  │
│                                                 │
│ Multi-Region D1 ───────────────────────────────│
│  ├── US D1 ← US Workers (5ms)                  │
│  │   ├── oauth_clients (synced)                │
│  │   └── token_usage (regional)                │
│  │                                              │
│  ├── EU D1 ← EU Workers (5ms)                  │
│  │   ├── oauth_clients (synced)                │
│  │   └── token_usage (regional)                │
│  │                                              │
│  └── APAC D1 ← APAC Workers (5ms)              │
│      ├── oauth_clients (synced)                │
│      └── token_usage (regional)                │
│                                                 │
│  Queue: client-sync                            │
│  └── Replicates client changes (5-10s)         │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Step 1: Create Regional D1 Databases

```bash
# Create D1 database in US region
wrangler d1 create openauth-us --location=us-east

# Create D1 database in EU region
wrangler d1 create openauth-eu --location=eu-west

# Create D1 database in APAC region
wrangler d1 create openauth-apac --location=apac
```

Save the database IDs from output.

## Step 2: Run Migrations on All Databases

```bash
# Apply schema to US database
wrangler d1 execute openauth-us --file=./migrations/0001_create_oauth_clients.sql
wrangler d1 execute openauth-us --file=./migrations/0002_create_token_usage.sql

# Apply schema to EU database
wrangler d1 execute openauth-eu --file=./migrations/0001_create_oauth_clients.sql
wrangler d1 execute openauth-eu --file=./migrations/0002_create_token_usage.sql

# Apply schema to APAC database
wrangler d1 execute openauth-apac --file=./migrations/0001_create_oauth_clients.sql
wrangler d1 execute openauth-apac --file=./migrations/0002_create_token_usage.sql
```

## Step 3: Create Queue for Client Sync

```bash
wrangler queues create client-sync
```

## Step 4: Configure wrangler.toml

```toml
name = "openauth-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# KV for tokens (automatic global replication)
[[kv_namespaces]]
binding = "KV"
id = "your-kv-id"

# Regional D1 databases
[[d1_databases]]
binding = "DB_LOCAL"  # Cloudflare routes to nearest region automatically
database_id = "openauth-us-id"      # Primary/default region

[[d1_databases]]
binding = "DB_US"
database_id = "openauth-us-id"

[[d1_databases]]
binding = "DB_EU"
database_id = "openauth-eu-id"

[[d1_databases]]
binding = "DB_APAC"
database_id = "openauth-apac-id"

# Queue for client sync
[[queues.producers]]
binding = "CLIENT_SYNC_QUEUE"
queue = "client-sync"

[[queues.consumers]]
queue = "client-sync"
max_batch_size = 10
max_batch_timeout = 5  # Sync within 5 seconds
max_retries = 3
dead_letter_queue = "client-sync-dlq"
```

## Step 5: Implement in Your Worker

### Main Worker (OAuth Server)

```typescript
import { issuer } from "@openauthjs/openauth/issuer"
import { MultiRegionD1ClientAdapter } from "@openauthjs/openauth/client/multi-region-d1-adapter"
import { AuditService } from "@openauthjs/openauth/services/audit"
import { MemoryStorage } from "@openauthjs/openauth/storage/memory"

export interface Env {
  KV: KVNamespace
  DB_LOCAL: D1Database     // Auto-routed to nearest region
  CLIENT_SYNC_QUEUE: Queue
}

export default {
  async fetch(request: Request, env: Env) {
    // Client adapter with multi-region sync
    const clientAdapter = new MultiRegionD1ClientAdapter({
      localDb: env.DB_LOCAL,
      syncQueue: env.CLIENT_SYNC_QUEUE,
    })

    // Audit service (regional, no sync)
    const auditService = new AuditService({
      database: env.DB_LOCAL,
    })

    // Token storage (KV, automatic global replication)
    const storage = new MemoryStorage() // Or KV-based storage

    const app = issuer({
      subjects: {
        // Your subjects...
      },
      providers: {
        // Your providers...
      },
      storage,
      success: async (ctx, value) => {
        // Log token generation
        await auditService.logTokenUsage({
          token_id: crypto.randomUUID(),
          subject: value.subject,
          event_type: "generated",
          client_id: value.clientID,
          timestamp: Date.now(),
        })

        return ctx.subject("user", {
          userID: value.claims.email,
        })
      },
    })

    return app.fetch(request, env)
  },

  // Queue consumer for client sync
  async queue(batch: MessageBatch, env: Env) {
    const { processClientSyncBatch } = await import(
      "@openauthjs/openauth/client/sync-consumer"
    )

    await processClientSyncBatch(batch, env)
  },
}
```

### Admin Dashboard (Query All Regions)

```typescript
import { queryMultiRegionAuditLogs, getMultiRegionStatistics } from "@openauthjs/openauth/services/multi-region-audit"

export async function getAuditLogs(env: Env, subject: string) {
  const regions = [
    { name: "US", database: env.DB_US },
    { name: "EU", database: env.DB_EU },
    { name: "APAC", database: env.DB_APAC },
  ]

  // Query all regions in parallel (200ms total)
  const logs = await queryMultiRegionAuditLogs(regions, {
    subject,
    limit: 100,
  })

  return logs
}

export async function getStatistics(env: Env) {
  const regions = [
    { name: "US", database: env.DB_US },
    { name: "EU", database: env.DB_EU },
    { name: "APAC", database: env.DB_APAC },
  ]

  const stats = await getMultiRegionStatistics(regions, {
    start_timestamp: Date.now() - 30 * 24 * 60 * 60 * 1000, // Last 30 days
  })

  return stats
}
```

## Step 6: Deploy

```bash
# Deploy worker with queue consumer
wrangler deploy

# Verify queue is working
wrangler queues list
```

## How It Works

### Client Registration Flow
```
1. Admin registers client in EU
2. Write to EU D1 (local, 5ms)
3. Queue sync message
4. Return success to admin (10ms total)
5. Background: Queue consumer replicates to US/APAC (5-10s)
```

### Token Validation Flow
```
1. User in Tokyo sends request
2. Tokyo worker queries APAC D1 (local, 5ms)
3. Client credentials found
4. Generate token, store in KV
5. Response (15ms total)
```

### Audit Query Flow (Admin)
```
1. Admin queries for user-123 logs
2. Query US D1: 50ms
3. Query EU D1: 50ms (parallel)
4. Query APAC D1: 50ms (parallel)
5. Merge + sort: 10ms
6. Return results (200ms total)
```

## Monitoring

### Check Sync Queue Health
```bash
# View queue metrics
wrangler queues consumer <queue-name>

# Check dead letter queue for failures
wrangler queues consumer client-sync-dlq
```

### Verify Replication
```bash
# Check client exists in all regions
wrangler d1 execute openauth-us --command="SELECT * FROM oauth_clients WHERE client_id='my-app'"
wrangler d1 execute openauth-eu --command="SELECT * FROM oauth_clients WHERE client_id='my-app'"
wrangler d1 execute openauth-apac --command="SELECT * FROM oauth_clients WHERE client_id='my-app'"
```

## Troubleshooting

### Sync Not Working?

1. **Check queue bindings**:
   ```bash
   wrangler queues list
   ```

2. **Check worker logs**:
   ```bash
   wrangler tail
   ```

3. **Inspect dead letter queue**:
   ```bash
   wrangler queues consumer client-sync-dlq --count=10
   ```

### Clients Not Found After Registration?

- **Eventual consistency**: Wait 5-10 seconds for sync to complete
- **Check local region**: Client should be immediately available in registration region
- **Verify timestamps**: Newer writes override older ones (Last-Write-Wins)

### High Latency in Some Regions?

- **Check which D1 is being used**: `DB_LOCAL` should auto-route to nearest
- **Verify regional databases exist**: All regions should have D1 instances
- **Monitor circuit breaker**: Use `adapter.getCircuitBreakerStats()`

## Cost Estimation

### Example: 10,000 users, 50,000 token ops/day

**D1 Costs**:
- 3 databases (US, EU, APAC)
- 50,000 writes/day (audit logs, split across regions)
- ~100 writes/day (client changes)
- Cost: ~$0 (within free tier: 5M reads, 100K writes/day)

**Queue Costs**:
- 100 messages/day (client sync)
- Cost: ~$0 (within free tier: 1M requests/month)

**KV Costs**:
- Token storage
- Cost: ~$5/month (standard KV pricing)

**Total: ~$5-10/month** (mostly KV storage)

## Migration from Single-Region

If you're currently using single-region D1:

1. Keep existing `D1ClientAdapter` as fallback
2. Create `MultiRegionD1ClientAdapter` alongside it
3. Gradually migrate clients to multi-region
4. No breaking changes to OAuth flow

```typescript
// Feature flag for gradual rollout
const useMultiRegion = env.ENABLE_MULTI_REGION === "true"

const clientAdapter = useMultiRegion
  ? new MultiRegionD1ClientAdapter({ localDb: env.DB_LOCAL, syncQueue: env.QUEUE })
  : new D1ClientAdapter({ database: env.DB_LOCAL })
```

## Best Practices

1. **Client registration**: Prefer one region for consistency (e.g., always US)
2. **Monitoring**: Set up alerts on queue consumer failures
3. **Dead letter queue**: Review failed syncs weekly
4. **Timestamps**: Use server time, not client time
5. **Conflict resolution**: Last-Write-Wins is acceptable for OAuth clients

## Next Steps

- [ ] Set up monitoring dashboard
- [ ] Configure alerts for sync failures
- [ ] Test failover scenarios
- [ ] Document region selection strategy
- [ ] Plan capacity for growth
