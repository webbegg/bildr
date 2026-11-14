import type { Model as ProjectModel, PageFile, Value } from '@bildr/codegen/model'

/**
 * What the canvas shows a page's bindings (P4b; P5 replaces it with the app's
 * live data): by alias, a query's rows from the model's fixtures (one row for
 * a query that returns one), a state's defaults, an action's idle status, and
 * a computed `if`/`then`/`else` over those. `site` is the project. Anything
 * else stays missing and renders as a placeholder.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const pathValue = (data: Record<string, unknown>, path: string): unknown => path.split('.').reduce<unknown>((value, key) => isRecord(value) ? value[key] : undefined, data)

export function designData(model: ProjectModel, page: PageFile | undefined): Record<string, unknown> {
  const data: Record<string, unknown> = { site: { name: model.project.name, ...(model.project.description ? { description: model.project.description } : {}) } }
  if (!page?.uses) return data
  const modules = Object.values(model.modules)
  const queries = modules.flatMap(entry => entry.queries)
  const states = modules.flatMap(entry => entry.state)
  const fixtures = modules.flatMap(entry => entry.fixtures)

  for (const use of page.uses.queries ?? []) {
    const query = queries.find(entry => entry.id === use.query)
    const rows = fixtures.find(entry => entry.entity === query?.from)?.rows ?? []
    if (query) data[use.as] = query.result === 'one' ? rows[0] ?? null : rows
  }
  for (const use of page.uses.state ?? []) {
    const state = states.find(entry => entry.id === use.state)
    if (!state) continue
    const defaults = Object.fromEntries(state.fields.flatMap(field => field.default === undefined ? [] : [[field.name, field.default]]))
    data[use.as] = state.shape === 'many' ? [] : defaults
  }
  for (const use of page.uses.actions ?? []) data[use.as] = { pending: false, error: null }
  for (const computed of page.uses.computed ?? []) {
    const { as, if: condition, then, else: otherwise } = computed as { as: string, if?: Value, then?: Value, else?: Value }
    const pick = (expression: Value | undefined) => isRecord(expression) && typeof expression.$bind === 'string' ? pathValue(data, expression.$bind) : expression
    if (condition !== undefined) data[as] = pick(pick(condition) ? then : otherwise)
  }
  return data
}
