import { describe, it, expect } from 'vitest'
import { view, valueHelpView } from '../../src/schema/view.js'
import { col } from '../../src/schema/column.js'
import { table } from '../../src/schema/table.js'
import { text, integer, timestamp } from '../../src/schema/types.js'

const area = table('area', {
  columns: {
    slug: text().notNull(),
    tenantId: integer(),
    sortOrder: integer().default(0),
  },
  primaryKey: ['slug', 'tenantId'],
  translations: ['name'],
})

describe('View builder', () => {
  it('creates a simple view from a table', () => {
    const v = view('area_view').from(area)
    expect(v.name).toBe('area_view')
    expect(v.source).toBe(area)
  })

  it('.columns() selects specific columns', () => {
    const v = view('area_view').from(area).columns({
      slug: col('slug'),
      sortOrder: col('sortOrder'),
    })
    expect(Object.keys(v.selectedColumns!)).toEqual(['slug', 'sortOrder'])
  })

  it('.where() adds filter condition', () => {
    const v = view('active_area').from(area).where('sort_order > 0')
    expect(v.whereClause).toBe('sort_order > 0')
  })

  it('generates correct DDL: CREATE VIEW ...', () => {
    const v = view('area_view').from(area)
    const ddl = v.toSQL()
    expect(ddl).toContain('CREATE VIEW area_view AS')
    expect(ddl).toContain('SELECT')
    expect(ddl).toContain('FROM area')
  })

  it('view with selected columns generates correct DDL', () => {
    const v = view('area_view').from(area).columns({
      slug: col('slug'),
      sortOrder: col('sortOrder'),
    })
    const ddl = v.toSQL()
    expect(ddl).toContain('CREATE VIEW area_view AS')
    expect(ddl).toContain('slug')
    expect(ddl).toContain('sort_order')
    expect(ddl).toContain('FROM area')
  })

  it('view with WHERE generates correct DDL', () => {
    const v = view('active_area').from(area).where('sort_order > 0')
    const ddl = v.toSQL()
    expect(ddl).toContain('WHERE sort_order > 0')
  })

  describe('field annotations', () => {
    it('.label() sets display label', () => {
      const c = col('slug').label('crud.slug')
      expect(c.annotations.label).toBe('crud.slug')
    })

    it('.searchable() marks field for full-text search', () => {
      const c = col('slug').searchable()
      expect(c.annotations.searchable).toBe(true)
    })

    it('.filterable() marks field for filter UI', () => {
      const c = col('slug').filterable()
      expect(c.annotations.filterable).toBe(true)
    })

    it('.immutable() prevents update after creation', () => {
      const c = col('slug').immutable()
      expect(c.annotations.immutable).toBe(true)
    })

    it('.hidden() excludes from metadata', () => {
      const c = col('slug').hidden()
      expect(c.annotations.hidden).toBe(true)
    })

    it('.inList(false) hides from list view', () => {
      const c = col('slug').inList(false)
      expect(c.annotations.inList).toBe(false)
    })

    it('.inForm(false) hides from form', () => {
      const c = col('slug').inForm(false)
      expect(c.annotations.inForm).toBe(false)
    })

    it('.valueHelp(view) links to dropdown source', () => {
      const vh = valueHelpView('area_vh').from(area).key('slug').display('name')
      const c = col('areaSlug').valueHelp(vh)
      expect(c.annotations.valueHelp).toBe(vh)
    })
  })
})

describe('Value help view builder', () => {
  it('creates a flat read-only view', () => {
    const vh = valueHelpView('area_vh').from(area).key('slug').display('name')
    expect(vh.name).toBe('area_vh')
    expect(vh.keyField).toBe('slug')
    expect(vh.displayField).toBe('name')
  })

  it('.key() sets the value field', () => {
    const vh = valueHelpView('area_vh').from(area).key('slug').display('name')
    expect(vh.keyField).toBe('slug')
  })

  it('.display() sets the display field', () => {
    const vh = valueHelpView('area_vh').from(area).key('slug').display('name')
    expect(vh.displayField).toBe('name')
  })

  it('generates correct DDL', () => {
    const vh = valueHelpView('area_vh').from(area).key('slug').display('name')
    const ddl = vh.toSQL()
    expect(ddl).toContain('CREATE VIEW area_vh AS')
    expect(ddl).toContain('slug')
    expect(ddl).toContain('name')
    expect(ddl).toContain('FROM area')
  })
})
