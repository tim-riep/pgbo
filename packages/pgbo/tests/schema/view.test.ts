import { describe, it, expect } from 'vitest'
import { view } from '../../src/schema/view.js'
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

    it('.valueHelp(view) links to a vh-annotated view', () => {
      const vh = view('area_vh').from(area)
        .columns({ slug: col('slug'), name: col('name') })
        .vh({ key: 'slug', display: 'name' })
      const c = col('areaSlug').valueHelp(vh)
      expect(c.annotations.valueHelp).toBe(vh)
    })

    it('.valueHelp() throws when the view is not .vh() annotated', () => {
      const plainView = view('area_view').from(area)
      expect(() => col('areaSlug').valueHelp(plainView)).toThrow(/not annotated with \.vh\(/)
    })
  })
})

describe('.vh() value-help annotation (issue #34)', () => {
  it('marks a regular view as a value help without changing DDL', () => {
    const vh = view('area_vh').from(area)
      .columns({ slug: col('slug'), name: col('name') })
      .vh({ key: 'slug', display: 'name' })
    expect(vh.vhAnnotation).toEqual({ key: 'slug', display: 'name' })
    // DDL is just a normal view — no special branch
    const ddl = vh.toSQL()
    expect(ddl).toContain('CREATE VIEW area_vh AS')
    expect(ddl).toContain('area.slug')
    expect(ddl).toContain('FROM area')
  })

  it('supports .translatedJoin() on a vh view (the UoM use case)', () => {
    const unitOfMeasure = table('unit_of_measure', {
      columns: { slug: text().notNull() },
      primaryKey: ['slug'],
    })
    const unitOfMeasureTranslation = table('unit_of_measure_translation', {
      columns: {
        uomSlug: text().notNull(),
        locale: text().notNull(),
        name: text().notNull(),
        symbol: text().notNull(),
      },
      primaryKey: ['uomSlug', 'locale'],
    })
    const uomVh = view('uom_vh').from(unitOfMeasure)
      .translatedJoin(unitOfMeasureTranslation, {
        parentKey: 'uomSlug', localeColumn: 'locale',
        localeParam: 'app.locale', fallbackLocale: 'en',
        fields: ['name', 'symbol'],
      })
      .vh({ key: 'slug', display: 'name' })
    expect(uomVh.vhAnnotation).toEqual({ key: 'slug', display: 'name' })
    const ddl = uomVh.toSQL()
    expect(ddl).toContain('LEFT JOIN unit_of_measure_translation t_req')
    expect(ddl).toContain('COALESCE(t_req.name, t_fb.name) AS name')
  })

  it('throws when .vh() is followed by .associations()', () => {
    const vh = view('area_vh').from(area).vh({ key: 'slug', display: 'name' })
    expect(() => vh.associations({ foo: { foreignKey: 'slug' } })).toThrow(/cannot be combined with \.vh\(\)/)
  })

  it('throws when .associations() is followed by .vh()', () => {
    const v = view('area_view').from(area).associations({ foo: { foreignKey: 'slug' } })
    expect(() => v.vh({ key: 'slug', display: 'name' })).toThrow(/cannot be combined with \.associations\(\)/)
  })
})
