/**
 * How a page shows a money or percent field as text (field types: formatting): an amount in its currency and a percent of 100
 * (25 is "25%"), in one fixed locale so the server, the browser and the canvas write the same text. The generated app inlines
 * `formatCode` in its template; the canvas calls `formatValue`, which makes the same `Intl.NumberFormat`.
 */

export type ValueFormat = { kind: 'money', currency: string } | { kind: 'percent' }

/** The formatted paths of one file's nodes: node id → bound path → its format (`valueFormats` of `@bildr/codegen/edit`). */
export type ValueFormats = Record<string, Record<string, ValueFormat>>

/** The locale every page formats in, until a project chooses its own. */
export const FORMAT_LOCALE = 'en-US'

const options = (format: ValueFormat): Intl.NumberFormatOptions => format.kind === 'money'
  ? { style: 'currency', currency: format.currency }
  : { style: 'percent', maximumFractionDigits: 2 }

/** A number as the page shows it. */
export const formatValue = (value: number, format: ValueFormat): string =>
  new Intl.NumberFormat(FORMAT_LOCALE, options(format)).format(format.kind === 'percent' ? value / 100 : value)

/** The TS expression that formats the number `code` evaluates to; the currency is a checked ISO 4217 code. */
export const formatCode = (code: string, format: ValueFormat): string => format.kind === 'money'
  ? `new Intl.NumberFormat('${FORMAT_LOCALE}', { style: 'currency', currency: '${format.currency}' }).format(${code})`
  : `new Intl.NumberFormat('${FORMAT_LOCALE}', { style: 'percent', maximumFractionDigits: 2 }).format(${code} / 100)`
