import { describe, it, expect } from 'vitest'
import { col } from '../../src/schema/column.js'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { viewMeta } from '../../src/metadata/index.js'

const apps = table('app', {
  columns: {
    slug: text().notNull(),
    kind: text().notNull(),
    name: text().notNull(),
    version: text(),
    bundleRef: text(),
    iframeUrl: text(),
    requiresAuth: integer(),
  },
  primaryKey: ['slug'],
})

describe('.visibleWhen() column annotation (issue #62)', () => {
  describe('column ref', () => {
    it('stashes a single-value predicate on the annotation', () => {
      const c = col('version').visibleWhen({ kind: 'esm_upload' })
      expect(c.annotations.visibleWhen).toEqual({ kind: 'esm_upload' })
    })

    it('accepts multi-value predicates (OR semantics)', () => {
      const c = col('version').visibleWhen({ kind: ['esm_upload', 'iframe'] })
      expect(c.annotations.visibleWhen).toEqual({ kind: ['esm_upload', 'iframe'] })
    })

    it('accepts multi-condition predicates (AND across keys)', () => {
      const c = col('version').visibleWhen({ kind: 'iframe', requiresAuth: true })
      expect(c.annotations.visibleWhen).toEqual({ kind: 'iframe', requiresAuth: true })
    })

    it('throws on empty predicate', () => {
      expect(() => col('version').visibleWhen({})).toThrow(/at least one key\/value pair/)
    })

    it('composes with other annotations', () => {
      const c = col('version').required().visibleWhen({ kind: 'esm_upload' }).label('app.version')
      expect(c.annotations.required).toBe(true)
      expect(c.annotations.visibleWhen).toEqual({ kind: 'esm_upload' })
      expect(c.annotations.label).toBe('app.version')
    })
  })

  describe('metadata', () => {
    const appView = view('app_view').from(apps).columns({
      slug: col('slug').required().immutable(),
      kind: col('kind').required(),
      name: col('name').required(),
      version: col('version').required().visibleWhen({ kind: 'esm_upload' }),
      bundleRef: col('bundleRef').visibleWhen({ kind: 'esm_upload' }),
      iframeUrl: col('iframeUrl').visibleWhen({ kind: 'iframe' }),
    })

    it('surfaces visibleWhen on FieldMeta', () => {
      const meta = viewMeta(appView)
      const version = meta.fields.find(f => f.key === 'version')!
      expect(version.visibleWhen).toEqual({ kind: 'esm_upload' })

      const iframe = meta.fields.find(f => f.key === 'iframeUrl')!
      expect(iframe.visibleWhen).toEqual({ kind: 'iframe' })
    })

    it('omits visibleWhen on fields without the annotation', () => {
      const meta = viewMeta(appView)
      const slug = meta.fields.find(f => f.key === 'slug')!
      expect(slug.visibleWhen).toBeUndefined()

      const name = meta.fields.find(f => f.key === 'name')!
      expect(name.visibleWhen).toBeUndefined()
    })

    it('preserves required + visibleWhen together (required-when-visible semantics)', () => {
      const meta = viewMeta(appView)
      const version = meta.fields.find(f => f.key === 'version')!
      expect(version.required).toBe(true)
      expect(version.visibleWhen).toEqual({ kind: 'esm_upload' })
    })

    it('multi-value predicate flows through unchanged', () => {
      const v = view('multi_v').from(apps).columns({
        version: col('version').visibleWhen({ kind: ['esm_upload', 'iframe'] }),
      })
      const meta = viewMeta(v)
      expect(meta.fields[0]!.visibleWhen).toEqual({ kind: ['esm_upload', 'iframe'] })
    })
  })
})
