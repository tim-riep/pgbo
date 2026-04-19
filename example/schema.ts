// Schema definitions — tables, views, enums

import { table } from '../packages/pgbo/src/schema/table.js'
import { text, integer, timestamp, boolean } from '../packages/pgbo/src/schema/types.js'
import { pgEnum } from '../packages/pgbo/src/schema/enum.js'
import { view } from '../packages/pgbo/src/schema/view.js'
import { col } from '../packages/pgbo/src/schema/column.js'
import { index } from '../packages/pgbo/src/schema/constraints.js'
import { translated, configureI18n, localeCode } from '../packages/pgbo/src/schema/i18n.js'
import type { SchemaDefinitions } from '../packages/pgbo/src/migration/diff.js'

// --- i18n config ---

configureI18n({
  localeTable: 'locale',
  localeColumn: 'code',
  fallbackLocale: 'en',
})

// --- Enums ---

export const warehouseStatus = pgEnum('warehouse_status', ['ACTIVE', 'INACTIVE', 'ARCHIVED'])

// --- Tables ---

export const warehouse = table('warehouse', {
  columns: {
    slug: text().notNull(),
    name: text().notNull(),
    status: warehouseStatus.column().notNull().default('ACTIVE' as any),
    address: text(),
    capacity: integer().min(0),
    createdAt: timestamp().withTimeZone().defaultNow(),
  },
  primaryKey: ['slug'],
  indexes: [
    index('name'),
    index('status'),
  ],
  translations: ['description'],
})

export const warehouseProducts = table('warehouse_product', {
  columns: {
    warehouseSlug: text().notNull(),
    productSku: text().notNull(),
    stock: integer().notNull().default(0),
  },
  primaryKey: ['warehouseSlug', 'productSku']
})

export const product = table('product', {
  columns: {
    sku: text().notNull(),
    name: text().notNull(),
    price: integer().min(0),
    warehouseSlug: text().notNull(),
    active: boolean().default(true),
    createdAt: timestamp().withTimeZone().defaultNow(),
  },
  primaryKey: ['sku'],
  indexes: [
    index('warehouseSlug'),
    index('name'),
  ],
})

// --- Views ---

export const warehouseView = view('warehouse_view').from(warehouse).columns({
  slug: col('slug').label('crud.slug').filterable().immutable(),
  name: col('name').label('crud.name').searchable().filterable(),
  status: col('status').label('warehouse.status').filterable(),
  address: col('address').label('warehouse.address'),
  capacity: col('capacity').label('warehouse.capacity'),
  description: translated('description'),
  createdAt: col('createdAt'),
})

export const productView = view('product_view').from(product)

// --- Export all definitions for migration ---

export const schema: SchemaDefinitions = {
  domains: [localeCode],
  enums: [warehouseStatus],
  tables: [warehouse, product, warehouseProducts],
  views: [warehouseView, productView],
}
