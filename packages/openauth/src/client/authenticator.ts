/**
 * Client Authenticator for OpenAuth
 *
 * Handles client credential validation for OAuth 2.0 client authentication.
 * Supports both confidential and public clients per RFC 6749.
 *
 * @packageDocumentation
 */

import { ClientD1Adapter } from "./client-d1-adapter.js"
import type { OAuthClient } from "./types.js"

export interface ClientAuthenticatorOptions {
  adapter: ClientD1Adapter
}

export class ClientAuthenticator {
  private adapter: ClientD1Adapter

  constructor(options: ClientAuthenticatorOptions) {
    this.adapter = options.adapter
  }

  /**
   * Validate client credentials
   *
   * Supports two client types per OAuth 2.0 spec:
   * - Confidential clients: Have client_secret_hash, require secret validation
   * - Public clients: No client_secret_hash, authenticate by client_id only
   */
  async validateClient(
    clientId: string,
    clientSecret?: string,
  ): Promise<{ valid: boolean; isPublicClient: boolean }> {
    try {
      // Get client from database (no tenant required for auth)
      const client = await this.adapter.getClientById(clientId)
      if (!client) {
        return { valid: false, isPublicClient: false }
      }

      // ============================================
      // PATH 1: PUBLIC CLIENT (no secret hash stored)
      // ============================================
      // Public clients (SPAs, mobile apps) cannot securely store secrets.
      // They authenticate by client_id only per RFC 7009.
      if (!client.client_secret_hash) {
        return { valid: true, isPublicClient: true }
      }

      // ============================================
      // PATH 2: CONFIDENTIAL CLIENT (has secret hash)
      // ============================================
      // Confidential clients MUST provide a valid secret.
      if (!clientSecret) {
        return { valid: false, isPublicClient: false }
      }

      // Use adapter's verifyCredentials which handles secret rotation grace period
      const verified = await this.adapter.verifyCredentials(
        clientId,
        clientSecret,
      )
      return { valid: verified !== null, isPublicClient: false }
    } catch (error) {
      console.error("ClientAuthenticator: Error validating client:", error)
      return { valid: false, isPublicClient: false }
    }
  }

  /**
   * Get client if credentials are valid
   *
   * Returns the client for:
   * - Public clients: When client_id exists (no secret needed)
   * - Confidential clients: When client_id + client_secret are valid
   */
  async authenticateClient(
    clientId: string,
    clientSecret?: string,
  ): Promise<{ client: OAuthClient | null; isPublicClient: boolean }> {
    const result = await this.validateClient(clientId, clientSecret)
    if (!result.valid) {
      return { client: null, isPublicClient: false }
    }

    const client = await this.adapter.getClientById(clientId)
    return { client, isPublicClient: result.isPublicClient }
  }
}
