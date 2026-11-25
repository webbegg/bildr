import { allFields } from '../generate/context.ts'
import type { Field } from '../generate/context.ts'
import { VALUE_TYPES } from '../model/field-types.ts'
import { PROPERTY_PATH } from '../model/schemas.ts'
import type { EntityFile, ModelNode, PropertyDef, StateFile, Value } from '../model/schemas.ts'
import { fail, isObject } from './core.ts'
import type { Draft } from './core.ts'
import { entityNameOf, findEntity } from './entities.ts'
import { bindingScope } from './scope.ts'
import type { ScopeName } from './scope.ts'

/**
 * The values an interaction step or a computed value may hold (B1): what `generate/ui/` can turn into code, checked against what the
 * node or page can read. A literal (text, number, true or false), `{ "$bind": path }` (with an optional `fallback`), `{ "not": value }`,
 * `{ "$route": param }`, `{ "$form": true | field }`, `{ "$template": "text {path}" }` and `{ "$event": "checked" }`. Anything else
 * (`$param`, `$input`, `$now`, `$var`, lists, null) is not generated in a step yet.
 */

export type ExpressionKind = 'bind' | 'not' | 'route' | 'form' | 'template' | 'event'

export interface ExpressionContext {
  draft: Draft
  /** The page, component or layout the value is in. */
  file: string
  kind: 'page' | 'component' | 'layout'
  /** The node it is on: List item names above it are in scope. Without one, the file's own root scope. */
  nodeId?: string
  /** Names the value can't read (a computed value, itself). */
  exclude?: ReadonlySet<string>
  allow: ReadonlySet<ExpressionKind>
  /** The Form the node is, or sits in: what `$form` reads. */
  form?: ModelNode
  /** What the value belongs to, in a refusal: "n_toggle", "the computed value posts". */
  subject: string
  /** The value is one thing (text, a number, true or false), not a list or a whole row: a bare binding of one is refused. */
  scalar?: boolean
}

/** The collection a Form node's action takes, and the fields of it the Form lists. */
export const formOf = (draft: Draft, form: ModelNode): { entity?: EntityFile, fields: Field[] } => {
  const mods = Object.values(draft.model.modules)
  const action = mods.flatMap(mod => mod.actions).find(entry => entry.id === form.props?.action)
  const entity = mods.flatMap(mod => mod.entities).find(entry => entry.id === action?.input.entity)
  const ids = Array.isArray(form.props?.fields) ? form.props.fields : []
  return { entity, fields: entity ? entity.fields.filter(field => ids.includes(field.id)) : [] }
}

/** The names of the fields a Form node holds: the ones of its action's collection it lists. */
const formFieldNames = (draft: Draft, form: ModelNode): string[] => formOf(draft, form).fields.map(field => field.name)

/** The `as` names of the Lists above node `id` (inclusive when `within`), closest first. */
const listItems = (root: ModelNode, id: string): string[] => {
  const chain: ModelNode[] = []
  const find = (node: ModelNode): boolean => {
    chain.push(node)
    if (node.id === id || (node.children ?? []).some(find)) return true
    chain.pop()
    return false
  }
  find(root)
  return chain.slice(0, -1).reverse().flatMap(node => node.type === 'List' && typeof node.props?.as === 'string' ? [node.props.as] : [])
}

/**
 * What the generator resolves a name to in the file: `bindingScope`, less `site`, which only a layout reads (a page's and a component's
 * script has no such name), and with the List item names a component's or layout's tree has (the scope only knows a page's).
 */
const scopeOf = (context: ExpressionContext): ScopeName[] => {
  const scope = bindingScope(context.draft.model, context.file, context.nodeId).filter(entry => entry.name !== 'site' || context.kind === 'layout')
  if (context.kind !== 'page' && context.nodeId) {
    const items = listItems(context.draft.tree(context.file).root, context.nodeId).map((name): ScopeName => ({ name, source: 'item', fields: [], many: false }))
    scope.unshift(...items)
  }
  return scope.filter(entry => !context.exclude?.has(entry.name))
}

/** The scope entry a bound path starts at, after checking the path: its first name is in scope, and what follows is one of its fields. */
export const resolvePath = (context: ExpressionContext, path: string, where: string): { entry: ScopeName, members: string[] } => {
  if (!PROPERTY_PATH.test(path)) fail('invalid', `${where}: "${path}" is not a property path (letters, digits, _ and $, separated by dots)`)
  const [root, ...members] = path.split('.') as [string, ...string[]]
  const scope = scopeOf(context)
  const entry = scope.find(item => item.name === root)
  if (!entry) fail('invalid', `${where}: "${root}" is not something ${context.subject} can read (${scope.map(item => item.name).join(', ') || 'nothing'})`)
  const found = entry!
  if (members.length) {
    if (found.many && members[0] !== 'length') fail('invalid', `${where}: ${root} is a list: read its length, or bind it as a List's items`)
    if (!found.many && found.fields.length && !found.fields.includes(members[0]!)) fail('invalid', `${where}: ${root} has no "${members[0]}" (${found.fields.join(', ')})`)
    // A computed value of plain values (text, numbers, true or false) has no members to read.
    if (found.source === 'computed' && computedType(context, root)?.shape === 'value') fail('invalid', `${where}: ${root} is a plain value, so it has no "${members[0]}": bind ${root} itself`)
  }
  return { entry: found, members }
}

const template = (context: ExpressionContext, text: string, where: string) => {
  for (const [, part] of text.matchAll(/\{([^}]*)\}/g)) resolvePath(context, part!, where)
}

/** Refuses `value` unless the generator can turn it into code in `context`. */
export const checkExpression = (context: ExpressionContext, value: Value | undefined, where: string): void => {
  if (value === undefined || value === null) return fail('invalid', `${where}: needs a value (null is not generated)`)
  if (typeof value !== 'object') return
  if (Array.isArray(value)) return fail('invalid', `${where}: a list is not a value`)
  const keys = Object.keys(value)
  const only = (...allowed: string[]) => {
    const extra = keys.find(key => !allowed.includes(key))
    if (extra) fail('invalid', `${where}: "${extra}" doesn't belong in ${JSON.stringify(value)}`)
  }
  const need = (kind: ExpressionKind, what: string) => {
    if (!context.allow.has(kind)) fail('invalid', `${where}: ${what} can't be used here`)
  }
  if ('$bind' in value) {
    need('bind', 'A binding')
    only('$bind', 'fallback')
    if (typeof value.$bind !== 'string') return fail('invalid', `${where}: $bind is a path, like "preferences.showDrafts"`)
    const { entry, members } = resolvePath(context, value.$bind, where)
    // A name stands for a whole thing unless it ends in a field: a list, a row, a state's row, an action's pending and error.
    const whole = entry.many || entry.entity !== undefined || ['state', 'action', 'site', 'layout'].includes(entry.source)
    if (context.scalar && !members.length && whole) return fail('invalid', `${where}: "${value.$bind}" is ${describeKind(context.draft, entry.many ? 'list' : 'row', entry.entity)}, not one value: bind one of its fields${entry.fields.length ? ` (${entry.fields.map(field => `${entry.name}.${field}`).join(', ')})` : ''}`)
    if (value.fallback !== undefined) checkExpression(context, value.fallback, `${where} fallback`)
    return
  }
  if ('not' in value) {
    need('not', '"not"')
    only('not')
    return checkExpression(context, value.not, where)
  }
  if ('$route' in value) {
    need('route', 'A route parameter')
    only('$route')
    if (context.kind !== 'page') return fail('invalid', `${where}: route parameters are read in pages only`)
    const page = context.draft.page(context.file).page
    if (typeof value.$route !== 'string' || !page.path.split('/').includes(`:${value.$route}`)) return fail('invalid', `${where}: the path ${page.path} of the page has no :${String(value.$route)} parameter`)
    return
  }
  if ('$form' in value) {
    need('form', 'A form value')
    only('$form')
    if (!context.form) return fail('invalid', `${where}: $form reads the Form the node is, or sits in: there is none`)
    if (value.$form === true) return
    const names = formFieldNames(context.draft, context.form)
    if (typeof value.$form !== 'string' || !names.includes(value.$form)) return fail('invalid', `${where}: $form is true (the whole form) or one of the form's fields (${names.join(', ') || 'none'})`)
    return
  }
  if ('$event' in value) {
    need('event', '"$event"')
    only('$event')
    if (value.$event !== 'checked') return fail('invalid', `${where}: only { "$event": "checked" } is generated`)
    return
  }
  if ('$template' in value) {
    need('template', 'A template')
    only('$template')
    if (typeof value.$template !== 'string') return fail('invalid', `${where}: $template is text with {path} parts`)
    return template(context, value.$template, where)
  }
  const dollar = keys.find(key => key.startsWith('$'))
  return fail('invalid', `${where}: ${dollar ? `"${dollar}" is not generated` : `${JSON.stringify(value)} is not a value`} in ${context.subject} yet`)
}

/** What a value stands for, to compare the branches of a computed value: a list of a collection's rows, one row of it, or a plain value. */
export type Shape = { kind: 'list' | 'row', entity: string } | { kind: 'value' }

export const shapeOf = (context: ExpressionContext, value: Value, where: string): Shape => {
  if (!isObject(value) || typeof value.$bind !== 'string') return { kind: 'value' }
  const { entry, members } = resolvePath(context, value.$bind, where)
  if (members.length || !entry.entity) return { kind: 'value' }
  return { kind: entry.many ? 'list' : 'row', entity: entry.entity }
}

/** What a value is, in a refusal, one way everywhere: "a list of Post", "one row of Post" or "a plain value" ("a list", "one row" when the collection is not known). */
export const describeKind = (draft: Draft, kind: 'value' | 'row' | 'list', entity?: string): string =>
  kind === 'value' ? 'a plain value' : `${kind === 'list' ? 'a list' : 'one row'}${entity ? ` of ${entityNameOf(draft, entity)}` : ''}`

// ── Types: what a value is, against what receives it ─────────────────────

/** The kinds of plain value the generated TypeScript tells apart: text (and a date, an image address, a uuid), a number, true or false. */
export type Prim = 'string' | 'number' | 'boolean'

/**
 * What a value is in the generated code, as TypeScript sees it: a plain value (`prims`, which can also be null or unset), a row (its
 * `members`, of `entity` when it is a collection's) or a list of a collection's rows (its `length`).
 */
export interface Typed {
  shape: 'value' | 'row' | 'list'
  prims: Prim[]
  entity?: string
  members?: Record<string, Typed>
  null?: boolean
  undef?: boolean
}

/** The plain kind a field type is in the generated code (the catalogue's TS type). */
export const primOf = (type: Field['type']): Prim => VALUE_TYPES[type].ts

export const PRIM_WORDS: Record<Prim, string> = { string: 'text', number: 'a number', boolean: 'true or false' }

const plain = (prim: Prim, flags: { null?: boolean, undef?: boolean } = {}): Typed => ({ shape: 'value', prims: [prim], ...flags })

/** A field as the generated schema types it (`zodField`): nullable gives null, and a field that is neither required, nullable nor defaulted may be unset. */
const fieldTyped = (field: Field): Typed => plain(primOf(field.type), { null: !!field.nullable, undef: !field.required && !field.nullable && field.default === undefined })

const rowTyped = (members: Record<string, Typed>, entity?: string): Typed => ({ shape: 'row', prims: [], members, ...(entity ? { entity } : {}) })
const listTyped = (entity: string): Typed => ({ shape: 'list', prims: [], entity, members: { length: plain('number') } })

const entityRow = (draft: Draft, id: string): Typed | undefined => {
  const entity = findEntity(draft, id)
  return entity ? rowTyped(Object.fromEntries(allFields(entity).map(field => [field.name, fieldTyped(field)])), entity.id) : undefined
}

const stateRow = (state: StateFile): Typed => rowTyped(Object.fromEntries(state.fields.map(field => [field.name, fieldTyped(field)])))

/** A component property or layout variable as its prop is typed (generate/ui/files.ts, `propertyType`): `layout` ones are unset without a default. */
const propertyTyped = (draft: Draft, property: PropertyDef, layout: boolean): Typed | undefined => {
  if (property.kind === 'slot') return undefined
  if (property.kind === 'entity') {
    if (!property.entity) return undefined
    return property.many ? listTyped(property.entity) : entityRow(draft, property.entity)
  }
  const prim: Prim = property.kind === 'number' ? 'number' : property.kind === 'boolean' ? 'boolean' : 'string'
  const unset = layout ? property.default === undefined : !property.required && property.default === undefined && property.kind !== 'boolean'
  return plain(prim, { undef: unset })
}

const pageOf = (context: ExpressionContext) => context.kind === 'page' ? context.draft.page(context.file).page : undefined

/** The kinds both are, or undefined when they differ or are unknown. */
export const eitherTyped = (a?: Typed, b?: Typed): Typed | undefined => {
  if (!a || !b || a.shape !== b.shape) return undefined
  if (a.shape !== 'value') return a.entity !== undefined && a.entity === b.entity ? a : undefined
  return { shape: 'value', prims: [...new Set([...a.prims, ...b.prims])], null: !!a.null || !!b.null, undef: !!a.undef || !!b.undef }
}

const typeOfEntry = (context: ExpressionContext, entry: ScopeName, seen: ReadonlySet<string>): Typed | undefined => {
  const { draft } = context
  switch (entry.source) {
    case 'item':
    case 'query':
      if (!entry.entity) return undefined
      return entry.many ? listTyped(entry.entity) : entityRow(draft, entry.entity)
    case 'computed':
      return computedTyped(context, entry.name, seen)
    case 'state': {
      const use = pageOf(context)?.uses?.state?.find(item => item.as === entry.name)
      const state = use && Object.values(draft.model.modules).flatMap(mod => mod.state).find(item => item.id === use.state)
      return state ? stateRow(state) : undefined
    }
    case 'action':
      return rowTyped({ pending: plain('boolean'), error: plain('string', { undef: true }) })
    case 'site':
      return rowTyped({ name: plain('string'), description: plain('string') })
    case 'prop': {
      const component = Object.values(draft.model.modules).flatMap(mod => mod.components).find(item => item.id === context.file)
      const property = component?.properties.find(item => item.name === entry.name)
      return property && propertyTyped(draft, property, false)
    }
    case 'layout': {
      const layout = draft.model.layouts.find(item => item.id === context.file)
      return rowTyped(Object.fromEntries((layout?.variables ?? []).flatMap((variable) => {
        const typed = propertyTyped(draft, variable, true)
        return typed ? [[variable.name, typed]] : []
      })))
    }
  }
}

/** What a page's computed value is: what its `then` and `else` both are. */
const computedTyped = (context: ExpressionContext, as: string, seen: ReadonlySet<string>): Typed | undefined => {
  const entry = ((pageOf(context)?.uses?.computed ?? []) as Array<{ as: string, then?: Value, else?: Value }>).find(item => item.as === as)
  if (!entry || seen.has(as)) return undefined
  const inner: ExpressionContext = { ...context, nodeId: undefined, exclude: undefined }
  const next = new Set(seen).add(as)
  return eitherTyped(typeOfValue(inner, entry.then, next), typeOfValue(inner, entry.else, next))
}

/** What the computed value `as` of the page is, or undefined when it can't be told. */
export const computedType = (context: ExpressionContext, as: string): Typed | undefined => computedTyped(context, as, new Set())

const typeOfPath = (context: ExpressionContext, path: string, seen: ReadonlySet<string>): Typed | undefined => {
  const [root, ...members] = path.split('.') as [string, ...string[]]
  const entry = scopeOf(context).find(item => item.name === root)
  let type = entry && typeOfEntry(context, entry, seen)
  for (const member of members) type = type?.members?.[member]
  return type
}

/** What `value` is, or undefined when it can't be told (the check then lets it through: the generator is the last word). */
export const typeOfValue = (context: ExpressionContext, value: Value | undefined, seen: ReadonlySet<string> = new Set()): Typed | undefined => {
  if (typeof value === 'string') return plain('string')
  if (typeof value === 'number') return plain('number')
  if (typeof value === 'boolean') return plain('boolean')
  if (!isObject(value)) return undefined
  if (typeof value.$bind === 'string') {
    const bound = typeOfPath(context, value.$bind, seen)
    if (!bound || value.fallback === undefined) return bound
    // `bound ?? fallback`: never null or unset, and either of the two.
    const fallback = typeOfValue(context, value.fallback, seen)
    if (!fallback || bound.shape !== 'value' || fallback.shape !== 'value') return undefined
    return { shape: 'value', prims: [...new Set([...bound.prims, ...fallback.prims])], null: fallback.null, undef: fallback.undef }
  }
  if ('not' in value || value.$event !== undefined) return plain('boolean')
  if (value.$route !== undefined || value.$template !== undefined) return plain('string')
  if (value.$form !== undefined && context.form) {
    const { entity, fields } = formOf(context.draft, context.form)
    // The form's values start as the field's default or an empty one: never null or unset.
    const members = Object.fromEntries(fields.map(field => [field.name, plain(primOf(field.type))]))
    if (value.$form === true) return rowTyped(members, entity?.id)
    return typeof value.$form === 'string' ? members[value.$form] : undefined
  }
  return undefined
}

/** `value` as a refusal names it: a binding by its path, anything else as it is written. */
export const describeValue = (value: Value | undefined): string =>
  isObject(value) && typeof value.$bind === 'string' ? `"${value.$bind}"` : JSON.stringify(value)

const wordsOf = (prims: Prim[]) => prims.map(prim => PRIM_WORDS[prim]).join(' or ')

/** What a typed value is, in a refusal: the kinds of plain value it is, or `describeKind` of a row or a list. */
export const describeTyped = (draft: Draft, type: Typed): string => type.shape === 'value' ? wordsOf(type.prims) : describeKind(draft, type.shape, type.entity)

/** What a place takes: the kinds of plain value, and whether null or unset passes. */
export interface Expect {
  prims: Prim[]
  null?: boolean
  undef?: boolean
}

/**
 * Refuses `value` when what it is can't go where `target` is ("the field title of reading", "a toast title"): another kind of plain value, a
 * whole row or list, or one that may be empty where the place takes only a value. What can't be told is let through.
 */
export const expectValue = (context: ExpressionContext, value: Value | undefined, where: string, target: string, expect: Expect): void => {
  const type = typeOfValue(context, value)
  if (!type) return
  const label = describeValue(value)
  const takes = `${target} takes ${wordsOf(expect.prims)}`
  if (type.shape !== 'value') return fail('invalid', `${where}: ${label} is ${describeKind(context.draft, type.shape, type.entity)}, but ${takes}: bind one of its fields`)
  const wrong = type.prims.find(prim => !expect.prims.includes(prim))
  if (wrong) return fail('invalid', `${where}: ${label} is ${PRIM_WORDS[wrong]}, but ${takes}`)
  if (type.null && !expect.null) return fail('invalid', `${where}: ${label} can be empty (null), but ${takes}: give the binding a fallback`)
  if (type.undef && !expect.undef) return fail('invalid', `${where}: ${label} can be unset, but ${takes}: give the binding a fallback`)
}
