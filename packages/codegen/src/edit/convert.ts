import { z } from 'zod'
import { CARD_DEFAULT_STYLE, CARD_SURFACE_STYLE, childrenInStack, fallbackStyle, selfFallback } from '../render/rules.ts'
import { parseStyleKey } from '../design/tokens.ts'
import type { ComponentFile, LayoutFile, ModelNode, Value } from '../model/schemas.ts'
import { defineEdit, EditError, fail } from './core.ts'
import type { Tree } from './core.ts'
import { FileRef, nodeIn, NodeRef } from './nodes.ts'

/**
 * Converting legacy layout nodes (layout-containers T7). Row, Column, Grid and
 * Card were types before every layout became a Container with tokens; they
 * still load and render, and `normalizeLayout` gives the Container that lays
 * out the same: what their type implied becomes explicit tokens. A Card's
 * surface (`ring ring-default`, which no token sets) becomes a 1px default
 * border.
 */

export const LEGACY_LAYOUT = ['Row', 'Column', 'Grid', 'Card'] as const

const isLegacy = (type: string) => (LEGACY_LAYOUT as readonly string[]).includes(type)

type Style = Record<string, string>
type Override = ComponentFile['variants'][number]['overrides'][string]

/** The card's surface as tokens, under its own: the padding, radius, background and clipping it rendered with, and a border for its ring. */
const CARD_TOKENS: Style = { ...CARD_DEFAULT_STYLE, ...CARD_SURFACE_STYLE, border: '1', borderColor: 'default' }

/** The base token key of a style key, undefined for a breakpoint one. */
const baseKeyOf = (key: string) => {
  const parsed = parseStyleKey(key)
  return parsed && !parsed.breakpoint ? parsed.token.key : undefined
}

/** A Card's `display` styled its surface, a block around the stack; the Container is the stack, so a shown display is `flex`. */
const cardDisplay = (style: Style): Style => Object.fromEntries(Object.entries(style).map(([key, value]) =>
  [key, parseStyleKey(key)?.token.key === 'display' && value !== 'hidden' ? 'flex' : value]))

/** The tokens a legacy type rendered with under its own (its fallbacks), with `props` as the node has them. */
const legacyFallback = (type: string, props: Record<string, unknown>): Style =>
  type === 'Card' ? { ...CARD_TOKENS, ...fallbackStyle(type, props) } : fallbackStyle(type, props)

const CONTAINER_FALLBACK = fallbackStyle('Container')

/** The style of the Container a legacy node becomes, before its children are looked at. */
const convertedStyle = (node: ModelNode): Style => {
  const own = node.style ?? {}
  if (node.type === 'Row') {
    return { ...own, ...(own.direction === undefined ? { direction: 'row' } : {}), ...(own.flexWrap === undefined && node.props?.wrap === true ? { flexWrap: 'wrap' } : {}) }
  }
  if (node.type === 'Grid') {
    if (own.display === 'hidden') fail('invalid', 'Show this Grid on its base breakpoint before converting it: it is hidden there (display: hidden)')
    // A Grid's flex (at any breakpoint) laid out a row: a Container's would be a column.
    const flexSomewhere = Object.entries(own).some(([key, value]) => parseStyleKey(key)?.token.key === 'display' && value === 'flex')
    return { ...own, display: own.display ?? 'grid', ...(flexSomewhere && own.direction === undefined ? { direction: 'row' } : {}) }
  }
  if (node.type === 'Card') return { ...CARD_TOKENS, ...cardDisplay(own) }
  return own
}

/**
 * The Container a legacy layout node (Row, Column, Grid, Card) renders like;
 * any other node is returned as it is. A child the Container would stretch
 * differently than the legacy type did (a Column set to a grid, a Row set to
 * a column) gets its old `self` as a token. Throws an `EditError` for a Grid
 * hidden at its base: once it is a Container, showing it again would make it
 * a flex stack.
 */
export function normalizeLayout(node: ModelNode): ModelNode {
  if (!isLegacy(node.type)) return node
  const { wrap: _wrap, ...props } = node.props ?? {}
  const style = convertedStyle(node)
  const converted: ModelNode = { ...node, type: 'Container' }
  if (node.type === 'Card' && !node.name) converted.name = 'Card'
  if (Object.keys(props).length) converted.props = props
  else delete converted.props
  if (Object.keys(style).length) converted.style = style
  else delete converted.style
  const before = childrenInStack(node.type, node.props, node.style)
  const after = childrenInStack('Container', props, style)
  if (before !== after && node.children) {
    converted.children = node.children.map((child) => {
      const was = selfFallback(child.type, child.style, before).self
      if (was === selfFallback(child.type, child.style, after).self) return child
      return { ...child, style: { ...child.style, self: was ?? 'auto' } }
    })
  }
  return converted
}

/**
 * A variant's override of a converted node, in the Container's terms. An
 * unset token falls back to what the legacy type gave, so it becomes that
 * token where the Container's fallback differs; a Row's `wrap` becomes a
 * flexWrap token where no flexWrap token won over it; a Card's display a
 * flex one. Undefined when nothing is left.
 */
const convertOverride = (node: ModelNode, converted: ModelNode, override: Override): Override | undefined => {
  const { wrap, ...props } = override.props ?? {}
  const style: Style = node.type === 'Card' ? cardDisplay(override.style ?? {}) : { ...override.style }
  const legacy = legacyFallback(node.type, { ...node.props, ...override.props })
  const unset: string[] = []
  for (const key of override.unset ?? []) {
    const base = baseKeyOf(key)
    // The legacy type's fallback; a direction it didn't set was CSS's row.
    const was = base === undefined ? undefined : legacy[base] ?? (base === 'direction' ? 'row' : undefined)
    if (base === undefined || was === CONTAINER_FALLBACK[base]) unset.push(key)
    else style[base] = was!
  }
  const tokenWins = node.style?.flexWrap !== undefined || override.style?.flexWrap !== undefined || unset.includes('flexWrap')
  if (node.type === 'Row' && wrap !== undefined && !tokenWins) {
    const wanted = wrap === true ? 'wrap' : 'nowrap'
    if (wanted !== (converted.style?.flexWrap ?? 'nowrap')) style.flexWrap = wanted
  }
  const next: Override = {}
  if (Object.keys(props).length) next.props = props as Record<string, Value>
  if (Object.keys(style).length) next.style = style
  if (unset.length) next.unset = unset
  return Object.keys(next).length ? next : undefined
}

/** The legacy layout nodes at and under `node`, in document order. */
const legacyIn = (node: ModelNode, out: ModelNode[] = []): ModelNode[] => {
  if (isLegacy(node.type)) out.push(node)
  for (const child of node.children ?? []) legacyIn(child, out)
  return out
}

/** The properties (a component's) or variables (a layout's) of a tree, which bind node props. */
const propertiesOf = (tree: Tree) => tree.kind === 'component' ? (tree.owner as ComponentFile).properties : tree.kind === 'layout' ? (tree.owner as LayoutFile).variables ?? [] : []

export const nodeConvert = defineEdit({
  input: z.object({
    file: FileRef,
    nodeId: NodeRef.describe('The legacy layout node (Row, Column, Grid or Card) to convert; with subtree, the node whose subtree to convert'),
    subtree: z.boolean().optional().describe('true: every Row, Column, Grid and Card at and under nodeId')
  }),
  apply: (draft, { file, nodeId, subtree }) => {
    const tree = draft.tree(file)
    const node = nodeIn(tree, nodeId)
    const targets = subtree ? legacyIn(node) : [node]
    if (!subtree && !isLegacy(node.type)) fail('invalid', `A ${node.type} is no legacy layout type (Row, Column, Grid or Card): nothing to convert`)
    if (!targets.length) fail('invalid', 'No Row, Column, Grid or Card in this subtree: nothing to convert')
    const variants = tree.kind === 'component' ? (tree.owner as ComponentFile).variants : []
    const properties = propertiesOf(tree)
    // Deepest first: converting a node copies the children whose stretch it keeps, so theirs must be done by then.
    for (const target of [...targets].reverse()) {
      const label = (message: string) => (targets.length > 1 ? `${target.name ?? target.id}: ${message}` : message)
      const binding = properties.find(property => property.bindings?.some(entry => entry.nodeId === target.id && 'prop' in entry && entry.prop === 'wrap'))
      if (binding) fail('invalid', label(`The property "${binding.name}" binds the wrap of this Row: unbind it before converting the Row`))
      const legacy = structuredClone(target)
      let converted: ModelNode
      try {
        converted = normalizeLayout(target)
      } catch (error) {
        if (error instanceof EditError) fail('invalid', label(error.message))
        throw error
      }
      for (const key of Object.keys(target)) Reflect.deleteProperty(target, key)
      Object.assign(target, converted)
      for (const variant of variants) {
        const override = variant.overrides[target.id]
        if (!override) continue
        const next = convertOverride(legacy, converted, override)
        if (next) variant.overrides[target.id] = next
        else Reflect.deleteProperty(variant.overrides, target.id)
      }
    }
    return { converted: targets.map(target => target.id) }
  }
})
