// Business Object demo — permissions, hooks, compositions, read-only guard

import { createDatabase } from '../packages/pgbo/src/query/client.js'
import { warehouseView, productView } from './schema.js'
import { warehouseBO, productBO, warehouseReportBO } from './bo.js'

const DB_URL = 'postgresql://timriep@localhost:5432/trtest'

async function main() {
  const db = createDatabase({ connectionString: DB_URL })

  try {
    const adminCtx = { role: 'admin', userId: 'u1' }
    const viewerCtx = { role: 'viewer', userId: 'u2' }

    // --- 1. Permission checks ---

    console.log('=== Permission checks ===')

    // Admin can create
    await warehouseBO.create(db, adminCtx, {
      slug: 'demo-wh',
      name: 'Demo Warehouse',
      status: 'ACTIVE',
      capacity: 500,
    })
    console.log('  Admin created demo-wh: OK')

    // Viewer cannot create
    try {
      await warehouseBO.create(db, viewerCtx, {
        slug: 'denied',
        name: 'Should Fail',
        status: 'ACTIVE',
      })
    } catch (e: any) {
      console.log(`  Viewer create denied: "${e.message}"`)
    }

    // --- 2. Before hooks (validation) ---

    console.log('\n=== Before hooks (validation) ===')

    // Slug with spaces → rejected by before hook
    try {
      await warehouseBO.create(db, adminCtx, {
        slug: 'bad slug',
        name: 'Invalid',
        status: 'ACTIVE',
      })
    } catch (e: any) {
      console.log(`  Invalid slug rejected: "${e.message}"`)
    }

    // Cannot delete main warehouse → rejected by before hook
    try {
      await warehouseBO.delete(db, adminCtx, { slug: 'main' })
    } catch (e: any) {
      console.log(`  Main warehouse protected: "${e.message}"`)
    }

    // --- 3. After hooks ---

    console.log('\n=== After hooks ===')
    await warehouseBO.update(db, adminCtx, { slug: 'demo-wh', name: 'Demo Updated' })

    // Verify update through view
    const [updated] = await db.from(warehouseView).where({ slug: 'demo-wh' }).execute()
    console.log(`  Verified via view: ${updated!.name}`)

    // --- 4. Compositions ---

    console.log('\n=== Compositions (parent + children) ===')

    await warehouseBO.create(db, adminCtx, {
      slug: 'comp-wh',
      name: 'Composite Warehouse',
      status: 'ACTIVE',
      products: [
        { productSku: 'WIDGET-001', stock: 100 },
        { productSku: 'GADGET-001', stock: 50 },
      ],
    })

    const stockRows = await db.raw<{ product_sku: string; stock: number }>`
      SELECT product_sku, stock
      FROM warehouse_product
      WHERE warehouse_slug = ${'comp-wh'}
      ORDER BY product_sku
    `
    for (const row of stockRows) {
      console.log(`  ${row.product_sku}: ${row.stock} units`)
    }

    // --- 5. Read-only BO ---

    console.log('\n=== Read-only BO ===')
    console.log(`  warehouseReportBO.isReadOnly: ${warehouseReportBO.isReadOnly}`)

    try {
      await warehouseReportBO.create(db, adminCtx, { slug: 'x', name: 'X', status: 'ACTIVE' })
    } catch (e: any) {
      console.log(`  Create on read-only BO: "${e.message}"`)
    }

    // Read-only BO can still read through views
    const all = await db.from(warehouseView).execute()
    console.log(`  But reading works: ${all.length} warehouses visible`)

    // --- 6. Simple BO (no permissions) ---

    console.log('\n=== Simple product BO ===')

    await productBO.create(db, {}, {
      sku: 'BO-PROD-001',
      name: 'BO Product',
      price: 1999,
      warehouseSlug: 'main',
      active: true,
    })

    const [prod] = await db.from(productView).where({ sku: 'BO-PROD-001' }).execute()
    console.log(`  Created: ${prod!.name} — €${(prod!.price! / 100).toFixed(2)}`)

    await productBO.delete(db, {}, { sku: 'BO-PROD-001' })
    console.log('  Deleted BO-PROD-001')

    // --- Cleanup ---

    await warehouseBO.delete(db, adminCtx, { slug: 'demo-wh' })
    await db.raw`DELETE FROM warehouse_product WHERE warehouse_slug = ${'comp-wh'}`
    await warehouseBO.delete(db, adminCtx, { slug: 'comp-wh' })

    console.log('\nAll BO examples complete!')
  } finally {
    await db.close()
  }
}

main().catch(console.error)
