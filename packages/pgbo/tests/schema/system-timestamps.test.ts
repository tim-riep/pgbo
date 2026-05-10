import { describe, it, expect } from 'vitest'
import { table } from '../../src/schema/table.js'
import { text, timestamp } from '../../src/schema/types.js'
import { systemTimestamps } from '../../src/schema/system-timestamps.js'
import { viewMeta } from '../../src/metadata/index.js'

describe('System-managed timestamps (issue #61)', () => {
  describe('column builder', () => {
    it('.systemCreatedAt() emits NOT NULL DEFAULT now() and tags the column', () => {
      const c = timestamp().withTimeZone().systemCreatedAt()
      expect(c._def.isNullable).toBe(false)
      expect(c._def.defaultValue).toBe('now()')
      expect(c._def.systemManaged).toBe('createdAt')
    })

    it('.systemUpdatedAt() does the same with the updatedAt marker', () => {
      const c = timestamp().withTimeZone().systemUpdatedAt()
      expect(c._def.isNullable).toBe(false)
      expect(c._def.defaultValue).toBe('now()')
      expect(c._def.systemManaged).toBe('updatedAt')
    })

    it('toSQL includes timestamptz NOT NULL DEFAULT now()', () => {
      const sql = timestamp().withTimeZone().systemCreatedAt().toSQL('created_at')
      expect(sql).toBe('created_at timestamptz NOT NULL DEFAULT now()')
    })
  })

  describe('systemTimestamps() helper', () => {
    it('returns a { createdAt, updatedAt } pair with the right markers', () => {
      const cols = systemTimestamps()
      expect(cols.createdAt._def.systemManaged).toBe('createdAt')
      expect(cols.updatedAt._def.systemManaged).toBe('updatedAt')
      expect(cols.createdAt._def.isNullable).toBe(false)
      expect(cols.updatedAt._def.isNullable).toBe(false)
    })

    it('spreads cleanly into a table definition', () => {
      const apps = table('app', {
        columns: {
          slug: text().notNull(),
          name: text().notNull(),
          ...systemTimestamps(),
        },
        primaryKey: ['slug'],
      })
      expect(Object.keys(apps.columns)).toEqual(['slug', 'name', 'createdAt', 'updatedAt'])
      expect(apps.columns.createdAt._def.systemManaged).toBe('createdAt')
      expect(apps.columns.updatedAt._def.systemManaged).toBe('updatedAt')
    })
  })

  describe('metadata', () => {
    const apps = table('app', {
      columns: {
        slug: text().notNull(),
        name: text().notNull(),
        ...systemTimestamps(),
      },
      primaryKey: ['slug'],
    })

    it('marks system-managed fields as inForm:false, immutable:true, required:false', () => {
      const meta = viewMeta(apps)
      const created = meta.fields.find(f => f.key === 'createdAt')!
      const updated = meta.fields.find(f => f.key === 'updatedAt')!

      expect(created.inForm).toBe(false)
      expect(created.immutable).toBe(true)
      expect(created.required).toBe(false)
      expect(created.systemManaged).toBe('createdAt')

      expect(updated.inForm).toBe(false)
      expect(updated.immutable).toBe(true)
      expect(updated.required).toBe(false)
      expect(updated.systemManaged).toBe('updatedAt')
    })

    it('non-system-managed fields are unaffected', () => {
      const meta = viewMeta(apps)
      const slug = meta.fields.find(f => f.key === 'slug')!
      expect(slug.inForm).toBe(true)
      expect(slug.systemManaged).toBeUndefined()
    })
  })
})
