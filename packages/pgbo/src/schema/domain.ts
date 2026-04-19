// Domain builder — Phase 1c

import type { AnyColumnBuilder, DomainDef, ForeignKeyReference } from './definitions.js'

class DomainDefImpl implements DomainDef {
  readonly name: string
  readonly baseType: AnyColumnBuilder
  readonly baseDomain: DomainDef | undefined
  readonly reference: ForeignKeyReference | undefined

  constructor(
    name: string,
    baseType: AnyColumnBuilder,
    baseDomain: DomainDef | undefined,
    reference: ForeignKeyReference | undefined,
  ) {
    this.name = name
    this.baseType = baseType
    this.baseDomain = baseDomain
    this.reference = reference
  }

  references(table: string, column: string, onDelete?: string): DomainDef {
    return new DomainDefImpl(this.name, this.baseType, this.baseDomain, {
      table,
      column,
      onDelete,
    })
  }

  toSQL(): string {
    // Inherited domain: CREATE DOMAIN warehouse_slug AS slug
    if (this.baseDomain) {
      return `CREATE DOMAIN ${this.name} AS ${this.baseDomain.name}`
    }

    // Base domain: CREATE DOMAIN slug AS text CHECK (...) CHECK (...)
    const { _def: def } = this.baseType
    const parts = [`CREATE DOMAIN ${this.name} AS ${def.pgType}`]

    for (const check of def.checks) {
      parts.push(`CHECK (${check.sql})`)
    }

    return parts.join(' ')
  }
}

export function domain(name: string, baseType: AnyColumnBuilder | DomainDef): DomainDef {
  // If baseType is a DomainDef (has .baseDomain property or is DomainDefImpl), inherit from it
  if ('name' in baseType && 'baseDomain' in baseType) {
    const parent = baseType
    return new DomainDefImpl(name, parent.baseType, parent, undefined)
  }

  return new DomainDefImpl(name, baseType, undefined, undefined)
}
