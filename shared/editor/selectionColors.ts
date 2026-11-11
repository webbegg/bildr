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

export interface ColorSwap {
  nodeIds: string[]
  /** The same patch for every node of the group (one `node_update_style` with `nodeIds`). */
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
 * subtrees that holds it: nodes changing the same keys share one group.
 * Keys `to` is not a value of (e.g. a background-only token on a text
 * colour) are left alone; `customColors` are the theme's own colour names.
 */
export function colorSwapPlan(roots: DocNode[], from: string, to: string, customColors: readonly string[] = []): ColorSwap[] {
  if (from === to) return []
  const groups = new Map<string, ColorSwap>()
  for (const node of subtreeNodes(roots)) {
    const keys = colorEntries(node)
      .filter(({ key, value }) => value === from && !styleTokenProblem(key, to, customColors))
      .map(({ key }) => key)
    if (!keys.length) continue
    const signature = [...keys].sort().join(' ')
    const group = groups.get(signature) ?? { nodeIds: [], style: Object.fromEntries(keys.map(key => [key, to])) }
    group.nodeIds.push(node.id)
    groups.set(signature, group)
  }
  return [...groups.values()]
}
