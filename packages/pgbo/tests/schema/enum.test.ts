import { describe, it, expect } from 'vitest'
import { pgEnum } from '../../src/schema/enum.js'

describe('Enum builder', () => {
  it('creates an enum definition with values', () => {
    const stockType = pgEnum('stock_type', ['RECEIPT', 'ADJUSTMENT', 'TRANSFER', 'REVERSAL'])
    expect(stockType.name).toBe('stock_type')
    expect(stockType.values).toEqual(['RECEIPT', 'ADJUSTMENT', 'TRANSFER', 'REVERSAL'])
  })

  it('generates correct DDL: CREATE TYPE ... AS ENUM (...)', () => {
    const stockType = pgEnum('stock_type', ['RECEIPT', 'ADJUSTMENT', 'TRANSFER', 'REVERSAL'])
    expect(stockType.toSQL()).toBe(
      "CREATE TYPE stock_type AS ENUM ('RECEIPT', 'ADJUSTMENT', 'TRANSFER', 'REVERSAL')"
    )
  })

  it('creates a column builder for use in tables', () => {
    const stockType = pgEnum('stock_type', ['RECEIPT', 'ADJUSTMENT', 'TRANSFER', 'REVERSAL'])
    const col = stockType.column()
    expect(col.toSQL('type')).toBe('type stock_type')
  })

  it('column builder supports .notNull() and .default()', () => {
    const stockType = pgEnum('stock_type', ['RECEIPT', 'ADJUSTMENT'])
    const col = stockType.column().notNull().default('RECEIPT' as any)
    expect(col.toSQL('type')).toBe("type stock_type NOT NULL DEFAULT 'RECEIPT'")
  })
})
