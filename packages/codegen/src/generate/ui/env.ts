import type { BreakpointBase } from '../../design/tokens.ts'
import type { ValueFormats } from '../../edit/formats.ts'
import type { Model } from '../../model/load.ts'
import type { ActionFile, EntityFile, ModelNode, PageFile, Value } from '../../model/schemas.ts'
import type { Field, ModuleContext } from '../context.ts'
import { itemParam, useNames } from '../names.ts'
import { identifier, propertyPath, tsString } from '../text.ts'
import type { Attr } from './markup.ts'

// ── Scope: what a `$bind` path refers to ───────────────────────────────

export type Ctx = 'template' | 'script'

export interface Root {
  /** The expression for `root.members…` in a template or in script setup (where refs need `.value`). */
  resolve: (members: string[], ctx: Ctx) => string
  /** The loading flags of the data behind this root (queries), for loading texts. */
  loading?: () => string[]
  /** The error flags of the data behind this root (API queries), for the error line. */
  errors?: () => string[]
  /** An API query's answer: whether the rows of its model have an `id` (the key of a List over them). */
  api?: { hasId: boolean }
}

export interface Env {
  model: Model
  context?: ModuleContext
  /** For error messages. */
  file: string
  roots: Map<string, Root>
  /** Script declarations the template needs, by kind and alias: `query:featured` → `data`, `loading`… */
  used: Map<string, Set<string>>
  needs: Set<'route' | 'site' | 'form' | 'props' | 'toast' | 'layout'>
  /** The project's breakpoint base: which prefixes its style keys take (`md:` or `max-md:`). */
  base: BreakpointBase
  /** The variant a component renders: its prop, or the `useVariantState` one when it has interactions. */
  variantExpr: string
  /** A component's root: the classes (`group/<name>`) and attributes (`v-on`) its states need. */
  root?: { id: string, classes: string[], attrs: Attr[] }
  /** Per node id, the props variants and property bindings drive (`$$variants` is generator-internal). */
  substitutions?: Map<string, Record<string, Value>>
  /** Per node id, the style keys properties drive. */
  styleBindings?: Map<string, StyleBinding[]>
  /** Script blocks of interaction handlers. */
  handlers: string[][]
  /** The Form being rendered: its action and the entity fields it edits. */
  form?: { fields: Field[] }
  /** Component variants: node id → the style each variant overrides (rendered as a class map) and the variants that hide it. */
  variants?: Map<string, Variant>
  /** The variant class map constants the template uses, in template order. */
  variantLines: string[]
  /** A component's slot properties: node id → slot name (the node's children are the default content). */
  componentSlots?: Map<string, string>
  /** Optional roots (a one-record query) read in script: those a handler `used`, and those it has `guarded` (checked first), which read without `?.`. */
  optional: { used: Set<string>, guarded: Set<string> }
  /** Page aliases (`uses`) by artifact id: an action's alias names its `execute`, a state's its setter. */
  aliases: { actions: Map<string, string>, state: Map<string, string> }
  /**
   * The item names of the Lists around the node being rendered, outermost first, each with the type of one item as a TS type (read
   * when a handler needs it). Only the template has them: a handler the script declares takes the ones it reads as parameters.
   */
  items: Map<string, () => string>
  /** Shared by every copy of the env: the item names a handler under construction has read (undefined outside one). */
  track: { items?: Set<string> }
  /** Shared by every copy of the env: the guarded Page whose missing data is a 404, as its script reads it (`guarded`). */
  notFound: { page?: NotFound }
  /** The money and percent fields the file's nodes show as text, by node id and path (`valueFormats`). */
  formats: ValueFormats
}

/** A guarded Page's 404: shown once nothing it reads is loading or failed and its `when` data is missing. */
export interface NotFound {
  /** What the comment names. */
  subject: string
  /** The script condition of a missing record. */
  condition: string
  message: string
}

export interface Variant {
  /** The base of its class map constants, e.g. `card` for `cardVariants`. */
  base: string
  /** `default`, then every variant of the component, with the node's style in it (overrides and `unset` applied). */
  styles: Array<[string, Record<string, string>]>
  /** Hover and pressed states rendered in CSS: per base variant, the class prefix, the state's style and the keys it changes. */
  pointer: Map<string, Array<{ prefix: string, style: Record<string, string>, keys: string[] }>>
  hiddenIn: string[]
  /** An interactive component's transition timing classes per variant (the target's); empty for instant. */
  timing?: Map<string, string>
}

export interface StyleBinding {
  key: string
  /** The `$bind` path of the property's value (`tone`, `layout.tone`). */
  path: string
  hasDefault: boolean
  select: boolean
  /** The token values it can take: its options, or every value of the token. */
  values: string[]
}

export const use = (env: Env, key: string, part: string) => {
  const parts = env.used.get(key) ?? new Set<string>()
  parts.add(part)
  env.used.set(key, parts)
}

/** `file (node id)`, the prefix of every generator error. */
export const where = (env: Env, node: ModelNode | undefined) => `${env.file}${node ? ` (node ${node.id})` : ''}`

export const fail = (env: Env, node: ModelNode | undefined, message: string): never => {
  throw new Error(`${env.file}${node ? ` (node ${node.id})` : ''}: ${message}`)
}

export const refRoot = (name: string, onUse: () => void, optional?: Env['optional'], loading?: () => string[]): Root => ({
  resolve: (members, ctx) => {
    onUse()
    if (ctx === 'template') return [name, ...members].join('.')
    optional?.used.add(name)
    const chain = optional && !optional.guarded.has(name) ? '?.' : '.'
    return `${name}.value${members.map(member => `${chain}${member}`).join('')}`
  },
  loading
})

/** The item name of a List: itself in the template, the handler's parameter in the script (which the handler being built notes). */
export const itemRoot = (env: Env, as: string, optionalMembers = false): Root => ({
  resolve: (members, ctx) => {
    if (ctx === 'script') env.track.items?.add(as)
    // A row of an API query's answer: a nested model can be missing (optional), so what is read below the row's own fields reads with `?.`.
    return [ctx === 'script' ? itemParam(as) : as, ...members].reduce((code, member, index) => index === 0 ? member : `${code}${optionalMembers && index > 1 ? '?.' : '.'}${member}`)
  }
})

export const plainRoot = (prefix: string, onUse: () => void = () => {}): Root => ({
  resolve: (members) => {
    onUse()
    return [prefix, ...members].join('.')
  }
})

export const bindPath = (env: Env, node: ModelNode | undefined, path: string, ctx: Ctx) => {
  try {
    propertyPath(path, `${env.file}${node ? ` (node ${node.id})` : ''}`)
  } catch (error) {
    throw new Error((error as Error).message, { cause: error })
  }
  const [root, ...members] = path.split('.')
  const entry = env.roots.get(root!)
  if (!entry) return fail(env, node, `"${path}" doesn't refer to anything this file uses`)
  return entry.resolve(members, ctx)
}

export const isObject = (value: unknown): value is Record<string, Value> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A model value as a TS expression. */
export const expression = (env: Env, node: ModelNode | undefined, value: Value | undefined, ctx: Ctx): string => {
  if (value === undefined || value === null) return 'undefined'
  if (typeof value === 'string') return tsString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (!isObject(value)) return fail(env, node, 'lists are not expressions')
  if (isObject(value.$$variants)) {
    return `({ ${Object.entries(value.$$variants).map(([name, item]) => `${name}: ${expression(env, node, item, ctx)}`).join(', ')} })[${env.variantExpr}]`
  }
  if (typeof value.$bind === 'string') {
    const bound = bindPath(env, node, value.$bind, ctx)
    return value.fallback === undefined ? bound : `${bound} ?? ${expression(env, node, value.fallback, ctx)}`
  }
  if ('not' in value) return `!${expression(env, node, value.not, ctx)}`
  if (typeof value.$route === 'string') {
    env.needs.add('route')
    return `route.params.${propertyPath(value.$route, `${env.file}${node ? ` (node ${node.id})` : ''}`)}`
  }
  if (value.$form === true) {
    env.needs.add('form')
    return '{ ...form }'
  }
  if (typeof value.$form === 'string') {
    env.needs.add('form')
    return `form.${propertyPath(value.$form, `${env.file}${node ? ` (node ${node.id})` : ''}`)}`
  }
  if (value.$event === 'checked') return '$event === true'
  if (typeof value.$template === 'string') {
    return `\`${templateParts(value.$template).map(part => part.path ? `\${${bindPath(env, node, part.path, ctx)}}` : part.text.replace(/[`\\$]/g, char => `\\${char}`)).join('')}\``
  }
  return fail(env, node, `can't generate the expression ${JSON.stringify(value)} yet`)
}

/** `"“{quote.text}”"` → literal text and `{path}` parts. */
export const templateParts = (template: string) => template.split(/(\{[\w.]+\})/).filter(Boolean)
  .map(part => /^\{[\w.]+\}$/.test(part) ? { text: '', path: part.slice(1, -1) } : { text: part, path: undefined })

/** The root of a `$bind` value, for loading flags. */
export const bindRoot = (value: Value | undefined) => isObject(value) && typeof value.$bind === 'string' ? value.$bind.split('.')[0]! : undefined

export const loadingOf = (env: Env, value: Value | undefined) => {
  const root = bindRoot(value)
  return root ? env.roots.get(root)?.loading?.() ?? [] : []
}

/** The error flags of what a `$bind` value reads (API queries only). */
export const errorsOf = (env: Env, value: Value | undefined) => {
  const root = bindRoot(value)
  return root ? env.roots.get(root)?.errors?.() ?? [] : []
}

/** What a List or a guarded Page shows when an API query failed. */
export const API_ERROR_TEXT = 'Couldn\'t load this.'

/** A row is keyed by its `id` only when the model has one that is always there: a required, non-null, single text or number. Any other `id` leaves the position. */
export const keyedById = (model: { fields: Array<{ name: string, type: string, optional?: boolean, nullable?: boolean, list?: boolean }> } | undefined): boolean => {
  const id = model?.fields.find(field => field.name === 'id')
  return !!id && !id.optional && !id.nullable && !id.list && ['text', 'integer', 'number'].includes(id.type)
}

/**
 * An API query's answer (`uses.apis`): `data` of the composable, which is undefined until it answers. A list reads as empty then
 * (`(<as> ?? [])`), a one result with `?.`; its loading flag is `<as>Loading` and its error `<as>Error`.
 */
export const apiRoot = (env: Env, as: string, many: boolean, hasId: boolean): Root => ({
  resolve: (members, ctx) => {
    use(env, `api:${as}`, 'data')
    if (ctx === 'template') {
      if (many) return [`(${as} ?? [])`, ...members].join('.')
      return [as, ...members].join('?.')
    }
    env.optional.used.add(as)
    const chain = env.optional.guarded.has(as) ? '.' : '?.'
    return `${as}.value${members.map((member, index) => `${many || index === 0 ? chain : '?.'}${member}`).join('')}`
  },
  loading: () => {
    use(env, `api:${as}`, 'loading')
    return [useNames(as).loading]
  },
  errors: () => {
    use(env, `api:${as}`, 'error')
    return [useNames(as).error]
  },
  api: { hasId }
})

// ── Pages and links ─────────────────────────────────────────────────────

export const pageById = (env: Env, node: ModelNode | undefined, id: string): PageFile => {
  for (const module of Object.values(env.model.modules)) {
    const page = module.pages.find(entry => entry.id === id)
    if (page) return page
  }
  return fail(env, node, `unknown page ${id}`)
}

/** A route location: the path when the page has no params, else the typed named route. */
export const routeLocation = (env: Env, node: ModelNode | undefined, to: Value | undefined, ctx: Ctx): { static?: string, code: string } => {
  if (!isObject(to) || typeof to.page !== 'string') return fail(env, node, 'a link needs `to: { page }`')
  const page = pageById(env, node, to.page)
  const params = isObject(to.params) ? Object.entries(to.params) : []
  if (!params.length) return { static: page.path, code: tsString(page.path) }
  return { code: `{ name: ${tsString(page.name)}, params: { ${params.map(([name, value]) => `${identifier(name, where(env, node))}: ${expression(env, node, value, ctx)}`).join(', ')} } }` }
}

// ── Model lookups and the env ───────────────────────────────────────────

export const actionById = (env: Env, node: ModelNode | undefined, id: Value | undefined): ActionFile =>
  env.context?.module.actions.find(action => action.id === id) ?? fail(env, node, `unknown action ${String(id)}`)

export const entityOf = (env: Env, node: ModelNode | undefined, id: string): EntityFile =>
  env.context?.module.entities.find(entity => entity.id === id) ?? fail(env, node, `unknown entity ${id}`)

/** A fresh env for one generated file. */
export const newEnv = (model: Model, file: string, context?: ModuleContext): Env => ({
  model, context, file, roots: new Map(), used: new Map(), needs: new Set(), handlers: [], variantLines: [], optional: { used: new Set(), guarded: new Set() }, aliases: { actions: new Map(), state: new Map() }, items: new Map(), track: {}, notFound: {}, formats: {},
  base: model.project.breakpointBase ?? 'mobile', variantExpr: 'props.variant'
})
