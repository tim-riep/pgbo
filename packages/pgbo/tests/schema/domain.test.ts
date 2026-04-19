import { describe, it, expect } from 'vitest'
import { domain } from '../../src/schema/domain.js'
import { text, integer } from '../../src/schema/types.js'

describe('Domain builder', () => {
  it('creates a domain with base type', () => {
    const slug = domain('slug', text().minLength(1).maxLength(128))
    expect(slug.name).toBe('slug')
    expect(slug.baseType._def.pgType).toBe('text')
  })

  it('inherits constraints from base type', () => {
    const slug = domain('slug', text().minLength(1).maxLength(128))
    expect(slug.baseType._def.checks).toHaveLength(2)
  })

  it('domain based on another domain inherits parent constraints', () => {
    const slug = domain('slug', text().minLength(1).maxLength(128))
    const warehouseSlug = domain('warehouse_slug', slug)
    expect(warehouseSlug.baseDomain).toBe(slug)
    expect(warehouseSlug.baseType._def.checks).toHaveLength(2)
  })

  it('.references() adds FK metadata', () => {
    const tenantId = domain('tenant_id', integer())
      .references('tenant', 'id', 'CASCADE')
    expect(tenantId.reference).toEqual({
      table: 'tenant',
      column: 'id',
      onDelete: 'CASCADE',
    })
  })

  it('generates correct DDL: CREATE DOMAIN ... AS ...', () => {
    const slug = domain('slug', text().minLength(1).maxLength(128))
    expect(slug.toSQL()).toBe(
      "CREATE DOMAIN slug AS text CHECK (length(VALUE) >= 1) CHECK (length(VALUE) <= 128)"
    )
  })

  it('inherited domain DDL references parent domain', () => {
    const slug = domain('slug', text().minLength(1).maxLength(128))
    const warehouseSlug = domain('warehouse_slug', slug)
    expect(warehouseSlug.toSQL()).toBe(
      'CREATE DOMAIN warehouse_slug AS slug'
    )
  })

  it('generates CHECK constraints from builder methods', () => {
    const positiveInt = domain('positive_int', integer().positive())
    expect(positiveInt.toSQL()).toBe(
      'CREATE DOMAIN positive_int AS integer CHECK (VALUE > 0)'
    )
  })
})
