import { isColorTokenValue, parseStyleKey, STYLE_HEX, styleTokenProblem } from '../design/tokens'
import type { DocNode } from '../document/schema'
import { walk } from '../document/tree'

/**
 * The panel's "Selection colours": every colour the selected subtrees use on
 * their colour keys (`bg`, `color`, `borderColor`, at any breakpoint key),
 * and the edits that swap one colour for another everywhere in them.
 */

export type SelectionColorKind = 'token' | 'custom' | 'hex'

export interface SelectionColor {
  /** The style value: a colour token (`primary`), a theme colour name (`brand`) or a hex. */
  value: string
  kind: SelectionColorKind
  /** How many node keys use it. */
  count: number
  /** The base keys it is used on, in first-use order. */
  keys: string[]
}

/** One node's edit of a swap: an entry of `node_update_style`'s `updates`, so the whole swap is one undo step. */
export interface ColorSwap {
  nodeId: string
  /** The node's colour keys that held the colour, set to the new one. */
  style: Record<string, string>
}

export function colorKind(value: string): SelectionColorKind {
  if (STYLE_HEX.test(value)) return 'hex'
  return isColorTokenValue(value) ? 'token' : 'custom'
}

/** Every node of the selected subtrees once, in tree order, a node inside two selected ones included once. */
function subtreeNodes(roots: DocNode[]): DocNode[] {
  const seen = new Set<string>()
  const nodes: DocNode[] = []
  for (const root of roots) {
    walk(root, (node) => {
      if (seen.has(node.id)) return
      seen.add(node.id)
      nodes.push(node)
    })
  }
  return nodes
}

/** The colour keys of a node's style, with their base key. */
function colorEntries(node: DocNode): { key: string, base: string, value: string }[] {
  return Object.entries(node.style).flatMap(([key, value]) => {
    const parsed = parseStyleKey(key)
    return parsed?.token.kind === 'color' ? [{ key, base: parsed.token.key, value }] : []
  })
}

/** The colours used in the subtrees of `roots`, most used first (ties in first-use order). */
export function selectionColors(roots: DocNode[]): SelectionColor[] {
  const colors = new Map<string, SelectionColor>()
  for (const node of subtreeNodes(roots)) {
    for (const { base, value } of colorEntries(node)) {
      const entry = colors.get(value) ?? { value, kind: colorKind(value), count: 0, keys: [] }
      entry.count++
      if (!entry.keys.includes(base)) entry.keys.push(base)
      colors.set(value, entry)
    }
  }
  return [...colors.values()].sort((a, b) => b.count - a.count)
}

/**
 * The edits that replace `from` with `to` on every colour key of the
 * subtrees that holds it, one per node in tree order (together, one
 * `node_update_style` with `updates`). Keys `to` is not a value of (e.g. a
 * background-only token on a text colour) are left alone; `customColors`
 * are the theme's own colour names.
 */
export function colorSwapPlan(roots: DocNode[], from: string, to: string, customColors: readonly string[] = []): ColorSwap[] {
  if (from === to) return []
  return subtreeNodes(roots).flatMap((node) => {
    const keys = colorEntries(node)
      .filter(({ key, value }) => value === from && !styleTokenProblem(key, to, customColors))
      .map(({ key }) => key)
    return keys.length ? [{ nodeId: node.id, style: Object.fromEntries(keys.map(key => [key, to])) }] : []
  })
}
