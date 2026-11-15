import type { ModelNode, PageFile } from '@bildr/codegen/model'

/**
 * The left sidebar's search (Framer's Pages / Layers / Assets search; the hosted
 * `shared/editor/sidebar.ts`, over the model's files): pure filters for the panel
 * that is showing. A query matches text containing it, ignoring case and the
 * spaces around it; an empty query keeps everything.
 */

const normalize = (query: string) => query.trim().toLowerCase()

/** True when any of `texts` contains `query` (the Insert panel searches components with it). */
export function matches(query: string, ...texts: (string | undefined)[]): boolean {
  const q = normalize(query)
  return !q || texts.some(text => text?.toLowerCase().includes(q))
}

/** The pages whose name or path (`/pricing`) matches. */
export function filterPages<T extends Pick<PageFile, 'name' | 'path'>>(pages: readonly T[], query: string): T[] {
  return pages.filter(page => matches(query, page.name, page.path))
}

/** A page's route name as a kebab-cased slug of a free text, to compare it with its path. */
const slugify = (text: string): string => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * A page row's label, Framer's: the path (`/pricing`), or `Home` for the home
 * page (the path `/`), plus the page name as a `hint` when the path does not say it.
 */
export function pageRowLabel(page: Pick<PageFile, 'name' | 'path'>, home: boolean): { path: string, hint?: string } {
  const path = home ? 'Home' : page.path
  const said = home ? 'home' : slugify(page.path)
  return slugify(page.name) === said || (home && page.name === 'index') ? { path } : { path, hint: page.name }
}

/** The items (e.g. the Assets panel's theme styles) whose name matches. */
export function filterByName<T extends { name: string }>(items: readonly T[], query: string): T[] {
  return items.filter(item => matches(query, item.name))
}

/** The text a layers row shows after its type: a node's `text` or `label`. */
function layerText(node: ModelNode): string | undefined {
  const text = node.props?.text ?? node.props?.label
  return typeof text === 'string' ? text : undefined
}

/**
 * The layers rows to show for a query: the nodes whose type or text matches,
 * plus their ancestors so each match keeps its place in the tree. Null for
 * an empty query (show every row).
 */
export function filterLayers(root: ModelNode, query: string): Set<string> | null {
  if (!normalize(query)) return null
  const shown = new Set<string>()
  const visit = (node: ModelNode, path: string[]) => {
    const here = [...path, node.id]
    if (matches(query, node.type, layerText(node))) here.forEach(id => shown.add(id))
    node.children?.forEach(child => visit(child, here))
  }
  visit(root, [])
  return shown
}
