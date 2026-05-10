// Column type builders — Phase 1a
// Each returns a ColumnBuilder with chainable constraint methods

import type { ColumnBuilder, ColumnDef, CheckExpr } from './definitions.js'

class ColumnBuilderImpl<TsType, Nullable extends boolean, HasDefault extends boolean>
  implements ColumnBuilder<TsType, Nullable, HasDefault>
{
  readonly _def: ColumnDef

  declare readonly _type: TsType
  declare readonly _nullable: Nullable
  declare readonly _hasDefault: HasDefault

  constructor(def: ColumnDef) {
    this._def = def
  }

  private clone(patch: Partial<ColumnDef>): ColumnBuilderImpl<TsType, Nullable, HasDefault> {
    return new ColumnBuilderImpl({ ...this._def, ...patch })
  }

  private addCheck(sql: string): ColumnBuilderImpl<TsType, Nullable, HasDefault> {
    return this.clone({ checks: [...this._def.checks, { sql }] })
  }

  // Nullability & defaults

  notNull(): ColumnBuilderImpl<TsType, false, HasDefault> {
    return new ColumnBuilderImpl({ ...this._def, isNullable: false })
  }

  nullable(): ColumnBuilderImpl<TsType, true, HasDefault> {
    return new ColumnBuilderImpl({ ...this._def, isNullable: true })
  }

  default(value: TsType): ColumnBuilderImpl<TsType, Nullable, true> {
    let sqlValue: string
    if (typeof value === 'string') {
      sqlValue = `'${value.replace(/'/g, "''")}'`
    } else {
      sqlValue = String(value)
    }
    return new ColumnBuilderImpl({ ...this._def, defaultValue: sqlValue })
  }

  defaultNow(): ColumnBuilderImpl<TsType, Nullable, true> {
    return new ColumnBuilderImpl({ ...this._def, defaultValue: 'now()' })
  }

  defaultRandom(): ColumnBuilderImpl<TsType, Nullable, true> {
    return new ColumnBuilderImpl({ ...this._def, defaultValue: 'gen_random_uuid()' })
  }

  unique(): ColumnBuilderImpl<TsType, Nullable, HasDefault> {
    return this.clone({ isUnique: true })
  }

  // Text constraints

  length(n: number): ColumnBuilderImpl<TsType, Nullable, HasDefault> {
    return this.clone({ length: n })
  }

  minLength(n: number): ColumnBuilderImpl<TsType, Nullable, HasDefault> {
    return this.addCheck(`length(VALUE) >= ${n}`)
  }

  maxLength(n: number): ColumnBuilderImpl<TsType, Nullable, HasDefault> {
    return this.addCheck(`length(VALUE) <= ${n}`)
  }

  pattern(regex: RegExp): ColumnBuilderImpl<TsType, Nullable, HasDefault> {
    return this.addCheck(`VALUE ~ '${regex.source}'`)
  }

  // Numeric constraints

  min(n: number): ColumnBuilderImpl<TsType, Nullable, HasDefault> {
    return this.addCheck(`VALUE >= ${n}`)
  }

  max(n: number): ColumnBuilderImpl<TsType, Nullable, HasDefault> {
    return this.addCheck(`VALUE <= ${n}`)
  }

  between(a: number, b: number): ColumnBuilderImpl<TsType, Nullable, HasDefault> {
    return this.addCheck(`VALUE >= ${a} AND VALUE <= ${b}`)
  }

  positive(): ColumnBuilderImpl<TsType, Nullable, HasDefault> {
    return this.addCheck('VALUE > 0')
  }

  // Type-specific

  precision(p: number, s?: number): ColumnBuilderImpl<TsType, Nullable, HasDefault> {
    return this.clone({ precision: p, scale: s })
  }

  withTimeZone(): ColumnBuilderImpl<TsType, Nullable, HasDefault> {
    return this.clone({ hasTimeZone: true })
  }

  // System-managed timestamps (issue #61)

  systemCreatedAt(): ColumnBuilderImpl<TsType, false, true> {
    return new ColumnBuilderImpl({
      ...this._def,
      isNullable: false,
      defaultValue: 'now()',
      systemManaged: 'createdAt',
    })
  }

  systemUpdatedAt(): ColumnBuilderImpl<TsType, false, true> {
    return new ColumnBuilderImpl({
      ...this._def,
      isNullable: false,
      defaultValue: 'now()',
      systemManaged: 'updatedAt',
    })
  }

  // DDL

  toSQL(columnName: string): string {
    const parts: string[] = [columnName]

    // Type name
    const { _def: def } = this
    if (def.length !== undefined) {
      parts.push(`varchar(${def.length})`)
    } else if (def.precision !== undefined) {
      parts.push(def.scale !== undefined ? `${def.pgType}(${def.precision},${def.scale})` : `${def.pgType}(${def.precision})`)
    } else if (def.hasTimeZone && def.pgType === 'timestamp') {
      parts.push('timestamptz')
    } else {
      parts.push(def.pgType)
    }

    if (!def.isNullable) parts.push('NOT NULL')
    if (def.defaultValue !== undefined) parts.push(`DEFAULT ${def.defaultValue}`)
    if (def.isUnique) parts.push('UNIQUE')

    if (def.checks.length > 0) {
      const checkExprs = def.checks.map((c: CheckExpr) => c.sql.replace(/VALUE/g, columnName))
      parts.push(`CHECK (${checkExprs.join(' AND ')})`)
    }

    return parts.join(' ')
  }
}

export function makeBuilder<T>(pgType: string): ColumnBuilder<T, true, false> {
  return new ColumnBuilderImpl<T, true, false>({
    pgType,
    isNullable: true,
    defaultValue: undefined,
    checks: [],
    isUnique: false,
    length: undefined,
    precision: undefined,
    scale: undefined,
    hasTimeZone: false,
  })
}

function makeAutoBuilder<T>(pgType: string): ColumnBuilder<T, true, true> {
  return new ColumnBuilderImpl<T, true, true>({
    pgType,
    isNullable: true,
    defaultValue: undefined,
    checks: [],
    isUnique: false,
    length: undefined,
    precision: undefined,
    scale: undefined,
    hasTimeZone: false,
  })
}

// Text types
export function text(): ColumnBuilder<string, true, false> { return makeBuilder<string>('text') }

// Integer types
export function integer(): ColumnBuilder<number, true, false> { return makeBuilder<number>('integer') }
export function bigint(): ColumnBuilder<string, true, false> { return makeBuilder<string>('bigint') }
export function serial(): ColumnBuilder<number, true, true> { return makeAutoBuilder<number>('serial') }
export function bigserial(): ColumnBuilder<string, true, true> { return makeAutoBuilder<string>('bigserial') }

// Numeric types
export function numeric(): ColumnBuilder<number, true, false> { return makeBuilder<number>('numeric') }
export function real(): ColumnBuilder<number, true, false> { return makeBuilder<number>('real') }
export function doublePrecision(): ColumnBuilder<number, true, false> { return makeBuilder<number>('double precision') }

// Boolean
export function boolean(): ColumnBuilder<boolean, true, false> { return makeBuilder<boolean>('boolean') }

// UUID
export function uuid(): ColumnBuilder<string, true, false> { return makeBuilder<string>('uuid') }

// Date/time
export function timestamp(): ColumnBuilder<Date, true, false> { return makeBuilder<Date>('timestamp') }
export function date(): ColumnBuilder<string, true, false> { return makeBuilder<string>('date') }
export function time(): ColumnBuilder<string, true, false> { return makeBuilder<string>('time') }
export function interval(): ColumnBuilder<string, true, false> { return makeBuilder<string>('interval') }

// JSON
export function jsonb(): ColumnBuilder<unknown, true, false> { return makeBuilder<unknown>('jsonb') }
export function json(): ColumnBuilder<unknown, true, false> { return makeBuilder<unknown>('json') }

// Binary
export function bytea(): ColumnBuilder<Buffer, true, false> { return makeBuilder<Buffer>('bytea') }

// Array
export function array<T>(_itemType: ColumnBuilder<T, any, any>): ColumnBuilder<T[], true, false> {
  const itemDef = _itemType._def
  return makeBuilder<T[]>(`${itemDef.pgType}[]`)
}

// Range types
export function daterange(): ColumnBuilder<string, true, false> { return makeBuilder<string>('daterange') }
export function int4range(): ColumnBuilder<string, true, false> { return makeBuilder<string>('int4range') }
export function numrange(): ColumnBuilder<string, true, false> { return makeBuilder<string>('numrange') }
export function tsrange(): ColumnBuilder<string, true, false> { return makeBuilder<string>('tsrange') }
export function tstzrange(): ColumnBuilder<string, true, false> { return makeBuilder<string>('tstzrange') }
