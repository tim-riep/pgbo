import { describe, it, expect } from 'vitest'
import { diff, type SchemaDefinitions } from '../../src/migration/diff.js'
import type { DatabaseSnapshot } from '../../src/migration/introspect.js'
import { table } from '../../src/schema/table.js'
import { text, integer, timestamp } from '../../src/schema/types.js'
import { domain } from '../../src/schema/domain.js'
import { pgEnum } from '../../src/schema/enum.js'
import { view, valueHelpView } from '../../src/schema/view.js'
import { index } from '../../src/schema/constraints.js'

const emptySnapshot: DatabaseSnapshot = {
  domains: [],
  enums: [],
  tables: [],
  views: [],
}

describe('Schema diff', () => {
  it('detects new domain', () => {
    const slug = domain('slug', text().minLength(1).maxLength(128))
    const plan = diff({ domains: [slug], enums: [], tables: [], views: [] }, emptySnapshot)
    const domainOps = plan.operations.filter(op => op.type === 'createDomain')
    expect(domainOps).toHaveLength(1)
    expect(domainOps[0]!.sql).toContain('CREATE DOMAIN slug')
  })

  it('detects new enum', () => {
    const stockType = pgEnum('stock_type', ['RECEIPT', 'ADJUSTMENT'])
    const plan = diff({ domains: [], enums: [stockType], tables: [], views: [] }, emptySnapshot)
    const enumOps = plan.operations.filter(op => op.type === 'createEnum')
    expect(enumOps).toHaveLength(1)
    expect(enumOps[0]!.sql).toContain("CREATE TYPE stock_type AS ENUM")
  })

  it('detects enum value added', () => {
    const stockType = pgEnum('stock_type', ['RECEIPT', 'ADJUSTMENT', 'TRANSFER'])
    const snapshot: DatabaseSnapshot = {
      ...emptySnapshot,
      enums: [{ name: 'stock_type', values: ['RECEIPT', 'ADJUSTMENT'] }],
    }
    const plan = diff({ domains: [], enums: [stockType], tables: [], views: [] }, snapshot)
    const enumOps = plan.operations.filter(op => op.type === 'alterEnum')
    expect(enumOps).toHaveLength(1)
    expect(enumOps[0]!.sql).toContain("ADD VALUE 'TRANSFER'")
  })

  it('detects new table', () => {
    const users = table('users', {
      columns: { id: integer().notNull(), name: text().notNull() },
      primaryKey: ['id'],
    })
    const plan = diff({ domains: [], enums: [], tables: [users], views: [] }, emptySnapshot)
    const tableOps = plan.operations.filter(op => op.type === 'createTable')
    expect(tableOps).toHaveLength(1)
    expect(tableOps[0]!.sql).toContain('CREATE TABLE users')
  })

  it('detects new column on existing table', () => {
    const users = table('users', {
      columns: { id: integer().notNull(), name: text().notNull(), email: text() },
      primaryKey: ['id'],
    })
    const snapshot: DatabaseSnapshot = {
      ...emptySnapshot,
      tables: [{
        name: 'users',
        columns: [
          { name: 'id', camelName: 'id', type: 'int4', isNullable: false, defaultValue: undefined },
          { name: 'name', camelName: 'name', type: 'text', isNullable: false, defaultValue: undefined },
        ],
        primaryKey: ['id'],
        foreignKeys: [],
        indexes: [],
      }],
    }
    const plan = diff({ domains: [], enums: [], tables: [users], views: [] }, snapshot)
    const addColOps = plan.operations.filter(op => op.type === 'addColumn')
    expect(addColOps).toHaveLength(1)
    expect(addColOps[0]!.sql).toContain('ALTER TABLE users ADD COLUMN email text')
  })

  it('detects new index', () => {
    const users = table('users', {
      columns: { id: integer().notNull(), name: text().notNull() },
      primaryKey: ['id'],
      indexes: [index('name')],
    })
    const snapshot: DatabaseSnapshot = {
      ...emptySnapshot,
      tables: [{
        name: 'users',
        columns: [
          { name: 'id', camelName: 'id', type: 'int4', isNullable: false, defaultValue: undefined },
          { name: 'name', camelName: 'name', type: 'text', isNullable: false, defaultValue: undefined },
        ],
        primaryKey: ['id'],
        foreignKeys: [],
        indexes: [],
      }],
    }
    const plan = diff({ domains: [], enums: [], tables: [users], views: [] }, snapshot)
    const idxOps = plan.operations.filter(op => op.type === 'createIndex')
    expect(idxOps).toHaveLength(1)
    expect(idxOps[0]!.sql).toContain('CREATE INDEX')
  })

  it('detects new view', () => {
    const users = table('users', {
      columns: { id: integer().notNull(), name: text().notNull() },
      primaryKey: ['id'],
    })
    const usersView = view('users_view').from(users)
    const plan = diff({ domains: [], enums: [], tables: [users], views: [usersView] }, emptySnapshot)
    const viewOps = plan.operations.filter(op => op.type === 'createView')
    expect(viewOps).toHaveLength(1)
    expect(viewOps[0]!.sql).toContain('CREATE VIEW users_view')
  })

  it('respects dependency ordering: domains → enums → tables → views', () => {
    const slug = domain('slug', text().minLength(1))
    const stockType = pgEnum('stock_type', ['RECEIPT'])
    const users = table('users', {
      columns: { id: integer().notNull(), name: text() },
      primaryKey: ['id'],
    })
    const usersView = view('users_view').from(users)

    const plan = diff(
      { domains: [slug], enums: [stockType], tables: [users], views: [usersView] },
      emptySnapshot,
    )

    const types = plan.operations.map(op => op.type)
    const domainIdx = types.indexOf('createDomain')
    const enumIdx = types.indexOf('createEnum')
    const tableIdx = types.indexOf('createTable')
    const viewIdx = types.indexOf('createView')

    expect(domainIdx).toBeLessThan(enumIdx)
    expect(enumIdx).toBeLessThan(tableIdx)
    expect(tableIdx).toBeLessThan(viewIdx)
  })

  it('detects new value help view (issue #31)', () => {
    const warehouses = table('warehouse', {
      columns: { id: integer().notNull(), slug: text().notNull(), name: text().notNull() },
      primaryKey: ['id'],
    })
    const warehouseVh = valueHelpView('warehouse_vh').from(warehouses).key('slug').display('name')
    const plan = diff(
      { domains: [], enums: [], tables: [warehouses], views: [], valueHelps: [warehouseVh] },
      emptySnapshot,
    )
    const vhOps = plan.operations.filter(op => op.type === 'createView' && op.sql.includes('warehouse_vh'))
    expect(vhOps).toHaveLength(1)
    expect(vhOps[0]!.sql).toBe('CREATE VIEW warehouse_vh AS SELECT slug, name FROM warehouse')
  })

  it('skips value help view when it already exists in snapshot', () => {
    const warehouses = table('warehouse', {
      columns: { id: integer().notNull(), slug: text().notNull(), name: text().notNull() },
      primaryKey: ['id'],
    })
    const warehouseVh = valueHelpView('warehouse_vh').from(warehouses).key('slug').display('name')
    const snapshot: DatabaseSnapshot = {
      ...emptySnapshot,
      views: [{ name: 'warehouse_vh' }],
    }
    const plan = diff(
      { domains: [], enums: [], tables: [warehouses], views: [], valueHelps: [warehouseVh] },
      snapshot,
    )
    const vhOps = plan.operations.filter(op => op.type === 'createView')
    expect(vhOps).toHaveLength(0)
  })

  it('does not require valueHelps to be set on SchemaDefinitions (backward compat)', () => {
    const users = table('users', {
      columns: { id: integer().notNull(), name: text().notNull() },
      primaryKey: ['id'],
    })
    // No valueHelps field at all — this must still typecheck and work
    const plan = diff({ domains: [], enums: [], tables: [users], views: [] }, emptySnapshot)
    expect(plan.operations.filter(op => op.type === 'createTable')).toHaveLength(1)
  })

  it('detects auto-generated translation table from .translations()', () => {
    const area = table('area', {
      columns: { slug: text().notNull(), sortOrder: integer().default(0) },
      primaryKey: ['slug'],
      translations: ['name'],
    })
    const plan = diff({ domains: [], enums: [], tables: [area], views: [] }, emptySnapshot)
    const tableOps = plan.operations.filter(op => op.type === 'createTable')
    const tableNames = tableOps.map(op => op.tableName)
    expect(tableNames).toContain('area')
    expect(tableNames).toContain('area_translation')
  })
})
