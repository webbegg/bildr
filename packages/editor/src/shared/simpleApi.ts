import { API_VALUE_TYPES, VALUE_TYPES, urlProblem } from '@bildr/codegen/model'
import type { ValueType, Model } from '@bildr/codegen/model'
import { isApiSource } from '@bildr/codegen/edit'
import type { ApiSource } from '@bildr/codegen/edit'

/**
 * What the simple Data section's API screens read and say that is not about a draft (`editor/simpleApiDraft.ts`): the words for where an
 * API runs and how it signs in, the rule a base URL must meet (the module's own, `urlProblem`, so the editor says what the module would),
 * the names the module takes for a query, an action and a model, and the secret's env var. Pure reads.
 */

/** Where an API's calls run, in the section's words. */
export const RUNTIMES = [
  { value: 'server', label: 'On the server (can use a secret key)', description: 'Your app\'s server makes the calls, so a secret key stays on the server.' },
  { value: 'browser', label: 'In the visitor\'s browser (no secret key)', description: 'Each visitor\'s browser makes the calls: nothing there can be kept secret.' }
] as const

/** How an API signs in. */
export const SIGN_INS = [
  { value: 'none', label: 'No sign-in', description: 'The API is open: anyone can call it.' },
  { value: 'bearer', label: 'Bearer token', description: 'A secret token, sent as “Authorization: Bearer …”.' },
  { value: 'header', label: 'API key header', description: 'A secret key, sent in a header you name.' }
] as const

/** What each write method does, in plain words. */
export const METHODS = [
  { value: 'POST', label: 'POST', description: 'Adds something new' },
  { value: 'PUT', label: 'PUT', description: 'Replaces something that exists' },
  { value: 'PATCH', label: 'PATCH', description: 'Changes part of something' },
  { value: 'DELETE', label: 'DELETE', description: 'Removes something' }
] as const

export const PARAM_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'integer', label: 'Whole number' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / no' }
] as const

const TYPE_ICONS: Record<ValueType, string> = {
  text: 'i-lucide-type',
  email: 'i-lucide-at-sign',
  url: 'i-lucide-link',
  phone: 'i-lucide-phone',
  integer: 'i-lucide-hash',
  number: 'i-lucide-hash',
  money: 'i-lucide-banknote',
  percent: 'i-lucide-percent',
  boolean: 'i-lucide-toggle-left',
  select: 'i-lucide-list',
  datetime: 'i-lucide-calendar-clock',
  date: 'i-lucide-calendar',
  image: 'i-lucide-image',
  color: 'i-lucide-palette',
  uuid: 'i-lucide-fingerprint'
}

/** The types of a model's field, from the catalogue (field types S2), then another model. */
export const FIELD_TYPES = [
  ...API_VALUE_TYPES.map(type => ({ value: type, label: VALUE_TYPES[type].label, description: VALUE_TYPES[type].description, icon: TYPE_ICONS[type] })),
  { value: 'model', label: 'Another model', description: 'A value that has fields of its own', icon: 'i-lucide-shapes' }
]

/** The currencies a money field offers first; one a model names that is not here is offered too. */
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'MXN', 'BRL', 'ARS', 'COP', 'CLP', 'INR', 'CNY', 'SEK', 'NOK', 'DKK', 'PLN']

/** The label of a type of a parameter or a field. */
export const typeLabel = (type: string): string => [...PARAM_TYPES, ...FIELD_TYPES].find(entry => entry.value === type)?.label ?? type

/** Why `value` can't be the base URL of an API, in the module's words (`urlProblem`); nothing when it can. Empty is asked for, not refused. */
export function baseUrlProblem(value: string): string | undefined {
  const typed = value.trim()
  return typed ? urlProblem(typed) : undefined
}

const words = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** What a model is named when the user types words: `product list` → `ProductList` (the module's PascalCase). */
export const modelNameOf = (typed: string): string => words(typed).map(word => word[0]!.toUpperCase() + word.slice(1)).join('')

/** What an API is named when the user types words: `Shop API` → `shop-api` (the module's kebab-case; it also makes its id and env vars). */
export const kebabNameOf = (typed: string): string => words(typed).join('-')

/** What a query or an action is named when the user types words: `list products` → `listProducts` (the module's camelCase). */
export function operationNameOf(typed: string): string {
  const pascal = modelNameOf(typed)
  return pascal ? pascal[0]!.toLowerCase() + pascal.slice(1) : ''
}

/**
 * The name proposed for the model of a body made from a sample: the module's own rule for an answer (`api_try`), the last fixed segment of
 * the path, singular (`/products/:id/reviews` → `Review`); `Body` when the path has none.
 */
export function sampleModelName(path: string): string {
  const segment = path.split('?')[0]!.split('/').filter(part => part && !part.startsWith(':')).at(-1) ?? ''
  const singular = segment.endsWith('ies') ? `${segment.slice(0, -3)}y` : /[^su]s$/.test(segment) ? segment.slice(0, -1) : segment
  return modelNameOf(singular) || 'Body'
}

/** The path parameters a path names (`/products/:id` → `['id']`), in order: the module's own reading of `:name`. */
export const pathParamNames = (path: string): string[] => [...new Set([...path.matchAll(/(?<=\/):([a-z][A-Za-z0-9]*)/g)].map(match => match[1]!))]

/** The API source of the model with this id. */
export const apiSourceOf = (model: Model | null | undefined, id: string): ApiSource | undefined => {
  const source = model?.datasources.find(entry => entry.id === id)
  return source && isApiSource(source) ? source : undefined
}

/** The env var that holds the API's secret (the name only: its value is never in the model nor anywhere the editor can read), when it has one. */
export const secretVarOf = (source: ApiSource): string | undefined => source.auth ? source.env?.[source.auth.secret] : undefined

// The words of an env var, as the module makes them (`generate/text.ts` `snake(camel(name))`, which the package does not export):
// `shop-api` → `SHOP_API`. A digit after a dash joins the word before it, as there.
const pascal = (name: string) => name.split(/[-_\s]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')
const camel = (name: string) => pascal(name).replace(/^./, first => first.toLowerCase())
const upperSnake = (name: string) => camel(name).replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase().replaceAll('-', '_').toUpperCase()
/** `NUXT_APIS_<NAME>_<SETTING>`, the env var of one setting of an API: what the module names the secret's variable. */
const apiEnvName = (name: string, setting: string) => `NUXT_APIS_${upperSnake(name)}_${upperSnake(setting)}`
const legacyEnvName = (name: string, setting: string) => `NUXT_DATASOURCES_${upperSnake(name)}_${upperSnake(setting)}`

/**
 * The env var the API's secret has once the API is called `typed` (`api_update` renames a variable bildr named, and leaves one the user
 * named), when that is not the one it has now: nothing for an API with no sign-in, a name that is the same, or a variable of the user's.
 */
export function secretVarAfterRename(source: ApiSource, typed: string): string | undefined {
  const name = kebabNameOf(typed)
  const secret = source.auth?.secret
  const current = secretVarOf(source)
  if (!secret || !current || !name || name === source.name) return undefined
  return current === apiEnvName(source.name, secret) || current === legacyEnvName(source.name, secret) ? apiEnvName(name, secret) : undefined
}

/** How many items of the list at `path` of an answer (`a.b`; empty for an answer that is the list) are in it, or undefined when there is no list there. */
export function listShown(json: unknown, path: string): number | undefined {
  let at: unknown = json
  for (const key of path.split('.').filter(Boolean)) {
    if (typeof at !== 'object' || at === null || Array.isArray(at)) return undefined
    at = (at as Record<string, unknown>)[key]
  }
  return Array.isArray(at) ? at.length : undefined
}

/** The host of a URL, for a sentence (`This sends a real POST to api.example.com`). */
export const hostOfUrl = (url: string): string => {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** What an item of a list says of itself in one line. */
export const querySummary = (query: ApiSource['queries'][number]): string => `GET ${query.path}`
export const actionSummary = (action: ApiSource['actions'][number]): string => `${action.method} ${action.path}`
export const modelSummary = (model: ApiSource['models'][number]): string => `${model.fields.length} ${model.fields.length === 1 ? 'field' : 'fields'}`
