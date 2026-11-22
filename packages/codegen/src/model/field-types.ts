/**
 * The catalogue of value types a field can have (field types S1): what each one is stored as, the zod check the generated code makes,
 * its sample for the generated tests, and the setting it needs (a select's `options`, money's `currency`). The model schemas, the
 * generators and the editor read the types from here, so a type is added in one place.
 *
 * Basic types: text, integer, number, boolean, datetime, date, uuid. SaaS types, each a basic value with its own check: email, url,
 * image (a url), phone, color, money (a number in a currency), percent (a number, 25 is 25 %) and select (one of its options).
 */

/** Where a type sits in a type picker. */
export type FieldFamily = 'text' | 'number' | 'choice' | 'date' | 'other'

export interface FieldTypeDef {
  family: FieldFamily
  /** What the value is in JSON and in TS. */
  ts: 'string' | 'number' | 'boolean'
  /** The zod check of the value, when it does not depend on the field's settings. */
  zod: string
  /** A value the check takes, named after the field. */
  sample: (name: string) => string | number | boolean
  label: string
  description: string
}

const HTTP_URL = 'z.url({ protocol: /^https?$/ })'
/** A phone number as people write it: digits, spaces, dots, dashes and brackets, an optional `+` in front. */
export const PHONE_PATTERN = /^\+?[\d\s().-]{5,24}$/
/** `#rgb`, `#rrggbb` or `#rrggbbaa`. */
export const COLOR_PATTERN = /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6}|[\da-fA-F]{8})$/
/** What zod's `z.email()` takes (its default pattern), so a value detected as an email passes the generated check. */
export const EMAIL_PATTERN = /^(?!\.)(?!.*\.\.)([\w'+\-.]*)[\w+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/
/** An ISO 4217 currency code: `EUR`, `USD`. */
export const CURRENCY_PATTERN = /^[A-Z]{3}$/

export const VALUE_TYPES = {
  text: { family: 'text', ts: 'string', zod: 'z.string()', sample: name => `${name} 1`, label: 'Text', description: 'Any text' },
  email: { family: 'text', ts: 'string', zod: 'z.email()', sample: name => `${name.toLowerCase()}@example.com`, label: 'Email', description: 'An email address, like ana@example.com' },
  url: { family: 'text', ts: 'string', zod: HTTP_URL, sample: name => `https://example.com/${name}`, label: 'Link', description: 'A web address that starts with http:// or https://' },
  phone: { family: 'text', ts: 'string', zod: `z.string().regex(${PHONE_PATTERN.toString()})`, sample: () => '+1 555 0100', label: 'Phone', description: 'A phone number, like +34 600 123 456' },
  integer: { family: 'number', ts: 'number', zod: 'z.number().int()', sample: () => 1, label: 'Whole number', description: 'A number with no decimals, like 3' },
  number: { family: 'number', ts: 'number', zod: 'z.number()', sample: () => 1.5, label: 'Number', description: 'A number that can have decimals, like 2.5' },
  money: { family: 'number', ts: 'number', zod: 'z.number()', sample: () => 9.99, label: 'Money', description: 'An amount in a currency, like 9.99 EUR' },
  percent: { family: 'number', ts: 'number', zod: 'z.number()', sample: () => 25, label: 'Percent', description: 'A percentage: 25 is 25 %' },
  boolean: { family: 'choice', ts: 'boolean', zod: 'z.boolean()', sample: () => true, label: 'Yes / no', description: 'True or false' },
  select: { family: 'choice', ts: 'string', zod: 'z.string()', sample: () => '', label: 'One of a list', description: 'One of the options you list, like draft or live' },
  datetime: { family: 'date', ts: 'string', zod: 'z.iso.datetime({ offset: true })', sample: () => '2024-01-02T03:04:05.000Z', label: 'Date and time', description: 'A moment, like 2024-01-02T10:00:00Z' },
  date: { family: 'date', ts: 'string', zod: 'z.iso.date()', sample: () => '2024-01-02', label: 'Date', description: 'A day, like 2024-01-02' },
  image: { family: 'other', ts: 'string', zod: HTTP_URL, sample: name => `https://example.com/${name}.png`, label: 'Image', description: 'The web address of an image' },
  color: { family: 'other', ts: 'string', zod: `z.string().regex(${COLOR_PATTERN.toString()})`, sample: () => '#336699', label: 'Color', description: 'A color as a hex code, like #336699' },
  uuid: { family: 'other', ts: 'string', zod: 'z.uuid()', sample: () => '00000000-0000-4000-8000-000000000001', label: 'Unique id', description: 'A UUID, like 3f2b…' }
} as const satisfies Record<string, FieldTypeDef>

export type ValueType = keyof typeof VALUE_TYPES

/** The value types of an API model's field, in picker order. */
export const API_VALUE_TYPES = ['text', 'email', 'url', 'phone', 'integer', 'number', 'money', 'percent', 'boolean', 'select', 'datetime', 'date', 'image', 'color', 'uuid'] as const satisfies readonly ValueType[]

/** What a field needs to say about its value type. */
export interface ValueSettings {
  type: string
  options?: readonly string[]
  currency?: string
}

/** The problems of a field's settings for its type, in the editor's words (`Contact.status` is `where`). */
export const valueSettingsProblems = (field: ValueSettings, where: string): string[] => {
  const problems: string[] = []
  if (field.type === 'select') {
    if (!field.options?.length) problems.push(`${where} is a "select" field: list its options`)
    const seen = new Set<string>()
    for (const option of field.options ?? []) {
      if (seen.has(option)) problems.push(`${where}: the option "${option}" is listed twice`)
      seen.add(option)
    }
  } else if (field.options) problems.push(`${where}: Only a "select" field lists options`)
  if (field.type === 'money') {
    if (field.currency === undefined) problems.push(`${where} is a "money" field: give its currency, like "EUR"`)
  } else if (field.currency !== undefined) problems.push(`${where}: Only a "money" field has a currency`)
  return problems
}
