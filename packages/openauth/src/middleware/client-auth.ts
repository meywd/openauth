/**
 * Client Authentication Middleware for OpenAuth
 *
 * Validates client credentials from Authorization header or request body.
 * Follows OAuth 2.0 client authentication specification.
 *
 * @packageDocumentation
 */

import type { Context, Next } from "hono"
import { ClientAuthenticator } from "../client/authenticator.js"
import type { OAuthClient } from "../client/d1-adapter.js"

export interface ClientAuthMiddlewareOptions {
	authenticator: ClientAuthenticator
	/**
	 * Whether to allow unauthenticated requests to pass through
	 * @default false
	 */
	optional?: boolean
	/**
	 * Custom error response handler
	 */
	onError?: (
		ctx: Context,
		error: ClientAuthError,
	) => Response | Promise<Response>
}

export class ClientAuthError extends Error {
	constructor(
		public code: string,
		message: string,
		public status: number = 401,
	) {
		super(message)
		this.name = "ClientAuthError"
	}
}

/**
 * Extract client credentials from request
 */
function extractCredentials(ctx: Context): {
	clientId: string
	clientSecret: string
} | null {
	// Try Authorization header first (OAuth 2.0 standard)
	const authHeader = ctx.req.header("Authorization")
	if (authHeader) {
		const [type, credentials] = authHeader.split(" ")

		if (type === "Basic" && credentials) {
			try {
				// Decode base64
				const decoded = atob(credentials)
				const [clientId, clientSecret] = decoded.split(":")

				if (clientId && clientSecret) {
					return { clientId, clientSecret }
				}
			} catch (error) {
				console.error("Failed to decode Basic auth:", error)
			}
		}
	}

	// Try request body (form data or JSON)
	const contentType = ctx.req.header("Content-Type")

	if (contentType?.includes("application/x-www-form-urlencoded")) {
		// Form data - will be parsed by Hono
		return null // Let the form parsing happen in the middleware
	}

	if (contentType?.includes("application/json")) {
		// JSON body - will be parsed by Hono
		return null // Let the JSON parsing happen in the middleware
	}

	return null
}

/**
 * Create client authentication middleware
 */
export function clientAuth(options: ClientAuthMiddlewareOptions) {
	const { authenticator, optional = false, onError } = options

	return async function clientAuthMiddleware(ctx: Context, next: Next) {
		let clientId: string | undefined
		let clientSecret: string | undefined
		let authenticated = false
		let client: OAuthClient | null = null

		try {
			// Try to extract from Authorization header
			const headerCreds = extractCredentials(ctx)
			if (headerCreds) {
				clientId = headerCreds.clientId
				clientSecret = headerCreds.clientSecret
			} else {
				// Try to extract from request body
				const contentType = ctx.req.header("Content-Type")

				if (contentType?.includes("application/x-www-form-urlencoded")) {
					const formData = await ctx.req.formData()
					clientId = formData.get("client_id")?.toString()
					clientSecret = formData.get("client_secret")?.toString()

					// Store formData for later use in the route handler
					ctx.set("formData", formData)
				} else if (contentType?.includes("application/json")) {
					const body = await ctx.req.json()
					clientId = body.client_id
					clientSecret = body.client_secret

					// Store body for later use in the route handler
					ctx.set("jsonBody", body)
				}
			}

			// Validate credentials if provided
			if (clientId && clientSecret) {
				client = await authenticator.authenticateClient(clientId, clientSecret)
				authenticated = client !== null

				if (!authenticated && !optional) {
					throw new ClientAuthError(
						"invalid_client",
						"Client authentication failed",
						401,
					)
				}
			} else if (!optional) {
				throw new ClientAuthError(
					"invalid_request",
					"Missing client credentials",
					400,
				)
			}

			// Set context variables
			ctx.set("clientId", clientId)
			ctx.set("clientAuthenticated", authenticated)
			ctx.set("client", client)

			// Continue to next handler
			await next()
		} catch (error) {
			if (error instanceof ClientAuthError) {
				if (onError) {
					return onError(ctx, error)
				}

				// Default error response (OAuth 2.0 format)
				return ctx.json(
					{
						error: error.code,
						error_description: error.message,
					},
					error.status,
				)
			}

			// Unexpected error
			console.error("ClientAuthMiddleware: Unexpected error:", error)
			return ctx.json(
				{
					error: "server_error",
					error_description: "Internal server error",
				},
				500,
			)
		}
	}
}

/**
 * Helper middleware for routes that require authenticated clients
 */
export function requireClientAuth(
	options: Omit<ClientAuthMiddlewareOptions, "optional">,
) {
	return clientAuth({ ...options, optional: false })
}

/**
 * Helper middleware for routes where client auth is optional
 */
export function optionalClientAuth(
	options: Omit<ClientAuthMiddlewareOptions, "optional">,
) {
	return clientAuth({ ...options, optional: true })
}

// Type augmentation for Hono context
declare module "hono" {
	interface ContextVariableMap {
		clientId?: string
		clientAuthenticated: boolean
		client?: OAuthClient | null
		formData?: FormData
		jsonBody?: any
	}
}
