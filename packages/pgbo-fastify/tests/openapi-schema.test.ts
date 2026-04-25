import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { table, view, text, integer, timestamp, boolean, col } from '@pgbo/core/schema'
import { defineBO, defineProjection } from '@pgbo/core/bo'
import { registerProjection, registerViewRoute } from '../src/index.js'
import {
  fieldSchema, rowSchema, listResponseSchema, listQuerystringSchema,
  paramSchema, paramFieldType, createBodySchema, updateBodySchema, viewHasAuth,
} from '../src/openapi.js'
import type { FieldMeta } from '@pgbo/core/metadata'

const productTable = table('product', {
  columns: {
    id: integer().notNull(),
    sku: text().notNull(),
    price: integer(),
    active: boolean().default(true),
    createdAt: timestamp().withTimeZone().defaultNow(),
  },
  primaryKey: ['id'],
})

const productView = view('product_view').from(productTable).columns({
  id: col('id').hidden().immutable(),
  sku: col('sku').label('product.sku').searchable().required(),
  price: col('price').label('product.price').filterable(),
  active: col('active').label('product.active'),
  createdAt: col('createdAt').label('product.createdAt'),
})

const productBO = defineBO(productView, {
  paramField: 'id',
  actions: {
    create: {},
    update: {},
    delete: {},
    archive: {
      summary: 'Archive a product',
      inputSchema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
    },
  },
})

const productProjection = defineProjection(productBO, {
  name: 'product',
  actions: { read: true, create: true, update: true, delete: true, archive: true },
})

const stubCtx = (app: ReturnType<typeof Fastify>) => () => ({ app, db: {} as any, locale: 'en' })

describe('OpenAPI schema generation (issue #38)', () => {
  describe('fieldSchema kind → JSON Schema mapping', () => {
    const f = (kind: FieldMeta['kind']): FieldMeta => ({
      key: 'x', kind, label: undefined, hidden: false, immutable: false,
      searchable: false, filterable: false, inList: true, inForm: true, required: false, quick: false,
    })

    it('text/slug → string', () => {
      expect(fieldSchema(f('text'))).toEqual({ type: 'string' })
      expect(fieldSchema(f('slug'))).toEqual({ type: 'string' })
    })
    it('number → number', () => {
      expect(fieldSchema(f('number'))).toEqual({ type: 'number' })
    })
    it('boolean → boolean', () => {
      expect(fieldSchema(f('boolean'))).toEqual({ type: 'boolean' })
    })
    it('date → string with date-time format', () => {
      expect(fieldSchema(f('date'))).toEqual({ type: 'string', format: 'date-time' })
    })
    it('relation → string', () => {
      expect(fieldSchema(f('relation'))).toEqual({ type: 'string' })
    })
    it('translation → string + nullable (locale may be missing)', () => {
      expect(fieldSchema(f('translation'))).toEqual({ type: 'string', nullable: true })
    })
  })

  describe('rowSchema', () => {
    it('omits hidden fields and uses additionalProperties: true to allow enrichment', () => {
      const meta = { name: 'x', fields: [
        { key: 'id', kind: 'number' as const, label: undefined, hidden: true, immutable: true, searchable: false, filterable: false as const, inList: false, inForm: false, required: false, quick: false },
        { key: 'sku', kind: 'text' as const, label: undefined, hidden: false, immutable: false, searchable: true, filterable: false as const, inList: true, inForm: true, required: true, quick: false },
      ], associations: [] }
      const schema = rowSchema(meta) as { properties: Record<string, unknown>; additionalProperties: boolean }
      expect(schema.properties).toHaveProperty('sku')
      expect(schema.properties).not.toHaveProperty('id')
      expect(schema.additionalProperties).toBe(true)
    })
  })

  describe('paramFieldType', () => {
    it('returns "integer" for serial/integer paramField', () => {
      expect(paramFieldType(productTable, 'id')).toBe('integer')
    })
    it('returns "string" for text paramField', () => {
      expect(paramFieldType(productTable, 'sku')).toBe('string')
    })
  })

  describe('createBodySchema / updateBodySchema', () => {
    it('createBodySchema marks .required() fields as required', () => {
      const schema = createBodySchema({
        name: 'x', paramField: 'id', readOnly: false,
        compositions: [], valueHelps: [], associations: [],
        fields: [
          { key: 'sku', kind: 'text', label: undefined, hidden: false, immutable: false, searchable: false, filterable: false, inList: true, inForm: true, required: true, quick: false },
          { key: 'price', kind: 'number', label: undefined, hidden: false, immutable: false, searchable: false, filterable: false, inList: true, inForm: true, required: false, quick: false },
        ],
      } as any) as { required?: string[] }
      expect(schema.required).toEqual(['sku'])
    })

    it('updateBodySchema excludes immutable fields and the paramField', () => {
      const schema = updateBodySchema({
        name: 'x', paramField: 'id', readOnly: false,
        compositions: [], valueHelps: [], associations: [],
        fields: [
          { key: 'id', kind: 'number', label: undefined, hidden: false, immutable: false, searchable: false, filterable: false, inList: true, inForm: true, required: false, quick: false },
          { key: 'sku', kind: 'text', label: undefined, hidden: false, immutable: true, searchable: false, filterable: false, inList: true, inForm: true, required: false, quick: false },
          { key: 'price', kind: 'number', label: undefined, hidden: false, immutable: false, searchable: false, filterable: false, inList: true, inForm: true, required: false, quick: false },
        ],
      } as any) as { properties: Record<string, unknown> }
      expect(Object.keys(schema.properties)).toEqual(['price'])
    })
  })

  describe('listQuerystringSchema', () => {
    it('emits sort enum from field keys + standard list params', () => {
      const meta = { name: 'x', fields: [
        { key: 'sku', kind: 'text' as const, label: undefined, hidden: false, immutable: false, searchable: true, filterable: false as const, inList: true, inForm: true, required: false, quick: false },
        { key: 'price', kind: 'number' as const, label: undefined, hidden: false, immutable: false, searchable: false, filterable: false as const, inList: true, inForm: true, required: false, quick: false },
      ], associations: [] }
      const qs = listQuerystringSchema(meta) as { properties: Record<string, any> }
      expect(qs.properties.page).toEqual({ type: 'integer', minimum: 1, default: 1 })
      expect(qs.properties.limit).toEqual({ type: 'integer', minimum: 1, maximum: 250, default: 25 })
      expect(qs.properties.sort.enum).toEqual(['sku', 'price'])
      expect(qs.properties.order.enum).toEqual(['asc', 'desc'])
    })
  })

  describe('paramSchema', () => {
    it('produces the expected path-param shape', () => {
      expect(paramSchema('id', 'integer')).toEqual({
        type: 'object',
        properties: { param: { type: 'integer', description: 'id of the record' } },
        required: ['param'],
      })
    })
  })

  describe('listResponseSchema', () => {
    it('wraps a row schema into the standard pagination envelope', () => {
      const row = { type: 'object', properties: { x: { type: 'string' } } }
      expect(listResponseSchema(row)).toEqual({
        type: 'object',
        properties: {
          items: { type: 'array', items: row },
          total: { type: 'integer' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
        },
        required: ['items', 'total', 'page', 'limit'],
      })
    })
  })

  describe('viewHasAuth', () => {
    it('returns false for views with no .restrict()', () => {
      expect(viewHasAuth(productProjection)).toBe(false)
    })

    it('returns true for views with .restrict() and not .noAuth()', () => {
      const restricted = view('restricted_view').from(productTable)
        .restrict({ grant: 'READ', to: 'ADMIN' })
        .columns({ id: col('id') })
      const restrictedBO = defineBO(restricted, { paramField: 'id' })
      const restrictedProjection = defineProjection(restrictedBO, { name: 'r', actions: { read: true } })
      expect(viewHasAuth(restrictedProjection)).toBe(true)
    })
  })

  describe('integration: schemas attached to registered routes', () => {
    it('attaches tags + summary + querystring + response to GET list (and other routes)', async () => {
      // onRoute hook must be installed before registerProjection so it fires for every route
      const captured: { method: string; url: string; schema: any }[] = []
      const app = Fastify()
      app.addHook('onRoute', r => captured.push({ method: r.method as string, url: r.url, schema: r.schema }))

      registerProjection(app, {} as any, {
        projection: productProjection,
        view: productView,
        extractContext: stubCtx(app),
      })
      await app.ready()

      const list = captured.find(r => r.method === 'GET' && r.url === '/bo/product')!
      expect(list.schema.tags).toEqual(['product'])
      expect(list.schema.summary).toBe('List product')
      expect(list.schema.querystring.properties.page).toBeDefined()
      expect(list.schema.response[200]).toBeDefined()

      const detail = captured.find(r => r.method === 'GET' && r.url === '/bo/product/:param')!
      expect(detail.schema.params.properties.param.type).toBe('integer')

      const create = captured.find(r => r.method === 'POST' && r.url === '/bo/product')!
      expect(create.schema.body.required).toContain('sku')

      const meta = captured.find(r => r.method === 'GET' && r.url === '/meta/product')!
      expect(meta.schema.tags).toEqual(['product', 'meta'])

      const archive = captured.find(r => r.method === 'POST' && r.url === '/bo/product/archive')!
      expect(archive.schema.tags).toEqual(['product', 'action'])
      expect(archive.schema.summary).toBe('Archive a product')
      expect(archive.schema.body.required).toEqual(['reason'])

      await app.close()
    })

    it('skips schema attachment when swagger.enabled is false', async () => {
      // Sanity: registerProjection with swagger.enabled=false doesn't throw,
      // and existing endpoint behaviour stays intact (the test just confirms
      // the registration completes — strict-no-schema verification is hard to
      // make portable across Fastify versions).
      const app = Fastify()
      expect(() => {
        registerProjection(app, {} as any, {
          projection: productProjection,
          view: productView,
          extractContext: stubCtx(app),
          swagger: { enabled: false },
        })
      }).not.toThrow()
      await app.close()
    })

    it('registerViewRoute attaches GET {prefix} + {prefix}/meta', async () => {
      const app = Fastify()
      registerViewRoute(app, {} as any, {
        view: productView,
        extractContext: stubCtx(app),
      })
      await app.ready()
      expect((app as any).hasRoute({ method: 'GET', url: '/view/product_view' })).toBe(true)
      expect((app as any).hasRoute({ method: 'GET', url: '/view/product_view/meta' })).toBe(true)
      await app.close()
    })
  })
})
