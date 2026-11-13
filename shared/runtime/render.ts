import type { DocNode, Page } from '../document/schema'
import { resolveBindings } from './bindings'
import type { BindingItem } from './bindings'

/**
 * Pure helpers shared by the runtime renderer, the editor, and the agent
 * surfaces (MCP, WebMCP).
 */

/**
 * `to` is an absolute URL or a page slug; slugs resolve under `base` (e.g. `/p/shop`).
 * A slug's leading slashes, backslashes and whitespace go: a browser reads
 * `//host` and `/\host` (tabs stripped) as another origin.
 */
export function resolveLink(to: string, base: string): { to: string, external: boolean } | undefined {
  const value = to.trim()
  if (!value) return undefined
  if (/^(?:https?:|mailto:|tel:)/i.test(value)) return { to: value, external: true }
  return { to: `${base}/${value.replace(/^[\s/\\]+/, '')}`, external: false }
}

/** A short human label for a node: its type plus its main text, if any. */
export function nodeLabel(node: DocNode): string {
  const text = node.props.text ?? node.props.label
  return typeof text === 'string' && text ? `${node.type}: ${text}` : node.type
}

export interface OutlineOptions {
  /** The path shown after the name, e.g. `/blog/:slug` for a detail page; `/<slug>` by default. */
  path?: string
  /** A detail page's record: its `{{ item.* }}` bindings show resolved. */
  item?: BindingItem | null
}

/**
 * The page as indented text: one line per node, links shown as `→ target`.
 * With `item`, bindings resolve against it, except inside Lists, whose own
 * records they read.
 */
export function pageOutline(page: Page, { path, item }: OutlineOptions = {}): string {
  const lines = [`Page "${page.name}" (${path ?? `/${page.slug}`})`]
  const bound = (node: DocNode, scope: BindingItem | null | undefined): DocNode => {
    if (!scope) return node
    const props = Object.fromEntries(Object.entries(node.props).map(([key, value]) => [key, typeof value === 'string' ? resolveBindings(value, { item: scope, link: key === 'to' }) : value]))
    return { ...node, props }
  }
  const visit = (raw: DocNode, depth: number, scope: BindingItem | null | undefined) => {
    const node = bound(raw, scope)
    const to = typeof node.props.to === 'string' && node.props.to ? ` → ${node.props.to}` : ''
    lines.push(`${'  '.repeat(depth)}${nodeLabel(node)}${to}`)
    node.children.forEach(child => visit(child, depth + 1, node.type === 'List' ? undefined : scope))
  }
  page.root.children.forEach(child => visit(child, 1, item))
  return lines.join('\n')
}
