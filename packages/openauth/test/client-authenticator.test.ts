import {
  expect,
  test,
  describe,
  beforeEach,
  mock,
  spyOn,
} from "bun:test"
import { ClientAuthenticator } from "../src/client/authenticator.js"
import { D1ClientAdapter, type OAuthClient } from "../src/client/d1-adapter.js"

// Mock D1 database
const createMockD1 = () => ({
  prepare: (sql: string) => ({
    bind: (...params: any[]) => ({
      run: mock(() => Promise.resolve({ success: true, meta: { changes: 1 } })),
      first: mock(() => Promise.resolve(null)),
      all: mock(() => Promise.resolve({ results: [] })),
    }),
  }),
})

describe("ClientAuthenticator", () => {
  let authenticator: ClientAuthenticator
  let adapter: D1ClientAdapter
  let mockDb: any

  beforeEach(() => {
    mockDb = createMockD1()
    adapter = new D1ClientAdapter({ database: mockDb })
    authenticator = new ClientAuthenticator({
      adapter,
      iterations: 1000, // Lower iterations for faster tests
      keyLength: 32,
    })
  })

  describe("hashSecret", () => {
    test("generates consistent hash with same salt", async () => {
      const secret = "my-secret-key"
      const salt = new Uint8Array(16).fill(1)

      const result1 = await authenticator.hashSecret(secret, salt)
      const result2 = await authenticator.hashSecret(secret, salt)

      expect(result1.hash).toBe(result2.hash)
      expect(result1.salt).toBe(result2.salt)
    })

    test("generates different hashes with different salts", async () => {
      const secret = "my-secret-key"
      const salt1 = new Uint8Array(16).fill(1)
      const salt2 = new Uint8Array(16).fill(2)

      const result1 = await authenticator.hashSecret(secret, salt1)
      const result2 = await authenticator.hashSecret(secret, salt2)

      expect(result1.hash).not.toBe(result2.hash)
    })

    test("generates random salt when not provided", async () => {
      const secret = "my-secret-key"

      const result1 = await authenticator.hashSecret(secret)
      const result2 = await authenticator.hashSecret(secret)

      expect(result1.salt).not.toBe(result2.salt)
      expect(result1.hash).not.toBe(result2.hash)
    })

    test("hash includes salt and hash separated by colon", async () => {
      const secret = "my-secret-key"
      const result = await authenticator.hashSecret(secret)

      expect(result.hash).toContain(":")
      const [salt, hash] = result.hash.split(":")
      expect(salt).toBe(result.salt)
      expect(hash).toBeTruthy()
    })
  })

  describe("validateClient", () => {
    test("returns true for valid credentials", async () => {
      const clientId = "test-client"
      const clientSecret = "my-secret"

      // Create hash for the secret
      const { hash } = await authenticator.hashSecret(clientSecret)

      // Mock adapter to return client with hashed secret
      const getClientSpy = spyOn(adapter, "getClient").mockResolvedValue({
        client_id: clientId,
        client_secret_hash: hash,
        client_name: "Test Client",
        redirect_uris: ["http://localhost:3000/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        scopes: ["openid", "profile"],
        created_at: Date.now(),
      })

      const isValid = await authenticator.validateClient(clientId, clientSecret)

      expect(isValid).toBe(true)
      expect(getClientSpy).toHaveBeenCalledWith(clientId)
    })

    test("returns false for invalid credentials", async () => {
      const clientId = "test-client"
      const clientSecret = "my-secret"
      const wrongSecret = "wrong-secret"

      // Create hash for the correct secret
      const { hash } = await authenticator.hashSecret(clientSecret)

      // Mock adapter to return client with hashed secret
      spyOn(adapter, "getClient").mockResolvedValue({
        client_id: clientId,
        client_secret_hash: hash,
        client_name: "Test Client",
        redirect_uris: ["http://localhost:3000/callback"],
        grant_types: ["authorization_code"],
        scopes: ["openid"],
        created_at: Date.now(),
      })

      const isValid = await authenticator.validateClient(
        clientId,
        wrongSecret,
      )

      expect(isValid).toBe(false)
    })

    test("returns false for non-existent client", async () => {
      const clientId = "non-existent"
      const clientSecret = "any-secret"

      // Mock adapter to return null (client not found)
      spyOn(adapter, "getClient").mockResolvedValue(null)

      const isValid = await authenticator.validateClient(clientId, clientSecret)

      expect(isValid).toBe(false)
    })

    test("performs timing-safe comparison (always hashes even if client not found)", async () => {
      const clientId = "non-existent"
      const clientSecret = "any-secret"

      // Mock adapter to return null
      spyOn(adapter, "getClient").mockResolvedValue(null)

      const hashSecretSpy = spyOn(authenticator, "hashSecret")

      await authenticator.validateClient(clientId, clientSecret)

      // Should still hash the secret even though client doesn't exist (timing attack prevention)
      expect(hashSecretSpy).toHaveBeenCalledWith(clientSecret)
    })

    test("returns false for malformed stored hash", async () => {
      const clientId = "test-client"
      const clientSecret = "my-secret"

      // Mock adapter to return client with malformed hash (no colon separator)
      spyOn(adapter, "getClient").mockResolvedValue({
        client_id: clientId,
        client_secret_hash: "malformed-hash-without-colon",
        client_name: "Test Client",
        redirect_uris: ["http://localhost:3000/callback"],
        grant_types: ["authorization_code"],
        scopes: ["openid"],
        created_at: Date.now(),
      })

      const isValid = await authenticator.validateClient(clientId, clientSecret)

      expect(isValid).toBe(false)
    })
  })

  describe("authenticateClient", () => {
    test("returns client for valid credentials", async () => {
      const clientId = "test-client"
      const clientSecret = "my-secret"
      const { hash } = await authenticator.hashSecret(clientSecret)

      const mockClient: OAuthClient = {
        client_id: clientId,
        client_secret_hash: hash,
        client_name: "Test Client",
        redirect_uris: ["http://localhost:3000/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        scopes: ["openid", "profile"],
        created_at: Date.now(),
      }

      spyOn(adapter, "getClient").mockResolvedValue(mockClient)

      const client = await authenticator.authenticateClient(
        clientId,
        clientSecret,
      )

      expect(client).toEqual(mockClient)
    })

    test("returns null for invalid credentials", async () => {
      const clientId = "test-client"
      const clientSecret = "my-secret"
      const wrongSecret = "wrong-secret"
      const { hash } = await authenticator.hashSecret(clientSecret)

      spyOn(adapter, "getClient").mockResolvedValue({
        client_id: clientId,
        client_secret_hash: hash,
        client_name: "Test Client",
        redirect_uris: ["http://localhost:3000/callback"],
        grant_types: ["authorization_code"],
        scopes: ["openid"],
        created_at: Date.now(),
      })

      const client = await authenticator.authenticateClient(
        clientId,
        wrongSecret,
      )

      expect(client).toBeNull()
    })
  })

  describe("createClient", () => {
    test("creates client with hashed secret", async () => {
      const clientId = "new-client"
      const clientSecret = "super-secret"
      const clientName = "New Client"

      const createClientSpy = spyOn(adapter, "createClient").mockResolvedValue({
        client_id: clientId,
        client_secret_hash: "salt:hash",
        client_name: clientName,
        redirect_uris: ["http://localhost:3000/callback"],
        grant_types: ["authorization_code"],
        scopes: ["openid"],
        created_at: Date.now(),
      })

      const client = await authenticator.createClient(
        clientId,
        clientSecret,
        clientName,
        {
          redirect_uris: ["http://localhost:3000/callback"],
          grant_types: ["authorization_code"],
          scopes: ["openid"],
        },
      )

      expect(createClientSpy).toHaveBeenCalled()
      expect(client.client_id).toBe(clientId)

      // Verify the hash was generated (should contain colon separator)
      const createCallArgs = createClientSpy.mock.calls[0][0]
      expect(createCallArgs.client_secret_hash).toContain(":")
    })
  })

  describe("updateClientSecret", () => {
    test("updates client secret with new hash", async () => {
      const clientId = "test-client"
      const newSecret = "new-secret"

      const updateClientSpy = spyOn(adapter, "updateClient").mockResolvedValue({
        client_id: clientId,
        client_secret_hash: "new-salt:new-hash",
        client_name: "Test Client",
        redirect_uris: ["http://localhost:3000/callback"],
        grant_types: ["authorization_code"],
        scopes: ["openid"],
        created_at: Date.now(),
      })

      const success = await authenticator.updateClientSecret(
        clientId,
        newSecret,
      )

      expect(success).toBe(true)
      expect(updateClientSpy).toHaveBeenCalled()

      // Verify the new hash was generated
      const updateCallArgs = updateClientSpy.mock.calls[0][1]
      expect(updateCallArgs.client_secret_hash).toContain(":")
    })

    test("returns false when update fails", async () => {
      const clientId = "non-existent"
      const newSecret = "new-secret"

      spyOn(adapter, "updateClient").mockResolvedValue(null)

      const success = await authenticator.updateClientSecret(
        clientId,
        newSecret,
      )

      expect(success).toBe(false)
    })
  })
})
