import type { ModelNode } from '../model/schemas.ts'

/**
 * The names a node tree binds: `$bind` paths and the `{path}` parts of
 * `$template` strings, anywhere in a node's props or interactions, with the
 * item names (`as`) of the Lists around each node in scope, the way the
 * generator resolves them.
 */

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The first segment of a bound path: `post.title` → `post`. */
export const rootOf = (path: string): string => path.split('.')[0]!

/** Calls `map` on every bound path inside `value`; a returned string replaces the path in place. */
export const mapPaths = (value: unknown, map: (path: string) => string | undefined): void => {
  if (Array.isArray(value)) {
    value.forEach(item => mapPaths(item, map))
    return
  }
  if (!isObject(value)) return
  if (typeof value.$bind === 'string') value.$bind = map(value.$bind) ?? value.$bind
  if (typeof value.$template === 'string') value.$template = value.$template.replace(/\{([\w.]+)\}/g, (part, path: string) => `{${map(path) ?? path}}`)
  for (const [key, entry] of Object.entries(value)) if (key !== '$bind' && key !== '$template') mapPaths(entry, map)
}

/** `mapPaths` over a node's own fields (not its children). */
export const mapNodePaths = (node: ModelNode, map: (path: string) => string | undefined): void => {
  for (const [key, value] of Object.entries(node)) if (key !== 'children') mapPaths(value, map)
}

/** Visits `node` and its descendants with the List item names in scope at each (a List's `as` covers its children, not itself). */
export const walkScoped = (node: ModelNode, visit: (node: ModelNode, scope: ReadonlySet<string>) => void, scope: ReadonlySet<string> = new Set()): void => {
  visit(node, scope)
  const as = node.type === 'List' ? node.props?.as : undefined
  const inner = typeof as === 'string' ? new Set([...scope, as]) : scope
  for (const child of node.children ?? []) walkScoped(child, visit, inner)
}

/** The names `root`'s tree binds that nothing inside it defines, each with the ids of the nodes that bind it. */
export const freeNames = (root: ModelNode): Map<string, string[]> => {
  const free = new Map<string, string[]>()
  walkScoped(root, (node, scope) => mapNodePaths(node, (path) => {
    const name = rootOf(path)
    if (scope.has(name)) return undefined
    const ids = free.get(name) ?? []
    if (!ids.includes(node.id)) ids.push(node.id)
    free.set(name, ids)
    return undefined
  }))
  return free
}
