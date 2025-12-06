#!/usr/bin/env node
/**
 * OpenAuth CLI
 *
 * Provides commands for managing OpenAuth in your project.
 *
 * Usage:
 *   npx openauth migrate [database-name] [--local]
 *
 * If database-name is not provided, reads from wrangler config.
 * Supports: wrangler.toml, wrangler.json, wrangler.jsonc
 */

import { execSync, spawnSync } from "child_process"
import { readFileSync, readdirSync, existsSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Migrations are in src/migrations relative to package root
const migrationsDir = join(__dirname, "..", "src", "migrations")

/**
 * Strip JSON comments (single-line and multi-line) for JSONC support
 */
function stripJsonComments(content: string): string {
  // Remove single-line comments
  content = content.replace(/\/\/.*$/gm, "")
  // Remove multi-line comments
  content = content.replace(/\/\*[\s\S]*?\*\//g, "")
  return content
}

/**
 * Parse wrangler config to get database name
 * Supports: wrangler.toml, wrangler.json, wrangler.jsonc
 */
function parseWranglerConfig(): { databaseName: string; configFile: string } | null {
  const cwd = process.cwd()

  // Try wrangler.toml first
  const tomlPath = join(cwd, "wrangler.toml")
  if (existsSync(tomlPath)) {
    const content = readFileSync(tomlPath, "utf-8")
    // Simple TOML parsing for d1_databases
    // Looking for: database_name = "xxx"
    const match = content.match(/database_name\s*=\s*"([^"]+)"/)
    if (match) {
      return { databaseName: match[1], configFile: "wrangler.toml" }
    }
  }

  // Try wrangler.json
  const jsonPath = join(cwd, "wrangler.json")
  if (existsSync(jsonPath)) {
    try {
      const content = readFileSync(jsonPath, "utf-8")
      const config = JSON.parse(content)
      const dbName = extractDbNameFromJson(config)
      if (dbName) {
        return { databaseName: dbName, configFile: "wrangler.json" }
      }
    } catch {
      // Invalid JSON, continue to next option
    }
  }

  // Try wrangler.jsonc (JSON with comments)
  const jsoncPath = join(cwd, "wrangler.jsonc")
  if (existsSync(jsoncPath)) {
    try {
      const content = readFileSync(jsoncPath, "utf-8")
      const stripped = stripJsonComments(content)
      const config = JSON.parse(stripped)
      const dbName = extractDbNameFromJson(config)
      if (dbName) {
        return { databaseName: dbName, configFile: "wrangler.jsonc" }
      }
    } catch {
      // Invalid JSONC, continue
    }
  }

  return null
}

/**
 * Extract database name from parsed JSON config
 */
function extractDbNameFromJson(config: any): string | null {
  // Check d1_databases array
  if (Array.isArray(config.d1_databases) && config.d1_databases.length > 0) {
    const db = config.d1_databases[0]
    if (db.database_name) {
      return db.database_name
    }
  }
  return null
}

function printHelp() {
  console.log(`
OpenAuth CLI

Usage:
  openauth migrate [database-name] [--local]    Apply database migrations
  openauth help                                 Show this help message

Options:
  --local    Apply to local D1 database (for development)

Examples:
  openauth migrate                    # Auto-detect from wrangler config, remote
  openauth migrate --local            # Auto-detect, local database
  openauth migrate my-auth-db         # Specify database name
  openauth migrate my-auth-db --local # Specify database, local

The migrate command executes OpenAuth SQL migrations against your D1 database.
`)
}

function migrate(args: string[]) {
  // Parse args for database name and --local flag
  let dbName: string | undefined
  let isLocal = false

  for (const arg of args) {
    if (arg === "--local") {
      isLocal = true
    } else if (!arg.startsWith("-")) {
      dbName = arg
    }
  }

  // Try to get database name from wrangler config if not provided
  if (!dbName) {
    const config = parseWranglerConfig()
    if (config) {
      dbName = config.databaseName
      console.log(`Found database in ${config.configFile}: ${dbName}`)
    } else {
      console.error(
        "Error: No database name provided and couldn't find wrangler config",
      )
      console.error("Supported: wrangler.toml, wrangler.json, wrangler.jsonc")
      console.error("Usage: openauth migrate <database-name>")
      process.exit(1)
    }
  }

  // Check if wrangler is available
  try {
    execSync("wrangler --version", { stdio: "ignore" })
  } catch {
    console.error("Error: wrangler CLI not found")
    console.error("Install it with: npm install -g wrangler")
    process.exit(1)
  }

  // Get SQL files sorted by name
  const sqlFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()

  if (sqlFiles.length === 0) {
    console.error("Error: No SQL migration files found")
    process.exit(1)
  }

  console.log(
    `Applying ${sqlFiles.length} OpenAuth migrations to ${dbName}${isLocal ? " (local)" : ""}...`,
  )

  // Execute each SQL file
  for (const file of sqlFiles) {
    const filePath = join(migrationsDir, file)
    console.log(`  Applying ${file}...`)

    const wranglerArgs = ["d1", "execute", dbName, "--file", filePath]
    if (isLocal) {
      wranglerArgs.push("--local")
    }

    const result = spawnSync("wrangler", wranglerArgs, {
      stdio: "inherit",
      shell: true,
    })

    if (result.status !== 0) {
      console.error(`Error applying ${file}`)
      process.exit(result.status || 1)
    }
  }

  console.log("Migrations applied successfully!")
}

// Parse command line arguments
const args = process.argv.slice(2)
const command = args[0]

switch (command) {
  case "migrate":
    migrate(args.slice(1))
    break
  case "help":
  case "--help":
  case "-h":
    printHelp()
    break
  default:
    if (command) {
      console.error(`Unknown command: ${command}`)
    }
    printHelp()
    process.exit(command ? 1 : 0)
}
