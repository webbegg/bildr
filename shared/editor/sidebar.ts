import { slugify } from '../document/factory'
import type { DocNode, Page } from '../document/schema'

/**
 * The left sidebar's search (Framer's Pages / Layers / Assets search): pure
 * filters for the panel that is showing. A query matches text containing
 * it, ignoring case and the spaces around it; an empty query keeps
 * everything.
 */

const normalize = (query: string) => query.trim().toLowerCase()

/** True when any of `texts` contains `query` (the Insert panel searches components with it). */
export function matches(query: string, ...texts: (string | undefined)[]): boolean {
  const q = normalize(query)
  return !q || texts.some(text => text?.toLowerCase().includes(q))
}

/** The pages whose name or path (`/slug`) matches. */
export function filterPages<T extends Pick<Page, 'name' | 'slug'>>(pages: readonly T[], query: string): T[] {
  return pages.filter(page => matches(query, page.name, `/${page.slug}`))
}

/**
 * A page row's label, Framer's: the path (`/pricing`), or `Home` for the home
 * page, plus the page name as a `hint` when the path does not say it.
 */
export function pageRowLabel(page: Pick<Page, 'name' | 'slug'>, home: boolean): { path: string, hint?: string } {
  const path = home ? 'Home' : `/${page.slug}`
  return slugify(page.name) === (home ? 'home' : page.slug) ? { path } : { path, hint: page.name }
}

/** The assets (theme styles, collections) whose name matches. */
export function filterByName<T extends { name: string }>(items: readonly T[], query: string): T[] {
  return items.filter(item => matches(query, item.name))
}

/** The text a layers row shows after its type: a node's `text` or `label`. */
function layerText(node: DocNode): string | undefined {
  const text = node.props.text ?? node.props.label
  return typeof text === 'string' ? text : undefined
}

/**
 * The layers rows to show for a query: the nodes whose type or text matches,
 * plus their ancestors so each match keeps its place in the tree. Null for
 * an empty query (show every row).
 */
export function filterLayers(root: DocNode, query: string): Set<string> | null {
  if (!normalize(query)) return null
  const shown = new Set<string>()
  const visit = (node: DocNode, path: string[]) => {
    const here = [...path, node.id]
    if (matches(query, node.type, layerText(node))) here.forEach(id => shown.add(id))
    node.children.forEach(child => visit(child, here))
  }
  visit(root, [])
  return shown
}
