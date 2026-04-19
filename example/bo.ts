// Business Object definitions for the example project

import { defineBO } from '../packages/pgbo/src/bo/index.js'
import { warehouse, product, warehouseView, productView, warehouseProducts } from './schema.js'
import type { ActionContext } from '../packages/pgbo/src/bo/types.js'

// --- Permission helpers ---

function isAdmin(ctx: ActionContext): boolean {
  return ctx.role === 'admin'
}

function requireAdmin(ctx: ActionContext): boolean | string {
  return isAdmin(ctx) || 'Admin access required'
}

// --- Warehouse BO (full CRUD with permissions + hooks) ---

export const warehouseBO = defineBO(warehouse, {
  paramField: 'slug',
  actions: {
    create: {
      permission: requireAdmin,
      before: async (_ctx, data) => {
        // Validate slug format
        if (typeof data.slug === 'string' && data.slug.includes(' ')) {
          return 'Slug cannot contain spaces'
        }
      },
      after: async (_ctx, result) => {
        console.log(`    [hook] Warehouse created: ${(result as any).slug}`)
      },
    },
    update: {
      permission: requireAdmin,
      after: async (_ctx, result) => {
        console.log(`    [hook] Warehouse updated: ${(result as any).slug}`)
      },
    },
    delete: {
      permission: requireAdmin,
      before: async (_ctx, data) => {
        if (data.slug === 'main') return 'Cannot delete the main warehouse'
      },
    },
  },
  compositions: {
    products: {
      table: warehouseProducts,
      parentKey: 'warehouseSlug',
    },
  },
})

// --- Product BO (simple CRUD, no permissions) ---

export const productBO = defineBO(product, {
  paramField: 'sku',
  actions: {
    create: {},
    update: {},
    delete: {},
  },
})

// --- Read-only reporting BO (no actions) ---

export const warehouseReportBO = defineBO(warehouse, {
  paramField: 'slug',
  // No actions → read-only
})
