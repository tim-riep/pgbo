import { describe, it, expect } from 'vitest'
import { table } from '../../src/schema/table.js'
import { text, integer } from '../../src/schema/types.js'
import { defineBO } from '../../src/bo/index.js'

const stockJournalTable = table('stock_journal', {
  columns: {
    id: integer().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['id'],
})

describe('BO name default (issue 017)', () => {
  it('defaults to camelCase of root.name', () => {
    const bo = defineBO(stockJournalTable, { paramField: 'id' })
    expect(bo.name).toBe('stockJournal')
  })

  it('accepts config.name override', () => {
    const bo = defineBO(stockJournalTable, { name: 'stockJournalEntries', paramField: 'id' })
    expect(bo.name).toBe('stockJournalEntries')
  })

  it('root.name (SQL identifier) is unchanged', () => {
    const bo = defineBO(stockJournalTable, { paramField: 'id' })
    expect(bo.root.name).toBe('stock_journal')
  })
})
