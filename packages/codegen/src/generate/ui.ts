import { customColorNames } from '../design/theme.ts'
import { displayFallback, orderedStyleTokens, parseStyleKey, styleClasses, styleInline, styleTokenProblem } from '../design/tokens.ts'
import type { BreakpointBase } from '../design/tokens.ts'
import { apiQueryOf, apiRowsOf } from '../edit/api-uses.ts'
import { apiComposableName } from '../edit/generated-names.ts'
import type { Model } from '../model/load.ts'
import type { ActionFile, ComponentFile, EntityFile, LayoutFile, ModelNode, PageFile, PropertyDef, QueryFile, Value } from '../model/schemas.ts'
import {
  animatedProperties, CARD_DEFAULT_STYLE, CARD_STACK_KEYS, CARD_SURFACE_CLASS, CARD_SURFACE_STYLE, childrenInStack, CONTAINER_TAGS, containerTag, DEFAULT_HEADING_LEVEL,
  DEFAULT_TRANSITION, displayOf, fallbackStyle, HEADING_TOKENS, headingLevel, headingTag, ICON_CLASS, IMAGE_FALLBACK_STYLE, INPUT_CONTROL_CLASS, LINK_CLASS,
  LINK_ICON_CLASS, LINK_ICON_DISPLAY, linkTarget, LOAD_MORE_CLASS, LOAD_MORE_LABEL, loadMoreSize, NODE_ELEMENTS, nodePropProblems, selfFallback, structuralStyle, TEXT_CLASS, transitionTimingClasses, uiStepProblems
} from '../render/rules.ts'
import type { GeneratedFile } from '../sync/plan.ts'
import { entityNames, moduleContext } from './context.ts'
import type { Field, ModuleContext } from './context.ts'
import { camel, identifier, kebab, pascal, propertyPath, tsString } from './text.ts'

/**
 * The UI of the app (T7c): layouts, pages and components, rendered from the
 * model's node trees into SFCs that use Nuxt UI, the token registry's
 * classes and the generated composables. One renderer for the three kinds,
 * so a node looks the same wherever it sits. Pure and deterministic.
 */
export const generateUi = (model: Model): GeneratedFile[] => {
  const files: GeneratedFile[] = model.layouts.map(layout => layoutFile(model, layout))
  for (const name of Object.keys(model.modules).sort()) {
    const context = moduleContext(model, name)
    for (const component of context.module.components) files.push(componentFile(context, component))
    for (const page of context.module.pages) files.push(pageFile(context, page))
  }
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

// ── Scope: what a `$bind` path refers to ───────────────────────────────

type Ctx = 'template' | 'script'

interface Root {
  /** The expression for `root.members…` in a template or in script setup (where refs need `.value`). */
  resolve: (members: string[], ctx: Ctx) => string
  /** The loading flags of the data behind this root (queries), for loading texts. */
  loading?: () => string[]
  /** The error flags of the data behind this root (API queries), for the error line. */
  errors?: () => string[]
  /** An API query's answer: whether the rows of its model have an `id` (the key of a List over them). */
  api?: { hasId: boolean }
}

interface Env {
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
}

interface Variant {
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

interface StyleBinding {
  key: string
  /** The `$bind` path of the property's value (`tone`, `layout.tone`). */
  path: string
  hasDefault: boolean
  select: boolean
  /** The token values it can take: its options, or every value of the token. */
  values: string[]
}

const use = (env: Env, key: string, part: string) => {
  const parts = env.used.get(key) ?? new Set<string>()
  parts.add(part)
  env.used.set(key, parts)
}

/** `file (node id)`, the prefix of every generator error. */
const where = (env: Env, node: ModelNode | undefined) => `${env.file}${node ? ` (node ${node.id})` : ''}`

const fail = (env: Env, node: ModelNode | undefined, message: string): never => {
  throw new Error(`${env.file}${node ? ` (node ${node.id})` : ''}: ${message}`)
}

const refRoot = (name: string, onUse: () => void, optional?: Env['optional'], loading?: () => string[]): Root => ({
  resolve: (members, ctx) => {
    onUse()
    if (ctx === 'template') return [name, ...members].join('.')
    optional?.used.add(name)
    const chain = optional && !optional.guarded.has(name) ? '?.' : '.'
    return `${name}.value${members.map(member => `${chain}${member}`).join('')}`
  },
  loading
})

/** The parameter a handler takes a List's item `as` as: the script has no `post`, only what the template passes. */
const itemParam = (as: string) => `${as}Item`

/** The item name of a List: itself in the template, the handler's parameter in the script (which the handler being built notes). */
const itemRoot = (env: Env, as: string, optionalMembers = false): Root => ({
  resolve: (members, ctx) => {
    if (ctx === 'script') env.track.items?.add(as)
    // A row of an API query's answer: a nested model can be missing (optional), so what is read below the row's own fields reads with `?.`.
    return [ctx === 'script' ? itemParam(as) : as, ...members].reduce((code, member, index) => index === 0 ? member : `${code}${optionalMembers && index > 1 ? '?.' : '.'}${member}`)
  }
})

const plainRoot = (prefix: string, onUse: () => void = () => {}): Root => ({
  resolve: (members) => {
    onUse()
    return [prefix, ...members].join('.')
  }
})

const bindPath = (env: Env, node: ModelNode | undefined, path: string, ctx: Ctx) => {
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

const isObject = (value: unknown): value is Record<string, Value> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A model value as a TS expression. */
const expression = (env: Env, node: ModelNode | undefined, value: Value | undefined, ctx: Ctx): string => {
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
const templateParts = (template: string) => template.split(/(\{[\w.]+\})/).filter(Boolean)
  .map(part => /^\{[\w.]+\}$/.test(part) ? { text: '', path: part.slice(1, -1) } : { text: part, path: undefined })

/** The root of a `$bind` value, for loading flags. */
const bindRoot = (value: Value | undefined) => isObject(value) && typeof value.$bind === 'string' ? value.$bind.split('.')[0]! : undefined

const loadingOf = (env: Env, value: Value | undefined) => {
  const root = bindRoot(value)
  return root ? env.roots.get(root)?.loading?.() ?? [] : []
}

/** The error flags of what a `$bind` value reads (API queries only). */
const errorsOf = (env: Env, value: Value | undefined) => {
  const root = bindRoot(value)
  return root ? env.roots.get(root)?.errors?.() ?? [] : []
}

/** What a List or a guarded Page shows when an API query failed. */
const API_ERROR_TEXT = 'Couldn\'t load this.'

/**
 * An API query's answer (`uses.apis`): `data` of the composable, which is undefined until it answers. A list reads as empty then
 * (`(<as> ?? [])`), a one result with `?.`; its loading flag is `<as>Loading` and its error `<as>Error`.
 */
const apiRoot = (env: Env, as: string, many: boolean, hasId: boolean): Root => ({
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
    return [`${as}Loading`]
  },
  errors: () => {
    use(env, `api:${as}`, 'error')
    return [`${as}Error`]
  },
  api: { hasId }
})

// ── Markup helpers ──────────────────────────────────────────────────────

/** Line terminators other than \n become character references, so a model value never splits or reflows generated lines. */
const LINE_TERMINATORS = new RegExp(`[\r${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, 'g')
const escapeLines = (text: string) => text.replace(LINE_TERMINATORS, char => `&#${char.charCodeAt(0)};`)
const escapeText = (text: string) => escapeLines(text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{\{/g, '&#123;&#123;'))
const escapeAttr = (text: string) => escapeLines(text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'))

/** Directive order of eslint-plugin-vue's attributes-order. */
const ORDER = { for: 0, if: 1, key: 2, model: 3, attr: 4, event: 5 } as const
type Attr = { kind: keyof typeof ORDER, text: string }
const attr = (kind: Attr['kind'], text: string): Attr => ({ kind, text })
const staticAttr = (name: string, value: string) => attr('attr', `${name}="${escapeAttr(value)}"`)
const boundAttr = (name: string, code: string) => attr('attr', `:${name}="${escapeAttr(code)}"`)

const openTag = (tag: string, attrs: Attr[]) => {
  const sorted = attrs.map((entry, index) => ({ entry, index })).sort((a, b) => ORDER[a.entry.kind] - ORDER[b.entry.kind] || a.index - b.index)
  return [tag, ...sorted.map(({ entry }) => entry.text)].join(' ')
}

/** HTML void elements: never closed (`<img …>`). */
const VOID_TAGS = ['img']

/** An element: self-closed when empty, one line for text, nested lines otherwise. */
const element = (tag: string, attrs: Attr[], inner: string | string[] | undefined, indent: string): string[] => {
  const open = openTag(tag, attrs)
  if (VOID_TAGS.includes(tag)) return [`${indent}<${open}>`]
  if (inner === undefined || (Array.isArray(inner) && !inner.length)) return [`${indent}<${open} />`]
  if (typeof inner === 'string') return [`${indent}<${open}>${inner}</${tag}>`]
  return [`${indent}<${open}>`, ...inner, `${indent}</${tag}>`]
}

/**
 * A string literal for an interpolation (`{{ 'a\nb' }}`): `tsString`, with the characters that could end the
 * interpolation or open a tag written as escapes, so the template parser never sees them.
 */
const interpolatedString = (text: string) => tsString(text).replace(/[<>&{}]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)

/**
 * Static text in a template. Vue condenses whitespace in template text (a newline becomes a space), so text with
 * a line break, which the canvas keeps (`whitespace-pre-line`), goes out as a string expression instead.
 */
const staticText = (text: string) => text.includes('\n') ? `{{ ${interpolatedString(text)} }}` : escapeText(text)

/** Text content: static text escaped, `$template` interpolated, other values as one interpolation. */
const textContent = (env: Env, node: ModelNode, value: Value | undefined): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value === 'string') return staticText(value)
  if (isObject(value) && typeof value.$template === 'string') {
    return templateParts(value.$template).map(part => part.path ? `{{ ${bindPath(env, node, part.path, 'template')} }}` : staticText(part.text)).join('')
  }
  return `{{ ${expression(env, node, value, 'template')} }}`
}

interface StyleOptions {
  /** The display class of the type (`displayOf`); a base `display` token replaces it. */
  display?: string
  /** The token fallbacks of the type (render rules); a token of the same key replaces each. */
  fallback?: Record<string, string>
  /** Fixed classes of the type, before the tokens. */
  classes?: string[]
  /** The style keys this element takes (a Card splits its style between the card and its inner stack). */
  pick?: (key: string) => boolean
  /** The class map name's part for this element, e.g. `Stack` for `cardStackVariants`. */
  part?: string
}

/** The node's classes, checked against the token registry: an unknown token is an error, not a silent drop. */
const styleAttrs = (env: Env, node: ModelNode, { display = '', fallback = {}, classes: fixed = [], pick = () => true, part = '' }: StyleOptions = {}): Attr[] => {
  const style = node.style ?? {}
  const custom = customColorNames(env.model.theme)
  for (const [key, value] of Object.entries(style)) {
    const problem = styleTokenProblem(key, value, custom, env.base)
    if (problem) fail(env, node, problem)
  }
  const mine = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).filter(([key]) => pick(key)))
  const full = mine({ ...fallback, ...style })
  const variant = env.variants?.get(node.id)
  const bound = (env.styleBindings?.get(node.id) ?? []).filter(binding => pick(binding.key))
  const keys = variant
    ? [...new Set([...variant.styles.flatMap(([, entry]) => changedKeys(style, entry)), ...[...variant.pointer.values()].flat().flatMap(state => state.keys)])].filter(pick)
    : []
  if (bound.some(binding => keys.includes(binding.key))) fail(env, node, 'a style a property drives is also overridden by a variant')
  const excluded = new Set([...keys, ...bound.map(binding => binding.key)])
  const own = Object.fromEntries(Object.entries(full).filter(([key]) => !excluded.has(key)))
  // An interactive component animates what its variants change, with the timing of the variant it goes to.
  const timings = variant?.timing && keys.length ? [...variant.timing.values()] : []
  const animated = timings.some(Boolean) ? animatedProperties(keys) : []
  const sharedTiming = animated.length && new Set(timings).size === 1 ? timings[0]! : ''
  const rootClasses = env.root?.id === node.id && !part ? env.root.classes : []
  const classes = [...fixed, display ? displayFallback(display, style) : '', ...rootClasses, animated.length ? `transition-[${animated.join(',')}]` : '', sharedTiming, styleClasses(own)].filter(Boolean).join(' ')
  const inline = Object.entries(styleInline(own)).map(([property, value]) => `${property}: ${value}`).join('; ')
  const maps: string[] = []
  if (variant && keys.length) {
    // Variant overrides become a class map; the default entry holds what the node renders without one.
    const map = `${variant.base}${part}Variants`
    const only = (entries: Record<string, string>, subset = keys) => Object.fromEntries(subset.filter(key => keys.includes(key) && entries[key] !== undefined).map(key => [key, entries[key]!]))
    const perVariant = variant.styles.map(([name, entry]): [string, string] => [name, [
      styleClasses(only({ ...fallback, ...entry })),
      ...(variant.pointer.get(name) ?? []).map(state => prefixedClasses(only({ ...fallback, ...state.style }, state.keys), state.prefix)),
      animated.length && !sharedTiming ? variant.timing!.get(name) || 'duration-0' : ''
    ].filter(Boolean).join(' ')])
    env.needs.add('props')
    env.variantLines.push('', `const ${map} = {`, perVariant.map(([name, value]) => `  ${name}: ${tsString(value)}`).join(',\n'), '} as const')
    maps.push(`${map}[${env.variantExpr}]`)
  }
  for (const binding of bound) {
    // A style a property drives: a class map of the values it can take, indexed by the property.
    const map = `${camel(node.id.replace(/^n_/, ''))}${pascal(binding.key.replace(/[^A-Za-z0-9]+/g, ' ').replace(/\s+(\w)/g, (_, char: string) => char.toUpperCase()))}Classes`
    const entries = binding.values.map(value => [value, styleClasses({ [binding.key]: value })] as const).filter(([, value]) => value)
    const quote = entries.some(([value]) => !/^[A-Za-z_$][\w$]*$/.test(value))
    const typed = binding.select && binding.hasDefault
    env.variantLines.push('', typed ? `const ${map} = {` : `const ${map}: Record<string, string> = {`, entries.map(([value, classes]) => `  ${quote ? tsString(value) : value}: ${tsString(classes)}`).join(',\n'), typed ? '} as const' : '}')
    const value = bindPath(env, node, binding.path, 'template')
    const fallbackValue = full[binding.key]
    maps.push(`${map}[${value}${binding.hasDefault ? '' : ` ?? ${tsString(fallbackValue ?? '')}`}]`)
  }
  return [
    ...(classes ? [staticAttr('class', classes)] : []),
    ...(maps.length ? [boundAttr('class', maps.length === 1 ? maps[0]! : `[${maps.join(', ')}]`)] : []),
    ...(inline ? [staticAttr('style', inline)] : [])
  ]
}

/** The keys whose values differ between two styles. */
const changedKeys = (a: Record<string, string>, b: Record<string, string>) => Object.keys({ ...a, ...b }).filter(key => a[key] !== b[key])

/** A style's classes under a state variant: `group-hover/card:p-4` or `hover:p-4`, after the breakpoint (`md:group-hover/card:p-4`). */
const prefixedClasses = (style: Record<string, string>, prefix: string) => orderedStyleTokens(style).filter(token => token.className)
  .map(token => token.breakpoint ? `${token.breakpoint}:${prefix}${token.className.slice(token.breakpoint.length + 1)}` : `${prefix}${token.className}`).join(' ')

/** A static string as an attribute, any other value bound. */
const valueAttr = (env: Env, node: ModelNode, name: string, value: Value): Attr =>
  typeof value === 'string' ? staticAttr(name, value) : boundAttr(name, expression(env, node, value, 'template'))

/** `v-if` from `visible` and from the variants that hide the node. */
const visibility = (env: Env, node: ModelNode): Attr[] => {
  const conditions: string[] = []
  if (node.props?.visible !== undefined) conditions.push(expression(env, node, node.props.visible, 'template'))
  for (const name of env.variants?.get(node.id)?.hiddenIn ?? []) {
    env.needs.add('props')
    conditions.push(`${env.variantExpr} !== ${tsString(name)}`)
  }
  return conditions.length ? [attr('if', `v-if="${escapeAttr(conditions.join(' && '))}"`)] : []
}

// ── Pages and links ─────────────────────────────────────────────────────

const pageById = (env: Env, node: ModelNode | undefined, id: string): PageFile => {
  for (const module of Object.values(env.model.modules)) {
    const page = module.pages.find(entry => entry.id === id)
    if (page) return page
  }
  return fail(env, node, `unknown page ${id}`)
}

/** A route location: the path when the page has no params, else the typed named route. */
const routeLocation = (env: Env, node: ModelNode | undefined, to: Value | undefined, ctx: Ctx): { static?: string, code: string } => {
  if (!isObject(to) || typeof to.page !== 'string') return fail(env, node, 'a link needs `to: { page }`')
  const page = pageById(env, node, to.page)
  const params = isObject(to.params) ? Object.entries(to.params) : []
  if (!params.length) return { static: page.path, code: tsString(page.path) }
  return { code: `{ name: ${tsString(page.name)}, params: { ${params.map(([name, value]) => `${identifier(name, where(env, node))}: ${expression(env, node, value, ctx)}`).join(', ')} } }` }
}

// ── Nodes ───────────────────────────────────────────────────────────────

const tagOf = (env: Env, node: ModelNode) =>
  containerTag(node.props?.tag) ?? fail(env, node, `tag must be one of ${CONTAINER_TAGS.join(', ')}`)

interface RenderOptions {
  /** Extra attributes from the parent (a List's v-for and key). */
  attrs?: Attr[]
  /** Layout slots: node id → slot name. */
  slots?: Map<string, string>
  /** The parent lays its children out in a vertical stack (`childrenInStack`), so `selfFallback` applies. */
  inStack?: boolean
  /** The root of a page: its SlotFills fill the slots of the page's layout. */
  pageRoot?: boolean
}

const SLOT_FILL = 'SlotFill'

/** The node's children, one level deeper (`depth` more for a wrapper), laid out the way the node lays them out. */
const children = (env: Env, node: ModelNode, indent: string, options: RenderOptions, kids = node.children ?? [], depth = 1) =>
  kids.flatMap(child => render(env, child, `${indent}${'  '.repeat(depth)}`, { slots: options.slots, inStack: childrenInStack(node.type, node.props) }))

/** The token fallbacks of a node in its parent: the type's (render rules) after the stack's `self: stretch`. */
const fallbackOf = (node: ModelNode, options: RenderOptions, own: Record<string, string> = fallbackStyle(node.type, node.props)) =>
  ({ ...selfFallback(node.type, node.style, options.inStack), ...own })

/** A layout's or component's slot around a node's children, which stay its default content. */
const slotted = (env: Env, node: ModelNode, inner: string[], indent: string, options: RenderOptions) => {
  const layoutSlot = options.slots?.get(node.id)
  const slot = layoutSlot ?? env.componentSlots?.get(node.id)
  if (!slot) return inner
  if (!/^[A-Za-z_][\w-]*$/.test(slot)) fail(env, node, `"${slot}" is not a slot name (letters, digits, _ and -)`)
  const name = layoutSlot === 'children' ? '' : ` name="${slot}"`
  return inner.length ? [`${indent}<slot${name}>`, ...inner.map(line => `  ${line}`), `${indent}</slot>`] : [`${indent}<slot${name} />`]
}

const render = (env: Env, original: ModelNode, indent: string, options: RenderOptions = {}): string[] => {
  const problem = nodePropProblems(original.type, original.props)[0]
  if (problem) fail(env, original, problem.message)
  // Props a variant overrides or a property drives become expressions.
  const swapped = env.substitutions?.get(original.id)
  const node = swapped ? { ...original, props: { ...original.props, ...swapped } } : original
  const extra = [...(options.attrs ?? []), ...visibility(env, node), ...(env.root?.id === node.id ? env.root.attrs : [])]
  switch (node.type) {
    case 'Page':
    case 'Container':
    case 'Row':
    case 'Column':
    case 'Grid': {
      const tag = node.type === 'Column' || node.type === 'Grid' ? 'div' : tagOf(env, node)
      const attrs = [...extra, ...styleAttrs(env, node, { display: displayOf(node.type), fallback: fallbackOf(node, options) })]
      const kids = options.pageRoot ? (node.children ?? []).filter(child => child.type !== SLOT_FILL) : node.children
      const inner = slotted(env, node, children(env, node, indent, options, kids), `${indent}  `, options)
      if (node.type === 'Page' && node.props?.when !== undefined) return guarded(env, node, tag, attrs, inner, indent)
      return element(tag, attrs, inner, indent)
    }
    case 'Card':
      return card(env, node, extra, indent, options)
    case 'Heading': {
      const level = node.props?.level ?? DEFAULT_HEADING_LEVEL
      if (typeof level !== 'number' || headingLevel(level) === undefined) return fail(env, node, 'heading level must be 1–6')
      const attrs = [...extra, ...styleAttrs(env, node, { fallback: fallbackOf(node, options, HEADING_TOKENS[level]) })]
      return element(headingTag(level), attrs, textContent(env, node, node.props?.text), indent)
    }
    case 'Text':
      return element(NODE_ELEMENTS.Text, [...extra, ...styleAttrs(env, node, { classes: [TEXT_CLASS], fallback: fallbackOf(node, options) })], textContent(env, node, node.props?.text), indent)
    case 'Image':
      return image(env, node, extra, indent, options)
    case 'Link':
      return link(env, node, extra, indent, options)
    case 'Button':
      return element(NODE_ELEMENTS.Button, [...extra, ...buttonAttrs(env, node), ...styleAttrs(env, node, { fallback: fallbackOf(node, options) }), ...events(env, node)], undefined, indent)
    case 'Input':
      return input(env, node, extra, indent, options)
    case 'Checkbox':
      return checkbox(env, node, extra, indent, options)
    case 'Form':
      return form(env, node, extra, indent, options)
    case 'List':
      return list(env, node, extra, indent, options)
    case 'Instance':
      return instance(env, node, extra, indent, options)
    case SLOT_FILL:
      return fail(env, node, 'a SlotFill sits under an Instance or at the root of a page with a layout')
    default:
      return fail(env, node, `node type ${node.type} can't be generated yet`)
  }
}

const isCardStackKey = (key: string) => CARD_STACK_KEYS.includes(parseStyleKey(key)?.token.key ?? '')

/** A Card: a tokenized div with the canvas UCard's surface, and an inner stack that lays out its children. */
const card = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
  const root = styleAttrs(env, node, { classes: [CARD_SURFACE_CLASS], fallback: fallbackOf(node, options, { ...CARD_DEFAULT_STYLE, ...CARD_SURFACE_STYLE }), pick: key => !isCardStackKey(key) })
  const stack = styleAttrs(env, node, { classes: ['flex'], fallback: structuralStyle(node.type), pick: isCardStackKey, part: 'Stack' })
  const inner = slotted(env, node, children(env, node, indent, options, node.children, 2), `${indent}    `, options)
  return element('div', [...extra, ...root], element('div', stack, inner, `${indent}  `), indent)
}

const image = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
  const { src, alt } = node.props ?? {}
  if (src === undefined || src === '') return fail(env, node, 'an Image needs `src`, a URL or a binding')
  // Always bound: a static `src` would be an asset import for Vue's compiler, and a missing upload would fail the build.
  const attrs = [...extra, boundAttr('src', expression(env, node, src, 'template')), ...(alt === undefined ? [] : [valueAttr(env, node, 'alt', alt)])]
  return element(NODE_ELEMENTS.Image, [...attrs, ...styleAttrs(env, node, { display: displayOf(node.type), fallback: fallbackOf(node, options, IMAGE_FALLBACK_STYLE) })], undefined, indent)
}

/** `href` (an external URL, opened in a new tab) or `to` (a page): the attributes of a Link or a Button. */
const linkAttrs = (env: Env, node: ModelNode): Attr[] => {
  const href = node.props?.href
  if (href !== undefined) {
    if (typeof href !== 'string') return fail(env, node, 'href must be a URL')
    const target = linkTarget(href)
    return [staticAttr('to', href), ...(target ? [staticAttr('target', target)] : [])]
  }
  const to = routeLocation(env, node, node.props?.to, 'template')
  return [to.static !== undefined ? staticAttr('to', to.static) : boundAttr('to', to.code)]
}

const link = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
  const icon = node.props?.icon
  const classes = [LINK_CLASS, ...(icon ? [LINK_ICON_CLASS] : [])]
  const attrs = [...extra, ...linkAttrs(env, node), ...styleAttrs(env, node, { classes, display: icon ? LINK_ICON_DISPLAY : '', fallback: fallbackOf(node, options) })]
  const content = node.children?.length ? children(env, node, indent, options) : textContent(env, node, node.props?.text)
  if (icon === undefined) return element(NODE_ELEMENTS.Link, attrs, content, indent)
  const iconLine = element('UIcon', [valueAttr(env, node, 'name', icon), staticAttr('class', ICON_CLASS)], undefined, `${indent}  `)
  const rest = content === undefined ? [] : typeof content === 'string' ? [`${indent}  ${content}`] : content
  return element(NODE_ELEMENTS.Link, attrs, [...iconLine, ...rest], indent)
}

/** A Page shown only when its `when` data exists: loading text, the page, then the empty text. */
const guarded = (env: Env, node: ModelNode, tag: string, attrs: Attr[], inner: string[], indent: string) => {
  const when = expression(env, node, node.props!.when, 'template')
  const loading = loadingOf(env, node.props!.when)
  const errors = errorsOf(env, node.props!.when)
  const lines: string[] = []
  if (typeof node.props?.loading === 'string' && loading.length) lines.push(...element('p', [attr('if', `v-if="${loading.join(' || ')}"`), staticAttr('class', 'text-muted')], escapeText(node.props.loading), indent))
  if (errors.length) lines.push(...element('p', [attr('if', `${lines.length ? 'v-else-if' : 'v-if'}="${errors.join(' || ')}"`), staticAttr('class', 'text-error')], API_ERROR_TEXT, indent))
  lines.push(...element(tag, [attr('if', `${lines.length ? 'v-else-if' : 'v-if'}="${escapeAttr(when)}"`), ...attrs], inner, indent))
  if (typeof node.props?.empty === 'string') lines.push(...element('p', [attr('if', 'v-else'), staticAttr('class', 'text-muted')], escapeText(node.props.empty), indent))
  return lines
}

const buttonAttrs = (env: Env, node: ModelNode): Attr[] => {
  const props = node.props ?? {}
  const attrs: Attr[] = []
  if (props.type === 'submit') attrs.push(staticAttr('type', 'submit'))
  if (props.text !== undefined) attrs.push(valueAttr(env, node, 'label', props.text))
  // Nuxt UI's own props, checked by `nodePropProblems`.
  for (const [key, name] of [['color', 'color'], ['variant', 'variant'], ['size', 'size'], ['icon', 'icon'], ['trailingIcon', 'trailing-icon']] as const) {
    if (props[key] !== undefined) attrs.push(valueAttr(env, node, name, props[key]))
  }
  if (props.href !== undefined) attrs.push(...linkAttrs(env, node))
  if (props.disabled !== undefined) attrs.push(boundAttr('disabled', expression(env, node, props.disabled, 'template')))
  return attrs
}

const fieldOf = (env: Env, node: ModelNode): Field => {
  if (!env.form) return fail(env, node, 'form fields must sit inside a Form')
  const field = env.form.fields.find(entry => entry.id === node.props?.field)
  return field ?? fail(env, node, `field ${String(node.props?.field)} is not one of the form's fields`)
}

/** The browser `pattern` of a model pattern: anchors dropped (implicit), a trailing `-` in a class escaped (the `v` flag needs it). */
const htmlPattern = (pattern: string) => pattern.replace(/^\^/, '').replace(/\$$/, '').replace(/(?<!\\)-\]/g, '\\-]')

const input = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
  const field = fieldOf(env, node)
  const props = node.props ?? {}
  const label = typeof props.label === 'string' ? props.label : pascal(field.name)
  const numeric = field.type === 'integer' || field.type === 'number'
  if (!numeric && field.type !== 'text') return fail(env, node, `a ${field.type} field has no input yet`)
  const multiline = props.multiline === true
  const inputType = props.inputType
  if (inputType !== undefined && multiline) return fail(env, node, 'a multiline input has no inputType')
  if (inputType !== undefined && numeric && inputType !== 'number') return fail(env, node, `a ${field.type} field's input has inputType number`)
  const attrs: Attr[] = [attr('model', `v-model${numeric ? '.number' : ''}="form.${field.name}"`), staticAttr('name', field.name)]
  if (field.required) attrs.push(attr('attr', 'required'))
  if (numeric) attrs.push(staticAttr('type', 'number'))
  if (!numeric && field.max !== undefined) attrs.push(staticAttr('maxlength', String(field.max)))
  if (field.pattern) attrs.push(staticAttr('pattern', htmlPattern(field.pattern)))
  if (!numeric && typeof inputType === 'string' && inputType !== 'text') attrs.push(staticAttr('type', inputType))
  if (props.placeholder !== undefined) attrs.push(valueAttr(env, node, 'placeholder', props.placeholder))
  if (multiline && typeof props.rows === 'number') attrs.push(boundAttr('rows', String(props.rows)))
  attrs.push(staticAttr('class', INPUT_CONTROL_CLASS))
  const control = element(multiline ? NODE_ELEMENTS.InputMultiline : NODE_ELEMENTS.InputControl, attrs, undefined, `${indent}  `)
  return element(NODE_ELEMENTS.Input, [...extra, staticAttr('label', label), staticAttr('name', field.name), ...(field.required ? [attr('attr', 'required')] : []), ...styleAttrs(env, node, { fallback: fallbackOf(node, options) })], control, indent)
}

const checkbox = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
  const attrs: Attr[] = [...extra]
  const label = node.props?.label
  if (node.props?.field !== undefined) {
    const field = fieldOf(env, node)
    if (field.type !== 'boolean') return fail(env, node, 'a checkbox needs a boolean field')
    attrs.push(attr('model', `v-model="form.${field.name}"`), staticAttr('name', field.name))
  } else if (node.props?.value !== undefined) {
    attrs.push(boundAttr('model-value', expression(env, node, node.props.value, 'template')))
  }
  if (typeof label === 'string') attrs.push(staticAttr('label', label))
  return element(NODE_ELEMENTS.Checkbox, [...attrs, ...styleAttrs(env, node, { fallback: fallbackOf(node, options) }), ...events(env, node)], undefined, indent)
}

const form = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
  const action = actionById(env, node, node.props?.action)
  const entity = action.input.entity ? entityOf(env, node, action.input.entity) : undefined
  if (!entity) return fail(env, node, 'a Form needs an action with an entity input')
  const ids = Array.isArray(node.props?.fields) ? node.props.fields : []
  const fields = ids.map(id => entity.fields.find(field => field.id === id) ?? fail(env, node, `unknown field ${String(id)}`))
  env.form = { fields }
  env.needs.add('form')
  const attrs = [...extra, ...styleAttrs(env, node, { display: displayOf(node.type), fallback: fallbackOf(node, options) }), ...events(env, node)]
  return element(NODE_ELEMENTS.Form, attrs, slotted(env, node, children(env, node, indent, options), `${indent}  `, options), indent)
}

const list = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
  if (extra.length) return fail(env, node, 'a List can\'t be hidden or repeated itself yet')
  const props = node.props ?? {}
  const as = typeof props.as === 'string' ? identifier(props.as, where(env, node)) : fail(env, node, 'a List needs `as`, the item name')
  const items = expression(env, node, props.items, 'template')
  const loading = typeof props.loading === 'string' ? loadingOf(env, props.items) : []
  const errors = errorsOf(env, props.items)
  const lines: string[] = []
  const condition = () => lines.length ? 'v-else-if' : 'v-if'
  if (loading.length) lines.push(...element('p', [attr('if', `v-if="${loading.join(' || ')}"`), staticAttr('class', 'text-muted')], escapeText(props.loading as string), indent))
  if (errors.length) lines.push(...element('p', [attr('if', `${condition()}="${errors.join(' || ')}"`), staticAttr('class', 'text-error')], API_ERROR_TEXT, indent))
  if (typeof props.empty === 'string') lines.push(...element('p', [attr('if', `${condition()}="!${escapeAttr(items)}.length"`), staticAttr('class', 'text-muted')], escapeText(props.empty), indent))
  const shownIf: Attr[] = lines.length ? [attr('if', 'v-else')] : props.hideWhenEmpty === true ? [attr('if', `v-if="${escapeAttr(items)}.length"`)] : []

  // A handler in the List's rows reads the item through a parameter: the type of one item is the items' own, which the script has.
  if (env.roots.has(itemParam(as))) fail(env, node, `the item name ${as} would give a handler the parameter ${itemParam(as)}, which the page already names`)
  const itemType = () => {
    const saved = env.track.items
    env.track.items = new Set()
    const code = expression(env, node, props.items, 'script')
    const outer = env.track.items
    env.track.items = saved
    if (outer.size) fail(env, node, `a handler can't read the items of a List over ${[...outer].join(', ')}: its row type is only known in the template`)
    return `NonNullable<typeof ${code}>[number]`
  }
  // Over an API query's list, the rows are its model's: keyed by `id` when the model has one, by their position otherwise.
  const api = bindRoot(props.items) === undefined ? undefined : env.roots.get(bindRoot(props.items)!)?.api
  const rows = api && isObject(props.items) && props.items.$bind === bindRoot(props.items) ? api : undefined
  const position = `${as}Index`
  if (api && !rows?.hasId && env.roots.has(position)) fail(env, node, `the position name ${position} is already a name the page uses`)
  const itemEnv: Env = { ...env, roots: new Map(env.roots).set(as, itemRoot(env, as, !!rows)), items: new Map(env.items).set(as, itemType) }
  // `loadMore`: the first n records, and a button that shows n more (state of this node, so one per List).
  const more = loadMoreSize(props.loadMore)
  const shown = more ? identifier(`shown${pascal(node.id.replace(/^n_/, ''))}`, where(env, node)) : undefined
  if (more) env.handlers.push([`const ${shown} = ref(${more})`])
  const byPosition = api && !rows?.hasId
  const repeat = [
    attr('for', `v-for="${byPosition ? `(${as}, ${position})` : as} in ${escapeAttr(shown ? `${items}.slice(0, ${shown})` : items)}"`),
    attr('key', `:key="${byPosition ? position : `${as}.id`}"`)
  ]
  const kids = node.children ?? []
  const inStack = childrenInStack(node.type, props)
  const inner = kids.length === 1
    ? render(itemEnv, kids[0]!, `${indent}  `, { attrs: repeat, slots: options.slots, inStack })
    : [`${indent}  <template ${repeat.map(entry => entry.text).join(' ')}>`, ...kids.flatMap(child => render(itemEnv, child, `${indent}    `, { slots: options.slots, inStack })), `${indent}  </template>`]
  const button = shown && more
    ? [`${indent}  <div v-if="${escapeAttr(items)}.length > ${shown}" class="${LOAD_MORE_CLASS}">`, `${indent}    <UButton label="${LOAD_MORE_LABEL}" @click="${shown} += ${more}" />`, `${indent}  </div>`]
    : []
  lines.push(...element(tagOf(env, node), [...shownIf, ...styleAttrs(env, node, { display: displayOf(node.type, props), fallback: fallbackOf(node, options) })], [...inner, ...button], indent))
  return lines
}

/** The node of a tree by id. */
const findNode = (node: ModelNode, id: string): ModelNode | undefined =>
  node.id === id ? node : node.children?.map(child => findNode(child, id)).find(Boolean)

/** `<template #name>` with a SlotFill's children, laid out the way the slot's node lays them out. */
const fillTemplate = (env: Env, fill: ModelNode, name: string, target: ModelNode | undefined, indent: string, slots?: Map<string, string>) => [
  `${indent}<template #${name}>`,
  ...(fill.children ?? []).flatMap(child => render(env, child, `${indent}  `, { slots, inStack: target ? childrenInStack(target.type, target.props) : false })),
  `${indent}</template>`
]

const instance = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
  const context = env.context ?? fail(env, node, 'component instances need a module')
  const component = context.module.components.find(entry => entry.id === node.props?.component) ?? fail(env, node, `unknown component ${String(node.props?.component)}`)
  const values = isObject(node.props?.values) ? node.props.values : {}
  const variantId = node.props?.variant
  const variant = typeof variantId === 'string' && variantId !== ''
    ? [staticAttr('variant', component.variants.find(entry => entry.id === variantId)?.name ?? fail(env, node, `component ${component.name} has no variant ${variantId}`))]
    : []
  const attrs = component.properties.flatMap((property) => {
    const value = values[property.id]
    if (value === undefined || property.kind === 'slot') return []
    return [valueAttr(env, node, kebab(property.name), value)]
  })
  // The instance stands in the stack for its component's root.
  const root = component.root
  const style = styleAttrs(env, node, { fallback: selfFallback(root.type, root.style, options.inStack) })
  const fills = (node.children ?? []).flatMap((child) => {
    if (child.type !== SLOT_FILL) return fail(env, child, 'an Instance holds only SlotFills')
    const property = component.properties.find(entry => entry.kind === 'slot' && entry.id === child.props?.slot)
      ?? fail(env, child, `component ${component.name} has no slot property ${String(child.props?.slot)}`)
    return fillTemplate(env, child, property.name, findNode(root, property.nodeId ?? ''), `${indent}  `)
  })
  return element(`${pascal(context.name)}${component.name}`, [...extra, ...variant, ...attrs, ...style], fills, indent)
}

// ── Interactions ────────────────────────────────────────────────────────

const actionById = (env: Env, node: ModelNode | undefined, id: Value | undefined): ActionFile =>
  env.context?.module.actions.find(action => action.id === id) ?? fail(env, node, `unknown action ${String(id)}`)

const entityOf = (env: Env, node: ModelNode | undefined, id: string): EntityFile =>
  env.context?.module.entities.find(entity => entity.id === id) ?? fail(env, node, `unknown entity ${id}`)

const runAction = (env: Env, node: ModelNode, step: Record<string, Value>, ctx: Ctx) => {
  const alias = env.aliases.actions.get(String(step.action)) ?? fail(env, node, `action ${String(step.action)} isn't in the page's uses.actions`)
  use(env, `action:${alias}`, 'execute')
  const args = step.args
  // An action with no parameters and no collection input is run with nothing.
  const { input } = actionById(env, node, step.action)
  if (!input.entity && !(input.params ?? []).length) return args === undefined ? `${alias}()` : fail(env, node, 'runAction on an action that takes no input has no args')
  if (isObject(args) && args.$form === true) return `${alias}(${expression(env, node, args, ctx)})`
  const entries = isObject(args) ? Object.values(args) : []
  if (entries.length !== 1) return fail(env, node, 'runAction takes `$form: true` or one argument')
  return `${alias}(${expression(env, node, entries[0], ctx)})`
}

const setState = (env: Env, node: ModelNode, step: Record<string, Value>) => {
  const alias = env.aliases.state.get(String(step.state)) ?? fail(env, node, `state ${String(step.state)} isn't in the page's uses.state`)
  use(env, `state:${alias}`, 'set')
  return `set${pascal(alias)}({ ${identifier(String(step.field), where(env, node))}: ${expression(env, node, step.value, 'template')} })`
}

const EVENT_NAMES: Record<string, string> = { click: 'click', change: 'update:model-value', mouseenter: 'mouseenter', mouseleave: 'mouseleave' }

const events = (env: Env, node: ModelNode): Attr[] => (node.interactions ?? []).map((interaction) => {
  const steps = interaction.do as Array<Record<string, Value>>
  if (interaction.on === 'submit') return attr('event', `@submit.prevent="${handler(env, node, interaction.on, steps)}"`)
  const name = EVENT_NAMES[interaction.on] ?? fail(env, node, `${interaction.on} interactions can't be generated yet`)
  if (steps.length !== 1) return attr('event', `@${name}="${handler(env, node, interaction.on, steps)}"`)
  const step = steps[0]!
  if (step.kind === 'runAction') return attr('event', `@${name}="${escapeAttr(runAction(env, node, step, 'template'))}"`)
  if (step.kind === 'setState') return attr('event', `@${name}="${escapeAttr(setState(env, node, step))}"`)
  if (step.kind === 'toast' && step.when === undefined) return attr('event', `@${name}="${escapeAttr(toast(env, node, step, 'template'))}"`)
  return attr('event', `@${name}="${handler(env, node, interaction.on, steps)}"`)
})

/** A `toast` step: Nuxt UI's `useToast`, with the title, description, colour and icon of the step. */
const toast = (env: Env, node: ModelNode, step: Record<string, Value>, ctx: Ctx) => {
  const problem = uiStepProblems(step)[0]
  if (problem) fail(env, node, problem.message)
  env.needs.add('toast')
  const options = (['title', 'description', 'color', 'icon'] as const).filter(key => step[key] !== undefined).map(key => `${key}: ${expression(env, node, step[key], ctx)}`)
  return `toast.add({ ${options.join(', ')} })`
}

/**
 * A named script handler for a multi-step interaction: run an action, then
 * the steps that follow it when it succeeded (`when: "success"`): navigate or
 * show a toast. Without an action, the navigate and toast steps in order.
 */
const handler = (env: Env, node: ModelNode, on: string, steps: Array<Record<string, Value>>) => {
  const name = `on${pascal(node.id.replace(/^n_/, ''))}${pascal(on)}`
  const unsupported = (): never => fail(env, node, `this ${on} interaction can't be generated yet`)
  const statement = (step: Record<string, Value>): { code: string, summary: string } => {
    if (step.kind === 'navigate') return { code: `await navigateTo(${routeLocation(env, node, step.to, 'script').code})`, summary: `go to ${pageById(env, node, String((step.to as Record<string, Value>).page)).path}` }
    if (step.kind === 'toast') return { code: toast(env, node, step, 'script'), summary: 'show a toast' }
    return unsupported()
  }
  const [first, ...rest] = steps
  // The List items the steps read are the template's: the handler takes them as parameters, and the template passes them.
  env.track.items = new Set()
  // A one-record query the handler reads may be empty: it returns early then, and reads it without `?.` after.
  env.optional.used.clear()
  if (first?.kind === 'runAction') {
    runAction(env, node, first, 'script')
    rest.forEach(statement)
  } else {
    steps.forEach(statement)
  }
  const guards = [...env.optional.used]
  env.optional.guarded = new Set(guards)
  const body: string[] = guards.map(name => `  if (!${name}.value) return`)
  const summaries: string[] = []
  if (first?.kind === 'runAction') {
    const run = runAction(env, node, first, 'script')
    summaries.push(`run action ${actionById(env, node, first.action).label}`)
    if (rest.some(step => step.when !== 'success')) unsupported()
    const then = rest.map(statement)
    summaries.push(...then.map(entry => entry.summary))
    body.push(...(!then.length
      ? [`  await ${run}`]
      : then.length === 1 ? [`  if (await ${run}) ${then[0]!.code}`] : [`  if (await ${run}) {`, ...then.map(entry => `    ${entry.code}`), '  }']))
  } else {
    if (steps.some(step => step.when !== undefined)) unsupported()
    const all = steps.map(statement)
    summaries.push(...all.map(entry => entry.summary))
    body.push(...all.map(entry => `  ${entry.code}`))
  }
  env.optional.guarded = new Set()
  const read = [...env.items.keys()].filter(item => env.track.items!.has(item))
  env.track.items = undefined
  const params = read.map(item => `${itemParam(item)}: ${env.items.get(item)!()}`)
  env.handlers.push([`// Interaction "${on}": ${summaries.join(', then ')}.`, `const ${name} = async (${params.join(', ')}) => {`, ...body, '}'])
  return `${name}${read.length ? `(${read.join(', ')})` : ''}`
}

// ── Files ───────────────────────────────────────────────────────────────

const vueHeader = (source: string) => `<!-- Generated by bildr from ${source}. Editing this file detaches it from the editor; prefer overriding it from the root app/. -->`

const sfc = (source: string, script: string[], template: string[]) => [
  vueHeader(source),
  ...(script.length ? ['<script setup lang="ts">', ...script, '</script>', ''] : []),
  '<template>',
  ...template,
  '</template>',
  ''
].join('\n')

const newEnv = (model: Model, file: string, context?: ModuleContext): Env => ({
  model, context, file, roots: new Map(), used: new Map(), needs: new Set(), handlers: [], variantLines: [], optional: { used: new Set(), guarded: new Set() }, aliases: { actions: new Map(), state: new Map() }, items: new Map(), track: {},
  base: model.project.breakpointBase ?? 'mobile', variantExpr: 'props.variant'
})

/**
 * Property bindings (the hosted `bindings`): a bound prop reads the property (`path`),
 * the node's own value as its fallback when the property has no default; a bound style
 * key becomes a class map (see `styleAttrs`).
 */
const bindProperties = (env: Env, properties: PropertyDef[], nodes: Map<string, ModelNode>, path: (property: PropertyDef) => string) => {
  env.substitutions ??= new Map()
  env.styleBindings ??= new Map()
  for (const property of properties) {
    if (property.kind === 'slot') continue
    for (const binding of property.bindings ?? []) {
      const node = nodes.get(binding.nodeId) ?? fail(env, undefined, `property ${property.name} is bound to the unknown node ${binding.nodeId}`)
      if (binding.target === 'style') {
        const values = property.kind === 'select' ? property.options ?? [] : parseStyleKey(binding.prop)?.token.values ?? fail(env, node, `unknown style token ${binding.prop}`)
        env.styleBindings.set(node.id, [...env.styleBindings.get(node.id) ?? [], { key: binding.prop, path: path(property), hasDefault: property.default !== undefined, select: property.kind === 'select', values }])
        continue
      }
      const swapped = env.substitutions.get(node.id) ?? {}
      const current = swapped[binding.prop] ?? node.props?.[binding.prop]
      swapped[binding.prop] = property.default === undefined && !property.required && current !== undefined ? { $bind: path(property), fallback: current } : { $bind: path(property) }
      env.substitutions.set(node.id, swapped)
    }
  }
}

const nodeIndex = (root: ModelNode) => {
  const nodes = new Map<string, ModelNode>()
  const visit = (node: ModelNode) => {
    nodes.set(node.id, node)
    node.children?.forEach(visit)
  }
  visit(root)
  return nodes
}

/** The script lines of the composables the template uses outside a page's declarations. */
const composableLines = (env: Env) => [
  ...(env.needs.has('site') ? ['const { site } = useAppConfig()'] : []),
  ...(env.needs.has('toast') ? ['const toast = useToast()'] : [])
]
const handlerLines = (env: Env) => env.handlers.flatMap(lines => ['', ...lines])

const siteRoot = (env: Env) => plainRoot('site', () => env.needs.add('site'))

const layoutFile = (model: Model, layout: LayoutFile): GeneratedFile => {
  const source = model.paths[layout.id] ?? `.bildr/layouts/${layout.name}.json`
  const env = newEnv(model, source)
  env.roots.set('site', siteRoot(env))
  // Layout variables: the page's values (route meta) over the defaults, read as `layout.<name>`.
  const variables = layout.variables ?? []
  env.roots.set('layout', refRoot('layout', () => env.needs.add('layout')))
  bindProperties(env, variables, nodeIndex(layout.root), variable => `layout.${variable.name}`)
  const slots = new Map(layout.slots.map(slot => [slot.nodeId, slot.name]))
  const template = render(env, layout.root, '  ', { slots })
  const defaults = variables.filter(variable => variable.default !== undefined).map(variable => `${variable.name}: ${expression(env, undefined, variable.default, 'script')}`)
  const types = variables.map(variable => `${variable.name}${variable.default === undefined ? '?' : ''}: ${propertyType(env, variable)}`)
  const layoutLines = env.needs.has('layout')
    ? ['const route = useRoute()', `const layout = computed(() => ({ ${[...defaults, '...route.meta.layoutValues'].join(', ')} }) as { ${types.join(', ')} })`]
    : []
  const script = [...composableLines(env), ...layoutLines, ...env.variantLines, ...handlerLines(env)]
  while (script[0] === '') script.shift()
  return { path: `layers/core/app/layouts/${layout.name}.vue`, owner: 'managed', source, content: sfc(source, script, template) }
}

const PROPERTY_TYPES: Record<string, string> = { text: 'string', textarea: 'string', number: 'number', boolean: 'boolean', image: 'string', link: 'string', icon: 'string', field: 'string' }

/** The TS type of a plain property or layout variable: a select is the union of its options. */
const propertyType = (env: Env, property: PropertyDef) => property.kind === 'select'
  ? (property.options ?? fail(env, undefined, `select property ${property.name} needs options`)).map(option => tsString(option)).join(' | ')
  : PROPERTY_TYPES[property.kind] ?? fail(env, undefined, `${property.kind} properties can't be generated yet`)

const componentFile = (context: ModuleContext, component: ComponentFile): GeneratedFile => {
  const source = context.source(component.id)
  const env = newEnv(context.model, source, context)
  const imports: string[] = []
  const props: string[] = []
  const defaults: string[] = []
  // Slot properties are slots, not props: the node they name renders a <slot> around its children.
  env.componentSlots = new Map(component.properties.filter(property => property.kind === 'slot').map(property => [property.nodeId ?? fail(env, undefined, `slot property ${property.name} needs a nodeId`), property.name]))
  for (const property of component.properties) {
    if (property.kind === 'slot') continue
    env.roots.set(property.name, plainRoot(`props.${property.name}`, () => env.needs.add('props')))
    let type: string
    if (property.kind === 'entity') {
      const entity = entityOf(env, undefined, property.entity ?? fail(env, undefined, `property ${property.name} needs an entity`))
      imports.push(`import type { ${entity.name} } from '#${context.name}/domain/${entityNames(entity).file}'`)
      type = property.pick?.length ? `Pick<${entity.name}, ${property.pick.map(name => tsString(name)).join(' | ')}>` : entity.name
      if (property.many) type = `${type}[]`
    } else {
      type = propertyType(env, property)
    }
    props.push(`  ${property.name}${property.required ? '' : '?'}: ${type}`)
    if (property.default !== undefined) defaults.push(`${property.name}: ${expression(env, undefined, property.default, 'script')}`)
    // vue/require-default-prop: an optional prop states that it has no default (a boolean's is false).
    else if (!property.required && property.kind !== 'boolean') defaults.push(`${property.name}: undefined`)
  }

  const nodes = nodeIndex(component.root)
  const variantLine = variantsOf(env, component, nodes)
  bindProperties(env, component.properties, nodes, property => property.name)

  const template = render(env, component.root, '  ')
  if (component.variants.length) {
    props.push(`  variant?: ${['default', ...component.variants.map(variant => variant.name)].map(name => tsString(name)).join(' | ')}`)
    defaults.push('variant: \'default\'')
  }
  const declare = env.needs.has('props') ? 'const props = ' : ''
  const define = !props.length
    ? []
    : defaults.length
      ? [`${declare}withDefaults(defineProps<{\n${props.join('\n')}\n}>(), { ${defaults.join(', ')} })`]
      : [`${declare}defineProps<{\n${props.join('\n')}\n}>()`]
  const script = [...imports, ...(imports.length ? [''] : []), ...define, ...(variantLine ? ['', variantLine] : []), ...composableLines(env), ...env.variantLines, ...handlerLines(env)]
  while (script[0] === '') script.shift()
  return {
    path: `layers/${context.name}/app/components/${context.name}/${component.name}.vue`,
    owner: 'managed',
    source,
    content: sfc(source, script, template)
  }
}

type Override = ComponentFile['variants'][number]['overrides'][string]
type VariantDef = ComponentFile['variants'][number]

/** `top` over `below`: props and style merge, a key `top` sets is no longer removed, and one it removes no longer set (the canvas's `layerOverride`). */
const layerOverride = (below: Override | undefined, top: Override | undefined): Override | undefined => {
  if (!below || !top) return top ?? below
  const style = { ...below.style, ...top.style }
  for (const key of top.unset ?? []) Reflect.deleteProperty(style, key)
  const unset = [...new Set([...(below.unset ?? []).filter(key => !(key in (top.style ?? {}))), ...(top.unset ?? [])])]
  return { props: { ...below.props, ...top.props }, style, unset }
}

/** A node's style in a variant: its own tokens with the override's, less the ones it removes. */
const styleIn = (style: Record<string, string>, override: Override | undefined) => {
  const merged = { ...style, ...override?.style }
  for (const key of override?.unset ?? []) Reflect.deleteProperty(merged, key)
  return merged
}

/**
 * A component's variants, per node they override: the style of each (a class map,
 * see `styleAttrs`), the variants that hide it, and the props they change
 * (`$$variants` expressions). A state shows its own overrides over its base's.
 * With states or interactions the component is interactive: style changes
 * animate (`transition`), and hover and pressed states render as `hover:` and
 * `active:` classes on the root, and `group-hover` and `group-active` classes on
 * its descendants (the root carries the group), when CSS can express them
 * (style-only states, no interactions); otherwise the core `useVariantState` composable keeps the
 * variant it shows, and the line declaring it is returned.
 */
const variantsOf = (env: Env, component: ComponentFile, nodes: Map<string, ModelNode>): string | undefined => {
  const variants = component.variants
  if (!variants.length) return undefined
  const byId = new Map(variants.map(variant => [variant.id, variant]))
  const nameOf = (id: string) => id === '' ? 'default' : byId.get(id)?.name ?? fail(env, undefined, `unknown variant ${id}`)
  const effective = (variant: VariantDef, id: string) => layerOverride(variant.state?.of ? byId.get(variant.state.of)?.overrides[id] : undefined, variant.overrides[id])
  const states = variants.filter(variant => variant.state)
  const interactions = [component.interactions ?? [], ...variants.map(variant => variant.interactions ?? [])].flat()
  const interactive = states.length > 0 || interactions.length > 0
  const group = kebab(component.name)
  const bases: Array<{ id: string, name: string }> = [{ id: '', name: 'default' }, ...variants.filter(variant => !variant.state).map(({ id, name }) => ({ id, name }))]
  const stateOf = (base: string, kind: 'hover' | 'pressed') => states.find(variant => variant.state!.of === base && variant.state!.kind === kind)
  let css = interactive && !interactions.length && states.every(state => Object.values(state.overrides).every(override => !override.props && !override.unset?.length))

  const timingOf = (variant?: VariantDef) => transitionTimingClasses(variant?.transition ?? (variant?.state?.of ? byId.get(variant.state.of)?.transition : undefined) ?? component.transition ?? DEFAULT_TRANSITION)
  const timing = interactive ? new Map([['default', timingOf()], ...variants.map(variant => [variant.name, timingOf(variant)] as const)]) : undefined
  const map = new Map<string, Variant>()
  env.substitutions ??= new Map()
  for (const id of [...new Set(variants.flatMap(variant => Object.keys(variant.overrides)))]) {
    const node = nodes.get(id) ?? fail(env, undefined, `a variant overrides the unknown node ${id}`)
    const own = node.style ?? {}
    const looks: Array<[string, Record<string, string>]> = [['default', own], ...variants.map(variant => [variant.name, styleIn(own, effective(variant, id))] as [string, Record<string, string>])]
    const styleOf = new Map(looks)
    const pointer: Variant['pointer'] = new Map()
    // The root can't be its own group's descendant: it takes the plain pseudo-class variants.
    const [hoverPrefix, pressedPrefix] = id === component.root.id ? ['hover:', 'active:'] : [`group-hover/${group}:`, `group-active/${group}:`]
    for (const base of bases) {
      const at = styleOf.get(base.name)!
      const hover = stateOf(base.id, 'hover')
      const pressed = stateOf(base.id, 'pressed')
      const hoverStyle = hover ? styleOf.get(hover.name)! : at
      const hoverKeys = changedKeys(at, hoverStyle)
      const entries: Array<{ prefix: string, style: Record<string, string>, keys: string[] }> = hoverKeys.length ? [{ prefix: hoverPrefix, style: hoverStyle, keys: hoverKeys }] : []
      if (pressed) {
        // Pressed wins over hover: it restates every key hover changes, so each needs a value.
        const pressedStyle = styleOf.get(pressed.name)!
        const keys = [...new Set([...changedKeys(at, pressedStyle), ...hoverKeys])]
        if (keys.some(key => pressedStyle[key] === undefined)) css = false
        if (keys.length) entries.push({ prefix: pressedPrefix, style: pressedStyle, keys })
      }
      if (entries.length) pointer.set(base.name, entries)
    }
    const hiddenIn = variants.filter(variant => effective(variant, id)?.props?.hidden === true).map(variant => variant.name)
    map.set(id, { base: camel(id.replace(/^n_/, '')), styles: looks, pointer, hiddenIn, timing })
    // Any other prop a variant overrides: one value per variant.
    const keys = [...new Set(variants.flatMap(variant => Object.keys(effective(variant, id)?.props ?? {})))].filter(key => key !== 'hidden')
    if (keys.length) {
      const swapped = env.substitutions.get(id) ?? {}
      for (const key of keys) {
        const base = node.props?.[key]
        swapped[key] = { $$variants: Object.fromEntries([['default', base], ...variants.map(variant => [variant.name, effective(variant, id)?.props?.[key] ?? base])]) as Record<string, Value> }
      }
      env.substitutions.set(id, swapped)
    }
  }
  if (!css) for (const entry of map.values()) entry.pointer.clear()
  env.variants = map
  if (!interactive) return undefined
  if (css) {
    if ([...map].some(([id, entry]) => id !== component.root.id && entry.pointer.size)) env.root = { id: component.root.id, classes: [`group/${group}`], attrs: [] }
    return undefined
  }

  // Interactions or states CSS can't show: the core composable keeps the shown variant.
  env.variantExpr = 'variant'
  env.needs.add('props')
  const parts: string[] = []
  const stated = bases.flatMap((base) => {
    const kinds = (['hover', 'pressed'] as const).flatMap(kind => stateOf(base.id, kind) ? [`${kind}: ${tsString(stateOf(base.id, kind)!.name)}`] : [])
    return kinds.length ? [`${base.name}: { ${kinds.join(', ')} }`] : []
  })
  if (stated.length) parts.push(`  states: { ${stated.join(', ')} }`)
  const owners = [['default', component.interactions ?? []] as const, ...variants.map(variant => [variant.name, variant.interactions ?? []] as const)].filter(([, list]) => list.length)
  if (owners.length) {
    const step = (interaction: (typeof interactions)[number]) => {
      const { to, delay } = interaction.do[0]
      return `{ on: ${tsString(interaction.on)}, to: ${tsString(nameOf(to))}${delay ? `, delay: ${delay}` : ''} }`
    }
    parts.push(['  interactions: {', owners.map(([name, list]) => `    ${name}: [${list.map(step).join(', ')}]`).join(',\n'), '  }'].join('\n'))
  }
  const appear = interactions.some(interaction => interaction.on === 'appear')
  env.root = { id: component.root.id, classes: [], attrs: [...(appear ? [attr('key', 'ref="variantRoot"')] : []), attr('event', 'v-on="on"')] }
  return `const { variant, on } = useVariantState(() => props.variant, {\n${parts.join(',\n')}\n}${appear ? ', \'variantRoot\'' : ''})`
}

/** `/posts/:slug` → `posts/[slug].vue`, `/` → `index.vue`. */
const pagePath = (path: string) => {
  const parts = path.split('/').filter(Boolean).map(part => part.startsWith(':') ? `[${part.slice(1)}]` : part)
  return `${parts.length ? parts.join('/') : 'index'}.vue`
}

const queryNames = (env: Env, query: QueryFile) => {
  const entity = entityOf(env, undefined, query.from)
  return { composable: `use${pascal(query.name)}`, one: query.result === 'one' ? entityNames(entity).variable : undefined }
}

const pageFile = (context: ModuleContext, page: PageFile): GeneratedFile => {
  const source = context.source(page.id)
  const env = newEnv(context.model, source, context)
  const uses = page.uses ?? {}
  const { actions: actionAliases, state: stateAliases } = env.aliases

  const states = (uses.state ?? []).map(entry => ({ ...entry, file: context.module.state.find(state => state.id === entry.state) ?? fail(env, undefined, `unknown state ${entry.state}`) }))
  for (const { as, state } of states) {
    stateAliases.set(state, as)
    env.roots.set(as, refRoot(as, () => use(env, `state:${as}`, 'value')))
  }
  const queries = (uses.queries ?? []).map(entry => ({ ...entry, file: context.module.queries.find(query => query.id === entry.query) ?? fail(env, undefined, `unknown query ${entry.query}`) }))
  for (const { as, file } of queries) {
    const one = queryNames(env, file).one
    env.roots.set(as, refRoot(as, () => use(env, `query:${as}`, 'data'), one ? env.optional : undefined, () => {
      use(env, `query:${as}`, 'loading')
      return [`${as}Loading`]
    }))
  }
  const apis = (uses.apis ?? []).map((entry) => {
    const found = apiQueryOf(context.model.datasources, entry) ?? fail(env, undefined, `unknown API query ${entry.query} of ${entry.datasource}`)
    return { ...entry, ...found }
  })
  for (const { as, source, query } of apis) {
    const rows = apiRowsOf(source, query)
    env.roots.set(as, apiRoot(env, as, rows.many, !!rows.models.find(model => model.name === rows.model)?.fields.some(field => field.name === 'id')))
  }
  const actions = (uses.actions ?? []).map(entry => ({ ...entry, file: actionById(env, undefined, entry.action) }))
  for (const { as, action } of actions) {
    actionAliases.set(action, as)
    env.roots.set(as, {
      resolve: (members, ctx) => {
        const [member, ...rest] = members
        if ((member !== 'pending' && member !== 'error') || rest.length) return fail(env, undefined, `${as}.${members.join('.')}: actions expose pending and error`)
        use(env, `action:${as}`, member)
        return `${as}${pascal(member)}${ctx === 'script' ? '.value' : ''}`
      }
    })
  }
  const computedEntries = (uses.computed ?? []) as Array<{ as: string, if?: Value, then?: Value, else?: Value }>
  /** The computed value whose line is being written, and the computed values each reads: they are declared before it. */
  let writing: string | undefined
  const reads = new Map<string, Set<string>>()
  for (const entry of computedEntries) {
    if (entry.if === undefined || entry.then === undefined || entry.else === undefined) fail(env, undefined, `computed ${entry.as} needs if, then and else`)
    env.roots.set(entry.as, refRoot(entry.as, () => {
      use(env, `computed:${entry.as}`, 'value')
      if (writing !== undefined) reads.set(writing, (reads.get(writing) ?? new Set<string>()).add(entry.as))
    }, undefined, () => [...loadingOf(env, entry.then), ...loadingOf(env, entry.else)]))
  }

  // The template first: it decides which declarations the script needs.
  const layout = page.layout ? context.model.layouts.find(entry => entry.id === page.layout) ?? fail(env, undefined, `unknown layout ${page.layout}`) : undefined
  // SlotFills at the page root fill its layout's slots: the page renders the layout itself (`layout: false`).
  const fills = (page.root.children ?? []).filter(child => child.type === SLOT_FILL)
  let template: string[]
  if (!fills.length) {
    template = render(env, page.root, '  ', { pageRoot: true })
  } else {
    const shell = layout ?? fail(env, fills[0], 'a SlotFill sits under an Instance or at the root of a page with a layout')
    const body = render(env, page.root, '      ', { pageRoot: true })
    const filled = fills.flatMap((fill) => {
      const slot = shell.slots.find(entry => entry.id === fill.props?.slot) ?? fail(env, fill, `layout ${shell.name} has no slot ${String(fill.props?.slot)}`)
      if (slot.name === 'children') fail(env, fill, 'the page\'s own content fills the children slot')
      return fillTemplate(env, fill, slot.name, findNode(shell.root, slot.nodeId), '    ')
    })
    template = [`  <NuxtLayout name="${shell.name}">`, '    <template #default>', ...body, '    </template>', ...filled, '  </NuxtLayout>']
  }
  const seo = Object.entries(page.seo ?? {}).filter(([, value]) => value !== undefined)
  const seoLine = seo.length
    ? `useSeoMeta({ ${seo.map(([key, value]) => `${key}: ${typeof value === 'string' ? tsString(value) : `() => ${expression(env, undefined, value, 'script')}`}`).join(', ')} })`
    : undefined
  // A computed value the template binds is declared, and so is one only another computed value reads: writing a line can use more.
  const written = new Map<string, string>()
  const writeComputed = () => {
    for (let more = true; more;) {
      more = false
      for (const entry of computedEntries) {
        if (written.has(entry.as) || !env.used.has(`computed:${entry.as}`)) continue
        writing = entry.as
        written.set(entry.as, `const ${entry.as} = computed(() => ${expression(env, undefined, entry.if, 'script')} ? ${expression(env, undefined, entry.then, 'script')} : ${expression(env, undefined, entry.else, 'script')})`)
        writing = undefined
        more = true
      }
    }
  }
  // The call of each API query the page reads: its arguments are read here, before the declarations, so what they read is declared too.
  // A use reads only the uses above it, so the last is written first; a computed value an argument reads is written by the next round.
  const calls = new Map<string, string>()
  const writeCalls = () => {
    for (const { as, query, source, args } of [...apis].reverse()) {
      if (calls.has(as) || !env.used.has(`api:${as}`)) continue
      const given = query.params.flatMap(param => args?.[param.name] === undefined ? [] : [{ name: param.name, value: args[param.name]! }])
      const object = given.map(({ name, value }) => `${name}: ${expression(env, undefined, value, 'script')}`).join(', ')
      // A literal stays constant; anything the page computes is read again when it changes.
      calls.set(as, `${apiComposableName(source.name, query.name)}(${!given.length ? '' : given.some(({ value }) => isObject(value)) ? `() => ({ ${object} })` : `{ ${object} }`})`)
    }
  }
  for (let size = -1; size !== calls.size + written.size;) {
    size = calls.size + written.size
    writeCalls()
    writeComputed()
  }
  // In dependency order: what a line reads is declared above it.
  const computedLines: string[] = []
  const placed = new Set<string>()
  const place = (as: string) => {
    if (placed.has(as) || !written.has(as)) return
    placed.add(as)
    for (const dependency of reads.get(as) ?? []) place(dependency)
    computedLines.push(written.get(as)!)
  }
  computedEntries.forEach(entry => place(entry.as))

  const declarations: string[] = []
  for (const { as, file } of states) {
    const parts = env.used.get(`state:${as}`)
    if (!parts) continue
    const names = [parts.has('value') && (as === file.name ? file.name : `${file.name}: ${as}`), parts.has('set') && `set: set${pascal(as)}`].filter(Boolean)
    declarations.push(`const { ${names.join(', ')} } = use${pascal(context.name)}${pascal(file.name)}()`)
  }
  for (const { as, file, args } of queries) {
    const parts = env.used.get(`query:${as}`)
    if (!parts) continue
    const { composable, one } = queryNames(env, file)
    const data = one ? (as === one ? one : `${one}: ${as}`) : `data: ${as}`
    const names = [parts.has('data') && data, parts.has('loading') && `isLoading: ${as}Loading`].filter(Boolean)
    const argList = file.params.map((param) => {
      const value = args?.[param.name]
      if (value === undefined) return undefined
      const code = expression(env, undefined, value, 'script')
      return param.reactive && typeof value === 'object' ? `() => ${code}` : code
    })
    while (argList.length && argList[argList.length - 1] === undefined) argList.pop()
    declarations.push(`const { ${names.join(', ')} } = ${composable}(${argList.map(arg => arg ?? 'undefined').join(', ')})`)
  }
  for (const { as } of apis) {
    const parts = env.used.get(`api:${as}`)
    if (!parts) continue
    const names = [parts.has('data') && `data: ${as}`, parts.has('loading') && `pending: ${as}Loading`, parts.has('error') && `error: ${as}Error`].filter(Boolean)
    declarations.push(`const { ${names.join(', ')} } = ${calls.get(as)!}`)
  }
  for (const { as, file } of actions) {
    const parts = env.used.get(`action:${as}`)
    if (!parts) continue
    const names = [parts.has('execute') && `execute: ${as}`, parts.has('pending') && `pending: ${as}Pending`, parts.has('error') && `error: ${as}Error`].filter(Boolean)
    declarations.push(`const { ${names.join(', ')} } = use${pascal(file.name)}()`)
  }

  const formLines: string[] = []
  if (env.needs.has('form') && env.form) {
    const initial = env.form.fields.map((field) => {
      const value = field.default ?? (field.type === 'boolean' ? false : field.type === 'integer' || field.type === 'number' ? 0 : '')
      return `${field.name}: ${expression(env, undefined, value as Value, 'script')}`
    })
    formLines.push(`const form = reactive({ ${initial.join(', ')} })`)
  }

  const imports: string[] = []
  const meta = [`name: ${tsString(page.name)}`]
  if (layout) meta.push(`layout: ${fills.length ? 'false' : tsString(layout.name)}`)
  const layoutValues = Object.entries(page.layoutValues ?? {}).map(([id, value]) => {
    const variable = layout?.variables?.find(entry => entry.id === id) ?? fail(env, undefined, `layout ${layout?.name ?? '(none)'} has no variable ${id}`)
    return `${variable.name}: ${expression(env, undefined, value, 'script')}`
  })
  if (layoutValues.length) meta.push(`layoutValues: { ${layoutValues.join(', ')} }`)
  const validators = (page.params ?? []).filter(param => param.validate).map((param) => {
    const entity = context.module.entities.find(entry => entry.fields.some(field => field.id === param.validate!.field)) ?? fail(env, undefined, `unknown field ${param.validate!.field}`)
    const field = entity.fields.find(entry => entry.id === param.validate!.field)!
    const schema = field.unique ? `${entity.name}${pascal(field.name)}Schema` : `${entity.name}Schema`
    imports.push(`import { ${schema} } from '#${context.name}/domain/${entityNames(entity).file}'`)
    return `'${param.name}' in route.params && ${schema}${field.unique ? '' : `.shape.${field.name}`}.safeParse(route.params.${param.name}).success`
  })
  const metaLine = validators.length
    ? `definePageMeta({\n${[...meta, `validate: route => ${validators.join(' && ')}`].map(line => `  ${line}`).join(',\n')}\n})`
    : `definePageMeta({ ${meta.join(', ')} })`

  const setup = [
    ...(env.needs.has('route') ? [`const route = useRoute(${tsString(page.name)})`] : []),
    ...composableLines(env),
    ...declarations,
    ...computedLines,
    ...formLines,
    // Last: unhead calls the getters at once, so what they read must be declared.
    ...(seoLine ? [seoLine] : [])
  ]
  const script = [
    ...[...new Set(imports)],
    ...(imports.length ? [''] : []),
    metaLine,
    ...(setup.length ? ['', ...setup] : []),
    ...handlerLines(env)
  ]
  return {
    path: `layers/${context.name}/app/pages/${pagePath(page.path)}`,
    owner: 'managed',
    source,
    content: sfc(source, script, template)
  }
}
