// Seed data for the example project

import { seed, tableSeed } from '../packages/pgbo/src/seed/index.js'
import { warehouse, product } from './schema.js'
import { createDatabase } from '../packages/pgbo/src/query/client.js'

const DB_URL = 'postgresql://timriep@localhost:5432/trtest'

async function main() {
  const db = createDatabase({ connectionString: DB_URL })

  try {
    await seed(db, [
      tableSeed(warehouse, [
        { slug: 'main', name: 'Main Warehouse', status: 'ACTIVE', address: 'Musterstr. 1, Berlin', capacity: 5000 },
        { slug: 'returns', name: 'Returns Center', status: 'ACTIVE', address: 'Retourenweg 3, Hamburg', capacity: 1000 },
        { slug: 'archive', name: 'Archive Storage', status: 'INACTIVE', address: 'Lagerstr. 99, München', capacity: 200 },
      ]),
      tableSeed(product, [
        { sku: 'WIDGET-001', name: 'Blue Widget', price: 1299, warehouseSlug: 'main', active: true },
        { sku: 'WIDGET-002', name: 'Red Widget', price: 1499, warehouseSlug: 'main', active: true },
        { sku: 'GADGET-001', name: 'Super Gadget', price: 4999, warehouseSlug: 'main', active: true },
        { sku: 'PART-001', name: 'Spare Part A', price: 299, warehouseSlug: 'returns', active: false },
      ]),
    ])

    console.log('Seed data applied successfully.')
  } finally {
    await db.close()
  }
}

main().catch(console.error)
