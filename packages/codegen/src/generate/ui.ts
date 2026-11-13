import { customColorNames } from '../design/theme.ts'
import { displayFallback, styleClasses, styleInline, styleTokenProblem } from '../design/tokens.ts'
import type { Model } from '../model/load.ts'
import type { ActionFile, ComponentFile, EntityFile, LayoutFile, ModelNode, PageFile, QueryFile, Value } from '../model/schemas.ts'
import { CONTAINER_TAGS, DEFAULT_HEADING_LEVEL, displayOf, headingTag, INPUT_CONTROL_CLASS, NODE_ELEMENTS } from '../render/rules.ts'
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
  needs: Set<'route' | 'site' | 'form' | 'props'>
  /** Script blocks of interaction handlers. */
  handlers: string[][]
  /** The Form being rendered: its action and the entity fields it edits. */
  form?: { fields: Field[] }
  /** Component variants: node id → the style keys they override (rendered as a class map) and the variants that hide it. */
  variants?: Map<string, Variant>
  /** Page aliases (`uses`) by artifact id: an action's alias names its `execute`, a state's its setter. */
  aliases: { actions: Map<string, string>, state: Map<string, string> }
}

interface Variant {
  /** The class map constant, e.g. `cardVariants`. */
  name: string
  keys: string[]
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

const refRoot = (name: string, onUse: () => void, optional = false, loading?: () => string[]): Root => ({
  resolve: (members, ctx) => {
    onUse()
    if (ctx === 'template') return [name, ...members].join('.')
    return `${name}.value${members.map(member => `${optional ? '?.' : '.'}${member}`).join('')}`
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

/** An element: self-closed when empty, one line for text, nested lines otherwise. */
const element = (tag: string, attrs: Attr[], inner: string | string[] | undefined, indent: string): string[] => {
  const open = openTag(tag, attrs)
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

/** The node's classes, checked against the token registry: an unknown token is an error, not a silent drop. */
const styleAttrs = (env: Env, node: ModelNode, display = ''): Attr[] => {
  const style = node.style ?? {}
  const custom = customColorNames(env.model.theme)
  for (const [key, value] of Object.entries(style)) {
    const problem = styleTokenProblem(key, value, custom)
    if (problem) fail(env, node, problem)
  }
  const variant = env.variants?.get(node.id)
  const own = Object.fromEntries(Object.entries(style).filter(([key]) => !variant?.keys.includes(key)))
  const classes = [display ? displayFallback(display, style) : '', styleClasses(own)].filter(Boolean).join(' ')
  const inline = Object.entries(styleInline(own)).map(([property, value]) => `${property}: ${value}`).join('; ')
  return [
    ...(classes ? [staticAttr('class', classes)] : []),
    ...(variant?.keys.length ? [boundAttr('class', `${variant.name}[props.variant]`)] : []),
    ...(inline ? [staticAttr('style', inline)] : [])
  ]
}

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

const tagOf = (env: Env, node: ModelNode) => {
  const tag = node.props?.tag ?? 'div'
  if (typeof tag !== 'string' || !CONTAINER_TAGS.includes(tag)) return fail(env, node, `tag must be one of ${CONTAINER_TAGS.join(', ')}`)
  return tag
}

interface RenderOptions {
  /** Extra attributes from the parent (a List's v-for and key). */
  attrs?: Attr[]
  /** Layout slots: node id → slot name. */
  slots?: Map<string, string>
}

const children = (env: Env, node: ModelNode, indent: string, options: RenderOptions) =>
  (node.children ?? []).flatMap(child => render(env, child, `${indent}  `, { slots: options.slots }))

const render = (env: Env, node: ModelNode, indent: string, options: RenderOptions = {}): string[] => {
  const extra = [...(options.attrs ?? []), ...visibility(env, node)]
  switch (node.type) {
    case 'Page':
    case 'Container':
    case 'Row': {
      const tag = tagOf(env, node)
      // Only a Row gets its display: KNOWN_DIVERGENCES container-direction, row-direction-wrap.
      const attrs = [...extra, ...styleAttrs(env, node, node.type === 'Row' ? displayOf(node.type) : '')]
      let inner = children(env, node, indent, options)
      const slot = options.slots?.get(node.id)
      if (slot) {
        if (!/^[A-Za-z_][\w-]*$/.test(slot)) fail(env, node, `"${slot}" is not a slot name (letters, digits, _ and -)`)
        const name = slot === 'children' ? '' : ` name="${slot}"`
        inner = inner.length ? [`${indent}  <slot${name}>`, ...inner.map(line => `  ${line}`), `${indent}  </slot>`] : [`${indent}  <slot${name} />`]
      }
      if (node.type === 'Page' && node.props?.when !== undefined) return guarded(env, node, tag, attrs, inner, indent)
      return element(tag, attrs, inner, indent)
    }
    case 'Heading': {
      const level = node.props?.level ?? DEFAULT_HEADING_LEVEL
      if (typeof level !== 'number' || level < 1 || level > 6) return fail(env, node, 'heading level must be 1–6')
      return element(headingTag(level), [...extra, ...styleAttrs(env, node)], textContent(env, node, node.props?.text), indent)
    }
    case 'Text':
      return element(NODE_ELEMENTS.Text, [...extra, ...styleAttrs(env, node)], textContent(env, node, node.props?.text), indent)
    case 'Link': {
      const to = routeLocation(env, node, node.props?.to, 'template')
      const attrs = [...extra, to.static !== undefined ? staticAttr('to', to.static) : boundAttr('to', to.code), ...styleAttrs(env, node)]
      const inner = node.children?.length ? children(env, node, indent, options) : textContent(env, node, node.props?.text)
      return element(NODE_ELEMENTS.Link, attrs, inner, indent)
    }
    case 'Button':
      return element(NODE_ELEMENTS.Button, [...extra, ...buttonAttrs(env, node), ...styleAttrs(env, node), ...events(env, node)], undefined, indent)
    case 'Input':
      return input(env, node, extra, indent)
    case 'Checkbox':
      return checkbox(env, node, extra, indent)
    case 'Form':
      return form(env, node, extra, indent, options)
    case 'List':
      return list(env, node, extra, indent, options)
    case 'Instance':
      return instance(env, node, extra, indent)
    default:
      return fail(env, node, `node type ${node.type} can't be generated yet`)
  }
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
  if (typeof props.text === 'string') attrs.push(staticAttr('label', props.text))
  else if (props.text !== undefined) attrs.push(boundAttr('label', expression(env, node, props.text, 'template')))
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

const input = (env: Env, node: ModelNode, extra: Attr[], indent: string) => {
  const field = fieldOf(env, node)
  const label = typeof node.props?.label === 'string' ? node.props.label : pascal(field.name)
  const numeric = field.type === 'integer' || field.type === 'number'
  if (!numeric && field.type !== 'text') return fail(env, node, `a ${field.type} field has no input yet`)
  const attrs: Attr[] = [attr('model', `v-model${numeric ? '.number' : ''}="form.${field.name}"`), staticAttr('name', field.name)]
  if (field.required) attrs.push(attr('attr', 'required'))
  if (numeric) attrs.push(staticAttr('type', 'number'))
  if (!numeric && field.max !== undefined) attrs.push(staticAttr('maxlength', String(field.max)))
  if (field.pattern) attrs.push(staticAttr('pattern', htmlPattern(field.pattern)))
  const multiline = node.props?.multiline === true
  if (multiline && typeof node.props?.rows === 'number') attrs.push(boundAttr('rows', String(node.props.rows)))
  attrs.push(staticAttr('class', INPUT_CONTROL_CLASS))
  const control = element(multiline ? NODE_ELEMENTS.InputMultiline : NODE_ELEMENTS.InputControl, attrs, undefined, `${indent}  `)
  return element(NODE_ELEMENTS.Input, [...extra, staticAttr('label', label), staticAttr('name', field.name), ...(field.required ? [attr('attr', 'required')] : []), ...styleAttrs(env, node)], control, indent)
}

const checkbox = (env: Env, node: ModelNode, extra: Attr[], indent: string) => {
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
  return element(NODE_ELEMENTS.Checkbox, [...attrs, ...styleAttrs(env, node), ...events(env, node)], undefined, indent)
}

const form = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
  const action = actionById(env, node, node.props?.action)
  const entity = action.input.entity ? entityOf(env, node, action.input.entity) : undefined
  if (!entity) return fail(env, node, 'a Form needs an action with an entity input')
  const ids = Array.isArray(node.props?.fields) ? node.props.fields : []
  const fields = ids.map(id => entity.fields.find(field => field.id === id) ?? fail(env, node, `unknown field ${String(id)}`))
  env.form = { fields }
  env.needs.add('form')
  const lines = element(NODE_ELEMENTS.Form, [...extra, ...styleAttrs(env, node), ...events(env, node)], children(env, node, indent, options), indent)
  return lines
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
  const inner = kids.length === 1
    ? render(itemEnv, kids[0]!, `${indent}  `, { attrs: repeat, slots: options.slots })
    : [`${indent}  <template ${repeat.map(entry => entry.text).join(' ')}>`, ...kids.flatMap(child => render(itemEnv, child, `${indent}    `, { slots: options.slots })), `${indent}  </template>`]
  lines.push(...element(tagOf(env, node), [...shown, ...styleAttrs(env, node)], inner, indent))
  return lines
}

const instance = (env: Env, node: ModelNode, extra: Attr[], indent: string) => {
  const context = env.context ?? fail(env, node, 'component instances need a module')
  const component = context.module.components.find(entry => entry.id === node.props?.component) ?? fail(env, node, `unknown component ${String(node.props?.component)}`)
  const values = isObject(node.props?.values) ? node.props.values : {}
  const attrs = component.properties.flatMap((property) => {
    const value = values[property.id]
    if (value === undefined) return []
    return [typeof value === 'string' ? staticAttr(kebab(property.name), value) : boundAttr(kebab(property.name), expression(env, node, value, 'template'))]
  })
  return element(`${pascal(context.name)}${component.name}`, [...extra, ...attrs, ...styleAttrs(env, node)], undefined, indent)
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
  return attr('event', `@${name}="${handler(env, node, interaction.on, steps)}"`)
})

/** A named script handler for a multi-step interaction: run an action, then navigate when it succeeded. */
const handler = (env: Env, node: ModelNode, on: string, steps: Array<Record<string, Value>>) => {
  const name = `on${pascal(node.id.replace(/^n_/, ''))}${pascal(on)}`
  const [first, second] = steps
  const navigate = (step: Record<string, Value>) => `await navigateTo(${routeLocation(env, node, step.to, 'script').code})`
  let body: string
  let summary: string
  if (first?.kind === 'runAction' && !second) {
    body = `  await ${runAction(env, node, first, 'script')}`
    summary = `run action ${actionById(env, node, first.action).label}`
  } else if (first?.kind === 'runAction' && second?.kind === 'navigate' && second.when === 'success' && steps.length === 2) {
    body = `  if (await ${runAction(env, node, first, 'script')}) ${navigate(second)}`
    summary = `run action ${actionById(env, node, first.action).label}, then go to ${pageById(env, node, String((second.to as Record<string, Value>).page)).path}`
  } else if (first?.kind === 'navigate' && !second) {
    body = `  ${navigate(first)}`
    summary = `go to ${pageById(env, node, String((first.to as Record<string, Value>).page)).path}`
  } else {
    return fail(env, node, `this ${on} interaction can't be generated yet`)
  }
  env.handlers.push([`// Interaction "${on}": ${summary}.`, `const ${name} = async () => {`, body, '}'])
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
  model, context, file, roots: new Map(), used: new Map(), needs: new Set(), handlers: [], aliases: { actions: new Map(), state: new Map() }
})

const siteRoot = (env: Env) => plainRoot('site', () => env.needs.add('site'))

const layoutFile = (model: Model, layout: LayoutFile): GeneratedFile => {
  const source = model.paths[layout.id] ?? `.bildr/layouts/${layout.name}.json`
  const env = newEnv(model, source)
  env.roots.set('site', siteRoot(env))
  const slots = new Map(layout.slots.map(slot => [slot.nodeId, slot.name]))
  const template = render(env, layout.root, '  ', { slots })
  const script = env.needs.has('site') ? ['const { site } = useAppConfig()'] : []
  return { path: `layers/core/app/layouts/${layout.name}.vue`, owner: 'managed', source, content: sfc(source, script, template) }
}

const PROPERTY_TYPES: Record<string, string> = { text: 'string', number: 'number', boolean: 'boolean', image: 'string', link: 'string' }

const componentFile = (context: ModuleContext, component: ComponentFile): GeneratedFile => {
  const source = context.source(component.id)
  const env = newEnv(context.model, source, context)
  const imports: string[] = []
  const props: string[] = []
  const defaults: string[] = []
  for (const property of component.properties) {
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

  // Variants: style overrides become a class map on the node, `hidden` a v-if.
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
      const entry = variantMap.get(id) ?? { name: `${camel(id.replace(/^n_/, ''))}Variants`, keys: [], hiddenIn: [] }
      for (const [key, value] of Object.entries(override.props ?? {})) {
        if (key === 'hidden' && value === true) entry.hiddenIn.push(variant.name)
        else fail(env, node, `variant ${variant.name}: overriding ${key} can't be generated yet`)
      }
      entry.keys = [...new Set([...entry.keys, ...Object.keys(override.style ?? {})])]
      variantMap.set(id, entry)
    }
  }
  const variantLines: string[] = []
  for (const [id, entry] of variantMap) {
    if (!entry.keys.length) continue
    const node = nodes.get(id)!
    const pick = (style: Record<string, string>) => Object.fromEntries(entry.keys.filter(key => style[key] !== undefined).map(key => [key, style[key]!]))
    const perVariant: Array<[string, string]> = [['default', styleClasses(pick(node.style ?? {}))]]
    for (const variant of component.variants) perVariant.push([variant.name, styleClasses(pick({ ...node.style, ...variant.overrides[id]?.style }))])
    env.needs.add('props')
    variantLines.push('', `const ${entry.name} = {`, perVariant.map(([name, value]) => `  ${name}: ${tsString(value)}`).join(',\n'), '} as const')
  }
  env.variants = variantMap

  const template = render(env, component.root, '  ')
  if (component.variants.length) {
    props.push(`  variant?: ${['default', ...component.variants.map(variant => variant.name)].map(name => tsString(name)).join(' | ')}`)
    defaults.push('variant: \'default\'')
  }
  const declare = env.needs.has('props') ? 'const props = ' : ''
  const define = defaults.length
    ? `${declare}withDefaults(defineProps<{\n${props.join('\n')}\n}>(), { ${defaults.join(', ')} })`
    : `${declare}defineProps<{\n${props.join('\n')}\n}>()`
  const script = [...imports, ...(imports.length ? [''] : []), define, ...variantLines]
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
    env.roots.set(as, refRoot(as, () => use(env, `query:${as}`, 'data'), !!one, () => {
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
    env.roots.set(entry.as, refRoot(entry.as, () => use(env, `computed:${entry.as}`, 'value'), false, () => [...loadingOf(env, entry.then), ...loadingOf(env, entry.else)]))
  }

  // The template first: it decides which declarations the script needs.
  const template = render(env, page.root, '  ')
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
  const layout = page.layout ? context.model.layouts.find(entry => entry.id === page.layout) ?? fail(env, undefined, `unknown layout ${page.layout}`) : undefined
  if (layout) meta.push(`layout: ${tsString(layout.name)}`)
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
    ...(env.needs.has('site') ? ['const { site } = useAppConfig()'] : []),
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
    ...env.handlers.flatMap(lines => ['', ...lines])
  ]
  return {
    path: `layers/${context.name}/app/pages/${pagePath(page.path)}`,
    owner: 'managed',
    source,
    content: sfc(source, script, template)
  }
}
