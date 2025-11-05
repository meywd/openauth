# Storage Architecture Options for Global OAuth Server

**Date**: 2025-01-04
**Context**: Analyzing storage options for OpenAuth fork with enterprise features running on Cloudflare Workers globally

---

## The Core Requirements

### Hot Path (Critical Performance)
- **Token validation**: 1000s/second, <10ms latency globally
- **Client credential lookup**: Every /token request, <10ms latency
- **Token revocation check**: Every token validation, <10ms latency

### Cold Path (Acceptable Latency)
- **Client registration**: Rare (once per app), 100-500ms acceptable
- **Audit log writes**: Fire-and-forget, don't block OAuth flow
- **Admin queries**: Compliance/analytics, 1-5 seconds acceptable

### Data Characteristics
- **Access tokens**: Millions, short TTL (1-24h), read-heavy
- **Refresh tokens**: Millions, long TTL (30-90d), read-heavy
- **OAuth clients**: 10-1000, very low write frequency, read-heavy
- **Audit logs**: Millions+, write-only, query for analytics

---

## The Fundamental Problem: D1 is Regional, Workers are Global

```
Cloudflare Workers: 300+ edge locations worldwide
├── User in Tokyo → Worker in Tokyo
├── User in London → Worker in London
└── User in NYC → Worker in NYC

Cloudflare D1: Single region (e.g., us-east)
└── ALL workers globally → One D1 instance
    ├── Tokyo → us-east: 150ms latency
    ├── London → us-east: 80ms latency
    └── NYC → us-east: 5ms latency
```

**Impact**:
- Geographic latency variance (5-200ms)
- Single concurrency bottleneck (~100-200 connections)
- Single point of failure

---

## Option 1: Single-Region D1 (Initial Approach - REJECTED)

### Architecture
```
KV (Global):
└── Tokens (access, refresh, auth codes)

D1 (Regional - us-east):
├── oauth_clients (client credentials)
└── token_usage (audit trail)
```

### Problems Identified

#### 1.1 High Traffic Audit Logging
```typescript
// Every token operation writes to D1
async logTokenUsage(event: TokenUsageEvent) {
  await d1.prepare(`INSERT INTO token_usage ...`).run()
  // Tokyo Worker: 150ms write latency
  // 1000 req/sec × 150ms = massive backlog
}
```

**Issue**: D1 can't handle high-frequency writes from global traffic
- Concurrency limits (~100-200 connections)
- Cross-region latency kills performance
- Fire-and-forget helps but doesn't solve concurrency

#### 1.2 Client Lookup Latency
```typescript
// /token endpoint validates client
const client = await d1.getClient(clientId)
// Tokyo: 150ms, London: 80ms, NYC: 5ms
// Inconsistent user experience
```

**Issue**: Geographic latency variance makes UX unpredictable

### Verdict: ❌ **Rejected**
- Can't scale for audit logs (high traffic)
- Unacceptable latency variance for client lookups

---

## Option 2: All-KV Architecture

### Architecture
```
KV (Global):
├── Tokens: token:abc-123 → { userId, exp, scopes }
├── Clients: client:my-app → { secret_hash, redirect_uris }
├── Revocation: revoked:jti-abc → { revoked_at, reason }
└── Audit: audit:2024-01-15:uuid → { token_id, event, timestamp }
```

### Pros
✅ Global, fast (5ms everywhere)
✅ Simple architecture
✅ Automatic TTL for tokens
✅ No regional dependencies

### Cons
❌ **Can't query audit logs**
```typescript
// How do you run this query with KV?
// "Show all revocations for user-123 in January"

// You'd have to:
const allKeys = await env.KV.list({ prefix: 'audit:' })
// Could be millions of keys
for (const key of allKeys) {
  const event = await env.KV.get(key)
  if (event.subject === 'user-123' && event.event_type === 'revoked' ...) {
    // Filter in application code
  }
}
// Impractical at scale
```

❌ No analytics/reporting
❌ Manual cleanup (no SQL `DELETE WHERE timestamp < ?`)
❌ Can't do aggregations (COUNT, GROUP BY)

### Workaround
Use **Cloudflare Logpush** → send to external analytics:
- Axiom (real-time log analytics)
- Datadog (monitoring + analytics)
- S3 + Athena (serverless SQL)
- BigQuery (data warehouse)

### Verdict: ⚠️ **Acceptable with external analytics**
- Works if you're okay with external dependency for queries
- Pure Cloudflare solution needs better audit querying

---

## Option 3: KV + Durable Objects

### Architecture
```
KV (Global):
└── Tokens, clients (hot path)

Durable Objects:
└── Per-user audit aggregation
    class UserAuditLog {
      async logEvent(event)
      async getAuditLogs(filters)
    }
```

### Pros
✅ Global distribution
✅ Can do queries within Durable Object
✅ Per-user isolation
✅ Strongly consistent within object

### Cons
❌ **Latency**: 100-300ms to reach Durable Object
❌ **Cost**: $0.15 per million requests (adds up)
❌ **Complexity**: More moving parts
❌ **Cross-user queries**: Can't easily query across all users

### Example Cost
```
1M token operations/day
= 1M Durable Object writes
= $0.15/day = $4.50/month (just for audit)
Plus storage costs
```

### Verdict: ⚠️ **Too expensive and complex for audit logging**
- Better for other use cases (websockets, real-time coordination)
- Overkill for audit trail

---

## Option 4: KV + External Global Database

### Architecture
```
KV (Global):
└── Tokens (hot path)

PlanetScale / Neon / CockroachDB:
├── oauth_clients
└── token_usage
```

### Pros
✅ Real SQL queries
✅ Global availability (read replicas)
✅ Proven at scale
✅ Full feature set (transactions, indexes, joins)

### Cons
❌ **External dependency** (not Cloudflare-native)
❌ **Additional cost** ($29-99+/month)
❌ **Network hop** from Workers to external DB
❌ **Vendor lock-in** to DB provider

### Example Services
- **PlanetScale**: Global MySQL, serverless, $29+/month
- **Neon**: Global Postgres, serverless, $19+/month
- **CockroachDB**: Distributed SQL, self-hosted or cloud

### Verdict: ✅ **Best for production if budget allows**
- Most complete feature set
- Battle-tested reliability
- Worth it for serious production use

---

## Option 5: Dual-Indexing in KV/R2 (User Suggested)

### Architecture
```
Per-token storage:
└── tokens/abc-123.json → { userId, exp, scopes }

Per-user index:
└── users/user-123/tokens.json → { access: [...], refresh: [...] }
```

### Problems

#### 5.1 Race Conditions (No Atomic Updates)
```typescript
// Phone and desktop login simultaneously
const userTokens = await storage.get('users/user-123/tokens.json')
const data = JSON.parse(userTokens)
data.access.push('token-from-phone')
await storage.put('users/user-123/tokens.json', data)

// MEANWHILE: desktop does the same
// ❌ Last write wins - one token lost
```

#### 5.2 No Automatic Expiration (KV/R2)
```typescript
// Token expires but remains in storage
const token = await storage.get('tokens/abc-123.json')
// ✅ Token exists
// Must manually check: if (Date.now() > token.expiresAt)

// Cleanup requires background jobs
```

#### 5.3 Index Consistency
```typescript
// Write token
await storage.put('tokens/abc-123.json', data) // ✅ Succeeds
await storage.put('users/user-123/tokens.json', index) // ❌ Fails
// Orphaned token - exists but can't be revoked
```

#### 5.4 Still Can't Query Audit Logs
Same problem as Option 2 - no SQL means no complex queries

### Verdict: ❌ **Doesn't solve core problems**
- Race conditions at scale
- Consistency issues without transactions
- Still need external analytics for queries

---

## Option 6: Multiple D1 Instances (User Insight!)

### User's Key Insight
> "For clients you need to sync all DBs, and connect only to closest"

**Client credentials** have perfect profile for multi-region:
- **Write frequency**: Very low (10-100/day)
- **Read frequency**: High (1000s/second)
- **Data size**: Small (<10MB total)
- **Tolerance**: Eventual consistency OK (5-10 seconds)

### Architecture

```
OAuth Clients (multi-region D1):
├── US D1    ← US Workers (5ms reads)
├── EU D1    ← EU Workers (5ms reads)
└── APAC D1  ← APAC Workers (5ms reads)
    └── Cloudflare Queue syncs changes (eventual consistency)

Audit Logs (NOT D1):
└── Analytics Engine (global, queryable)

Tokens (KV):
└── Global fast lookups
```

### Implementation
```typescript
export class MultiRegionD1ClientAdapter {
  private localDb: D1Database
  private syncQueue: Queue

  // READ: Local D1 only (5ms)
  async getClient(clientId: string) {
    return this.localDb
      .prepare(`SELECT * FROM oauth_clients WHERE client_id = ?`)
      .bind(clientId)
      .first()
  }

  // WRITE: Local D1 + queue sync
  async createClient(client: OAuthClient) {
    // 1. Write to local D1 (fast)
    await this.localDb.prepare(`INSERT INTO oauth_clients ...`).run()

    // 2. Queue async replication (non-blocking)
    await this.syncQueue.send({
      operation: 'create',
      table: 'oauth_clients',
      data: client,
      timestamp: Date.now()
    })

    return client
  }
}

// Background queue consumer
async function syncToAllRegions(batch: MessageBatch) {
  for (const msg of batch.messages) {
    // Replicate to all other regions
    await Promise.allSettled([
      usD1.prepare(`INSERT OR REPLACE ...`).run(),
      euD1.prepare(`INSERT OR REPLACE ...`).run(),
      apacD1.prepare(`INSERT OR REPLACE ...`).run(),
    ])
  }
}
```

### Conflict Resolution
```sql
-- Last-Write-Wins using updated_at timestamp
INSERT OR REPLACE INTO oauth_clients (...)
VALUES (...)
WHERE NOT EXISTS (
  SELECT 1 FROM oauth_clients
  WHERE client_id = ? AND updated_at > ?
)
```

### Pros
✅ **Fast reads**: 5ms from local D1
✅ **Fast writes**: Write locally, return immediately
✅ **Eventual consistency**: Sync within 5-10 seconds
✅ **Low cost**: Client changes are rare
✅ **Cloudflare native**: No external dependencies
✅ **Resilient**: No single point of failure

### Cons
⚠️ **Eventual consistency** (5-10 seconds)
- New client won't be available globally instantly
- Acceptable because client registration is manual

⚠️ **Rare conflicts**
- If same client modified in two regions simultaneously
- Last-Write-Wins resolution using timestamps

⚠️ **Sync complexity**
- Need Queue consumer for replication
- More complex than single-region

### Why Eventual Consistency is OK
```
10:00:00 - Admin registers "my-mobile-app" in US
10:00:01 - Written to US D1, response to admin
10:00:02 - Queue message sent to sync worker
10:00:05 - Replicated to EU and APAC D1
10:00:10 - User in Tokyo uses app → Works! ✅

Propagation: 5-10 seconds
Typical registration-to-use: Minutes to hours
```

### Verdict: ✅ **RECOMMENDED for OAuth clients**
- Perfect fit for read-heavy, low-write data
- All reads are local (5ms globally)
- Cloudflare-native solution

---

## Option 7: Analytics Engine (RECONSIDERED)

### What is Analytics Engine?

Cloudflare's time-series database for logging high-volume events from Workers.

**Data Model** (Very Limited):
```typescript
env.ANALYTICS.writeDataPoint({
  blobs: ['string1', 'string2'],   // Max 20 strings
  doubles: [123.45, 678.90],       // Max 20 numbers
  indexes: ['filter-key']          // MAX 1 INDEX only!
})
```

**Query via GraphQL** (not SQL):
```graphql
query {
  data(filter: { index1: { eq: "user-123" } })  # Can ONLY filter by the ONE index
}
```

### Critical Limitations Discovered

❌ **Only ONE filterable index**:
```typescript
// If index is user_id, you can query:
"Show all events for user-123" ✅

// But you CANNOT efficiently query:
"Show all revoked tokens across all users" ❌
// Would require scanning ALL events
```

❌ **No complex types**: Only strings and numbers, no objects/arrays
❌ **GraphQL only**: No SQL, different query language
❌ **Limited filtering**: Can't filter by non-indexed blobs efficiently

### Actual Audit Log Volume Reality Check

```
Typical OAuth server:
├── 10,000 users
├── 5 token operations/user/day
└── Total: 50,000 writes/day = 0.5 writes/second

Peak traffic (10x):
└── 5 writes/second

D1 can easily handle this!
├── 100-200 concurrent connections (plenty)
├── Sub-millisecond writes (when local)
└── Millions of rows (years of audit logs)
```

**Analytics Engine is overkill** for this volume.

### Verdict: ❌ **NOT RECOMMENDED - Use multi-region D1 instead**
- Overly complex for actual traffic volume
- Limited querying capabilities (one index only)
- D1 handles this volume easily with full SQL

---

## Final Recommended Architecture (REVISED)

### The Winning Combination: Multi-Region D1 for Everything

```
┌─────────────────────────────────────────────────┐
│ Cloudflare Workers (Global Edge)               │
├─────────────────────────────────────────────────┤
│                                                 │
│ KV (Global, 5ms) ──────────────────────────────│
│  ├── Access tokens: token:abc → {...}          │
│  ├── Refresh tokens: refresh:xyz → {...}       │
│  ├── Auth codes: code:123 → {...}              │
│  └── Revocation: revoked:jti-abc → {...}       │
│     └── With automatic TTL expiration          │
│                                                 │
│ Multi-Region D1 ───────────────────────────────│
│  ├── US D1 ← US Workers (5ms)                  │
│  │   ├── oauth_clients (synced globally)       │
│  │   └── token_usage (regional only)           │
│  │                                              │
│  ├── EU D1 ← EU Workers (5ms)                  │
│  │   ├── oauth_clients (synced globally)       │
│  │   └── token_usage (regional only)           │
│  │                                              │
│  └── APAC D1 ← APAC Workers (5ms)              │
│      ├── oauth_clients (synced globally)       │
│      └── token_usage (regional only)           │
│                                                 │
│  Sync Strategy:                                │
│  ├── oauth_clients: Queue-based replication    │
│  └── token_usage: No sync (regional logs)      │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Data Flow

**Token Validation (Hot Path)**:
```
1. Request → Worker (any region)
2. KV lookup: token:abc-123 → 5ms
3. Check revocation: revoked:jti-abc → 5ms
4. Response → User
Total: ~10ms globally
```

**Client Lookup (Hot Path)**:
```
1. /token request → Worker (any region)
2. D1 lookup: SELECT * FROM oauth_clients → 5ms (local)
3. Validate credentials
4. Generate tokens → KV writes
Total: ~15ms globally
```

**Client Registration (Cold Path)**:
```
1. Admin creates client → Worker in US
2. Write to local D1 (US) → 5ms
3. Queue sync message → 1ms
4. Return to admin → 10ms total
5. Background: Sync to EU/APAC D1 → 5-10 seconds
```

**Audit Logging (Fire-and-Forget)**:
```
1. Token operation → Worker (any region)
2. Local D1 write → Fire-and-forget, 0ms blocking
3. Admin query later → Query all regions, merge results
   - US D1 query: 50ms
   - EU D1 query: 50ms
   - APAC D1 query: 50ms
   - Merge + sort: 10ms
   Total: ~200ms (acceptable for admin queries)
```

### Why This Works

✅ **Hot paths are fast**: KV + local D1 = 5-10ms globally
✅ **Scales globally**: No regional bottlenecks
✅ **Real SQL queries**: Full D1 SQL capabilities for audit logs
✅ **Cost-effective**: ~$5-10/month at scale (just D1 + KV + Queues)
✅ **Cloudflare-native**: No external dependencies
✅ **Resilient**: No single points of failure
✅ **Simple**: No GraphQL learning curve, no external services

### Trade-offs Accepted

⚠️ **Client eventual consistency**: 5-10 seconds
- Acceptable: Registration is manual, not time-critical
- Users don't use new clients immediately after registration

⚠️ **Regional audit logs**: Not globally replicated
- Acceptable: Admin queries merge from all regions (200ms total)
- Fire-and-forget writes don't block OAuth flow
- Compliance queries are infrequent

⚠️ **Queue complexity**: Need sync worker for clients
- Acceptable: Well-documented Cloudflare pattern
- Only syncs low-volume client data, not audit logs

---

## Decision Matrix

| Criterion | Single D1 | All-KV | External DB | Multi-Region D1 |
|-----------|-----------|---------|-------------|-----------------|
| **Global Performance** | ❌ Poor | ✅ Excellent | ✅ Good | ✅ Excellent |
| **Audit Queries** | ✅ SQL | ❌ None | ✅ SQL | ✅ SQL (merge) |
| **Cost** | ✅ Low | ✅ Low | ❌ High ($29+) | ✅ Low (~$5-10) |
| **Complexity** | ✅ Simple | ✅ Simple | ⚠️ External | ⚠️ Queues |
| **Cloudflare Native** | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| **Scale** | ❌ Limited | ✅ Unlimited | ✅ High | ✅ High |
| **Query Flexibility** | ✅ Full SQL | ❌ None | ✅ Full SQL | ✅ Full SQL |

**Winner**: Multi-Region D1 (Option 6) - Simpler than Analytics Engine, full SQL power

---

## Implementation Priority

1. **Phase 1**: KV for all tokens ✅ (already working)
2. **Phase 2**: Single-region D1 for clients + audit (current PR - works, but has latency)
3. **Phase 3**: Multi-region D1 for clients (Queue-based sync)
4. **Phase 4**: Regional audit logs (already in current PR, just don't sync)
5. **Phase 5**: Admin dashboard with multi-region query merge

### Current PR Status

The current PR (#306) implements **single-region D1**:
- ✅ Works correctly
- ✅ Security hardened (SQL injection prevention)
- ✅ Circuit breaker + retry logic
- ⚠️ Geographic latency variance (acceptable for MVP)

**Recommendation**:
- **Merge current PR as-is** - It's production-ready for single-region or low-traffic
- **Phase 3 (multi-region)** can be added incrementally without breaking changes
- The `D1ClientAdapter` interface remains the same, just add `MultiRegionD1ClientAdapter` later

---

## References

- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/)
- [Cloudflare KV Documentation](https://developers.cloudflare.com/kv/)
- [Cloudflare Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- Current PR: #306 "Add enterprise features for OAuth 2.0 server"
