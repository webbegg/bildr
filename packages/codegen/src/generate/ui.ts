import { customColorNames } from '../design/theme.ts'
import { displayFallback, parseStyleKey, styleClasses, styleInline, styleTokenProblem } from '../design/tokens.ts'
import type { Model } from '../model/load.ts'
import type { ActionFile, ComponentFile, EntityFile, LayoutFile, ModelNode, PageFile, QueryFile, Value } from '../model/schemas.ts'
import {
  CARD_DEFAULT_STYLE, CARD_STACK_KEYS, CARD_SURFACE_CLASS, CARD_SURFACE_STYLE, childrenInStack, CONTAINER_TAGS, containerTag, DEFAULT_HEADING_LEVEL,
  displayOf, fallbackStyle, HEADING_TOKENS, headingLevel, headingTag, ICON_CLASS, IMAGE_FALLBACK_STYLE, INPUT_CONTROL_CLASS, LINK_CLASS,
  LINK_ICON_CLASS, LINK_ICON_DISPLAY, linkTarget, NODE_ELEMENTS, nodePropProblems, selfFallback, structuralStyle, TEXT_CLASS, uiStepProblems
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
}

interface Env {
  model: Model
  context?: ModuleContext
  /** For error messages. */
  file: string
  roots: Map<string, Root>
  /** Script declarations the template needs, by kind and alias: `query:featured` → `data`, `loading`… */
  used: Map<string, Set<string>>
  needs: Set<'route' | 'site' | 'form' | 'props' | 'toast'>
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
}

interface Variant {
  /** The base of its class map constants, e.g. `card` for `cardVariants`. */
  base: string
  /** Every variant of the component with the style it overrides on this node (empty when none). */
  styles: Array<[string, Record<string, string>]>
  hiddenIn: string[]
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

/** Text content: static text escaped, `$template` interpolated, other values as one interpolation. */
const textContent = (env: Env, node: ModelNode, value: Value | undefined): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value === 'string') return escapeText(value)
  if (isObject(value) && typeof value.$template === 'string') {
    return templateParts(value.$template).map(part => part.path ? `{{ ${bindPath(env, node, part.path, 'template')} }}` : escapeText(part.text)).join('')
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
    const problem = styleTokenProblem(key, value, custom)
    if (problem) fail(env, node, problem)
  }
  const mine = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).filter(([key]) => pick(key)))
  const full = mine({ ...fallback, ...style })
  const variant = env.variants?.get(node.id)
  const keys = [...new Set((variant?.styles ?? []).flatMap(([, override]) => Object.keys(mine(override))))]
  const own = Object.fromEntries(Object.entries(full).filter(([key]) => !keys.includes(key)))
  const classes = [...fixed, display ? displayFallback(display, style) : '', styleClasses(own)].filter(Boolean).join(' ')
  const inline = Object.entries(styleInline(own)).map(([property, value]) => `${property}: ${value}`).join('; ')
  let map: string | undefined
  if (variant && keys.length) {
    // Variant overrides become a class map; the default entry holds what the node renders without one.
    map = `${variant.base}${part}Variants`
    const only = (entries: Record<string, string>) => Object.fromEntries(keys.filter(key => entries[key] !== undefined).map(key => [key, entries[key]!]))
    const perVariant: Array<[string, string]> = [['default', styleClasses(only(full))], ...variant.styles.map(([name, override]): [string, string] => [name, styleClasses(only({ ...full, ...mine(override) }))])]
    env.needs.add('props')
    env.variantLines.push('', `const ${map} = {`, perVariant.map(([name, value]) => `  ${name}: ${tsString(value)}`).join(',\n'), '} as const')
  }
  return [
    ...(classes ? [staticAttr('class', classes)] : []),
    ...(map ? [boundAttr('class', `${map}[props.variant]`)] : []),
    ...(inline ? [staticAttr('style', inline)] : [])
  ]
}

/** A static string as an attribute, any other value bound. */
const valueAttr = (env: Env, node: ModelNode, name: string, value: Value): Attr =>
  typeof value === 'string' ? staticAttr(name, value) : boundAttr(name, expression(env, node, value, 'template'))

/** `v-if` from `visible` and from the variants that hide the node. */
const visibility = (env: Env, node: ModelNode): Attr[] => {
  const conditions: string[] = []
  if (node.props?.visible !== undefined) conditions.push(expression(env, node, node.props.visible, 'template'))
  for (const name of env.variants?.get(node.id)?.hiddenIn ?? []) {
    env.needs.add('props')
    conditions.push(`props.variant !== ${tsString(name)}`)
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

const render = (env: Env, node: ModelNode, indent: string, options: RenderOptions = {}): string[] => {
  const problem = nodePropProblems(node.type, node.props)[0]
  if (problem) fail(env, node, problem.message)
  const extra = [...(options.attrs ?? []), ...visibility(env, node)]
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
  const lines: string[] = []
  if (typeof node.props?.loading === 'string' && loading.length) lines.push(...element('p', [attr('if', `v-if="${loading.join(' || ')}"`), staticAttr('class', 'text-muted')], escapeText(node.props.loading), indent))
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
  const lines: string[] = []
  const condition = () => lines.length ? 'v-else-if' : 'v-if'
  if (loading.length) lines.push(...element('p', [attr('if', `v-if="${loading.join(' || ')}"`), staticAttr('class', 'text-muted')], escapeText(props.loading as string), indent))
  if (typeof props.empty === 'string') lines.push(...element('p', [attr('if', `${condition()}="!${escapeAttr(items)}.length"`), staticAttr('class', 'text-muted')], escapeText(props.empty), indent))
  const shown: Attr[] = lines.length ? [attr('if', 'v-else')] : props.hideWhenEmpty === true ? [attr('if', `v-if="${escapeAttr(items)}.length"`)] : []

  const itemEnv: Env = { ...env, roots: new Map(env.roots).set(as, plainRoot(as)) }
  const repeat = [attr('for', `v-for="${as} in ${escapeAttr(items)}"`), attr('key', `:key="${as}.id"`)]
  const kids = node.children ?? []
  const inStack = childrenInStack(node.type, props)
  const inner = kids.length === 1
    ? render(itemEnv, kids[0]!, `${indent}  `, { attrs: repeat, slots: options.slots, inStack })
    : [`${indent}  <template ${repeat.map(entry => entry.text).join(' ')}>`, ...kids.flatMap(child => render(itemEnv, child, `${indent}    `, { slots: options.slots, inStack })), `${indent}  </template>`]
  lines.push(...element(tagOf(env, node), [...shown, ...styleAttrs(env, node, { display: displayOf(node.type, props), fallback: fallbackOf(node, options) })], inner, indent))
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
  return element(`${pascal(context.name)}${component.name}`, [...extra, ...attrs, ...style], fills, indent)
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
  env.handlers.push([`// Interaction "${on}": ${summaries.join(', then ')}.`, `const ${name} = async () => {`, ...body, '}'])
  return name
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
  model, context, file, roots: new Map(), used: new Map(), needs: new Set(), handlers: [], variantLines: [], optional: { used: new Set(), guarded: new Set() }, aliases: { actions: new Map(), state: new Map() }
})

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
  const slots = new Map(layout.slots.map(slot => [slot.nodeId, slot.name]))
  const template = render(env, layout.root, '  ', { slots })
  const script = [...composableLines(env), ...handlerLines(env)]
  while (script[0] === '') script.shift()
  return { path: `layers/core/app/layouts/${layout.name}.vue`, owner: 'managed', source, content: sfc(source, script, template) }
}

const PROPERTY_TYPES: Record<string, string> = { text: 'string', number: 'number', boolean: 'boolean', image: 'string', link: 'string' }

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
    } else {
      type = PROPERTY_TYPES[property.kind] ?? fail(env, undefined, `${property.kind} properties can't be generated yet`)
    }
    props.push(`  ${property.name}${property.required ? '' : '?'}: ${type}`)
    if (property.default !== undefined) defaults.push(`${property.name}: ${expression(env, undefined, property.default, 'script')}`)
  }

  // Variants: style overrides become a class map on the node (see `styleAttrs`), `hidden` a v-if.
  const variantMap = new Map<string, Variant>()
  const nodes = new Map<string, ModelNode>()
  const collect = (node: ModelNode) => {
    nodes.set(node.id, node)
    node.children?.forEach(collect)
  }
  collect(component.root)
  for (const variant of component.variants) {
    for (const [id, override] of Object.entries(variant.overrides)) {
      const node = nodes.get(id) ?? fail(env, undefined, `variant ${variant.name} overrides unknown node ${id}`)
      const entry = variantMap.get(id) ?? { base: camel(id.replace(/^n_/, '')), styles: component.variants.map(({ name, overrides }): [string, Record<string, string>] => [name, overrides[id]?.style ?? {}]), hiddenIn: [] }
      for (const [key, value] of Object.entries(override.props ?? {})) {
        if (key === 'hidden' && value === true) entry.hiddenIn.push(variant.name)
        else fail(env, node, `variant ${variant.name}: overriding ${key} can't be generated yet`)
      }
      variantMap.set(id, entry)
    }
  }
  env.variants = variantMap

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
  const script = [...imports, ...(imports.length ? [''] : []), ...define, ...composableLines(env), ...env.variantLines, ...handlerLines(env)]
  while (script[0] === '') script.shift()
  return {
    path: `layers/${context.name}/app/components/${context.name}/${component.name}.vue`,
    owner: 'managed',
    source,
    content: sfc(source, script, template)
  }
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
  for (const entry of computedEntries) {
    if (entry.if === undefined || entry.then === undefined || entry.else === undefined) fail(env, undefined, `computed ${entry.as} needs if, then and else`)
    env.roots.set(entry.as, refRoot(entry.as, () => use(env, `computed:${entry.as}`, 'value'), undefined, () => [...loadingOf(env, entry.then), ...loadingOf(env, entry.else)]))
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
  const computedLines = computedEntries.filter(entry => env.used.has(`computed:${entry.as}`)).map(entry =>
    `const ${entry.as} = computed(() => ${expression(env, undefined, entry.if, 'script')} ? ${expression(env, undefined, entry.then, 'script')} : ${expression(env, undefined, entry.else, 'script')})`)

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
