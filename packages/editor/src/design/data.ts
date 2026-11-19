import type { Model as ProjectModel, PageFile, QueryFile, Value } from '@bildr/codegen/model'
import { evaluateQuery } from '@bildr/codegen/query'
import type { Row } from '@bildr/codegen/query'
import type { StatePreview } from './previewState.ts'

/**
 * What the canvas shows a page's bindings (P4b, P5): by alias, a query's rows
 * (the app's, when `rows` has them, else the model's fixtures; evaluated with
 * the query's own where, order and limit by `@bildr/codegen/query`, as the app's
 * query composable does; a `one` query's row or null), a state's defaults, an
 * action's idle status, and a computed `if`/`then`/`else` over those. A state's
 * row is its defaults with the values set in the preview over them (`state`, by
 * state id: B5), so a computed value follows what the preview set. `site` is
 * the project and `$route` the route parameters of the record picked on a
 * detail page. Anything else stays missing and renders as a placeholder.
 */

export interface DataInput {
  /** The app's rows by entity id: what an entity listed here shows instead of its fixtures. */
  rows?: Record<string, Row[]>
  /** The route parameters of the record a detail page shows. */
  route?: Record<string, unknown>
  /** The values set in the preview, by state id then field: they replace the defaults of the fields the state still has. */
  state?: StatePreview
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const pathValue = (data: Record<string, unknown>, path: string): unknown => path.split('.').reduce<unknown>((value, key) => isRecord(value) ? value[key] : undefined, data)

/** The value of a query argument: a literal, a route parameter, or a bound name. */
const argument = (value: Value, data: Record<string, unknown>, route: Record<string, unknown>): unknown => {
  if (isRecord(value) && typeof value.$route === 'string') return route[value.$route]
  if (isRecord(value) && typeof value.$bind === 'string') return pathValue(data, value.$bind)
  return value
}

/** The page's route parameters for the record picked: each parameter reads the field its query condition matches it against. */
export const routeParams = (model: ProjectModel, page: PageFile | undefined, record: Row | undefined): Record<string, unknown> => {
  if (!page || !record) return {}
  const queries = Object.values(model.modules).flatMap(entry => entry.queries)
  const route: Record<string, unknown> = {}
  for (const param of page.params ?? []) {
    const field = detailField(queries, page, param.name)
    route[param.name] = record[field ?? param.name]
  }
  return route
}

/** The query field a route parameter of the page is matched against (`where.field` of the query that takes it), if one does. */
export const detailField = (queries: QueryFile[], page: PageFile, param: string): string | undefined => {
  for (const use of page.uses?.queries ?? []) {
    const query = queries.find(entry => entry.id === use.query)
    const arg = Object.entries(use.args ?? {}).find(([, value]) => isRecord(value) && value.$route === param)?.[0]
    const where = query?.where
    if (arg && where && isRecord(where.value) && where.value.$param === arg) return where.field
  }
  return undefined
}

export function designData(model: ProjectModel, page: PageFile | undefined, input: DataInput = {}): Record<string, unknown> {
  const data: Record<string, unknown> = { site: { name: model.project.name, ...(model.project.description ? { description: model.project.description } : {}) } }
  if (!page?.uses) return data
  const route = input.route ?? {}
  if (Object.keys(route).length) data.$route = route
  const modules = Object.values(model.modules)
  const queries = modules.flatMap(entry => entry.queries)
  const states = modules.flatMap(entry => entry.state)
  const fixtures = modules.flatMap(entry => entry.fixtures)

  for (const use of page.uses.queries ?? []) {
    const query = queries.find(entry => entry.id === use.query)
    if (!query) continue
    const rows = input.rows?.[query.from] ?? fixtures.find(entry => entry.entity === query.from)?.rows ?? []
    const args = Object.fromEntries(Object.entries(use.args ?? {}).map(([name, value]) => [name, argument(value, data, route)]))
    data[use.as] = evaluateQuery(query, rows, args).value
  }
  for (const use of page.uses.state ?? []) {
    const state = states.find(entry => entry.id === use.state)
    if (!state) continue
    const defaults = Object.fromEntries(state.fields.flatMap(field => field.default === undefined ? [] : [[field.name, field.default]]))
    const previewed = input.state?.[state.id] ?? {}
    // Only the fields the State has now: a model edit can remove one before the store has pruned its value (`prunePreviewState`).
    const overrides = Object.fromEntries(state.fields.flatMap(field => Object.hasOwn(previewed, field.name) ? [[field.name, previewed[field.name]]] : []))
    data[use.as] = state.shape === 'many' ? [] : { ...defaults, ...overrides }
  }
  for (const use of page.uses.actions ?? []) data[use.as] = { pending: false, error: null }
  for (const computed of page.uses.computed ?? []) {
    const { as, if: condition, then, else: otherwise } = computed as { as: string, if?: Value, then?: Value, else?: Value }
    const pick = (expression: Value | undefined) => isRecord(expression) && typeof expression.$bind === 'string' ? pathValue(data, expression.$bind) : expression
    if (condition !== undefined) data[as] = pick(pick(condition) ? then : otherwise)
  }
  return data
}
