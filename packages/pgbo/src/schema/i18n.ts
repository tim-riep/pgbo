// Native i18n support — Phase 1d

import { domain } from './domain.js'
import { text } from './types.js'
import type { DomainDef } from './definitions.js'

export interface I18nConfig {
  localeTable: string
  localeColumn: string
  fallbackLocale: string
}

let currentConfig: I18nConfig = {
  localeTable: 'locale',
  localeColumn: 'code',
  fallbackLocale: 'en',
}

export function configureI18n(config: I18nConfig): void {
  currentConfig = { ...config }
}

export function getI18nConfig(): I18nConfig {
  return currentConfig
}

/** Built-in locale_code domain: text(2) matching /^[a-z]{2}$/ */
export const localeCode: DomainDef = domain('locale_code', text().length(2).pattern(/^[a-z]{2}$/))

/** Marker for a translated column reference in a view */
export interface TranslatedRef {
  readonly ref: string
  readonly isTranslated: true
}

export function translated(field: string): TranslatedRef {
  return { ref: field, isTranslated: true }
}

/** Type guard for TranslatedRef */
export function isTranslatedRef(value: unknown): value is TranslatedRef {
  return typeof value === 'object' && value !== null && 'isTranslated' in value && value.isTranslated === true
}
