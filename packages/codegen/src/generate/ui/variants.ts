import { parseStyleKey } from '../../design/tokens.ts'
import type { ComponentFile, ModelNode, PropertyDef, Value } from '../../model/schemas.ts'
import { DEFAULT_TRANSITION, FILL, fillStyle, stateTimingClasses, transitionTimingClasses } from '../../render/rules.ts'
import { camel, kebab, tsString } from '../text.ts'
import type { Env, PointerState, Variant } from './env.ts'
import { fail, isObject } from './env.ts'
import { attr, staticAttr } from './markup.ts'
import { changedKeys } from './style.ts'

/**
 * Property bindings (the hosted `bindings`): a bound prop reads the property (`path`),
 * the node's own value as its fallback when the property has no default; a bound style
 * key becomes a class map (see `styleAttrs`).
 */
export const bindProperties = (env: Env, properties: PropertyDef[], nodes: Map<string, ModelNode>, path: (property: PropertyDef) => string) => {
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

export const nodeIndex = (root: ModelNode) => {
  const nodes = new Map<string, ModelNode>()
  const visit = (node: ModelNode) => {
    nodes.set(node.id, node)
    node.children?.forEach(visit)
  }
  visit(root)
  return nodes
}

export type Override = ComponentFile['variants'][number]['overrides'][string]

export type VariantDef = ComponentFile['variants'][number]

/** `top` over `below`: props and style merge, a key `top` sets is no longer removed, and one it removes no longer set (the canvas's `layerOverride`). */
export const layerOverride = (below: Override | undefined, top: Override | undefined): Override | undefined => {
  if (!below || !top) return top ?? below
  const style = { ...below.style, ...top.style }
  for (const key of top.unset ?? []) Reflect.deleteProperty(style, key)
  const unset = [...new Set([...(below.unset ?? []).filter(key => !(key in (top.style ?? {}))), ...(top.unset ?? [])])]
  return { props: { ...below.props, ...top.props }, style, unset }
}

/** A node's style in a variant: its own tokens with the override's, less the ones it removes. */
export const styleIn = (style: Record<string, string>, override: Override | undefined) => {
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
/** Nodes the keyboard reaches by themselves. */
const CONTROLS = new Set(['Button', 'Link', 'Input', 'Checkbox', 'Form'])

/**
 * Whether the keyboard reaches a control under `node` in every variant: one that no variant hides (a hidden one leaves the
 * click unreachable there). An instance holds what its component's root holds.
 */
const holdsControl = (env: Env, node: ModelNode, hidden: (node: ModelNode) => boolean, seen = new Set<string>()): boolean => {
  if (hidden(node)) return false
  if (CONTROLS.has(node.type)) return true
  if (node.type === 'Instance') {
    const id = String(node.props?.component)
    const component = seen.has(id) ? undefined : env.context?.module.components.find(entry => entry.id === id)
    // An instance's own variants don't hide it in this component: only `hidden` on the instance node counts.
    return component !== undefined && holdsControl(env, component.root, child => child.props?.hidden === true, new Set([...seen, id]))
  }
  return (node.children ?? []).some(child => holdsControl(env, child, hidden, seen))
}

export const variantsOf = (env: Env, component: ComponentFile, nodes: Map<string, ModelNode>): string | undefined => {
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
  const parents = new Map<string, ModelNode>()
  const walk = (node: ModelNode) => (node.children ?? []).forEach((child) => {
    parents.set(child.id, node)
    walk(child)
  })
  walk(component.root)
  const overridden = [...new Set(variants.flatMap(variant => Object.keys(variant.overrides)))]
  // A Fill child of an overridden node changes with its parent's axis, so it gets its looks too.
  const filling = (node: ModelNode) => Object.values(node.style ?? {}).includes(FILL)
  const followers = overridden.flatMap(id => (nodes.get(id)?.children ?? []).filter(filling).map(child => child.id))
  /** A node's style in a variant, Fill resolved by its parent in that variant (as `render` resolves the default). */
  const lookOf = (id: string, own: Record<string, string>, variant: VariantDef | undefined) => {
    const parent = parents.get(id)
    const parentLook = parent && { ...parent, style: variant ? styleIn(parent.style ?? {}, effective(variant, parent.id)) : parent.style }
    return fillStyle(variant ? styleIn(own, effective(variant, id)) : own, parentLook, env.base)
  }
  for (const id of [...new Set([...overridden, ...followers])]) {
    const node = nodes.get(id) ?? fail(env, undefined, `a variant overrides the unknown node ${id}`)
    const own = node.style ?? {}
    const looks: Array<[string, Record<string, string>]> = [['default', lookOf(id, own, undefined)], ...variants.map(variant => [variant.name, lookOf(id, own, variant)] as [string, Record<string, string>])]
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
      // The timing of each: a state animates its way in with its own transition (`stateTimingClasses`).
      const baseTiming = timing?.get(base.name) ?? ''
      const hoverTiming = hover && hoverKeys.length ? timing?.get(hover.name) : undefined
      const entries: PointerState[] = hoverKeys.length
        ? [{ prefix: hoverPrefix, style: hoverStyle, keys: hoverKeys, timing: hoverTiming === undefined ? undefined : stateTimingClasses(hoverTiming, baseTiming, hoverPrefix) }]
        : []
      if (pressed) {
        // Pressed wins over hover: it restates every key hover changes, so each needs a value.
        const pressedStyle = styleOf.get(pressed.name)!
        const keys = [...new Set([...changedKeys(at, pressedStyle), ...hoverKeys])]
        if (keys.some(key => pressedStyle[key] === undefined)) css = false
        if (keys.length) entries.push({ prefix: pressedPrefix, style: pressedStyle, keys, timing: timing && stateTimingClasses(timing.get(pressed.name) ?? '', baseTiming, pressedPrefix, hoverTiming) })
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
    // The states are the editor's previews of hover and pressed: the classes show them, so they are no variant the component takes.
    const stateNames = new Set(states.map(state => state.name))
    for (const entry of map.values()) {
      entry.styles = entry.styles.filter(([name]) => !stateNames.has(name))
      entry.hiddenIn = entry.hiddenIn.filter(name => !stateNames.has(name))
    }
    for (const swapped of env.substitutions.values()) {
      for (const value of Object.values(swapped)) {
        if (isObject(value) && isObject(value.$$variants)) for (const name of stateNames) Reflect.deleteProperty(value.$$variants, name)
      }
    }
    if ([...map].some(([id, entry]) => id !== component.root.id && entry.pointer.size)) env.root = { id: component.root.id, classes: [`group/${group}`], attrs: [] }
    return undefined
  }

  // Interactions or states CSS can't show: the core composable keeps the shown variant.
  env.variantExpr = 'variant'
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
  // A click on a root with no control in it: a button to the keyboard and assistive technology (the composable hears Enter and Space).
  // With a control every variant shows (a Button, a Link, one in an instance), the control is what the keyboard reaches, and its
  // click bubbles.
  const hidden = (node: ModelNode) => node.props?.hidden === true || variants.some(variant => effective(variant, node.id)?.props?.hidden === true)
  const clickable = interactions.some(interaction => interaction.on === 'click') && !holdsControl(env, component.root, hidden, new Set([component.id]))
  env.root = {
    id: component.root.id,
    classes: [],
    attrs: [...(appear ? [attr('key', 'ref="variantRoot"')] : []), ...(clickable ? [staticAttr('role', 'button'), staticAttr('tabindex', '0')] : []), attr('event', 'v-on="on"')]
  }
  // The composable can show a state, so it is typed with every variant name; the component takes only its base variants.
  const names = states.length ? `<${['default', ...variants.map(variant => variant.name)].map(name => tsString(name)).join(' | ')}>` : ''
  if (bases.length > 1) env.needs.add('props')
  const shown = bases.length > 1 ? '() => props.variant' : '\'default\''
  return `const { variant, on } = useVariantState${names}(${shown}, {\n${parts.join(',\n')}\n}${appear ? ', \'variantRoot\'' : ''})`
}
