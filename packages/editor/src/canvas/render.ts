import { displayFallback, orderedStyleTokens, parseStyleKey, styleClasses, styleInline, tidyClasses } from '@bildr/codegen/design'
import type { BreakpointBase } from '@bildr/codegen/design'
import type { ComponentFile, LayoutFile, ModelNode, PageFile, PropertyDef, Value } from '@bildr/codegen/model'
import {
  animatedProperties, CARD_DEFAULT_STYLE, CARD_STACK_KEYS, CARD_SURFACE_CLASS, CARD_SURFACE_STYLE, childrenInStack, containerTag, DEFAULT_HEADING_LEVEL,
  DEFAULT_TRANSITION, displayOf, fallbackStyle, FILL, fillStyle, HEADING_TOKENS, headingLevel, headingTag, ICON_CLASS, IMAGE_FALLBACK_STYLE, INPUT_CONTROL_CLASS, isSafeUrl, LINK_CLASS,
  LINK_ICON_CLASS, LINK_ICON_DISPLAY, linkTarget, LOAD_MORE_CLASS, LOAD_MORE_LABEL, loadMoreSize, NODE_ELEMENTS, selfFallback, structuralStyle, TEXT_CLASS, transitionTimingClasses,
  formatValue
} from '@bildr/codegen/render'
import type { LayoutParent, ValueFormats } from '@bildr/codegen/render'
import { INSTANCE_ID_SEPARATOR, layoutNodeId } from './ids.ts'
import type { PlainValue } from './protocol.ts'

/**
 * The canvas renderer's pure half (P4a, spec V4): a `.bildr` page, component
 * or layout file and the data it reads become a render plan, a tree of
 * elements (an HTML tag or a Nuxt UI component, its classes, attributes and
 * children) that `ModelNode.vue` turns into vnodes. It follows the generator
 * (`generate/ui.ts`) rule for rule with the shared `@bildr/codegen/render`
 * rules and token classes, so each element has the tag and classes the
 * generated app renders (the parity tests compare them).
 *
 * Canvas-only parts, which the generator has no equivalent for:
 * - `data-node` ids. Page nodes keep theirs; the parts of an Instance are
 *   `<instanceId>/<nodeId>` (`INSTANCE_ID_SEPARATOR`, composed when nested),
 *   and its root element carries the instance's own id; layout nodes are
 *   `<pageRootId>/@<nodeId>`. `pageNodeId` maps any of them back to the node
 *   of the file being edited.
 * - Data the editor doesn't send (a root of `$bind` no alias, prop or
 *   layout value provides) renders as a placeholder: `{post.title}` in text,
 *   the node shown whatever its `visible`, a List's children once (dimmed).
 *   Elements standing in for missing parts (an empty List's text, a missing
 *   component, a layout's page slot) are `placeholder`.
 * - List repetitions after the first are `copy`, so outlines and drops use
 *   the first.
 */

export { INSTANCE_ID_SEPARATOR, LAYOUT_ID_MARKER } from './ids.ts'
/** Nested component depth beyond which an instance is not expanded (the model refuses cycles). */
export const MAX_INSTANCE_DEPTH = 8

/** The id of the edited file's node a rendered id belongs to: the instance for its parts, the page root for layout parts. */
export function pageNodeId(id: string): string {
  const at = id.indexOf(INSTANCE_ID_SEPARATOR)
  return at < 0 ? id : id.slice(0, at)
}

/** The variant a board frame shows: `id` null is the primary. */
export interface BoardVariant { id: string | null, label: string }

export type CanvasFile = PageFile | ComponentFile | LayoutFile

export interface RenderInput {
  file: CanvasFile
  components: ComponentFile[]
  layouts: LayoutFile[]
  /** By alias: a page's `uses` (rows of a query, a state, `{pending, error}` of an action), `site`, `$route`; a component's props by name. */
  data: Record<string, unknown>
  /** The variant a component file renders (a variant board frame). */
  variant?: BoardVariant | null
  /** Preview mode: the variant each interactive instance shows now, by its root's `data-node` id. */
  shown?: Record<string, string>
  /** Preview mode: how many records each List shows after Load more clicks, by the List's `data-node` id (its `loadMore` page size until clicked). */
  listShown?: Record<string, number>
  /** Page id → route path, so links to a page point at it (the canvas's router sits on the current page's path, which makes those links active). */
  paths?: Record<string, string>
  /** Action id → field id → options: the select fields of the entity a Form running that action edits, so their Inputs are dropdowns. */
  formSelects?: Record<string, Record<string, string[]>>
  /** File id → the money and percent fields its nodes show as text (`valueFormats`), so they read as the generated app writes them. */
  formats?: Record<string, ValueFormats>
  /** The project's breakpoint base: the cascade Fill sizes resolve along (`fillStyle`). */
  base?: BreakpointBase
}

export interface PlanElement {
  tag: string
  class: string
  /** `data-node`: the rendered node id (see above). Absent on inner parts of a node (a Card's stack, an Input's control). */
  node?: string
  /** The node type, `Instance` on an instance's parts and `Layout` on layout parts (the canvas labels boxes with it). */
  type?: string
  style?: Record<string, string>
  /** HTML attributes or Nuxt UI component props. */
  attrs: Record<string, unknown>
  children: PlanChild[]
  copy?: boolean
  placeholder?: boolean
  /** The node's own interactions (preview mode runs them). */
  interactions?: ModelNode['interactions']
  /** The scope the node renders in, on a node with a Set state step: preview mode works the step's value out over it (`stepValue`). */
  scope?: Record<string, unknown>
  /** The root of an instance whose component has states or interactions (preview mode switches its variant). */
  variantRoot?: { key: string, component: ComponentFile, variant: string, css: boolean }
}
export type PlanChild = PlanElement | string

/** What an expression reads when the scope has no root for it (`designData` leaves such a computed value to the render). */
export const MISSING: unique symbol = Symbol('missing')
type Evaluated = unknown

const isObject = (value: unknown): value is Record<string, Value> => typeof value === 'object' && value !== null && !Array.isArray(value)

// ── Scope ───────────────────────────────────────────────────────────────

type Scope = Record<string, unknown>

/** `root.members…` in the scope; a root the scope lacks is MISSING, as is any member of a MISSING value. */
const resolvePath = (scope: Scope, path: string): Evaluated => {
  const [root, ...members] = path.split('.')
  if (!(root! in scope)) return MISSING
  let value = scope[root!]
  for (const member of members) {
    if (value === MISSING) return MISSING
    if (value === null || value === undefined) return undefined
    value = (value as Record<string, unknown>)[member]
  }
  return value
}

const templateParts = (template: string) => template.split(/(\{[\w.]+\})/).filter(Boolean)
  .map(part => /^\{[\w.]+\}$/.test(part) ? { text: '', path: part.slice(1, -1) } : { text: part, path: undefined })

/** An expression over a scope, as the generated app reads it (`not`, `$bind` with its fallback, `$template`, a literal): the canvas's one evaluator. */
export const evaluate = (value: Value | undefined, scope: Scope): Evaluated => {
  if (value === undefined || value === null) return undefined
  if (!isObject(value)) return value
  if (typeof value.$bind === 'string') {
    const bound = resolvePath(scope, value.$bind)
    return bound === undefined || bound === null ? evaluate(value.fallback, scope) ?? bound : bound
  }
  if ('not' in value) {
    const inner = evaluate(value.not, scope)
    return inner === MISSING ? MISSING : !inner
  }
  if (typeof value.$route === 'string') return resolvePath(scope, `$route.${value.$route}`)
  if (value.$event === 'checked') return resolvePath(scope, '$event')
  if (value.$form !== undefined) return value.$form === true ? { ...(scope.$form as object) } : resolvePath(scope, `$form.${String(value.$form)}`)
  if (typeof value.$template === 'string') return templateParts(value.$template).map(part => part.path ? text(resolvePath(scope, part.path), part.path) : part.text).join('')
  return undefined
}

/**
 * The value a Set state step stores when its interaction runs in preview, worked out as the generated handler does over the scope
 * its node renders in: a fixed value, `not` a binding, a binding or a template, and `{ $event: 'checked' }` the Checkbox's new
 * `checked`. Undefined when it can't be worked out (a binding nothing provides, a list or a row): there is nothing to set.
 */
export function stepValue(value: Value | undefined, scope: Record<string, unknown>, checked?: boolean): PlainValue | undefined {
  if (value === null) return null
  const result = evaluate(value, checked === undefined ? scope : { ...scope, $event: checked })
  return result === null || typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean' ? result : undefined
}

/** Whether a node has a Set state step in any of its interactions (preview mode reports those, with their value: `protocol.ts`). */
export const setsState = (node: ModelNode): boolean => !!node.interactions?.some(interaction => interaction.do.some(step => (step as Record<string, Value>).kind === 'setState'))

/** Whether a plan element is a Checkbox's control, whose clicks are its `change` (and its label's, which preview mode resolves to it). */
export const isCheckbox = (element: PlanElement): boolean => element.tag === NODE_ELEMENTS.Checkbox

/** A value as text: a missing one as its path (`{post.title}`). */
const text = (value: Evaluated, path = 'value'): string => value === MISSING ? `{${path}}` : value === undefined || value === null ? '' : String(value)

const textOf = (value: Value | undefined, scope: Scope): string | undefined => {
  if (value === undefined) return undefined
  const path = isObject(value) && typeof value.$bind === 'string' ? value.$bind : undefined
  return text(evaluate(value, scope), path)
}

/** A node's text as the generated app writes it: a money or percent field it shows formatted when it holds a number (`valueFormats`). */
const shownText = (frame: Frame, node: ModelNode, value: Value | undefined): string | undefined => {
  const formats = frame.formats?.[node.id]
  if (!formats || !isObject(value)) return textOf(value, frame.scope)
  const formatted = (path: string): string | undefined => {
    const format = formats[path]
    const bound = format ? resolvePath(frame.scope, path) : undefined
    return format && typeof bound === 'number' ? formatValue(bound, format) : undefined
  }
  if (typeof value.$bind === 'string') return formatted(value.$bind) ?? textOf(value, frame.scope)
  if (typeof value.$template === 'string') return templateParts(value.$template).map(part => part.path ? formatted(part.path) ?? text(resolvePath(frame.scope, part.path), part.path) : part.text).join('')
  return textOf(value, frame.scope)
}

/** A static or evaluated string prop, undefined when missing. */
const stringOf = (value: Value | undefined, scope: Scope): string | undefined => {
  const evaluated = evaluate(value, scope)
  return evaluated === MISSING || evaluated === undefined || evaluated === null ? undefined : String(evaluated)
}

// ── Components: variants and property bindings (the generator's `variantsOf` and `bindProperties`) ──

type Override = ComponentFile['variants'][number]['overrides'][string]
type VariantDef = ComponentFile['variants'][number]

interface Pointer { prefix: string, style: Record<string, string>, keys: string[] }
interface NodeVariants {
  styles: Map<string, Record<string, string>>
  pointer: Map<string, Pointer[]>
  hiddenIn: string[]
  timing?: Map<string, string>
}
interface StyleBinding { key: string, path: string, hasDefault: boolean, values: string[] }

interface Shell {
  /** Per node id: its variant styles. */
  variants: Map<string, NodeVariants>
  /** Per node id: prop → value per variant name. */
  variantProps: Map<string, Record<string, Record<string, Value | undefined>>>
  /** Per node id: props properties drive (`$bind` expressions over the component's props or `layout.x`). */
  substitutions: Map<string, Record<string, Value>>
  styleBindings: Map<string, StyleBinding[]>
  /** The root's group class (CSS states on descendants). */
  root?: { id: string, classes: string[] }
  /** Hover and pressed states CSS can't show, or interactions: the shown variant comes from the preview state. */
  interactive: boolean
  css: boolean
}

const emptyShell = (): Shell => ({ variants: new Map(), variantProps: new Map(), substitutions: new Map(), styleBindings: new Map(), interactive: false, css: false })

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

const changedKeys = (a: Record<string, string>, b: Record<string, string>) => Object.keys({ ...a, ...b }).filter(key => a[key] !== b[key])

const layerOverride = (below: Override | undefined, top: Override | undefined): Override | undefined => {
  if (!below || !top) return top ?? below
  const style = { ...below.style, ...top.style }
  for (const key of top.unset ?? []) Reflect.deleteProperty(style, key)
  const unset = [...new Set([...(below.unset ?? []).filter(key => !(key in (top.style ?? {}))), ...(top.unset ?? [])])]
  return { props: { ...below.props, ...top.props }, style, unset }
}

const styleIn = (style: Record<string, string>, override: Override | undefined) => {
  const merged = { ...style, ...override?.style }
  for (const key of override?.unset ?? []) Reflect.deleteProperty(merged, key)
  return merged
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

const bindProperties = (shell: Shell, properties: PropertyDef[], nodes: Map<string, ModelNode>, path: (property: PropertyDef) => string) => {
  for (const property of properties) {
    if (property.kind === 'slot') continue
    for (const binding of property.bindings ?? []) {
      const node = nodes.get(binding.nodeId)
      if (!node) continue
      if (binding.target === 'style') {
        const values = property.kind === 'select' ? property.options ?? [] : parseStyleKey(binding.prop)?.token.values ?? []
        shell.styleBindings.set(node.id, [...shell.styleBindings.get(node.id) ?? [], { key: binding.prop, path: path(property), hasDefault: property.default !== undefined, values }])
        continue
      }
      const swapped = shell.substitutions.get(node.id) ?? {}
      const current = swapped[binding.prop] ?? node.props?.[binding.prop]
      swapped[binding.prop] = property.default === undefined && !property.required && current !== undefined ? { $bind: path(property), fallback: current } : { $bind: path(property) }
      shell.substitutions.set(node.id, swapped)
    }
  }
}

const componentShell = (component: ComponentFile, base?: BreakpointBase): Shell => {
  const shell = emptyShell()
  const nodes = nodeIndex(component.root)
  const variants = component.variants
  if (variants.length) {
    const byId = new Map(variants.map(variant => [variant.id, variant]))
    const effective = (variant: VariantDef, id: string) => layerOverride(variant.state?.of ? byId.get(variant.state.of)?.overrides[id] : undefined, variant.overrides[id])
    const states = variants.filter(variant => variant.state)
    const interactions = [component.interactions ?? [], ...variants.map(variant => variant.interactions ?? [])].flat()
    const interactive = states.length > 0 || interactions.length > 0
    const group = kebab(component.name)
    const bases = [{ id: '', name: 'default' }, ...variants.filter(variant => !variant.state).map(({ id, name }) => ({ id, name }))]
    const stateOf = (base: string, kind: 'hover' | 'pressed') => states.find(variant => variant.state!.of === base && variant.state!.kind === kind)
    let css = interactive && !interactions.length && states.every(state => Object.values(state.overrides).every(override => !override.props && !override.unset?.length))
    const timingOf = (variant?: VariantDef) => transitionTimingClasses(variant?.transition ?? (variant?.state?.of ? byId.get(variant.state.of)?.transition : undefined) ?? component.transition ?? DEFAULT_TRANSITION)
    const timing = interactive ? new Map([['default', timingOf()], ...variants.map(variant => [variant.name, timingOf(variant)] as const)]) : undefined
    const parents = new Map<string, ModelNode>()
    for (const node of nodes.values()) for (const child of node.children ?? []) parents.set(child.id, node)
    const overridden = [...new Set(variants.flatMap(variant => Object.keys(variant.overrides)))]
    // A Fill child of an overridden node changes with its parent's axis, so it gets its looks too (the generator's `variantsOf`).
    const followers = overridden.flatMap(id => (nodes.get(id)?.children ?? []).filter(child => Object.values(child.style ?? {}).includes(FILL)).map(child => child.id))
    const lookOf = (id: string, own: Record<string, string>, variant: VariantDef | undefined) => {
      const parent = parents.get(id)
      const parentLook = parent && { ...parent, style: variant ? styleIn(parent.style ?? {}, effective(variant, parent.id)) : parent.style }
      return fillStyle(variant ? styleIn(own, effective(variant, id)) : own, parentLook, base)
    }
    for (const id of [...new Set([...overridden, ...followers])]) {
      const node = nodes.get(id)
      if (!node) continue
      const own = node.style ?? {}
      const looks: Array<[string, Record<string, string>]> = [['default', lookOf(id, own, undefined)], ...variants.map(variant => [variant.name, lookOf(id, own, variant)] as [string, Record<string, string>])]
      const styles = new Map(looks)
      const pointer = new Map<string, Pointer[]>()
      const [hoverPrefix, pressedPrefix] = id === component.root.id ? ['hover:', 'active:'] : [`group-hover/${group}:`, `group-active/${group}:`]
      for (const base of bases) {
        const at = styles.get(base.name)!
        const hover = stateOf(base.id, 'hover')
        const pressed = stateOf(base.id, 'pressed')
        const hoverStyle = hover ? styles.get(hover.name)! : at
        const hoverKeys = changedKeys(at, hoverStyle)
        const entries: Pointer[] = hoverKeys.length ? [{ prefix: hoverPrefix, style: hoverStyle, keys: hoverKeys }] : []
        if (pressed) {
          const pressedStyle = styles.get(pressed.name)!
          const keys = [...new Set([...changedKeys(at, pressedStyle), ...hoverKeys])]
          if (keys.some(key => pressedStyle[key] === undefined)) css = false
          if (keys.length) entries.push({ prefix: pressedPrefix, style: pressedStyle, keys })
        }
        if (entries.length) pointer.set(base.name, entries)
      }
      const hiddenIn = variants.filter(variant => effective(variant, id)?.props?.hidden === true).map(variant => variant.name)
      shell.variants.set(id, { styles, pointer, hiddenIn, timing })
      const keys = [...new Set(variants.flatMap(variant => Object.keys(effective(variant, id)?.props ?? {})))].filter(key => key !== 'hidden')
      if (keys.length) {
        const props: Record<string, Record<string, Value | undefined>> = {}
        for (const key of keys) {
          const base = node.props?.[key]
          props[key] = Object.fromEntries([['default', base], ...variants.map(variant => [variant.name, effective(variant, id)?.props?.[key] ?? base])])
        }
        shell.variantProps.set(id, props)
      }
    }
    if (!css) for (const entry of shell.variants.values()) entry.pointer.clear()
    shell.interactive = interactive
    shell.css = css
    if (interactive && css && [...shell.variants].some(([id, entry]) => id !== component.root.id && entry.pointer.size)) shell.root = { id: component.root.id, classes: [`group/${group}`] }
  }
  bindProperties(shell, component.properties, nodes, property => property.name)
  return shell
}

const layoutShell = (layout: LayoutFile): Shell => {
  const shell = emptyShell()
  bindProperties(shell, layout.variables ?? [], nodeIndex(layout.root), variable => `layout.${variable.name}`)
  return shell
}

// ── Rendering ───────────────────────────────────────────────────────────

interface Frame {
  input: RenderInput
  shell: Shell
  scope: Scope
  /** The variant name the frame's component renders. */
  variant: string
  /** `data-node` id of a node of this frame. */
  id: (node: ModelNode) => string
  /** The type label of this frame's nodes (`Instance`, `Layout`), or their own. */
  label?: string
  /** Layout slots by node id (a layout frame), with what fills them. */
  layoutSlots?: Map<string, { name: string, fill?: () => PlanChild[] }>
  /** Component slots by node id, with the instance's fill. */
  componentSlots?: Map<string, { fill?: () => PlanChild[] }>
  depth: number
  /** The options of the select fields the enclosing Form edits, by field id. */
  formSelects?: Record<string, string[]>
  /** The formatted paths of the frame's file (`RenderInput.formats`). */
  formats?: ValueFormats
}

interface Options {
  inStack?: boolean
  /** The node that lays this one out, which resolves its Fill sizes (`fillStyle`); none for a file's root. */
  parent?: LayoutParent
  copy?: boolean
  pageRoot?: boolean
  /** The id the element takes instead of the frame's (an instance root). */
  nodeId?: string
  /** Extra classes and inline style from an instance (fallthrough onto its component's root). */
  fallthrough?: { classes: string[], style: Record<string, string> }
  variantRoot?: PlanElement['variantRoot']
}

interface StyleOptions {
  display?: string
  fallback?: Record<string, string>
  classes?: string[]
  pick?: (key: string) => boolean
  part?: boolean
}

const prefixedClasses = (style: Record<string, string>, prefix: string) => orderedStyleTokens(style).filter(token => token.className)
  .map(token => token.breakpoint ? `${token.breakpoint}:${prefix}${token.className.slice(token.breakpoint.length + 1)}` : `${prefix}${token.className}`).join(' ')

/** The generator's `styleAttrs`, evaluated: the classes and inline style a node's element renders with in the frame's variant. */
const styleOf = (frame: Frame, node: ModelNode, { display = '', fallback = {}, classes: fixed = [], pick = () => true, part = false }: StyleOptions = {}) => {
  const style = node.style ?? {}
  const mine = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).filter(([key]) => pick(key)))
  const full = mine({ ...fallback, ...style })
  const variant = frame.shell.variants.get(node.id)
  const bound = (frame.shell.styleBindings.get(node.id) ?? []).filter(binding => pick(binding.key))
  const keys = variant
    ? [...new Set([...[...variant.styles.values()].flatMap(entry => changedKeys(style, entry)), ...[...variant.pointer.values()].flat().flatMap(state => state.keys)])].filter(pick)
    : []
  const excluded = new Set([...keys, ...bound.map(binding => binding.key)])
  const own = Object.fromEntries(Object.entries(full).filter(([key]) => !excluded.has(key)))
  const timings = variant?.timing && keys.length ? [...variant.timing.values()] : []
  const animated = timings.some(Boolean) ? animatedProperties(keys) : []
  const sharedTiming = animated.length && new Set(timings).size === 1 ? timings[0]! : ''
  const rootClasses = frame.shell.root?.id === node.id && !part ? frame.shell.root.classes : []
  // The generator's transition class, built the same way: the canvas has no CSS for it (it animates nothing in edit mode).
  const transition = animated.length ? `transition-[${animated.join(',')}]` : ''
  // Tidied as the generator tidies its static class attribute: the same order, no default direction.
  const classes = [tidyClasses([...fixed, display ? displayFallback(display, style) : '', ...rootClasses, transition, sharedTiming, styleClasses(own)])]
  if (variant && keys.length) {
    const name = frame.variant
    const only = (entries: Record<string, string>, subset = keys) => Object.fromEntries(subset.filter(key => keys.includes(key) && entries[key] !== undefined).map(key => [key, entries[key]!]))
    const entry = variant.styles.get(name) ?? style
    classes.push(
      styleClasses(only({ ...fallback, ...entry })),
      ...(variant.pointer.get(name) ?? []).map(state => prefixedClasses(only({ ...fallback, ...state.style }, state.keys), state.prefix)),
      animated.length && !sharedTiming ? variant.timing!.get(name) || 'duration-0' : ''
    )
  }
  for (const binding of bound) {
    const value = resolvePath(frame.scope, binding.path)
    const key = value === MISSING || value === undefined || value === null ? (binding.hasDefault ? undefined : full[binding.key] ?? '') : String(value)
    if (key !== undefined && binding.values.includes(key)) classes.push(styleClasses({ [binding.key]: key }))
  }
  return { class: classes.filter(Boolean).join(' '), style: styleInline(own) }
}

/** A node with the props its variant and its property bindings set. */
const effectiveNode = (frame: Frame, node: ModelNode): ModelNode => {
  const byVariant = frame.shell.variantProps.get(node.id)
  const swapped = frame.shell.substitutions.get(node.id)
  if (!byVariant && !swapped) return node
  const props = { ...node.props, ...swapped }
  for (const [key, values] of Object.entries(byVariant ?? {})) {
    const value = frame.variant in values ? values[frame.variant] : values.default
    if (value === undefined) Reflect.deleteProperty(props, key)
    else props[key] = value
  }
  return { ...node, props }
}

const isVisible = (frame: Frame, node: ModelNode) => {
  if (frame.shell.variants.get(node.id)?.hiddenIn.includes(frame.variant)) return false
  if (node.props?.visible === undefined) return true
  const visible = evaluate(node.props.visible, frame.scope)
  return visible === MISSING || Boolean(visible)
}

const base = (frame: Frame, node: ModelNode, options: Options, tag: string, look: { class: string, style: Record<string, string> }, extra: Partial<PlanElement> = {}): PlanElement => {
  const classes = [look.class, ...(options.fallthrough?.classes ?? [])].filter(Boolean).join(' ')
  const style = { ...look.style, ...options.fallthrough?.style }
  return {
    tag,
    class: classes,
    node: options.nodeId ?? frame.id(node),
    type: options.nodeId ? 'Instance' : frame.label ?? node.type,
    ...(Object.keys(style).length ? { style } : {}),
    attrs: {},
    children: [],
    ...(options.copy ? { copy: true } : {}),
    ...(node.interactions?.length ? { interactions: node.interactions } : {}),
    ...(setsState(node) ? { scope: frame.scope } : {}),
    ...(options.variantRoot ? { variantRoot: options.variantRoot } : {}),
    ...extra
  }
}

const placeholderElement = (node: string | undefined, type: string, label: string, copy?: boolean): PlanElement => ({
  tag: 'p', class: 'text-muted', node, type, attrs: {}, children: [label], placeholder: true, ...(copy ? { copy: true } : {})
})

const SLOT_FILL = 'SlotFill'

const renderChildren = (frame: Frame, node: ModelNode, options: Options, kids = node.children ?? []): PlanChild[] => {
  const layoutSlot = frame.layoutSlots?.get(node.id)
  if (layoutSlot?.fill) return layoutSlot.fill()
  const componentSlot = frame.componentSlots?.get(node.id)
  if (componentSlot?.fill) return componentSlot.fill()
  const inStack = childrenInStack(node.type, node.props, node.style)
  const rendered = kids.flatMap(child => renderNode(frame, child, { inStack, copy: options.copy, parent: node }))
  // A layout's page slot, edited on its own: where the page's content goes.
  if (layoutSlot?.name === 'children' && !rendered.length) return [{ tag: 'div', class: 'rounded-sm border border-dashed border-default p-4 text-sm text-muted', attrs: {}, children: ['Page content'], placeholder: true }]
  return rendered
}

const fallbackOf = (node: ModelNode, options: Options, own: Record<string, string> = fallbackStyle(node.type, node.props)) =>
  ({ ...selfFallback(node.type, node.style, options.inStack), ...own })

const renderNode = (frame: Frame, original: ModelNode, options: Options = {}): PlanElement[] => {
  const swapped = effectiveNode(frame, original)
  // Fill sizes become what they are in this parent (a variant's looks are resolved alike, in `componentShell`).
  const style = swapped.style && fillStyle(swapped.style, options.parent, frame.input.base)
  const node = style === swapped.style ? swapped : { ...swapped, style }
  if (!isVisible(frame, node)) return []
  const props = node.props ?? {}
  switch (node.type) {
    case 'Page':
    case 'Container':
    case 'Row':
    case 'Column':
    case 'Grid': {
      const tag = containerTag(props.tag) ?? 'div'
      if (node.type === 'Page' && props.when !== undefined) {
        const when = evaluate(props.when, frame.scope)
        if (when !== MISSING && !when) return typeof props.empty === 'string' ? [placeholderElement(frame.id(node), node.type, props.empty)] : []
      }
      const kids = options.pageRoot ? (node.children ?? []).filter(child => child.type !== SLOT_FILL) : node.children
      return [base(frame, node, options, tag, styleOf(frame, node, { display: displayOf(node.type), fallback: fallbackOf(node, options) }), { children: renderChildren(frame, node, options, kids) })]
    }
    case 'Card': {
      const isStackKey = (key: string) => CARD_STACK_KEYS.includes(parseStyleKey(key)?.token.key ?? '')
      const root = styleOf(frame, node, { classes: [CARD_SURFACE_CLASS], fallback: fallbackOf(node, options, { ...CARD_DEFAULT_STYLE, ...CARD_SURFACE_STYLE }), pick: key => !isStackKey(key) })
      const stack = styleOf(frame, node, { classes: ['flex'], fallback: structuralStyle(node.type), pick: isStackKey, part: true })
      const inner: PlanElement = { tag: 'div', class: stack.class, attrs: {}, children: renderChildren(frame, node, options), ...(Object.keys(stack.style).length ? { style: stack.style } : {}), ...(options.copy ? { copy: true } : {}) }
      return [base(frame, node, options, 'div', root, { children: [inner] })]
    }
    case 'Heading': {
      const level = headingLevel(props.level ?? DEFAULT_HEADING_LEVEL) ?? DEFAULT_HEADING_LEVEL
      return [base(frame, node, options, headingTag(level), styleOf(frame, node, { fallback: fallbackOf(node, options, HEADING_TOKENS[level]) }), { children: textChildren(shownText(frame, node, props.text)) })]
    }
    case 'Text':
      return [base(frame, node, options, NODE_ELEMENTS.Text, styleOf(frame, node, { classes: [TEXT_CLASS], fallback: fallbackOf(node, options) }), { children: textChildren(shownText(frame, node, props.text)) })]
    case 'Image': {
      const src = stringOf(props.src, frame.scope)
      const safe = src !== undefined && src !== '' && isSafeUrl(src, 'src')
      const look = styleOf(frame, node, { display: displayOf(node.type), fallback: fallbackOf(node, options, IMAGE_FALLBACK_STYLE) })
      // No URL to show (missing data, an empty or unsafe one): a placeholder box, never a request.
      const element = base(frame, node, options, NODE_ELEMENTS.Image, safe ? look : { ...look, style: { ...look.style, 'min-height': '6rem', 'background-color': 'var(--ui-bg-elevated)' } })
      element.attrs = { ...(safe ? { src } : {}), ...(props.alt === undefined ? {} : { alt: textOf(props.alt, frame.scope) }) }
      return [element]
    }
    case 'Link': {
      const icon = stringOf(props.icon, frame.scope)
      const look = styleOf(frame, node, { classes: [LINK_CLASS, ...(icon ? [LINK_ICON_CLASS] : [])], display: icon ? LINK_ICON_DISPLAY : '', fallback: fallbackOf(node, options) })
      const content = node.children?.length ? renderChildren(frame, node, options) : textChildren(shownText(frame, node, props.text))
      const children: PlanChild[] = icon ? [{ tag: 'UIcon', class: ICON_CLASS, attrs: { name: icon }, children: [], ...(options.copy ? { copy: true } : {}) }, ...content] : content
      return [base(frame, node, options, NODE_ELEMENTS.Link, look, { attrs: linkAttrs(frame, props), children })]
    }
    case 'Button': {
      const attrs: Record<string, unknown> = { type: props.type === 'submit' ? 'submit' : 'button' }
      if (props.text !== undefined) attrs.label = textOf(props.text, frame.scope)
      for (const key of ['color', 'variant', 'size', 'icon', 'trailingIcon'] as const) {
        const value = stringOf(props[key], frame.scope)
        if (value !== undefined) attrs[key] = value
      }
      if (props.href !== undefined) Object.assign(attrs, linkAttrs(frame, props))
      if (props.disabled !== undefined) attrs.disabled = evaluate(props.disabled, frame.scope) === true
      return [base(frame, node, options, NODE_ELEMENTS.Button, styleOf(frame, node, { fallback: fallbackOf(node, options) }), { attrs })]
    }
    case 'Input': {
      const field = fieldName(props.field)
      const multiline = props.multiline === true
      const label = typeof props.label === 'string' ? props.label : field.charAt(0).toUpperCase() + field.slice(1)
      const choices = typeof props.field === 'string' ? frame.formSelects?.[props.field] : undefined
      if (choices) {
        // A select field: a dropdown of its options, as the generated form has it.
        const selectAttrs: Record<string, unknown> = { name: field, items: [...choices] }
        if (props.placeholder !== undefined) selectAttrs.placeholder = textOf(props.placeholder, frame.scope)
        const select: PlanElement = { tag: NODE_ELEMENTS.InputSelect, class: INPUT_CONTROL_CLASS, attrs: selectAttrs, children: [], ...(options.copy ? { copy: true } : {}) }
        return [base(frame, node, options, NODE_ELEMENTS.Input, styleOf(frame, node, { fallback: fallbackOf(node, options) }), { attrs: { label, name: field }, children: [select] })]
      }
      const controlAttrs: Record<string, unknown> = { name: field }
      if (!multiline && typeof props.inputType === 'string' && props.inputType !== 'text') controlAttrs.type = props.inputType
      if (props.placeholder !== undefined) controlAttrs.placeholder = textOf(props.placeholder, frame.scope)
      if (multiline && typeof props.rows === 'number') controlAttrs.rows = props.rows
      const control: PlanElement = { tag: multiline ? NODE_ELEMENTS.InputMultiline : NODE_ELEMENTS.InputControl, class: INPUT_CONTROL_CLASS, attrs: controlAttrs, children: [], ...(options.copy ? { copy: true } : {}) }
      return [base(frame, node, options, NODE_ELEMENTS.Input, styleOf(frame, node, { fallback: fallbackOf(node, options) }), { attrs: { label, name: field }, children: [control] })]
    }
    case 'Checkbox': {
      const attrs: Record<string, unknown> = {}
      if (props.field !== undefined) attrs.name = fieldName(props.field)
      else if (props.value !== undefined) attrs.modelValue = evaluate(props.value, frame.scope) === true
      if (typeof props.label === 'string') attrs.label = props.label
      return [base(frame, node, options, NODE_ELEMENTS.Checkbox, styleOf(frame, node, { fallback: fallbackOf(node, options) }), { attrs })]
    }
    case 'Form':
    {
      const selects = typeof props.action === 'string' ? frame.input.formSelects?.[props.action] : undefined
      const inner = selects ? { ...frame, formSelects: selects } : frame
      return [base(frame, node, options, NODE_ELEMENTS.Form, styleOf(frame, node, { display: displayOf(node.type), fallback: fallbackOf(node, options) }), { children: renderChildren(inner, node, options) })]
    }
    case 'List':
      return list(frame, node, options)
    case 'Instance':
      return instance(frame, node, options)
    default:
      // A SlotFill renders where it fills; anything else the generator can't render either.
      return node.type === SLOT_FILL ? [] : [placeholderElement(frame.id(node), node.type, `Unknown component "${node.type}"`, options.copy)]
  }
}

const textChildren = (value: string | undefined): PlanChild[] => value === undefined || value === '' ? [] : [value]

/** A field's name from its id (`fld_published_at` → `publishedAt`): the render payload has no entities. */
const fieldName = (id: Value | undefined) => String(id ?? '').replace(/^fld_/, '').replace(/_(\w)/g, (_, char: string) => char.toUpperCase())

/** A page link's `to` in the canvas: the render payload has no page paths, and the canvas never navigates (an inactive link). */
export const CANVAS_LINK = '/__canvas-link'

/**
 * A page link's route, from the page paths the editor sends: the path with its
 * `:params` filled from the link's own values; undefined when the path is
 * unknown or a param has no value (missing data).
 */
const pageRoute = (frame: Frame, to: Value | undefined): string | undefined => {
  if (!isObject(to) || typeof to.page !== 'string') return undefined
  const path = frame.input.paths?.[to.page]
  if (!path) return undefined
  const params = isObject(to.params) ? to.params : {}
  let missing = false
  const route = path.replace(/:(\w+)/g, (_, name: string) => {
    const value = stringOf(params[name], frame.scope)
    if (value === undefined) missing = true
    return encodeURIComponent(value ?? '')
  })
  return missing ? undefined : route
}

/** A link in the canvas: an external URL as it is (new tab), a page link its route (else `CANVAS_LINK`); clicks never follow either. */
const linkAttrs = (frame: Frame, props: Record<string, Value>): Record<string, unknown> => {
  if (typeof props.href === 'string' && isSafeUrl(props.href, 'href')) {
    const target = linkTarget(props.href)
    return { to: props.href, ...(target ? { target } : {}) }
  }
  return { to: pageRoute(frame, props.to) ?? CANVAS_LINK }
}

const list = (frame: Frame, node: ModelNode, options: Options): PlanElement[] => {
  const props = node.props ?? {}
  const as = typeof props.as === 'string' ? props.as : 'item'
  const items = evaluate(props.items, frame.scope)
  const rows: unknown[] = Array.isArray(items) ? items : []
  const missing = !Array.isArray(items)
  if (!missing && !rows.length) {
    if (typeof props.empty === 'string') return [placeholderElement(frame.id(node), node.type, props.empty, options.copy)]
    if (props.hideWhenEmpty === true) return []
  }
  const inStack = childrenInStack(node.type, props, node.style)
  const kids = node.children ?? []
  // `loadMore`: the first n records, then the Load more button while more follow; preview mode's clicks show a page more each.
  const more = loadMoreSize(props.loadMore)
  const key = frame.id(node)
  const count = more ? frame.input.listShown?.[key] ?? more : 0
  // No data: the children once, dimmed, with their bindings as placeholders.
  const shown = missing ? [MISSING] : more ? rows.slice(0, count) : rows
  const children = shown.flatMap((row, index) => {
    const itemFrame: Frame = { ...frame, scope: { ...frame.scope, [as]: row } }
    const copy = options.copy || index > 0
    return kids.flatMap(child => renderNode(itemFrame, child, { inStack, copy, parent: node }).map(element => missing ? { ...element, class: [element.class, 'opacity-60'].filter(Boolean).join(' '), placeholder: false } : element))
  })
  if (more && rows.length > count) {
    const copy = options.copy ? { copy: true } : {}
    // The canvas's preview reads the List's key and page size from the button (`data-load-more`, `data-load-more-size`).
    const button: PlanElement = { tag: NODE_ELEMENTS.Button, class: '', attrs: { 'label': LOAD_MORE_LABEL, 'data-load-more': key, 'data-load-more-size': more }, children: [], ...copy }
    children.push({ tag: 'div', class: LOAD_MORE_CLASS, attrs: {}, children: [button], ...copy })
  }
  const tag = containerTag(props.tag) ?? 'div'
  return [base(frame, node, options, tag, styleOf(frame, node, { display: displayOf(node.type, props), fallback: fallbackOf(node, options) }), { children })]
}

const findNode = (node: ModelNode, id: string): ModelNode | undefined =>
  node.id === id ? node : node.children?.map(child => findNode(child, id)).find(Boolean)

const instance = (frame: Frame, node: ModelNode, options: Options): PlanElement[] => {
  const props = node.props ?? {}
  const component = frame.input.components.find(entry => entry.id === props.component)
  const id = options.nodeId ?? frame.id(node)
  if (!component || frame.depth >= MAX_INSTANCE_DEPTH) return [{ tag: 'div', class: 'text-error text-sm', node: id, type: 'Instance', attrs: {}, children: ['Missing component'], placeholder: true, ...(options.copy ? { copy: true } : {}) }]
  const values = isObject(props.values) ? props.values : {}
  const scope: Scope = {}
  for (const property of component.properties) {
    if (property.kind === 'slot') continue
    const given = values[property.id]
    const value = given === undefined ? property.default : evaluate(given, frame.scope)
    scope[property.name] = value === undefined && property.kind === 'boolean' ? false : value
  }
  const variantId = typeof props.variant === 'string' ? props.variant : ''
  const set = variantId ? component.variants.find(variant => variant.id === variantId)?.name ?? 'default' : 'default'
  const shell = componentShell(component, frame.input.base)
  const key = id
  const variant = frame.input.shown?.[key] ?? set
  const look = styleOf(frame, node, { fallback: selfFallback(component.root.type, component.root.style, options.inStack) })
  const componentSlots = new Map<string, { fill?: () => PlanChild[] }>()
  for (const property of component.properties) {
    if (property.kind !== 'slot' || !property.nodeId) continue
    const fill = (node.children ?? []).find(child => child.type === SLOT_FILL && child.props?.slot === property.id)
    const target = findNode(component.root, property.nodeId)
    componentSlots.set(property.nodeId, {
      fill: fill
        ? () => (fill.children ?? []).flatMap(child => renderNode(frame, child, { inStack: target ? childrenInStack(target.type, target.props, target.style) : false, copy: options.copy, parent: target }))
        : undefined
    })
  }
  const inner: Frame = {
    input: frame.input,
    shell,
    scope,
    variant,
    id: part => `${id}${INSTANCE_ID_SEPARATOR}${part.id}`,
    label: 'Instance',
    componentSlots,
    depth: frame.depth + 1,
    formats: frame.input.formats?.[component.id]
  }
  return renderNode(inner, component.root, {
    nodeId: id,
    copy: options.copy,
    fallthrough: { classes: look.class ? [look.class] : [], style: look.style },
    variantRoot: shell.interactive ? { key, component, variant: set, css: shell.css } : undefined
  })
}

// ── Files ───────────────────────────────────────────────────────────────

const isLayout = (file: CanvasFile): file is LayoutFile => 'slots' in file
const isComponent = (file: CanvasFile): file is ComponentFile => 'properties' in file && 'variants' in file

/** The page's computed aliases (`uses.computed`: `{as, if, then, else}`), over its data. */
const computedScope = (page: PageFile, scope: Scope): Scope => {
  const out = { ...scope }
  for (const entry of (page.uses?.computed ?? []) as Array<{ as: string, if?: Value, then?: Value, else?: Value }>) {
    if (entry.as in out) continue
    const condition = evaluate(entry.if, out)
    out[entry.as] = condition === MISSING ? MISSING : evaluate(condition ? entry.then : entry.else, out)
  }
  return out
}

const layoutScope = (layout: LayoutFile, values: Record<string, Value>, data: Scope): Scope => {
  const layoutValues: Record<string, unknown> = {}
  for (const variable of layout.variables ?? []) {
    const value = values[variable.id] ?? variable.default
    if (value !== undefined) layoutValues[variable.name] = evaluate(value, data)
  }
  return { ...data, layout: layoutValues }
}

/** The render plan of a `.bildr` file with its data: the elements the canvas renders. */
export function renderPlan(input: RenderInput): PlanElement[] {
  const { file, data } = input
  const plain = (node: ModelNode) => node.id
  if (isComponent(file)) {
    const shell = componentShell(file, input.base)
    const scope: Scope = {}
    for (const property of file.properties) {
      if (property.kind === 'slot') continue
      const value = property.name in data ? data[property.name] : property.default
      scope[property.name] = value === undefined ? (property.kind === 'boolean' ? false : property.kind === 'entity' && property.required ? MISSING : undefined) : value
    }
    const variant = input.variant?.id ? file.variants.find(entry => entry.id === input.variant!.id)?.name ?? 'default' : 'default'
    const frame: Frame = { input, shell, scope, variant: input.shown?.[file.root.id] ?? variant, id: plain, componentSlots: new Map(), depth: 0, formats: input.formats?.[file.id] }
    return renderNode(frame, file.root, { variantRoot: shell.interactive ? { key: file.root.id, component: file, variant, css: shell.css } : undefined })
  }
  if (isLayout(file)) {
    const slots = new Map(file.slots.map(slot => [slot.nodeId, { name: slot.name }]))
    return renderNode({ input, shell: layoutShell(file), scope: layoutScope(file, {}, data), variant: 'default', id: plain, layoutSlots: slots, depth: 0, formats: input.formats?.[file.id] }, file.root)
  }
  const page = file
  const pageFrame: Frame = { input, shell: emptyShell(), scope: computedScope(page, data), variant: 'default', id: plain, depth: 0, formats: input.formats?.[page.id] }
  const layout = page.layout ? input.layouts.find(entry => entry.id === page.layout) : undefined
  if (!layout) return renderNode(pageFrame, page.root, { pageRoot: true })
  const fills = (page.root.children ?? []).filter(child => child.type === SLOT_FILL)
  const slots = new Map<string, { name: string, fill?: () => PlanChild[] }>()
  for (const slot of layout.slots) {
    const target = findNode(layout.root, slot.nodeId)
    const fill = slot.name === 'children' ? undefined : fills.find(entry => entry.props?.slot === slot.id)
    slots.set(slot.nodeId, {
      name: slot.name,
      fill: slot.name === 'children'
        ? () => renderNode(pageFrame, page.root, { pageRoot: true })
        : fill ? () => (fill.children ?? []).flatMap(child => renderNode(pageFrame, child, { inStack: target ? childrenInStack(target.type, target.props, target.style) : false, parent: target })) : undefined
    })
  }
  const frame: Frame = {
    input,
    shell: layoutShell(layout),
    scope: layoutScope(layout, page.layoutValues ?? {}, data),
    variant: 'default',
    id: node => layoutNodeId(page.root.id, node.id),
    label: 'Layout',
    layoutSlots: slots,
    depth: 0,
    formats: input.formats?.[layout.id]
  }
  return renderNode(frame, layout.root)
}
