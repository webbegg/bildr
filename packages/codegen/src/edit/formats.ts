import type { Model } from '../model/load.ts'
import type { ApiModel, ModelNode, Value } from '../model/schemas.ts'
import type { ValueFormat, ValueFormats } from '../render/format.ts'
import { apiQueryOf } from './api-uses.ts'
import { bindingScope } from './scope.ts'
import type { ScopeName } from './scope.ts'

export type { ValueFormats }

/** The props a node shows as text. */
const TEXT_PROPS = ['text'] as const

const isObject = (value: unknown): value is Record<string, Value> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The paths a text value reads: a `$bind`'s, and each `{path}` of a `$template`. */
const pathsOf = (value: Value | undefined): string[] => {
  if (!isObject(value)) return []
  if (typeof value.$bind === 'string') return [value.$bind]
  if (typeof value.$template === 'string') return [...value.$template.matchAll(/\{([\w.]+)\}/g)].map(match => match[1]!)
  return []
}

const formatOfField = (field: { type: string, currency?: string } | undefined): ValueFormat | undefined => {
  if (field?.type === 'money' && field.currency) return { kind: 'money', currency: field.currency }
  if (field?.type === 'percent') return { kind: 'percent' }
  return undefined
}

const apiField = (models: ApiModel[], model: string, members: string[]) => {
  let current = models.find(entry => entry.name === model)
  for (const [index, member] of members.entries()) {
    const field = current?.fields.find(entry => entry.name === member)
    if (!field || field.list) return undefined
    if (index === members.length - 1) return field
    current = field.type === 'model' ? models.find(entry => entry.name === field.model) : undefined
  }
  return undefined
}

const formatOf = (model: Model, file: string, entry: ScopeName, members: string[]): ValueFormat | undefined => {
  if (entry.many || !members.length) return undefined
  if (entry.api) {
    const found = apiQueryOf(model.datasources, entry.api)
    return found ? formatOfField(apiField(found.source.models ?? [], entry.api.model, members)) : undefined
  }
  if (members.length !== 1) return undefined
  const mods = Object.values(model.modules)
  if (entry.entity) return formatOfField(mods.flatMap(mod => mod.entities).find(entity => entity.id === entry.entity)?.fields.find(field => field.name === members[0]))
  if (entry.source === 'state') {
    const use = mods.flatMap(mod => mod.pages).find(page => page.id === file)?.uses?.state?.find(state => state.as === entry.name)
    const state = mods.flatMap(mod => mod.state).find(entry => entry.id === use?.state)
    return formatOfField(state?.fields.find(field => field.name === members[0]))
  }
  return undefined
}

const treeRoot = (model: Model, file: string): ModelNode | undefined => {
  for (const mod of Object.values(model.modules)) {
    const found = mod.pages.find(entry => entry.id === file) ?? mod.components.find(entry => entry.id === file)
    if (found) return found.root
  }
  return model.layouts.find(entry => entry.id === file)?.root
}

/**
 * The money and percent fields each node of `file` (a page, component or layout id) shows as text (field types: formatting): node
 * id → bound path → its format. The generator formats those paths, and the canvas does the same with the same map. A path is
 * formatted when it reads one field of a record: an entity's (a query's row, a List item, an entity property), a single store's,
 * or an API model's, down through nested models.
 */
export const valueFormats = (model: Model, file: string): ValueFormats => {
  const root = treeRoot(model, file)
  const formats: ValueFormats = {}
  const visit = (node: ModelNode) => {
    const paths = TEXT_PROPS.flatMap(prop => pathsOf(node.props?.[prop]))
    if (paths.length) {
      const scope = bindingScope(model, file, node.id)
      for (const path of paths) {
        const [name, ...members] = path.split('.')
        const entry = scope.find(candidate => candidate.name === name)
        const format = entry && formatOf(model, file, entry, members)
        if (format) (formats[node.id] ??= {})[path] = format
      }
    }
    node.children?.forEach(visit)
  }
  if (root) visit(root)
  return formats
}
