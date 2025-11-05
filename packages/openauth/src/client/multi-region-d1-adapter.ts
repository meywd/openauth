/**
 * Multi-Region D1 Client Adapter for OpenAuth
 *
 * Provides globally distributed storage for OAuth client credentials using
 * multiple regional D1 instances with queue-based replication.
 *
 * Architecture:
 * - Reads: Always from local D1 (5ms latency)
 * - Writes: Local D1 + queue message for async replication
 * - Sync: Queue consumer replicates to all other regions (5-10s propagation)
 *
 * @packageDocumentation
 */

import type { D1Database, Queue } from "@cloudflare/workers-types"
import {
  withRetry,
  checkD1Result,
  D1NotFoundError,
  type RetryConfig,
} from "./d1-errors.js"
import {
  CircuitBreaker,
  CircuitBreakerError,
  type CircuitBreakerConfig,
} from "./circuit-breaker.js"
import { SQLValidator } from "../security/sql-validator.js"
import type { OAuthClient } from "./d1-adapter.js"

export type SyncOperation = "create" | "update" | "delete"

export interface ClientSyncMessage {
  operation: SyncOperation
  client_id: string
  data?: Omit<OAuthClient, "created_at" | "updated_at">
  updates?: Partial<Omit<OAuthClient, "client_id" | "created_at" | "updated_at">>
  timestamp: number
}

export interface MultiRegionD1Options {
  localDb: D1Database
  syncQueue?: Queue
  tableName?: string
  retryConfig?: Partial<RetryConfig>
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>
}

/**
 * Multi-region D1 adapter for OAuth client credentials
 *
 * Reads are always from local D1 for fast performance.
 * Writes go to local D1 immediately, then queue a sync message
 * for async replication to other regions.
 */
export class MultiRegionD1ClientAdapter {
  private db: D1Database
  private syncQueue?: Queue
  private tableName: string
  private retryConfig: Partial<RetryConfig>
  private circuitBreaker: CircuitBreaker

  constructor(options: MultiRegionD1Options) {
    this.db = options.localDb
    this.syncQueue = options.syncQueue
    this.tableName = SQLValidator.validateTableName(
      options.tableName || "oauth_clients",
    )
    this.retryConfig = options.retryConfig || {}
    this.circuitBreaker = new CircuitBreaker(
      "MultiRegionD1ClientAdapter",
      options.circuitBreakerConfig,
    )
  }

  /**
   * Get a client by ID (reads from LOCAL D1 only - fast!)
   */
  async getClient(clientId: string): Promise<OAuthClient | null> {
    return this.circuitBreaker
      .execute(() =>
        withRetry(
          `getClient(${clientId})`,
          async () => {
            const result = await this.db
              .prepare(`SELECT * FROM ${this.tableName} WHERE client_id = ?`)
              .bind(clientId)
              .first<OAuthClient>()

            if (!result) return null

            // Parse JSON fields
            return {
              ...result,
              redirect_uris: result.redirect_uris
                ? JSON.parse(result.redirect_uris as any)
                : undefined,
              grant_types: result.grant_types
                ? JSON.parse(result.grant_types as any)
                : undefined,
              scopes: result.scopes
                ? JSON.parse(result.scopes as any)
                : undefined,
            }
          },
          this.retryConfig,
        ),
      )
      .catch((error) => {
        if (
          error instanceof D1NotFoundError ||
          error instanceof CircuitBreakerError
        ) {
          return null
        }
        console.error(
          `MultiRegionD1: Failed to get client ${clientId}:`,
          error,
        )
        return null
      })
  }

  /**
   * Create a new client (writes to local D1 + queues sync)
   */
  async createClient(
    client: Omit<OAuthClient, "created_at" | "updated_at">,
  ): Promise<OAuthClient> {
    const now = Date.now()
    const fullClient = {
      ...client,
      created_at: now,
      updated_at: now,
    }

    return this.circuitBreaker.execute(async () => {
      // 1. Write to local D1 (fast, blocks response)
      await withRetry(
        `createClient(${client.client_id})`,
        async () => {
          const result = await this.db
            .prepare(
              `
              INSERT INTO ${this.tableName} (
                client_id, client_secret_hash, client_name,
                redirect_uris, grant_types, scopes,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .bind(
              client.client_id,
              client.client_secret_hash,
              client.client_name,
              client.redirect_uris
                ? JSON.stringify(client.redirect_uris)
                : null,
              client.grant_types ? JSON.stringify(client.grant_types) : null,
              client.scopes ? JSON.stringify(client.scopes) : null,
              now,
              now,
            )
            .run()

          checkD1Result(result, `createClient(${client.client_id})`)
        },
        this.retryConfig,
      )

      // 2. Queue sync to other regions (non-blocking)
      if (this.syncQueue) {
        try {
          await this.syncQueue.send({
            operation: "create" as SyncOperation,
            client_id: client.client_id,
            data: client,
            timestamp: now,
          })
        } catch (error) {
          // Log but don't fail the operation
          console.error(
            `MultiRegionD1: Failed to queue sync for ${client.client_id}:`,
            error,
          )
        }
      }

      return fullClient
    })
  }

  /**
   * Update an existing client
   */
  async updateClient(
    clientId: string,
    updates: Partial<
      Omit<OAuthClient, "client_id" | "created_at" | "updated_at">
    >,
  ): Promise<OAuthClient | null> {
    const now = Date.now()

    // Build update query dynamically
    const updateFields: string[] = []
    const values: any[] = []

    if (updates.client_secret_hash !== undefined) {
      updateFields.push("client_secret_hash = ?")
      values.push(updates.client_secret_hash)
    }
    if (updates.client_name !== undefined) {
      updateFields.push("client_name = ?")
      values.push(updates.client_name)
    }
    if (updates.redirect_uris !== undefined) {
      updateFields.push("redirect_uris = ?")
      values.push(JSON.stringify(updates.redirect_uris))
    }
    if (updates.grant_types !== undefined) {
      updateFields.push("grant_types = ?")
      values.push(JSON.stringify(updates.grant_types))
    }
    if (updates.scopes !== undefined) {
      updateFields.push("scopes = ?")
      values.push(JSON.stringify(updates.scopes))
    }

    if (updateFields.length === 0) {
      return this.getClient(clientId)
    }

    updateFields.push("updated_at = ?")
    values.push(now)
    values.push(clientId) // for WHERE clause

    return this.circuitBreaker.execute(async () => {
      // 1. Update local D1
      await withRetry(
        `updateClient(${clientId})`,
        async () => {
          const result = await this.db
            .prepare(
              `
              UPDATE ${this.tableName}
              SET ${updateFields.join(", ")}
              WHERE client_id = ?
            `,
            )
            .bind(...values)
            .run()

          try {
            checkD1Result(result, `updateClient(${clientId})`, true)
          } catch (error) {
            if (error instanceof D1NotFoundError) {
              return null
            }
            throw error
          }
        },
        this.retryConfig,
      )

      // 2. Queue sync to other regions
      if (this.syncQueue) {
        try {
          await this.syncQueue.send({
            operation: "update" as SyncOperation,
            client_id: clientId,
            updates,
            timestamp: now,
          })
        } catch (error) {
          console.error(
            `MultiRegionD1: Failed to queue update sync for ${clientId}:`,
            error,
          )
        }
      }

      return this.getClient(clientId)
    })
  }

  /**
   * Delete a client
   */
  async deleteClient(clientId: string): Promise<boolean> {
    return this.circuitBreaker
      .execute(async () => {
        // 1. Delete from local D1
        const deleted = await withRetry(
          `deleteClient(${clientId})`,
          async () => {
            const result = await this.db
              .prepare(`DELETE FROM ${this.tableName} WHERE client_id = ?`)
              .bind(clientId)
              .run()

            try {
              checkD1Result(result, `deleteClient(${clientId})`, true)
              return true
            } catch (error) {
              if (error instanceof D1NotFoundError) {
                return false
              }
              throw error
            }
          },
          this.retryConfig,
        )

        // 2. Queue sync to other regions
        if (this.syncQueue && deleted) {
          try {
            await this.syncQueue.send({
              operation: "delete" as SyncOperation,
              client_id: clientId,
              timestamp: Date.now(),
            })
          } catch (error) {
            console.error(
              `MultiRegionD1: Failed to queue delete sync for ${clientId}:`,
              error,
            )
          }
        }

        return deleted
      })
      .catch((error) => {
        if (error instanceof CircuitBreakerError) {
          return false
        }
        console.error(
          `MultiRegionD1: Failed to delete client ${clientId}:`,
          error,
        )
        return false
      })
  }

  /**
   * List all clients (with pagination)
   */
  async listClients(options?: {
    limit?: number
    offset?: number
  }): Promise<OAuthClient[]> {
    const limit = options?.limit || 100
    const offset = options?.offset || 0

    return this.circuitBreaker
      .execute(() =>
        withRetry(
          `listClients(limit=${limit}, offset=${offset})`,
          async () => {
            const result = await this.db
              .prepare(
                `
                SELECT * FROM ${this.tableName}
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
              `,
              )
              .bind(limit, offset)
              .all<OAuthClient>()

            if (!result.results) return []

            return result.results.map((client) => ({
              ...client,
              redirect_uris: client.redirect_uris
                ? JSON.parse(client.redirect_uris as any)
                : undefined,
              grant_types: client.grant_types
                ? JSON.parse(client.grant_types as any)
                : undefined,
              scopes: client.scopes
                ? JSON.parse(client.scopes as any)
                : undefined,
            }))
          },
          this.retryConfig,
        ),
      )
      .catch((error) => {
        if (error instanceof CircuitBreakerError) {
          return []
        }
        console.error("MultiRegionD1: Failed to list clients:", error)
        return []
      })
  }

  /**
   * Get circuit breaker statistics
   */
  getCircuitBreakerStats() {
    return this.circuitBreaker.getStats()
  }

  /**
   * Reset circuit breaker to closed state
   */
  resetCircuitBreaker() {
    this.circuitBreaker.reset()
  }
}

/**
 * Apply a sync message to a D1 database
 * Used by queue consumer to replicate changes across regions
 *
 * Uses INSERT OR REPLACE with timestamp-based conflict resolution (Last-Write-Wins)
 */
export async function applySyncMessage(
  db: D1Database,
  message: ClientSyncMessage,
  tableName = "oauth_clients",
): Promise<void> {
  const validatedTable = SQLValidator.validateTableName(tableName)

  switch (message.operation) {
    case "create":
      if (!message.data) {
        throw new Error("Create operation requires data")
      }

      // INSERT OR REPLACE with timestamp check (Last-Write-Wins)
      await db
        .prepare(
          `
          INSERT OR REPLACE INTO ${validatedTable} (
            client_id, client_secret_hash, client_name,
            redirect_uris, grant_types, scopes,
            created_at, updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM ${validatedTable}
            WHERE client_id = ? AND updated_at > ?
          )
        `,
        )
        .bind(
          message.client_id,
          message.data.client_secret_hash,
          message.data.client_name,
          message.data.redirect_uris
            ? JSON.stringify(message.data.redirect_uris)
            : null,
          message.data.grant_types
            ? JSON.stringify(message.data.grant_types)
            : null,
          message.data.scopes ? JSON.stringify(message.data.scopes) : null,
          message.timestamp,
          message.timestamp,
          message.client_id, // for WHERE EXISTS check
          message.timestamp, // for timestamp comparison
        )
        .run()
      break

    case "update":
      if (!message.updates) {
        throw new Error("Update operation requires updates")
      }

      const updateFields: string[] = []
      const values: any[] = []

      if (message.updates.client_secret_hash !== undefined) {
        updateFields.push("client_secret_hash = ?")
        values.push(message.updates.client_secret_hash)
      }
      if (message.updates.client_name !== undefined) {
        updateFields.push("client_name = ?")
        values.push(message.updates.client_name)
      }
      if (message.updates.redirect_uris !== undefined) {
        updateFields.push("redirect_uris = ?")
        values.push(JSON.stringify(message.updates.redirect_uris))
      }
      if (message.updates.grant_types !== undefined) {
        updateFields.push("grant_types = ?")
        values.push(JSON.stringify(message.updates.grant_types))
      }
      if (message.updates.scopes !== undefined) {
        updateFields.push("scopes = ?")
        values.push(JSON.stringify(message.updates.scopes))
      }

      if (updateFields.length > 0) {
        updateFields.push("updated_at = ?")
        values.push(message.timestamp)
        values.push(message.client_id)
        values.push(message.timestamp) // for timestamp check

        // Only update if newer than existing
        await db
          .prepare(
            `
            UPDATE ${validatedTable}
            SET ${updateFields.join(", ")}
            WHERE client_id = ?
              AND updated_at < ?
          `,
          )
          .bind(...values)
          .run()
      }
      break

    case "delete":
      // Only delete if not already updated by a newer operation
      await db
        .prepare(
          `
          DELETE FROM ${validatedTable}
          WHERE client_id = ?
            AND updated_at <= ?
        `,
        )
        .bind(message.client_id, message.timestamp)
        .run()
      break

    default:
      throw new Error(`Unknown sync operation: ${message.operation}`)
  }
}
