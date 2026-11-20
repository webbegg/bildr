import type { ApiModel, ApiParam, ApiQuery, DataSourceFile, PageFile } from '../model/schemas.ts'

/**
 * What a page reading a query of an API data source (`uses.apis`, SD-6) can know about it, with nothing but the model: the query behind
 * the use, the rows it answers (a model, one or many), the paths a binding can read below a row, and the arguments the query takes.
 * Pure, so the scope, the usage index, the edits and the generator all say the same.
 */

export type ApiUse = NonNullable<NonNullable<PageFile['uses']>['apis']>[number]

/** What a query answers: the models of its source, the one it answers, and whether it answers a list of them. */
export interface ApiRows {
  models: ApiModel[]
  model: string
  many: boolean
}

export const apiSourceIn = (datasources: DataSourceFile[], id: string): DataSourceFile | undefined =>
  datasources.find(source => source.id === id && source.kind === 'api')

/** The source and the query a use names, when both exist. */
export const apiQueryOf = (datasources: DataSourceFile[], use: Pick<ApiUse, 'datasource' | 'query'>): { source: DataSourceFile, query: ApiQuery } | undefined => {
  const source = apiSourceIn(datasources, use.datasource)
  const query = source?.queries?.find(entry => entry.name === use.query)
  return source && query ? { source, query } : undefined
}

export const apiRowsOf = (source: DataSourceFile, query: ApiQuery): ApiRows => ({ models: source.models ?? [], model: query.result.model, many: query.result.many })

const MAX_DEPTH = 4

/**
 * The paths a binding can read below a row of `model`: each field, a nested model's fields after it (`address.city`), and the `length`
 * of a list. A field that is a model reads as itself too. The models don't loop (the model checks it); the depth is capped all the same.
 */
export const apiFieldPaths = (models: ApiModel[], name: string, prefix = '', depth = 0): string[] => {
  const model = models.find(entry => entry.name === name)
  if (!model || depth >= MAX_DEPTH) return []
  return model.fields.flatMap((field) => {
    const path = `${prefix}${field.name}`
    if (field.list) return [path, `${path}.length`]
    return field.type === 'model' && field.model ? [path, ...apiFieldPaths(models, field.model, `${path}.`, depth + 1)] : [path]
  })
}

/** Whether `members`, the path below a row of `model`, names something the row has: fields down through nested models, then a list's `length`. */
export const apiMembersResolve = (models: ApiModel[], model: string, members: string[]): boolean => {
  let current = models.find(entry => entry.name === model)
  let list = false
  for (const [index, member] of members.entries()) {
    if (list) return member === 'length' && index === members.length - 1
    const field = current?.fields.find(entry => entry.name === member)
    if (!field) return false
    list = !!field.list
    current = field.type === 'model' && !field.list ? models.find(entry => entry.name === field.model) : undefined
  }
  return true
}

/** Whether a param must be given: a path parameter always, a query parameter when it says so. */
export const apiParamRequired = (param: ApiParam): boolean => param.in === 'path' || param.required === true
