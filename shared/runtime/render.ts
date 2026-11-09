import type { DocNode, Page } from '../document/schema'

/**
 * Pure helpers shared by the runtime renderer, the editor, and the agent
 * surfaces (MCP, WebMCP).
 */

/** `to` is an absolute URL or a page slug; slugs resolve under `base` (e.g. `/p/shop`). */
export function resolveLink(to: string, base: string): { to: string, external: boolean } | undefined {
  const value = to.trim()
  if (!value) return undefined
  if (/^(?:https?:|mailto:|tel:)/i.test(value)) return { to: value, external: true }
  return { to: `${base}/${value.replace(/^\/+/, '')}`, external: false }
}

/** A short human label for a node: its type plus its main text, if any. */
export function nodeLabel(node: DocNode): string {
  const text = node.props.text ?? node.props.label
  return typeof text === 'string' && text ? `${node.type}: ${text}` : node.type
}

/** The page as indented text: one line per node, links shown as `→ target`. */
export function pageOutline(page: Page): string {
  const lines = [`Page "${page.name}" (/${page.slug})`]
  const visit = (node: DocNode, depth: number) => {
    const to = typeof node.props.to === 'string' && node.props.to ? ` → ${node.props.to}` : ''
    lines.push(`${'  '.repeat(depth)}${nodeLabel(node)}${to}`)
    node.children.forEach(child => visit(child, depth + 1))
  }
  page.root.children.forEach(child => visit(child, 1))
  return lines.join('\n')
}
