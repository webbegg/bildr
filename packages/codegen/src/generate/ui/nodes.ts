import { parseStyleKey } from '../../design/tokens.ts'
import { VALUE_TYPES } from '../../model/field-types.ts'
import type { ModelNode, Value } from '../../model/schemas.ts'
import { formatCode } from '../../render/format.ts'
import type { LayoutParent } from '../../render/rules.ts'
import {
  CARD_DEFAULT_STYLE, CARD_STACK_KEYS, CARD_SURFACE_CLASS, CARD_SURFACE_STYLE, childrenInStack, CONTAINER_TAGS, containerTag, DEFAULT_HEADING_LEVEL, displayOf, fallbackStyle, fillStyle, HEADING_TOKENS, headingLevel, headingTag, ICON_CLASS, IMAGE_FALLBACK_STYLE, INPUT_CONTROL_CLASS, LINK_CLASS, LINK_ICON_CLASS, LINK_ICON_DISPLAY, linkTarget, LOAD_MORE_CLASS, LOAD_MORE_LABEL, loadMoreSize, NODE_ELEMENTS, nodePropProblems, selfFallback, structuralStyle, TEXT_CLASS
} from '../../render/rules.ts'
import type { Field } from '../context.ts'
import { identifier, kebab, pascal, tsString } from '../text.ts'
import type { Env } from './env.ts'
import {
  actionById, API_ERROR_TEXT, bindPath, bindRoot, entityOf, errorsOf, expression, fail, isObject, itemParam, itemRoot, loadingOf, routeLocation, templateParts, where
} from './env.ts'
import { events } from './interactions.ts'
import type { Attr } from './markup.ts'
import { attr, boundAttr, element, escapeAttr, escapeText, staticAttr, staticText } from './markup.ts'
import { styleAttrs } from './style.ts'

/** A bound path shown as text: a money or percent field formatted (`valueFormats`) when it holds a number, else `otherwise`. */
export const shownPath = (env: Env, node: ModelNode, path: string, otherwise: () => string): string | undefined => {
  const format = env.formats[node.id]?.[path]
  if (!format) return undefined
  const code = bindPath(env, node, path, 'template')
  return `typeof ${code} === 'number' ? ${formatCode(code, format)} : ${otherwise()}`
}

/** Text content: static text escaped, `$template` interpolated, other values as one interpolation. */
export const textContent = (env: Env, node: ModelNode, value: Value | undefined): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value === 'string') return staticText(value)
  if (isObject(value) && typeof value.$template === 'string') {
    return templateParts(value.$template).map(part => part.path ? `{{ ${shownPath(env, node, part.path, () => '\'\'') ?? bindPath(env, node, part.path, 'template')} }}` : staticText(part.text)).join('')
  }
  if (isObject(value) && typeof value.$bind === 'string') {
    const shown = shownPath(env, node, value.$bind, () => value.fallback === undefined ? '\'\'' : expression(env, node, value.fallback, 'template'))
    if (shown) return `{{ ${shown} }}`
  }
  return `{{ ${expression(env, node, value, 'template')} }}`
}

/** A static string as an attribute, any other value bound. */
export const valueAttr = (env: Env, node: ModelNode, name: string, value: Value): Attr =>
  typeof value === 'string' ? staticAttr(name, value) : boundAttr(name, expression(env, node, value, 'template'))

/** `v-if` from `visible` and from the variants that hide the node. */
export const visibility = (env: Env, node: ModelNode): Attr[] => {
  const conditions: string[] = []
  if (node.props?.visible !== undefined) conditions.push(expression(env, node, node.props.visible, 'template'))
  for (const name of env.variants?.get(node.id)?.hiddenIn ?? []) {
    env.needs.add('props')
    conditions.push(`${env.variantExpr} !== ${tsString(name)}`)
  }
  return conditions.length ? [attr('if', `v-if="${escapeAttr(conditions.join(' && '))}"`)] : []
}

// ── Nodes ───────────────────────────────────────────────────────────────

export const tagOf = (env: Env, node: ModelNode) =>
  containerTag(node.props?.tag) ?? fail(env, node, `tag must be one of ${CONTAINER_TAGS.join(', ')}`)

export interface RenderOptions {
  /** Extra attributes from the parent (a List's v-for and key). */
  attrs?: Attr[]
  /** Layout slots: node id → slot name. */
  slots?: Map<string, string>
  /** The parent lays its children out in a vertical stack (`childrenInStack`), so `selfFallback` applies. */
  inStack?: boolean
  /** The node that lays this one out, which resolves its Fill sizes (`fillStyle`); none for a file's root. */
  parent?: LayoutParent
  /** The root of a page: its SlotFills fill the slots of the page's layout. */
  pageRoot?: boolean
}

export const SLOT_FILL = 'SlotFill'

/** The node's children, one level deeper (`depth` more for a wrapper), laid out the way the node lays them out. */
export const children = (env: Env, node: ModelNode, indent: string, options: RenderOptions, kids = node.children ?? [], depth = 1) =>
  kids.flatMap(child => render(env, child, `${indent}${'  '.repeat(depth)}`, { slots: options.slots, inStack: childrenInStack(node.type, node.props, node.style), parent: node }))

/** The token fallbacks of a node in its parent: the type's (render rules) after the stack's `self: stretch`. */
export const fallbackOf = (node: ModelNode, options: RenderOptions, own: Record<string, string> = fallbackStyle(node.type, node.props)) =>
  ({ ...selfFallback(node.type, node.style, options.inStack), ...own })

/** A layout's or component's slot around a node's children, which stay its default content. */
export const slotted = (env: Env, node: ModelNode, inner: string[], indent: string, options: RenderOptions) => {
  const layoutSlot = options.slots?.get(node.id)
  const slot = layoutSlot ?? env.componentSlots?.get(node.id)
  if (!slot) return inner
  if (!/^[A-Za-z_][\w-]*$/.test(slot)) fail(env, node, `"${slot}" is not a slot name (letters, digits, _ and -)`)
  const name = layoutSlot === 'children' ? '' : ` name="${slot}"`
  return inner.length ? [`${indent}<slot${name}>`, ...inner.map(line => `  ${line}`), `${indent}</slot>`] : [`${indent}<slot${name} />`]
}

export const render = (env: Env, original: ModelNode, indent: string, options: RenderOptions = {}): string[] => {
  const problem = nodePropProblems(original.type, original.props)[0]
  if (problem) fail(env, original, problem.message)
  // Props a variant overrides or a property drives become expressions.
  const swapped = env.substitutions?.get(original.id)
  const props = swapped ? { ...original.props, ...swapped } : original.props
  // Fill sizes become what they are in this parent (a variant's looks are resolved alike, in `variantsOf`).
  const style = original.style && fillStyle(original.style, options.parent, env.base)
  const node = swapped || style !== original.style ? { ...original, props, style } : original
  const extra = [...(options.attrs ?? []), ...visibility(env, node), ...(env.root?.id === node.id ? env.root.attrs : [])]
  switch (node.type) {
    case 'Page':
    case 'Container':
    case 'Row':
    case 'Column':
    case 'Grid': {
      const tag = tagOf(env, node)
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

export const isCardStackKey = (key: string) => CARD_STACK_KEYS.includes(parseStyleKey(key)?.token.key ?? '')

/** A Card: a tokenized div with the canvas UCard's surface, and an inner stack that lays out its children. */
export const card = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
  const root = styleAttrs(env, node, { classes: [CARD_SURFACE_CLASS], fallback: fallbackOf(node, options, { ...CARD_DEFAULT_STYLE, ...CARD_SURFACE_STYLE }), pick: key => !isCardStackKey(key) })
  const stack = styleAttrs(env, node, { classes: ['flex'], fallback: structuralStyle(node.type), pick: isCardStackKey, part: 'Stack' })
  const inner = slotted(env, node, children(env, node, indent, options, node.children, 2), `${indent}    `, options)
  return element('div', [...extra, ...root], element('div', stack, inner, `${indent}  `), indent)
}

export const image = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
  const { src, alt } = node.props ?? {}
  if (src === undefined || src === '') return fail(env, node, 'an Image needs `src`, a URL or a binding')
  // Always bound: a static `src` would be an asset import for Vue's compiler, and a missing upload would fail the build.
  const attrs = [...extra, boundAttr('src', expression(env, node, src, 'template')), ...(alt === undefined ? [] : [valueAttr(env, node, 'alt', alt)])]
  return element(NODE_ELEMENTS.Image, [...attrs, ...styleAttrs(env, node, { display: displayOf(node.type), fallback: fallbackOf(node, options, IMAGE_FALLBACK_STYLE) })], undefined, indent)
}

/** `href` (an external URL, opened in a new tab) or `to` (a page): the attributes of a Link or a Button. */
export const linkAttrs = (env: Env, node: ModelNode): Attr[] => {
  const href = node.props?.href
  if (href !== undefined) {
    if (typeof href !== 'string') return fail(env, node, 'href must be a URL')
    const target = linkTarget(href)
    return [staticAttr('to', href), ...(target ? [staticAttr('target', target)] : [])]
  }
  const to = routeLocation(env, node, node.props?.to, 'template')
  return [to.static !== undefined ? staticAttr('to', to.static) : boundAttr('to', to.code)]
}

export const link = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
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
export const guarded = (env: Env, node: ModelNode, tag: string, attrs: Attr[], inner: string[], indent: string) => {
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

export const buttonAttrs = (env: Env, node: ModelNode): Attr[] => {
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

export const fieldOf = (env: Env, node: ModelNode): Field => {
  if (!env.form) return fail(env, node, 'form fields must sit inside a Form')
  const field = env.form.fields.find(entry => entry.id === node.props?.field)
  return field ?? fail(env, node, `field ${String(node.props?.field)} is not one of the form's fields`)
}

/** The fields a text input edits, with the browser input each gets when the page names none (field types S3). */
export const TEXT_INPUT_TYPES = { text: undefined, email: 'email', url: 'url', phone: 'tel', color: undefined } as const

/** The browser `pattern` of a model pattern: anchors dropped (implicit), a trailing `-` in a class escaped (the `v` flag needs it). */
export const htmlPattern = (pattern: string) => pattern.replace(/^\^/, '').replace(/\$$/, '').replace(/(?<!\\)-\]/g, '\\-]')

export const input = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
  const field = fieldOf(env, node)
  const props = node.props ?? {}
  const label = typeof props.label === 'string' ? props.label : pascal(field.name)
  if (field.type === 'select') return selectInput(env, node, field, label, extra, indent, options)
  const numeric = VALUE_TYPES[field.type].family === 'number'
  const textual = field.type in TEXT_INPUT_TYPES
  if (!numeric && !textual) return fail(env, node, `a ${field.type} field has no input yet`)
  const multiline = props.multiline === true
  // A SaaS text type gets its browser input (email, url, tel) unless the page names another.
  const inputType = props.inputType ?? (multiline ? undefined : TEXT_INPUT_TYPES[field.type as keyof typeof TEXT_INPUT_TYPES])
  if (inputType !== undefined && multiline) return fail(env, node, 'a multiline input has no inputType')
  if (inputType !== undefined && numeric && inputType !== 'number') return fail(env, node, `a ${field.type} field's input has inputType number`)
  const attrs: Attr[] = [attr('model', `v-model${numeric ? '.number' : ''}="form.${field.name}"`), staticAttr('name', field.name)]
  if (field.required) attrs.push(attr('attr', 'required'))
  if (numeric) attrs.push(staticAttr('type', 'number'))
  // A browser number input takes whole numbers unless told otherwise: money is in cents, a percent any decimal.
  if (field.type === 'money') attrs.push(staticAttr('step', '0.01'))
  if (field.type === 'percent') attrs.push(staticAttr('step', 'any'))
  if (!numeric && field.max !== undefined) attrs.push(staticAttr('maxlength', String(field.max)))
  if (field.pattern) attrs.push(staticAttr('pattern', htmlPattern(field.pattern)))
  if (!numeric && typeof inputType === 'string' && inputType !== 'text') attrs.push(staticAttr('type', inputType))
  if (props.placeholder !== undefined) attrs.push(valueAttr(env, node, 'placeholder', props.placeholder))
  if (multiline && typeof props.rows === 'number') attrs.push(boundAttr('rows', String(props.rows)))
  attrs.push(staticAttr('class', INPUT_CONTROL_CLASS))
  const control = element(multiline ? NODE_ELEMENTS.InputMultiline : NODE_ELEMENTS.InputControl, attrs, undefined, `${indent}  `)
  return element(NODE_ELEMENTS.Input, [...extra, staticAttr('label', label), staticAttr('name', field.name), ...(field.required ? [attr('attr', 'required')] : []), ...styleAttrs(env, node, { fallback: fallbackOf(node, options) })], control, indent)
}

/** A select field's Input: a dropdown of its options, labelled as any Input. */
export const selectInput = (env: Env, node: ModelNode, field: Field, label: string, extra: Attr[], indent: string, options: RenderOptions) => {
  const props = node.props ?? {}
  if (props.multiline !== undefined || props.inputType !== undefined) return fail(env, node, 'a select field\'s input is a dropdown: it has no multiline or inputType')
  const attrs: Attr[] = [attr('model', `v-model="form.${field.name}"`), staticAttr('name', field.name)]
  if (field.required) attrs.push(attr('attr', 'required'))
  attrs.push(boundAttr('items', `[${(field.options ?? []).map(option => tsString(option)).join(', ')}]`))
  if (props.placeholder !== undefined) attrs.push(valueAttr(env, node, 'placeholder', props.placeholder))
  attrs.push(staticAttr('class', INPUT_CONTROL_CLASS))
  const control = element(NODE_ELEMENTS.InputSelect, attrs, undefined, `${indent}  `)
  return element(NODE_ELEMENTS.Input, [...extra, staticAttr('label', label), staticAttr('name', field.name), ...(field.required ? [attr('attr', 'required')] : []), ...styleAttrs(env, node, { fallback: fallbackOf(node, options) })], control, indent)
}

export const checkbox = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
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

export const form = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
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

export const list = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
  if (extra.length) return fail(env, node, 'a List can\'t be hidden or repeated itself yet')
  const props = node.props ?? {}
  const as = typeof props.as === 'string' ? identifier(props.as, where(env, node)) : fail(env, node, 'a List needs `as`, the item name')
  const items = expression(env, node, props.items, 'template')
  const errors = errorsOf(env, props.items)
  // An API list with an empty text but no loading text still holds its place while the query is pending: the empty text is for an answer that came back empty.
  const waits = typeof props.loading === 'string' || (errors.length > 0 && typeof props.empty === 'string')
  const loading = waits ? loadingOf(env, props.items) : []
  const lines: string[] = []
  const condition = () => lines.length ? 'v-else-if' : 'v-if'
  if (loading.length) {
    lines.push(...typeof props.loading === 'string'
      ? element('p', [attr('if', `v-if="${loading.join(' || ')}"`), staticAttr('class', 'text-muted')], escapeText(props.loading), indent)
      : element('template', [attr('if', `v-if="${loading.join(' || ')}"`)], undefined, indent))
  }
  if (errors.length) lines.push(...element('p', [attr('if', `${condition()}="${errors.join(' || ')}"`), staticAttr('class', 'text-error')], API_ERROR_TEXT, indent))
  if (typeof props.empty === 'string') lines.push(...element('p', [attr('if', `${condition()}="!${escapeAttr(items)}.length"`), staticAttr('class', 'text-muted')], escapeText(props.empty), indent))
  // An API list always has its error line, so the wrapper follows it; with `hideWhenEmpty` and no empty message it still hides when empty.
  const hidden = props.hideWhenEmpty === true && !(typeof props.empty === 'string')
  const shownIf: Attr[] = lines.length
    ? [attr('if', errors.length && hidden ? `v-else-if="${escapeAttr(items)}.length"` : 'v-else')]
    : hidden ? [attr('if', `v-if="${escapeAttr(items)}.length"`)] : []

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
  const inStack = childrenInStack(node.type, props, node.style)
  const inner = kids.length === 1
    ? render(itemEnv, kids[0]!, `${indent}  `, { attrs: repeat, slots: options.slots, inStack, parent: { ...node, props } })
    : [`${indent}  <template ${repeat.map(entry => entry.text).join(' ')}>`, ...kids.flatMap(child => render(itemEnv, child, `${indent}    `, { slots: options.slots, inStack, parent: { ...node, props } })), `${indent}  </template>`]
  const button = shown && more
    ? [`${indent}  <div v-if="${escapeAttr(items)}.length > ${shown}" class="${LOAD_MORE_CLASS}">`, `${indent}    <UButton label="${LOAD_MORE_LABEL}" @click="${shown} += ${more}" />`, `${indent}  </div>`]
    : []
  lines.push(...element(tagOf(env, node), [...shownIf, ...styleAttrs(env, node, { display: displayOf(node.type, props), fallback: fallbackOf(node, options) })], [...inner, ...button], indent))
  return lines
}

/** The node of a tree by id. */
export const findNode = (node: ModelNode, id: string): ModelNode | undefined =>
  node.id === id ? node : node.children?.map(child => findNode(child, id)).find(Boolean)

/** `<template #name>` with a SlotFill's children, laid out the way the slot's node lays them out. */
export const fillTemplate = (env: Env, fill: ModelNode, name: string, target: ModelNode | undefined, indent: string, slots?: Map<string, string>) => [
  `${indent}<template #${name}>`,
  ...(fill.children ?? []).flatMap(child => render(env, child, `${indent}  `, { slots, inStack: target ? childrenInStack(target.type, target.props, target.style) : false, parent: target })),
  `${indent}</template>`
]

export const instance = (env: Env, node: ModelNode, extra: Attr[], indent: string, options: RenderOptions) => {
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
