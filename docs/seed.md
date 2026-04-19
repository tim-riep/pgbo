# Seed System

Declarative data seeding with idempotent upserts, FK ordering, and stale cleanup.

## Defining Seeds

```typescript
import { seed, tableSeed } from '@pgbo/core/seed'

await seed(db, [
  tableSeed(tenantTable, [
    { id: 1, name: 'Acme Corp' },
    { id: 2, name: 'Other Inc' },
  ]),
  tableSeed(warehouseTable, [
    { slug: 'main', tenantId: 1, name: 'Main Warehouse' },
    { slug: 'returns', tenantId: 1, name: 'Returns Center' },
  ]),
])
```

## Behavior

### Idempotent Upserts

Seeds use `INSERT ... ON CONFLICT DO UPDATE`. Re-running the same seed is safe — existing records are updated, not duplicated:

```typescript
// First run: inserts 2 rows
await seed(db, defs)

// Second run: updates 2 rows (no duplicates)
await seed(db, defs)
```

### FK Ordering

Seeds are automatically sorted by foreign key dependencies using topological sort. You can define them in any order — parents are always inserted before children:

```typescript
// warehouse depends on tenant via FK — pgbo seeds tenant first
await seed(db, [
  tableSeed(warehouseTable, [{ slug: 'main', tenantId: 1, name: 'Main' }]),
  tableSeed(tenantTable, [{ id: 1, name: 'Acme' }]),  // inserted first despite being listed second
])
```

### Stale Cleanup

Remove database records not present in the seed definition:

```typescript
await seed(db, [
  tableSeed(tenantTable, [
    { id: 1, name: 'Acme' },
    // id: 2 removed — will be deleted from DB
  ]),
], { cleanup: true })
```

### Protected Records

Exclude specific records from cleanup:

```typescript
await seed(db, [
  tableSeed(tenantTable, [
    { id: 1, name: 'Acme' },
  ], {
    protectedKeys: [{ id: 999 }],  // system tenant — never deleted
  }),
], { cleanup: true })
```
