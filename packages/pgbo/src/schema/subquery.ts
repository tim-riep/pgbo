// Subquery column helpers for views (issue 014)

import type { SubqueryCountRef, FieldAnnotations, TableDef } from './definitions.js'

class SubqueryCountRefImpl implements SubqueryCountRef {
  readonly isSubqueryCount = true as const
  readonly childTable: TableDef
  readonly on: Record<string, string>
  readonly whereSQL?: string
  readonly annotations: FieldAnnotations

  constructor(
    childTable: TableDef,
    on: Record<string, string>,
    whereSQL?: string,
    annotations: FieldAnnotations = {},
  ) {
    this.childTable = childTable
    this.on = on
    this.whereSQL = whereSQL
    this.annotations = annotations
  }

  private withAnnotation(patch: Partial<FieldAnnotations>): SubqueryCountRef {
    return new SubqueryCountRefImpl(this.childTable, this.on, this.whereSQL, { ...this.annotations, ...patch })
  }

  label(key: string): SubqueryCountRef { return this.withAnnotation({ label: key }) }
  filterable(): SubqueryCountRef { return this.withAnnotation({ filterable: true }) }
  hidden(): SubqueryCountRef { return this.withAnnotation({ hidden: true }) }
  inList(show: boolean): SubqueryCountRef { return this.withAnnotation({ inList: show }) }
  inForm(show: boolean): SubqueryCountRef { return this.withAnnotation({ inForm: show }) }
}

/**
 * Subquery column that counts child rows joined to the parent view's source table.
 *
 * @param childTable — the child table to count rows from
 * @param on — `{ parentCol: childCol }` mapping parent columns to child FK columns
 * @param options.where — optional raw SQL predicate added to the subquery (use `child.col` qualifiers)
 */
export function subqueryCount(
  childTable: TableDef,
  on: Record<string, string>,
  options?: { where?: string },
): SubqueryCountRef {
  return new SubqueryCountRefImpl(childTable, on, options?.where)
}

export function isSubqueryCountRef(value: unknown): value is SubqueryCountRef {
  return typeof value === 'object' && value !== null && 'isSubqueryCount' in value && value.isSubqueryCount === true
}
