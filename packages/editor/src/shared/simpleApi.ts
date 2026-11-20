import { urlProblem } from '@bildr/codegen/model'
import type { Model } from '@bildr/codegen/model'
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

export const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'integer', label: 'Whole number' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'datetime', label: 'Date and time' },
  { value: 'date', label: 'Date' },
  { value: 'uuid', label: 'Unique id' },
  { value: 'model', label: 'Another model' }
] as const

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
