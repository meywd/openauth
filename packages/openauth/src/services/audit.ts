/**
 * Audit Service for OpenAuth
 *
 * Provides async, non-blocking audit logging for token events using Cloudflare D1.
 * All D1 writes are fire-and-forget to avoid blocking OAuth flows.
 *
 * @packageDocumentation
 */

import type { D1Database } from "@cloudflare/workers-types"

export interface TokenUsageEvent {
	token_id: string
	subject: string
	event_type: "generated" | "refreshed" | "revoked" | "reused"
	client_id?: string
	ip_address?: string
	user_agent?: string
	timestamp: number
	metadata?: Record<string, any>
}

export interface AuditServiceConfig {
	database: D1Database
	tableName?: string
}

export class AuditService {
	private db: D1Database
	private tableName: string

	constructor(config: AuditServiceConfig) {
		this.db = config.database
		this.tableName = config.tableName || "token_usage"
	}

	/**
	 * Log token usage event (async, non-blocking)
	 * Uses fire-and-forget pattern - errors are logged but not thrown
	 */
	async logTokenUsage(event: TokenUsageEvent): Promise<void> {
		try {
			// Async write - does not block OAuth flow
			await this.db
				.prepare(
					`
          INSERT INTO ${this.tableName}
          (token_id, subject, event_type, client_id, ip_address, user_agent, timestamp, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
				)
				.bind(
					event.token_id,
					event.subject,
					event.event_type,
					event.client_id || null,
					event.ip_address || null,
					event.user_agent || null,
					event.timestamp,
					event.metadata ? JSON.stringify(event.metadata) : null,
				)
				.run()
		} catch (error) {
			// Log error but don't fail the OAuth flow
			console.error("AuditService: Failed to log token usage:", error)
		}
	}

	/**
	 * Get token usage analytics for a subject
	 */
	async getTokenAnalytics(
		subject: string,
		limit = 100,
	): Promise<TokenUsageEvent[]> {
		try {
			const { results } = await this.db
				.prepare(
					`
          SELECT * FROM ${this.tableName}
          WHERE subject = ?
          ORDER BY timestamp DESC
          LIMIT ?
        `,
				)
				.bind(subject, limit)
				.all<TokenUsageEvent>()

			if (!results) return []

			return results.map((row) => ({
				...row,
				metadata: row.metadata ? JSON.parse(row.metadata as any) : undefined,
			}))
		} catch (error) {
			console.error("AuditService: Failed to get token analytics:", error)
			return []
		}
	}

	/**
	 * Get token family history (track refresh token chains)
	 */
	async getTokenFamily(tokenId: string, limit = 50): Promise<TokenUsageEvent[]> {
		try {
			const { results } = await this.db
				.prepare(
					`
          SELECT * FROM ${this.tableName}
          WHERE token_id = ?
          ORDER BY timestamp ASC
          LIMIT ?
        `,
				)
				.bind(tokenId, limit)
				.all<TokenUsageEvent>()

			if (!results) return []

			return results.map((row) => ({
				...row,
				metadata: row.metadata ? JSON.parse(row.metadata as any) : undefined,
			}))
		} catch (error) {
			console.error("AuditService: Failed to get token family:", error)
			return []
		}
	}

	/**
	 * Get audit logs with filters
	 */
	async getAuditLogs(options: {
		subject?: string
		event_type?: TokenUsageEvent["event_type"]
		client_id?: string
		start_timestamp?: number
		end_timestamp?: number
		limit?: number
		offset?: number
	}): Promise<TokenUsageEvent[]> {
		try {
			const conditions: string[] = []
			const bindings: any[] = []

			if (options.subject) {
				conditions.push("subject = ?")
				bindings.push(options.subject)
			}

			if (options.event_type) {
				conditions.push("event_type = ?")
				bindings.push(options.event_type)
			}

			if (options.client_id) {
				conditions.push("client_id = ?")
				bindings.push(options.client_id)
			}

			if (options.start_timestamp) {
				conditions.push("timestamp >= ?")
				bindings.push(options.start_timestamp)
			}

			if (options.end_timestamp) {
				conditions.push("timestamp <= ?")
				bindings.push(options.end_timestamp)
			}

			const whereClause =
				conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
			const limit = options.limit || 100
			const offset = options.offset || 0

			bindings.push(limit, offset)

			const { results } = await this.db
				.prepare(
					`
          SELECT * FROM ${this.tableName}
          ${whereClause}
          ORDER BY timestamp DESC
          LIMIT ? OFFSET ?
        `,
				)
				.bind(...bindings)
				.all<TokenUsageEvent>()

			if (!results) return []

			return results.map((row) => ({
				...row,
				metadata: row.metadata ? JSON.parse(row.metadata as any) : undefined,
			}))
		} catch (error) {
			console.error("AuditService: Failed to get audit logs:", error)
			return []
		}
	}

	/**
	 * Clean up old audit logs (for data retention policies)
	 */
	async cleanExpired(maxAgeSeconds: number): Promise<number> {
		try {
			const cutoffTimestamp = Date.now() - maxAgeSeconds * 1000

			const result = await this.db
				.prepare(`DELETE FROM ${this.tableName} WHERE timestamp < ?`)
				.bind(cutoffTimestamp)
				.run()

			return result.meta.changes || 0
		} catch (error) {
			console.error("AuditService: Failed to clean expired logs:", error)
			return 0
		}
	}
}
