#!/usr/bin/env node

// pgbo CLI entry point

import { parseArgs } from 'node:util'
import { runMigrate } from './migrate.js'
import { runStatus } from './status.js'
import { runIntrospect } from './introspect.js'

const USAGE = `
pgbo — Type-safe PostgreSQL Business Objects CLI

Usage:
  pgbo migrate    --schema <path> [--db <url>]   Apply schema migrations
  pgbo status     [--db <url>]                   Show database schema status
  pgbo introspect [--db <url>]                   Dump current DB schema as JSON

Options:
  --schema, -s   Path to schema definitions file (required for migrate)
  --db, -d       PostgreSQL connection string (default: $DATABASE_URL)
  --help, -h     Show this help message
`.trim()

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      schema: { type: 'string', short: 's' },
      db: { type: 'string', short: 'd' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help || positionals.length === 0) {
    console.log(USAGE)
    process.exit(0)
  }

  const command = positionals[0]
  const connectionString = values.db ?? process.env['DATABASE_URL']

  if (!connectionString) {
    console.error('Error: No database connection string. Use --db or set DATABASE_URL.')
    process.exit(1)
  }

  try {
    switch (command) {
      case 'migrate': {
        if (!values.schema) {
          console.error('Error: --schema <path> is required for migrate.')
          process.exit(1)
        }
        const schemaPath = new URL(values.schema, `file://${process.cwd()}/`).href
        await runMigrate(connectionString, schemaPath)
        break
      }
      case 'status':
        await runStatus(connectionString)
        break
      case 'introspect':
        await runIntrospect(connectionString)
        break
      default:
        console.error(`Unknown command: ${command}`)
        console.log(USAGE)
        process.exit(1)
    }
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

void main()
