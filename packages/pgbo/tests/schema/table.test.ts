import { describe, it, expect } from 'vitest'
import { table } from '../../src/schema/table.js'
import { text, integer, timestamp, uuid } from '../../src/schema/types.js'
import { domain } from '../../src/schema/domain.js'
import { foreignKey, index, check } from '../../src/schema/constraints.js'

// Set up domains for testing
const tenantId = domain('tenant_id', integer()).references('tenant', 'id', 'CASCADE')
const slug = domain('slug', text().minLength(1).maxLength(128))

describe('Table builder', () => {
  it('creates a table definition with columns', () => {
    const t = table('warehouse', {
      columns: {
        slug: slug.baseType.notNull(),
        name: text().notNull(),
      },
      primaryKey: ['slug'],
    })
    expect(t.name).toBe('warehouse')
    expect(Object.keys(t.columns)).toEqual(['slug', 'name'])
  })

  it('defines primary key', () => {
    const t = table('warehouse', {
      columns: {
        slug: slug.baseType.notNull(),
        tenantId: tenantId.baseType,
      },
      primaryKey: ['slug', 'tenantId'],
    })
    expect(t.primaryKey).toEqual(['slug', 'tenantId'])
  })

  it('auto-infers single-column FK from domain references', () => {
    const t = table('warehouse', {
      columns: {
        slug: slug.baseType.notNull(),
        tenantId: tenantId.baseType,
      },
      primaryKey: ['slug', 'tenantId'],
      domains: { tenantId },
    })
    expect(t.foreignKeys).toEqual([
      { columns: ['tenantId'], refTable: 'tenant', refColumns: ['id'], onDelete: 'CASCADE', onUpdate: undefined },
    ])
  })

  it('explicit composite FK via foreignKey()', () => {
    const t = table('warehouse_product', {
      columns: {
        wku: slug.baseType.notNull(),
        tenantId: tenantId.baseType,
        baseUomSlug: slug.baseType.nullable(),
      },
      primaryKey: ['wku', 'tenantId'],
      foreignKeys: [
        foreignKey(['baseUomSlug']).references('unit_of_measure', ['slug']),
      ],
    })
    const explicitFk = t.foreignKeys.find(fk => fk.columns.includes('baseUomSlug'))
    expect(explicitFk).toEqual({
      columns: ['baseUomSlug'],
      refTable: 'unit_of_measure',
      refColumns: ['slug'],
      onDelete: undefined,
      onUpdate: undefined,
    })
  })

  it('index builder: simple, unique, partial, GIN', () => {
    const simpleIdx = index('name')
    expect(simpleIdx.columns).toEqual(['name'])
    expect(simpleIdx.isUnique).toBe(false)

    const uniqueIdx = index('slug', 'tenantId').unique()
    expect(uniqueIdx.columns).toEqual(['slug', 'tenantId'])
    expect(uniqueIdx.isUnique).toBe(true)

    const partialIdx = index('status').where("status != 'ARCHIVED'")
    expect(partialIdx.condition).toBe("status != 'ARCHIVED'")

    const ginIdx = index('data').using('gin')
    expect(ginIdx.method).toBe('gin')
  })

  it('check constraints', () => {
    const c = check('quantity').greaterThanOrEqual(0)
    expect(c.column).toBe('quantity')
    expect(c.sql).toContain('>= 0')

    const c2 = check('end_date').greaterThan('start_date')
    expect(c2.sql).toContain('end_date > start_date')
  })

  it('.translations([]) auto-generates translation table definition', () => {
    const t = table('area', {
      columns: {
        slug: slug.baseType.notNull(),
        tenantId: tenantId.baseType,
        sortOrder: integer().default(0),
      },
      primaryKey: ['slug', 'tenantId'],
      translations: ['name'],
    })
    const tt = t.translationTable
    expect(tt).toBeDefined()
    expect(tt!.name).toBe('area_translation')
    expect(Object.keys(tt!.columns)).toContain('locale')
    expect(Object.keys(tt!.columns)).toContain('name')
    // PK = parent PK + locale
    expect(tt!.primaryKey).toEqual(['slug', 'tenantId', 'locale'])
  })

  it('generates correct DDL: CREATE TABLE ...', () => {
    const t = table('warehouse', {
      columns: {
        slug: text().notNull(),
        tenantId: integer(),
        name: text().notNull(),
        createdAt: timestamp().withTimeZone().defaultNow(),
      },
      primaryKey: ['slug', 'tenantId'],
      domains: { tenantId },
      indexes: [
        index('slug', 'tenantId'),
      ],
    })
    const ddl = t.toSQL()
    expect(ddl).toContain('CREATE TABLE warehouse')
    expect(ddl).toContain('slug text NOT NULL')
    expect(ddl).toContain('tenant_id integer')
    expect(ddl).toContain('name text NOT NULL')
    expect(ddl).toContain('created_at timestamptz DEFAULT now()')
    expect(ddl).toContain('PRIMARY KEY (slug, tenant_id)')
    expect(ddl).toContain('FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE')
    expect(ddl).toContain('CREATE INDEX idx_warehouse_slug_tenant_id ON warehouse (slug, tenant_id)')
  })
})
