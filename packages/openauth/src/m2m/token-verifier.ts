import { jwtVerify, type KeyLike, type JWTVerifyResult } from "jose"
import type { M2MTokenClaims } from "./types.js"

export interface VerifyM2MTokenOptions {
  /** The M2M access token to verify */
  token: string
  /** Public key for verification */
  publicKey: KeyLike | Uint8Array
  /** Expected issuer (iss claim) */
  issuer: string
  /** Optional expected audience (aud claim) */
  audience?: string
  /** Optional clock tolerance in seconds for exp/nbf checks */
  clockTolerance?: number
}

export interface VerifyM2MTokenResult {
  /** Whether the token is valid */
  valid: true
  /** The verified token claims */
  claims: M2MTokenClaims
  /** Client ID from the token */
  clientId: string
  /** Tenant ID if present */
  tenantId?: string
  /** Granted scopes as an array */
  scopes: string[]
  /** Token expiration timestamp (Unix seconds) */
  expiresAt: number
}

export interface VerifyM2MTokenError {
  valid: false
  error: string
  code:
    | "invalid_token"
    | "expired_token"
    | "invalid_issuer"
    | "invalid_audience"
    | "not_m2m_token"
    | "missing_claims"
}

export type VerifyM2MTokenResponse = VerifyM2MTokenResult | VerifyM2MTokenError

/**
 * Verify an M2M (machine-to-machine) access token
 *
 * @example
 * ```typescript
 * const result = await verifyM2MToken({
 *   token: accessToken,
 *   publicKey: await importSPKI(publicKeyPem, 'RS256'),
 *   issuer: 'https://auth.example.com',
 * })
 *
 * if (result.valid) {
 *   console.log('Client ID:', result.clientId)
 *   console.log('Scopes:', result.scopes)
 * } else {
 *   console.error('Token invalid:', result.error)
 * }
 * ```
 */
export async function verifyM2MToken(
  options: VerifyM2MTokenOptions,
): Promise<VerifyM2MTokenResponse> {
  try {
    const { payload } = await jwtVerify(options.token, options.publicKey, {
      issuer: options.issuer,
      audience: options.audience,
      clockTolerance: options.clockTolerance,
    })

    // Check if this is an M2M token
    const mode = (payload as any).mode
    if (mode !== "m2m") {
      return {
        valid: false,
        error: "Token is not an M2M token (mode claim is not 'm2m')",
        code: "not_m2m_token",
      }
    }

    // Validate required M2M claims
    const clientId = (payload as any).client_id
    if (!clientId) {
      return {
        valid: false,
        error: "Missing client_id claim",
        code: "missing_claims",
      }
    }

    const scope = (payload as any).scope
    if (typeof scope !== "string") {
      return {
        valid: false,
        error: "Missing or invalid scope claim",
        code: "missing_claims",
      }
    }

    if (!payload.sub) {
      return {
        valid: false,
        error: "Missing sub claim",
        code: "missing_claims",
      }
    }

    if (!payload.exp) {
      return {
        valid: false,
        error: "Missing exp claim",
        code: "missing_claims",
      }
    }

    const claims: M2MTokenClaims = {
      mode: "m2m",
      sub: payload.sub,
      client_id: clientId,
      scope: scope,
      exp: payload.exp,
      iat: payload.iat!,
      iss: payload.iss!,
      jti: (payload as any).jti || "",
      tenant_id: (payload as any).tenant_id,
    }

    return {
      valid: true,
      claims,
      clientId,
      tenantId: claims.tenant_id,
      scopes: scope.split(" ").filter(Boolean),
      expiresAt: payload.exp,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // Categorize the error
    if (message.includes("expired") || message.includes('"exp" claim')) {
      return {
        valid: false,
        error: "Token has expired",
        code: "expired_token",
      }
    }

    if (message.includes("issuer") || message.includes('"iss" claim')) {
      return {
        valid: false,
        error: "Invalid token issuer",
        code: "invalid_issuer",
      }
    }

    if (message.includes("audience") || message.includes('"aud" claim')) {
      return {
        valid: false,
        error: "Invalid token audience",
        code: "invalid_audience",
      }
    }

    return {
      valid: false,
      error: `Token verification failed: ${message}`,
      code: "invalid_token",
    }
  }
}

/**
 * Check if a token has a specific scope
 */
export function hasScope(scopes: string[], requiredScope: string): boolean {
  return scopes.includes(requiredScope)
}

/**
 * Check if a token has all required scopes
 */
export function hasAllScopes(
  scopes: string[],
  requiredScopes: string[],
): boolean {
  return requiredScopes.every((s) => scopes.includes(s))
}

/**
 * Check if a token has any of the required scopes
 */
export function hasAnyScope(
  scopes: string[],
  requiredScopes: string[],
): boolean {
  return requiredScopes.some((s) => scopes.includes(s))
}
