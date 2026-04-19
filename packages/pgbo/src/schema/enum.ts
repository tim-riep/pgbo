// Enum builder — Phase 1c

import type { AnyColumnBuilder, EnumDef } from './definitions.js'
import { makeBuilder } from './types.js'

class EnumDefImpl implements EnumDef {
  readonly name: string
  readonly values: readonly string[]

  constructor(name: string, values: readonly string[]) {
    this.name = name
    this.values = values
  }

  column(): AnyColumnBuilder {
    return makeBuilder<string>(this.name)
  }

  toSQL(): string {
    const valuesList = this.values.map(v => `'${v}'`).join(', ')
    return `CREATE TYPE ${this.name} AS ENUM (${valuesList})`
  }
}

export function pgEnum(name: string, values: readonly string[]): EnumDef {
  return new EnumDefImpl(name, values)
}
