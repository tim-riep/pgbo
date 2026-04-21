import { describe, it, expect } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { defineBO } from '../../src/bo/index.js'
import { viewMeta, boMeta } from '../../src/metadata/index.js'

const areaTable = table('area', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
  },
  primaryKey: ['id'],
})

const areaView = view('area_view').from(areaTable)

const pageTable = table('page', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    areaId: integer().notNull(),
  },
  primaryKey: ['id'],
})

describe('View-level associations (issue #4)', () => {
  it('.associations() attaches metadata to the view', () => {
    const pageView = view('page_view').from(pageTable)
      .associations({
        area: { foreignKey: 'areaId', target: areaView },
      })

    expect(pageView.viewAssociations).toBeDefined()
    expect(pageView.viewAssociations?.area?.foreignKey).toBe('areaId')
    expect(pageView.viewAssociations?.area?.target?.name).toBe('area_view')
  })

  it('viewMeta() surfaces associations', () => {
    const pageView = view('page_view').from(pageTable)
      .associations({
        area: { foreignKey: 'areaId', target: areaView },
      })

    const meta = viewMeta(pageView)
    expect(meta.associations).toHaveLength(1)
    expect(meta.associations[0]).toEqual({
      name: 'area',
      foreignKey: 'areaId',
      target: 'area_view',
    })
  })

  it('viewMeta() returns empty associations for views without them', () => {
    const plainView = view('plain_view').from(pageTable)
    expect(viewMeta(plainView).associations).toEqual([])
  })

  it('BO inherits associations from the view', () => {
    const pageView = view('page_view').from(pageTable)
      .associations({
        area: { foreignKey: 'areaId', target: areaView },
      })

    const pageBO = defineBO(pageView, { paramField: 'id' })

    expect(pageBO.associations.area).toBeDefined()
    expect(pageBO.associations.area?.foreignKey).toBe('areaId')
    expect(pageBO.associations.area?.target?.name).toBe('area_view')
  })

  it('BO-level associations override view associations on key collision', () => {
    const pageView = view('page_view').from(pageTable)
      .associations({
        area: { foreignKey: 'areaId', target: areaView },
      })

    const pageBO = defineBO(pageView, {
      paramField: 'id',
      associations: {
        area: { foreignKey: 'customAreaId' },  // override
      },
    })

    expect(pageBO.associations.area?.foreignKey).toBe('customAreaId')
  })

  it('BO associations merge with view associations (different keys)', () => {
    const pageView = view('page_view').from(pageTable)
      .associations({
        area: { foreignKey: 'areaId', target: areaView },
      })

    const pageBO = defineBO(pageView, {
      paramField: 'id',
      associations: {
        extra: { foreignKey: 'extraId' },
      },
    })

    expect(Object.keys(pageBO.associations).sort()).toEqual(['area', 'extra'])
  })

  it('boMeta() exposes merged associations', () => {
    const pageView = view('page_view').from(pageTable)
      .associations({
        area: { foreignKey: 'areaId', target: areaView },
      })

    const pageBO = defineBO(pageView, { paramField: 'id' })
    const meta = boMeta(pageBO)

    expect(meta.associations).toHaveLength(1)
    expect(meta.associations[0]).toEqual({
      name: 'area',
      foreignKey: 'areaId',
      target: 'area_view',
    })
  })

  it('associations persist through .where() / .columns() chaining', () => {
    const pageView = view('page_view').from(pageTable)
      .associations({
        area: { foreignKey: 'areaId', target: areaView },
      })
      .where("id > 0")

    expect(pageView.viewAssociations?.area?.foreignKey).toBe('areaId')
  })
})
