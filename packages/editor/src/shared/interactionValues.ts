import { bindingScope } from '@bildr/codegen/edit'
import type { ScopeName } from '@bildr/codegen/edit'
import type { EntityFile, Model, PageFile, PropertyDef } from '@bildr/codegen/model'
import type { FieldType } from './dataModel.ts'
import { stateOfAlias } from './stateModel.ts'

/**
 * What a step's value can be at a node (B3, S2). The module checks a step's value against what receives it (`expectValue` of
 * `@bildr/codegen/edit`: a state field takes its own type, a message's title takes text, a route parameter text or a number…);
 * the picker offers only the names that pass, so a choice is never one the module refuses. A name is typed the way the generated
 * app types it: a field by its type, a field that may be empty (`null`) or unset (`undef`) only where the target takes that, a
 * List's or a query's results by their `length` (a whole list or row is not a value). What is in scope is `bindingScope`, the one
 * the binding pickers use: the List items around the node, then what the page uses (queries, state, actions, computed values), a
 * component's properties or a layout's variables, and the page's route parameters.
 *
 * Not offered, because what they are can't be told here (the module lets them through, and so would a guess): a List item in a
 * layout or component, and a computed value of plain values.
 */

/** The kinds of plain value the generated code tells apart. */
export type Prim = 'string' | 'number' | 'boolean'

const PRIMS: Record<FieldType, Prim> = { text: 'string', image: 'string', date: 'string', datetime: 'string', uuid: 'string', integer: 'number', number: 'number', boolean: 'boolean' }
export const primOf = (type: FieldType): Prim => PRIMS[type]

/** What a place takes: the kinds of plain value, and whether a value that may be empty (`null`) or unset passes. */
export interface Expect {
  prims: readonly Prim[]
  null?: boolean
  undef?: boolean
}

/** Where a value is read: the file (a page, layout or component id), what kind it is, and the node. */
export interface Place {
  file: string
  kind: 'page' | 'layout' | 'component'
  nodeId: string
}

/** A name a value can read: a `bind` of a path (`post.slug`), or a `route` parameter of the page. */
export interface Choice {
  kind: 'bind' | 'route'
  /** The path a `{ $bind }` reads, or the route parameter's name. */
  path: string
  label: string
}

interface Typed {
  prim: Prim
  null?: boolean
  undef?: boolean
}

export interface FieldLike {
  name: string
  type: FieldType
  required?: boolean
  nullable?: boolean
  default?: unknown
}

const ID_FIELD: FieldLike = { name: 'id', type: 'uuid', required: true }
const TIMESTAMPS: FieldLike[] = [{ name: 'createdAt', type: 'datetime', required: true }, { name: 'updatedAt', type: 'datetime', required: true }]

/** An entity's fields plus the key and the timestamps it keeps (the row a query or a List item holds). */
const rowFields = (entity: EntityFile): FieldLike[] => [...(entity.idStrategy === 'uuid' ? [ID_FIELD] : []), ...entity.fields, ...(entity.timestamps ? TIMESTAMPS : [])]

/** A field as the generated schema types it: nullable gives null, and one that is neither required, nullable nor defaulted may be unset. */
const fieldTyped = (field: FieldLike): Typed => ({ prim: primOf(field.type), null: !!field.nullable, undef: !field.required && !field.nullable && field.default === undefined })

const entities = (model: Model): EntityFile[] => Object.values(model.modules).flatMap(mod => mod.entities)

/** A component property or a layout variable as its prop is typed in the generated component: a layout's are unset without a default. */
const propertyTyped = (property: PropertyDef, layout: boolean): Typed | undefined => {
  if (property.kind === 'slot' || property.kind === 'entity') return undefined
  const prim: Prim = property.kind === 'number' ? 'number' : property.kind === 'boolean' ? 'boolean' : 'string'
  const unset = layout ? property.default === undefined : !property.required && property.default === undefined && property.kind !== 'boolean'
  return { prim, undef: unset }
}

const accepts = (expect: Expect, type: Typed): boolean => expect.prims.includes(type.prim) && (!type.null || !!expect.null) && (!type.undef || !!expect.undef)

/** Whether a state's (or any) field, typed as the generated app types it, is a value `expect` takes (B4: the State a prop can bind to). */
export const fieldAccepted = (expect: Expect, field: FieldLike): boolean => accepts(expect, fieldTyped(field))

const pageOf = (model: Model, id: string): PageFile | undefined => Object.values(model.modules).flatMap(mod => mod.pages).find(page => page.id === id)

/** The `:param` names of a page's path. */
export const routeParams = (page: Pick<PageFile, 'path'>): string[] => page.path.split('/').filter(part => part.startsWith(':')).map(part => part.slice(1))

/** The typed members of one name in scope, as `[path, type]`. A name with no members is the value itself when `whole` says so. */
const membersOf = (model: Model, place: Place, entry: ScopeName): Array<[string, Typed]> => {
  const entity = entry.entity ? entities(model).find(item => item.id === entry.entity) : undefined
  if (entity) {
    // A list is read by its length; a row by the fields the name lists.
    if (entry.many) return [[`${entry.name}.length`, { prim: 'number' }]]
    const fields = rowFields(entity)
    return entry.fields.flatMap((name): Array<[string, Typed]> => {
      const field = fields.find(item => item.name === name)
      return field ? [[`${entry.name}.${name}`, fieldTyped(field)]] : []
    })
  }
  switch (entry.source) {
    case 'state': {
      const state = stateOfAlias(model, pageOf(model, place.file), entry.name)
      return (state?.fields ?? []).map((field): [string, Typed] => [`${entry.name}.${field.name}`, fieldTyped(field)])
    }
    case 'action': return [[`${entry.name}.pending`, { prim: 'boolean' }], [`${entry.name}.error`, { prim: 'string', undef: true }]]
    case 'site': return place.kind === 'layout' ? [[`${entry.name}.name`, { prim: 'string' }], [`${entry.name}.description`, { prim: 'string' }]] : []
    case 'layout': {
      const layout = model.layouts.find(item => item.id === place.file)
      return (layout?.variables ?? []).flatMap((variable): Array<[string, Typed]> => {
        const typed = propertyTyped(variable, true)
        return typed ? [[`${entry.name}.${variable.name}`, typed]] : []
      })
    }
    case 'prop': {
      const component = Object.values(model.modules).flatMap(mod => mod.components).find(item => item.id === place.file)
      const property = component?.properties.find(item => item.name === entry.name)
      const typed = property && propertyTyped(property, false)
      return typed ? [[entry.name, typed]] : []
    }
    default: return []
  }
}

/** The List item names of a component's or layout's tree are untyped there (the model only knows a page's): they are not offered. */
const offered = (place: Place, entry: ScopeName): boolean => !(entry.source === 'item' && place.kind !== 'page')

/**
 * The values node `place.nodeId` can read that `expect` takes, in the order the scope lists them (the List item first, then what
 * the page uses), then the page's route parameters.
 */
export function valueChoices(model: Model, place: Place, expect: Expect): Choice[] {
  const scope = bindingScope(model, place.file, place.nodeId)
  const choices: Choice[] = []
  for (const entry of scope) {
    if (!offered(place, entry)) continue
    for (const [path, type] of membersOf(model, place, entry)) {
      if (accepts(expect, type)) choices.push({ kind: 'bind', path, label: path })
    }
  }
  const page = place.kind === 'page' ? pageOf(model, place.file) : undefined
  // A route parameter is text (a path segment); the module reads it as text.
  if (page && expect.prims.includes('string')) {
    for (const name of routeParams(page)) choices.push({ kind: 'route', path: name, label: name })
  }
  return choices
}
