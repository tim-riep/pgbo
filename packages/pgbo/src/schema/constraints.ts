// Constraint builders — Phase 1c

import type { ForeignKeyBuilder, ForeignKeyDef, IndexBuilder, CheckBuilder } from './definitions.js'

// --- Foreign Key ---

class ForeignKeyBuilderImpl implements ForeignKeyBuilder {
  readonly columns: readonly string[]
  private refTable: string | undefined
  private refColumns: readonly string[] | undefined
  private deleteAction: string | undefined
  private updateAction: string | undefined

  constructor(columns: readonly string[]) {
    this.columns = columns
  }

  references(table: string, columns: readonly string[]): ForeignKeyBuilder {
    this.refTable = table
    this.refColumns = columns
    return this
  }

  onDelete(action: string): ForeignKeyBuilder {
    this.deleteAction = action
    return this
  }

  onUpdate(action: string): ForeignKeyBuilder {
    this.updateAction = action
    return this
  }

  _build(): ForeignKeyDef {
    if (!this.refTable || !this.refColumns) {
      throw new Error(`Foreign key on columns [${this.columns.join(', ')}] is missing .references()`)
    }
    return {
      columns: this.columns,
      refTable: this.refTable,
      refColumns: this.refColumns,
      onDelete: this.deleteAction,
      onUpdate: this.updateAction,
    }
  }
}

export function foreignKey(columns: string[]): ForeignKeyBuilder {
  return new ForeignKeyBuilderImpl(columns)
}

// --- Index ---

class IndexBuilderImpl implements IndexBuilder {
  readonly columns: readonly string[]
  readonly isUnique: boolean
  readonly condition: string | undefined
  readonly method: string | undefined

  constructor(
    columns: readonly string[],
    isUnique = false,
    condition?: string,
    method?: string,
  ) {
    this.columns = columns
    this.isUnique = isUnique
    this.condition = condition
    this.method = method
  }

  unique(): IndexBuilder {
    return new IndexBuilderImpl(this.columns, true, this.condition, this.method)
  }

  where(condition: string): IndexBuilder {
    return new IndexBuilderImpl(this.columns, this.isUnique, condition, this.method)
  }

  using(method: string): IndexBuilder {
    return new IndexBuilderImpl(this.columns, this.isUnique, this.condition, method)
  }
}

export function index(...columns: string[]): IndexBuilder {
  return new IndexBuilderImpl(columns)
}

// --- Check ---

class CheckBuilderImpl implements CheckBuilder {
  readonly column: string
  readonly sql: string

  constructor(column: string, sql = '') {
    this.column = column
    this.sql = sql
  }

  greaterThan(valueOrColumn: number | string): CheckBuilder {
    const rhs = typeof valueOrColumn === 'number' ? String(valueOrColumn) : valueOrColumn
    return new CheckBuilderImpl(this.column, `${this.column} > ${rhs}`)
  }

  greaterThanOrEqual(value: number): CheckBuilder {
    return new CheckBuilderImpl(this.column, `${this.column} >= ${value}`)
  }

  lessThan(valueOrColumn: number | string): CheckBuilder {
    const rhs = typeof valueOrColumn === 'number' ? String(valueOrColumn) : valueOrColumn
    return new CheckBuilderImpl(this.column, `${this.column} < ${rhs}`)
  }

  lessThanOrEqual(value: number): CheckBuilder {
    return new CheckBuilderImpl(this.column, `${this.column} <= ${value}`)
  }
}

export function check(column: string): CheckBuilder {
  return new CheckBuilderImpl(column)
}
