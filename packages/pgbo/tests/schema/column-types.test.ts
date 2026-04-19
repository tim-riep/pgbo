import { describe, it, expect } from 'vitest'
import {
  text, integer, uuid, timestamp, numeric, boolean, serial,
} from '../../src/schema/types.js'

describe('Column type builders', () => {
  describe('text()', () => {
    it('creates a text column', () => {
      expect(text().toSQL('name')).toBe('name text')
    })

    it('.length(n) sets varchar(n)', () => {
      expect(text().length(255).toSQL('name')).toBe('name varchar(255)')
    })

    it('.minLength(n) adds CHECK constraint', () => {
      expect(text().minLength(3).toSQL('name')).toBe('name text CHECK (length(name) >= 3)')
    })

    it('.maxLength(n) adds CHECK constraint', () => {
      expect(text().maxLength(100).toSQL('name')).toBe('name text CHECK (length(name) <= 100)')
    })

    it('.pattern(regex) adds CHECK constraint', () => {
      expect(text().pattern(/^[a-z]+$/).toSQL('slug')).toBe("slug text CHECK (slug ~ '^[a-z]+$')")
    })

    it('.notNull() sets NOT NULL', () => {
      expect(text().notNull().toSQL('name')).toBe('name text NOT NULL')
    })

    it('.nullable() removes NOT NULL', () => {
      const col = text().notNull().nullable()
      expect(col.toSQL('name')).toBe('name text')
    })

    it('.default(value) sets DEFAULT', () => {
      expect(text().default('hello').toSQL('name')).toBe("name text DEFAULT 'hello'")
    })

    it('.unique() adds UNIQUE constraint', () => {
      expect(text().unique().toSQL('name')).toBe('name text UNIQUE')
    })
  })

  describe('integer()', () => {
    it('creates an integer column', () => {
      expect(integer().toSQL('age')).toBe('age integer')
    })

    it('.min(n) adds CHECK constraint', () => {
      expect(integer().min(0).toSQL('age')).toBe('age integer CHECK (age >= 0)')
    })

    it('.max(n) adds CHECK constraint', () => {
      expect(integer().max(100).toSQL('age')).toBe('age integer CHECK (age <= 100)')
    })

    it('.between(a, b) adds CHECK constraint', () => {
      expect(integer().between(1, 10).toSQL('age')).toBe('age integer CHECK (age >= 1 AND age <= 10)')
    })

    it('.positive() adds CHECK > 0', () => {
      expect(integer().positive().toSQL('qty')).toBe('qty integer CHECK (qty > 0)')
    })
  })

  describe('uuid()', () => {
    it('creates a uuid column', () => {
      expect(uuid().toSQL('id')).toBe('id uuid')
    })

    it('.defaultRandom() sets DEFAULT gen_random_uuid()', () => {
      expect(uuid().defaultRandom().toSQL('id')).toBe('id uuid DEFAULT gen_random_uuid()')
    })
  })

  describe('timestamp()', () => {
    it('creates a timestamp column', () => {
      expect(timestamp().toSQL('created')).toBe('created timestamp')
    })

    it('.withTimeZone() creates timestamptz', () => {
      expect(timestamp().withTimeZone().toSQL('created')).toBe('created timestamptz')
    })

    it('.defaultNow() sets DEFAULT now()', () => {
      expect(timestamp().defaultNow().toSQL('created')).toBe('created timestamp DEFAULT now()')
    })
  })

  describe('numeric()', () => {
    it('creates a numeric column', () => {
      expect(numeric().toSQL('price')).toBe('price numeric')
    })

    it('.precision(p, s) sets numeric(p, s)', () => {
      expect(numeric().precision(10, 2).toSQL('price')).toBe('price numeric(10,2)')
    })

    it('.positive() adds CHECK > 0', () => {
      expect(numeric().positive().toSQL('price')).toBe('price numeric CHECK (price > 0)')
    })
  })

  describe('boolean()', () => {
    it('creates a boolean column', () => {
      expect(boolean().toSQL('active')).toBe('active boolean')
    })
  })

  describe('serial()', () => {
    it('creates a serial column', () => {
      expect(serial().toSQL('id')).toBe('id serial')
    })
  })
})
