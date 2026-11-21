import { apiQueryUsesOf, isApiSource } from '@bildr/codegen/edit'
import type { ApiModel, ApiSource, ApiUse } from '@bildr/codegen/edit'
import type { Model, PageFile, Value } from '@bildr/codegen/model'
import { routeParams } from './interactionValues.ts'

/**
 * What the editor knows of the API queries a page can use (simple data P7b, SD-A): the queries to offer ("<API> · <query>"), the
 * arguments a page can give a query by itself (a route parameter of the same name), the required ones still missing, what a use
 * answers, and the sample rows the canvas shows for it. Pure reads of the model; the module is the last word on every write
 * (`page_use_add`, `page_use_update`).
 */

type ApiQuery = ApiSource['queries'][number]
export type ApiParam = ApiQuery['params'][number]

/** One API query a page can read. `id` is what a select holds (`api:<datasource id>:<query name>`). */
export interface ApiChoice {
  id: string
  datasource: string
  query: string
  /** `<API> · <query>`, as the pickers say it. */
  label: string
  many: boolean
  /** The model of its rows. */
  model: string
  params: ApiParam[]
}

const PREFIX = 'api:'

export const apiChoiceId = (datasource: string, query: string): string => `${PREFIX}${datasource}:${query}`

const apisOf = (model: Model | null | undefined): ApiSource[] => (model?.datasources ?? []).filter(isApiSource)

const choiceOf = (source: ApiSource, query: ApiQuery): ApiChoice => ({
  id: apiChoiceId(source.id, query.name),
  datasource: source.id,
  query: query.name,
  label: `${source.name} · ${query.name}`,
  many: query.result.many,
  model: query.result.model,
  params: query.params
})

/** Every query of every API of the model; with `many`, only those that answer a list (what a List repeats over). */
export const apiChoices = (model: Model | null | undefined, options: { many?: boolean } = {}): ApiChoice[] =>
  apisOf(model).flatMap(source => source.queries.map(query => choiceOf(source, query))).filter(choice => !options.many || choice.many)

/** The choice an id names (`apiChoiceId`), when the model has that query. */
export const apiChoiceOf = (model: Model | null | undefined, id: string): ApiChoice | undefined =>
  id.startsWith(PREFIX) ? apiChoices(model).find(choice => choice.id === id) : undefined

/** The route parameters of the page are text: a query parameter of the same name (and of a text type) reads the route. */
export const apiAutoArgs = (page: Pick<PageFile, 'path'>, params: ApiParam[]): Record<string, Value> => {
  const route = routeParams(page)
  return Object.fromEntries(params.filter(param => param.type === 'text' && route.includes(param.name)).map(param => [param.name, { $route: param.name }]))
}

/** The required parameters (a path parameter always, a query parameter when it says so) that `args` gives no value. */
export const apiMissingArgs = (params: ApiParam[], args: Record<string, Value | undefined>): ApiParam[] =>
  params.filter(param => (param.in === 'path' || param.required === true) && (args[param.name] === undefined || args[param.name] === null))

/** What a use answers: the models of its API, the one it answers, and whether it is a list of them. */
export interface ApiUseRows {
  models: ApiModel[]
  model: string
  many: boolean
}

export const apiUseRows = (model: Model | null | undefined, use: Pick<ApiUse, 'datasource' | 'query'>): ApiUseRows | undefined => {
  const source = apisOf(model).find(entry => entry.id === use.datasource)
  const query = source?.queries.find(entry => entry.name === use.query)
  return source && query ? { models: source.models, model: query.result.model, many: query.result.many } : undefined
}

const SAMPLE_ROWS = 3
const MAX_DEPTH = 4

const sampleValue = (models: ApiModel[], field: ApiModel['fields'][number], depth: number): unknown => {
  const one = (): unknown => {
    switch (field.type) {
      case 'integer':
      case 'number': return 0
      case 'boolean': return false
      case 'datetime': return '2026-01-01T00:00:00.000Z'
      case 'date': return '2026-01-01'
      case 'uuid': return '00000000-0000-4000-8000-000000000000'
      case 'model': return sampleRecord(models, field.model ?? '', depth + 1)
      default: return field.name
    }
  }
  return field.list ? Array.from({ length: SAMPLE_ROWS }, one) : one()
}

/** One record of `name`: each field's sample (its name for text, 0, false, a fixed date), a nested model's record in it. A model that contains itself stops at a depth. */
const sampleRecord = (models: ApiModel[], name: string, depth = 0): Record<string, unknown> => {
  const model = models.find(entry => entry.name === name)
  if (!model || depth >= MAX_DEPTH) return {}
  return Object.fromEntries(model.fields.map(field => [field.name, sampleValue(models, field, depth)]))
}

/**
 * The rows the canvas shows for an API use: not the API's (the canvas makes no call to it) but a sample made of its model's fields,
 * three rows for a list, one record for a query that answers one.
 */
export const apiSample = (rows: ApiUseRows): unknown =>
  rows.many ? Array.from({ length: SAMPLE_ROWS }, () => sampleRecord(rows.models, rows.model)) : sampleRecord(rows.models, rows.model)

/** The pages that read query `query` of API `datasource`, by name, once each, in the order the module's usage gives them. */
export const apiQueryPages = (model: Model | null | undefined, datasource: string, query: string): string[] =>
  model ? [...new Set(apiQueryUsesOf(model, datasource, query).filter(use => use.kind === 'page').map(use => use.name))] : []

/** Where a query is used, in a line: the first pages by name and a count of the rest ("Used in shop, weather and 2 more"). */
export const usedInPagesWords = (pages: string[], shown = 3): string =>
  `Used in ${pages.length > shown ? `${pages.slice(0, shown).join(', ')} and ${pages.length - shown} more` : pages.join(', ')}`
