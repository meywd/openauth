import { describe, test, expect, beforeAll } from "bun:test"
import { generateKeyPair, exportSPKI, importSPKI, SignJWT } from "jose"
import {
  verifyM2MToken,
  hasScope,
  hasAllScopes,
  hasAnyScope,
} from "./token-verifier.js"
import { generateM2MToken } from "./token-generator.js"

describe("verifyM2MToken", () => {
  let keyPair: { privateKey: CryptoKey; publicKey: CryptoKey }

  beforeAll(async () => {
    keyPair = await generateKeyPair("RS256")
  })

  test("verifies valid M2M token", async () => {
    const { access_token } = await generateM2MToken({
      clientId: "test-client",
      scopes: ["read", "write"],
      issuer: "https://auth.example.com",
      signingKey: {
        private: keyPair.privateKey,
        alg: "RS256",
        id: "key-1",
      },
    })

    const result = await verifyM2MToken({
      token: access_token,
      publicKey: keyPair.publicKey,
      issuer: "https://auth.example.com",
    })

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.clientId).toBe("test-client")
      expect(result.scopes).toEqual(["read", "write"])
      expect(result.claims.mode).toBe("m2m")
    }
  })

  test("verifies token with tenant_id", async () => {
    const { access_token } = await generateM2MToken({
      clientId: "test-client",
      tenantId: "tenant-123",
      scopes: ["api:read"],
      issuer: "https://auth.example.com",
      signingKey: {
        private: keyPair.privateKey,
        alg: "RS256",
        id: "key-1",
      },
    })

    const result = await verifyM2MToken({
      token: access_token,
      publicKey: keyPair.publicKey,
      issuer: "https://auth.example.com",
    })

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.tenantId).toBe("tenant-123")
    }
  })

  test("rejects token with wrong issuer", async () => {
    const { access_token } = await generateM2MToken({
      clientId: "test-client",
      scopes: ["read"],
      issuer: "https://auth.example.com",
      signingKey: {
        private: keyPair.privateKey,
        alg: "RS256",
        id: "key-1",
      },
    })

    const result = await verifyM2MToken({
      token: access_token,
      publicKey: keyPair.publicKey,
      issuer: "https://wrong.example.com",
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.code).toBe("invalid_issuer")
    }
  })

  test("rejects expired token", async () => {
    // Create an already-expired token
    const expiredToken = await new SignJWT({
      mode: "m2m",
      sub: "test-client",
      client_id: "test-client",
      scope: "read",
      iss: "https://auth.example.com",
      jti: crypto.randomUUID(),
    })
      .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "JWT" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(keyPair.privateKey)

    const result = await verifyM2MToken({
      token: expiredToken,
      publicKey: keyPair.publicKey,
      issuer: "https://auth.example.com",
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.code).toBe("expired_token")
    }
  })

  test("rejects non-M2M token", async () => {
    // Create a user token (not M2M)
    const userToken = await new SignJWT({
      mode: "access",
      type: "user",
      sub: "user-123",
      iss: "https://auth.example.com",
    })
      .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(keyPair.privateKey)

    const result = await verifyM2MToken({
      token: userToken,
      publicKey: keyPair.publicKey,
      issuer: "https://auth.example.com",
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.code).toBe("not_m2m_token")
    }
  })

  test("rejects token missing client_id", async () => {
    const invalidToken = await new SignJWT({
      mode: "m2m",
      sub: "test-client",
      // missing client_id
      scope: "read",
      iss: "https://auth.example.com",
      jti: crypto.randomUUID(),
    })
      .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(keyPair.privateKey)

    const result = await verifyM2MToken({
      token: invalidToken,
      publicKey: keyPair.publicKey,
      issuer: "https://auth.example.com",
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.code).toBe("missing_claims")
    }
  })

  test("rejects invalid token format", async () => {
    const result = await verifyM2MToken({
      token: "not-a-valid-jwt",
      publicKey: keyPair.publicKey,
      issuer: "https://auth.example.com",
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.code).toBe("invalid_token")
    }
  })

  test("validates audience when specified", async () => {
    const tokenWithAudience = await new SignJWT({
      mode: "m2m",
      sub: "test-client",
      client_id: "test-client",
      scope: "read",
      iss: "https://auth.example.com",
      aud: "api.example.com",
      jti: crypto.randomUUID(),
    })
      .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(keyPair.privateKey)

    // Should pass with correct audience
    const validResult = await verifyM2MToken({
      token: tokenWithAudience,
      publicKey: keyPair.publicKey,
      issuer: "https://auth.example.com",
      audience: "api.example.com",
    })
    expect(validResult.valid).toBe(true)

    // Should fail with wrong audience
    const invalidResult = await verifyM2MToken({
      token: tokenWithAudience,
      publicKey: keyPair.publicKey,
      issuer: "https://auth.example.com",
      audience: "wrong.example.com",
    })
    expect(invalidResult.valid).toBe(false)
    if (!invalidResult.valid) {
      expect(invalidResult.code).toBe("invalid_audience")
    }
  })
})

describe("scope helpers", () => {
  const scopes = ["read", "write", "admin"]

  describe("hasScope", () => {
    test("returns true when scope exists", () => {
      expect(hasScope(scopes, "read")).toBe(true)
      expect(hasScope(scopes, "admin")).toBe(true)
    })

    test("returns false when scope missing", () => {
      expect(hasScope(scopes, "delete")).toBe(false)
    })
  })

  describe("hasAllScopes", () => {
    test("returns true when all scopes exist", () => {
      expect(hasAllScopes(scopes, ["read", "write"])).toBe(true)
    })

    test("returns false when any scope missing", () => {
      expect(hasAllScopes(scopes, ["read", "delete"])).toBe(false)
    })

    test("returns true for empty required scopes", () => {
      expect(hasAllScopes(scopes, [])).toBe(true)
    })
  })

  describe("hasAnyScope", () => {
    test("returns true when any scope exists", () => {
      expect(hasAnyScope(scopes, ["read", "delete"])).toBe(true)
    })

    test("returns false when no scopes match", () => {
      expect(hasAnyScope(scopes, ["delete", "create"])).toBe(false)
    })

    test("returns false for empty required scopes", () => {
      expect(hasAnyScope(scopes, [])).toBe(false)
    })
  })
})
