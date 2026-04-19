// Example queries against the trtest database
// All reads and writes go through views — never tables directly

import { createDatabase } from '../packages/pgbo/src/query/client.js'
import { warehouse, warehouseView, productView } from './schema.js'
import { zodSchemas } from '../packages/pgbo/src/validation/index.js'
import { defineBO } from '../packages/pgbo/src/bo/index.js'

const DB_URL = 'postgresql://timriep@localhost:5432/trtest'

async function main() {
  const db = createDatabase({ connectionString: DB_URL })

  try {
    // --- SELECT through views ---

    console.log('=== All warehouses (via warehouse_view) ===')
    const warehouses = await db.from(warehouseView).execute()
    for (const wh of warehouses) {
      console.log(`  ${wh.slug}: ${wh.name} (${wh.status}, capacity: ${wh.capacity})`)
    }

    console.log('\n=== Active products (via product_view), sorted by price ===')
    const products = await db.from(productView)
      .where({ active: true })
      .orderBy('price', 'desc')
      .execute()
    for (const p of products) {
      console.log(`  ${p.sku}: ${p.name} — €${(p.price! / 100).toFixed(2)}`)
    }

    console.log('\n=== Products in main warehouse ===')
    const mainProducts = await db.from(productView)
      .where({ warehouseSlug: 'main' })
      .execute()
    console.log(`  Found ${mainProducts.length} products`)

    console.log('\n=== Product count ===')
    const total = await db.from(productView).count()
    const active = await db.from(productView).where({ active: true }).count()
    console.log(`  Total: ${total}, Active: ${active}`)

    // --- Validation example ---

    console.log('\n=== Zod validation ===')
    const schemas = zodSchemas(warehouse)

    try {
      schemas.insert.parse({ slug: 'test', name: 'Test WH' })
      console.log('  Valid insert data: OK')
    } catch {
      console.log('  Unexpected error')
    }

    try {
      schemas.insert.parse({ slug: '' })
      console.log('  Should not reach here')
    } catch {
      console.log('  Invalid data (empty slug, missing name): correctly rejected')
    }

    // --- Transaction through views ---

    console.log('\n=== Transaction: create + update atomically (via views) ===')
    const result = await db.transaction(async (tx) => {
      await tx.into(productView).values({
        sku: 'TX-001', name: 'Transaction Product', price: 999,
        warehouseSlug: 'main', active: true,
      }).execute()

      await tx.update(productView)
        .set({ price: 1099 })
        .where({ sku: 'TX-001' })
        .execute()

      const [row] = await tx.from(productView).where({ sku: 'TX-001' }).execute()
      return row
    })
    console.log(`  Created & updated: ${result!.name} — €${(result!.price! / 100).toFixed(2)}`)

    // Cleanup via view
    await db.deleteFrom(productView).where({ sku: 'TX-001' }).execute()

    // --- BO example (writes go through BO actions → internal table ops) ---

    console.log('\n=== Business Object: CRUD ===')
    const warehouseBO = defineBO(warehouse, {
      paramField: 'slug',
      actions: {
        create: {},
        update: {},
        delete: {},
      },
    })

    await warehouseBO.create(db, {}, { slug: 'bo-test', name: 'BO Test WH', status: 'ACTIVE' })
    console.log('  Created bo-test')

    await warehouseBO.update(db, {}, { slug: 'bo-test', name: 'BO Test Updated' })
    const [updated] = await db.from(warehouseView).where({ slug: 'bo-test' }).execute()
    console.log(`  Updated: ${updated!.name}`)

    await warehouseBO.delete(db, {}, { slug: 'bo-test' })
    console.log('  Deleted bo-test')

    // --- Raw SQL (escape hatch) ---

    console.log('\n=== Raw SQL ===')
    const stats = await db.raw<{ status: string; cnt: string }>`
      SELECT status, COUNT(*) AS cnt FROM warehouse GROUP BY status ORDER BY status
    `
    for (const row of stats) {
      console.log(`  ${row.status}: ${row.cnt}`)
    }

    console.log('\nAll examples complete!')
  } finally {
    await db.close()
  }
}

main().catch(console.error)
