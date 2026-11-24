import { z } from 'zod'
import { CARD_DEFAULT_STYLE, CARD_SURFACE_STYLE } from '../render/rules.ts'
import { parseStyleKey } from '../design/tokens.ts'
import type { ComponentFile, ModelNode, Value } from '../model/schemas.ts'
import { defineEdit, EditError, fail } from './core.ts'
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

/** Whether a style sets `key` at its base breakpoint. */
const setsBase = (style: Record<string, string>, key: string) => style[key] !== undefined

/** The card's surface as tokens, under its own: the padding, radius, background and clipping it rendered with, and a border for its ring. */
const CARD_TOKENS: Record<string, string> = { ...CARD_DEFAULT_STYLE, ...CARD_SURFACE_STYLE, border: '1', borderColor: 'default' }

/** A Card's `display` styled its surface, a block around the stack; the Container is the stack, so a shown display is `flex`. */
const cardDisplay = (style: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(style).map(([key, value]) =>
  [key, parseStyleKey(key)?.token.key === 'display' && value !== 'hidden' ? 'flex' : value]))

/** A Row's `wrap` prop as a style patch: its flexWrap token. */
const wrapStyle = (wrap: Value | undefined): Record<string, string> => (wrap === true ? { flexWrap: 'wrap' } : {})

/**
 * The Container a legacy layout node (Row, Column, Grid, Card) renders like;
 * any other node is returned as it is. Children are left as they are.
 * Throws an `EditError` for a Grid hidden at its base: once it is a Container,
 * showing it again would make it a flex stack.
 */
export function normalizeLayout(node: ModelNode): ModelNode {
  if (!isLegacy(node.type)) return node
  const { wrap, ...props } = node.props ?? {}
  const own = node.style ?? {}
  let style: Record<string, string>
  if (node.type === 'Row') style = { ...own, ...(setsBase(own, 'direction') ? {} : { direction: 'row' }), ...(setsBase(own, 'flexWrap') ? {} : wrapStyle(wrap)) }
  else if (node.type === 'Grid') {
    if (setsBase(own, 'display') && own.display !== 'grid') fail('invalid', `Show this Grid on its base breakpoint before converting it: it sets display "${own.display}" there`)
    style = { ...own, display: 'grid' }
  } else if (node.type === 'Card') style = { ...CARD_TOKENS, ...cardDisplay(own) }
  else style = own
  const converted: ModelNode = { ...node, type: 'Container' }
  if (node.type === 'Card' && !node.name) converted.name = 'Card'
  if (Object.keys(props).length) converted.props = props
  else delete converted.props
  if (Object.keys(style).length) converted.style = style
  else delete converted.style
  return converted
}

/** A variant's override of a converted node, in the Container's terms: a Row's `wrap` becomes flexWrap, a Card's display a flex one. */
const convertOverride = (type: string, override: ComponentFile['variants'][number]['overrides'][string]) => {
  const { wrap, ...props } = override.props ?? {}
  const style = type === 'Card' ? cardDisplay(override.style ?? {}) : { ...override.style }
  if (type === 'Row' && wrap !== undefined) style.flexWrap = wrap === true ? 'wrap' : 'nowrap'
  const next: typeof override = { ...override }
  if (Object.keys(props).length) next.props = props
  else delete next.props
  if (Object.keys(style).length) next.style = style
  else delete next.style
  return next
}

/** The legacy layout nodes at and under `node`, in document order. */
const legacyIn = (node: ModelNode, out: ModelNode[] = []): ModelNode[] => {
  if (isLegacy(node.type)) out.push(node)
  for (const child of node.children ?? []) legacyIn(child, out)
  return out
}

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
    for (const target of targets) {
      const type = target.type
      let converted: ModelNode
      try {
        converted = normalizeLayout(target)
      } catch (error) {
        if (error instanceof EditError && targets.length > 1) fail('invalid', `${target.name ?? target.id}: ${error.message}`)
        throw error
      }
      for (const key of Object.keys(target)) Reflect.deleteProperty(target, key)
      Object.assign(target, converted)
      for (const variant of variants) {
        const override = variant.overrides[target.id]
        if (override) variant.overrides[target.id] = convertOverride(type, override)
      }
    }
    return { converted: targets.map(target => target.id) }
  }
})
