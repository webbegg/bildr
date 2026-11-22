import { COLOR_PATTERN, EMAIL_PATTERN } from '../model/field-types.ts'
import type { ApiField, ApiModel, FIELD_TYPES } from '../model/schemas.ts'

/**
 * What `datasource_preview` and `repository_endpoint_test` work out from a REST data
 * source, without fetching (P3c): where a request goes (only under the source's base
 * URL), where the items are in a response, and the entity fields they suggest. Ported
 * from the hosted `shared/data/apiSource.ts`, onto the model's field types: top-level
 * keys only, since the generated adapters map one remote key per field.
 */

export type RemoteUrl = { ok: true, url: string } | { ok: false, message: string }

const RELATIVE = 'Use a path relative to the data source\'s base URL, like "/posts"'
const LEAVES = 'The path can\'t leave the data source\'s base URL'

/** The URL of `path` (relative, with an optional query) under `baseUrl`, or why it can't be fetched. */
export const remoteUrl = (baseUrl: string, path: string): RemoteUrl => {
  if (!baseUrl) return { ok: false, message: 'The data source has no base URL: set it in the model (defaults.baseUrl) or its env var' }
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return { ok: false, message: `The data source's base URL "${baseUrl}" is not a URL` }
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') return { ok: false, message: 'The data source\'s base URL must be http or https' }
  if (base.username || base.password) return { ok: false, message: 'The data source\'s base URL can\'t hold a user name or password' }
  // eslint-disable-next-line no-control-regex
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//') || /[\\#\s\u0000-\u001f]/.test(path) || path.length > 2000) return { ok: false, message: RELATIVE }
  const [pathname = ''] = path.split('?')
  for (const segment of pathname.split('/')) {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return { ok: false, message: RELATIVE }
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) return { ok: false, message: LEAVES }
  }
  const prefix = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`
  const url = new URL(path.replace(/^\/+/, ''), `${base.origin}${prefix}`)
  if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) return { ok: false, message: LEAVES }
  return { ok: true, url: url.href }
}

/** Whether `url` is under `baseUrl` (a redirect may only go there). */
export const isUnder = (baseUrl: string, url: string): boolean => {
  try {
    const root = new URL(baseUrl)
    const target = new URL(url)
    const prefix = root.pathname.endsWith('/') ? root.pathname : `${root.pathname}/`
    return target.origin === root.origin && (target.pathname === root.pathname || target.pathname.startsWith(prefix))
  } catch {
    return false
  }
}

// ── Items and fields ─────────────────────────────────────────────────────

const ITEM_NAMES = ['results', 'data', 'items', 'records']
const SAMPLE_SIZE = 20
const MAX_FIELDS = 50
const KEY = /^[\w$@:-]+$/

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isItemArray = (value: unknown): value is unknown[] => Array.isArray(value) && value.some(isObject)

/**
 * Finds the items in a response: `results`, `data`, `items` or `records`, else the root
 * array, else the first top-level array of objects. `itemsPath` is `''` for the root.
 */
export const detectItems = (json: unknown): { itemsPath: string, items: unknown[] } | null => {
  if (Array.isArray(json)) return { itemsPath: '', items: json }
  if (!isObject(json)) return null
  for (const name of ITEM_NAMES) {
    if (Array.isArray(json[name])) return { itemsPath: name, items: json[name] }
  }
  for (const [key, value] of Object.entries(json)) {
    if (KEY.test(key) && isItemArray(value)) return { itemsPath: key, items: value }
  }
  return null
}

export type FieldType = (typeof FIELD_TYPES)[number]

/** A field `entity_create` takes (with `remote`, the API's key for it). */
export interface InferredField {
  name: string
  type: FieldType
  remote: string
}

/** `full_name` / `First Name` → `fullName` / `firstName`; a valid field name. */
const fieldName = (raw: string): string => {
  const words = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean).map(word => word.toLowerCase())
  let name = words.map((word, index) => index ? word.charAt(0).toUpperCase() + word.slice(1) : word).join('').slice(0, 60)
  if (!name) name = 'field'
  if (/^\d/.test(name)) name = `f${name}`
  return name
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|svg|avif)$/i
const IMAGE_KEY = /image|avatar|photo|thumbnail|picture/i

const isImage = (key: string, value: string) => {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && (IMAGE_FILE.test(url.pathname) || IMAGE_KEY.test(key))
  } catch {
    return false
  }
}

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && value.startsWith(url.protocol)
  } catch {
    return false
  }
}

/** The SaaS type of an API field whose values are all text, when every value passes its check (field types S2): else text. */
const textTypeOf = (values: string[]): ApiField['type'] => {
  if (!values.length) return 'text'
  if (values.every(value => EMAIL_PATTERN.test(value))) return 'email'
  if (values.every(isHttpUrl)) return 'url'
  if (values.every(value => COLOR_PATTERN.test(value))) return 'color'
  return 'text'
}

const typeOf = (key: string, values: unknown[]): FieldType | undefined => {
  if (!values.length) return 'text'
  if (values.every(value => typeof value === 'number')) return values.every(Number.isInteger) ? 'integer' : 'number'
  if (values.every(value => typeof value === 'boolean')) return 'boolean'
  if (!values.every(value => typeof value === 'string')) return undefined
  const strings = values as string[]
  if (strings.every(value => UUID.test(value))) return 'uuid'
  if (strings.every(value => DATE.test(value))) return 'date'
  if (strings.every(value => DATETIME.test(value) && !Number.isNaN(Date.parse(value)))) return 'datetime'
  if (strings.every(value => isImage(key, value))) return 'image'
  return 'text'
}

/**
 * Proposes entity fields from up to 20 items: one per top-level key whose values are all
 * strings, numbers or booleans (empty and null ones ignored); nested objects and lists are
 * left out. A type fits when every sampled value has it. `id` stays `id`: the API's key.
 */
export const inferFields = (items: unknown[]): InferredField[] => {
  const columns = new Map<string, { values: unknown[], skip: boolean }>()
  for (const item of items.slice(0, SAMPLE_SIZE)) {
    if (!isObject(item)) continue
    for (const [key, value] of Object.entries(item)) {
      if (!KEY.test(key)) continue
      const column = columns.get(key) ?? { values: [], skip: false }
      columns.set(key, column)
      if (Array.isArray(value) || isObject(value)) column.skip = true
      else if (value !== null && value !== '' && value !== undefined) column.values.push(value)
    }
  }
  const used = new Set<string>()
  const fields: InferredField[] = []
  for (const [remote, column] of columns) {
    if (column.skip || fields.length >= MAX_FIELDS) continue
    const type = typeOf(remote, column.values)
    if (!type) continue
    const base = fieldName(remote)
    let name = base
    for (let n = 2; used.has(name); n++) name = `${base}${n}`
    used.add(name)
    fields.push({ name, type, remote })
  }
  return fields
}

// ── API models ───────────────────────────────────────────────────────────

const MAX_DEPTH = 5
/** A proposal any user can review: more nested objects than this are left out (their fields with them). */
const MAX_MODELS = 30

/** `order-line` / `order_lines` → `OrderLine` / `OrderLines`; a valid model name, kept as given (`URLList`). */
const modelName = (raw: string): string => {
  if (/^[A-Z][A-Za-z0-9]*$/.test(raw)) return raw
  const camel = fieldName(raw)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

/**
 * Proposes the models of an API answer, in the order `api_model_set` takes them one by one:
 * nested models first, the root model last. `sample` is one object or an array of them (up to 20
 * are read). Fields are camelCase with the remote `key` when it differs; the type comes from
 * the values (an image URL is text); a nested object is a model, a list of objects or scalars
 * a list; null makes a field `nullable`, a key missing in some items `optional`. Each nested
 * object gets a model of its own (named from its key, made unique), so a model never holds
 * itself. Nothing for a sample with no object.
 */
export const inferApiModels = (sample: unknown, rootName: string): ApiModel[] => {
  const objects = (Array.isArray(sample) ? sample.slice(0, SAMPLE_SIZE) : [sample]).filter(isObject)
  if (!objects.length) return []
  const models: ApiModel[] = []
  const taken = new Set<string>()
  const claim = (wanted: string, parent: string | undefined): string => {
    let name = wanted
    if (taken.has(name) && parent) name = `${parent}${wanted}`
    for (let n = 2; taken.has(name); n++) name = `${wanted}${n}`
    taken.add(name)
    return name
  }

  // Builds the model of `items` (objects, in the order found) and returns its name, or undefined when it has no field.
  const build = (wanted: string, items: Record<string, unknown>[], parent: string | undefined, depth: number): string | undefined => {
    const name = claim(modelName(wanted), parent)
    const at = models.push({ name, fields: [] }) - 1
    const usedNames = new Set<string>()
    const fields: ApiField[] = []
    const keys = [...new Set(items.flatMap(item => Object.keys(item)))].filter(key => KEY.test(key) && key.length <= 64)
    for (const key of keys) {
      if (fields.length >= MAX_FIELDS) break
      const present = items.filter(item => Object.hasOwn(item, key))
      const values = present.map(item => item[key])
      const known = values.filter(value => value !== null && value !== undefined)
      const base = fieldName(key)
      let fieldNameOf = base
      for (let n = 2; usedNames.has(fieldNameOf); n++) fieldNameOf = `${base}${n}`
      const flags: Partial<ApiField> = {
        ...(present.length < items.length ? { optional: true } : {}),
        ...(values.length > known.length ? { nullable: true } : {})
      }
      const shape = shapeOf(key, known, name, depth)
      if (!shape) continue
      usedNames.add(fieldNameOf)
      fields.push({ name: fieldNameOf, ...shape, ...(fieldNameOf === key ? {} : { key }), ...flags })
    }
    if (!fields.length) {
      models.splice(at, 1)
      taken.delete(name)
      return undefined
    }
    models[at]!.fields = fields
    return name
  }

  // The type of a field from its non-null values: a model, a list, a scalar, or none when they mix kinds.
  const shapeOf = (key: string, known: unknown[], parent: string, depth: number): Pick<ApiField, 'type' | 'model' | 'list'> | undefined => {
    if (known.every(isObject) && known.length) {
      if (depth >= MAX_DEPTH || models.length >= MAX_MODELS) return undefined
      const model = build(key, known as Record<string, unknown>[], parent, depth + 1)
      return model ? { type: 'model', model } : undefined
    }
    if (known.length && known.every(Array.isArray)) {
      const elements = (known as unknown[][]).flat().filter(value => value !== null && value !== undefined)
      const inner = elements.length && elements.every(isObject) ? shapeOf(key, elements, parent, depth) : scalarOf(key, elements)
      return inner ? { ...inner, list: true } : undefined
    }
    return scalarOf(key, known)
  }

  const scalarOf = (key: string, values: unknown[]): { type: ApiField['type'] } | undefined => {
    if (values.some(value => Array.isArray(value) || isObject(value))) return undefined
    const present = values.filter(value => value !== '')
    const type = typeOf(key, present)
    if (!type) return undefined
    return { type: type === 'text' ? textTypeOf(present as string[]) : type }
  }

  build(rootName, objects, undefined, 0)
  // Built root first, each model before what it holds: reversed, each model comes after every model it names, as api_model_set takes them.
  return models.reverse()
}
