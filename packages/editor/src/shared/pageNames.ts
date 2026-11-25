import { AUTO_IMPORTED_FUNCTION_NAMES, pageNodeNames, RESERVED_PAGE_NAMES } from '@bildr/codegen/edit'
import type { ModelNode, PageFile } from '@bildr/codegen/model'
import { routeParams } from './interactionValues.ts'

/**
 * The name a page gives what it uses (B4): a State, a query, an action or a computed value is read by name, in the page's script and in
 * its bindings. `freeAlias` is the first name the page can give one: not one of its uses, or a name a use derives (a State's `set…`, a
 * query's `…Loading`, an action's `…Pending` and `…Error`), not what a List calls its records (a name inside the List would read the
 * record instead), not a route parameter, and not one the page's script uses itself or Vue and Nuxt provide to it.
 *
 * The module refuses a name its script cannot declare (`page_use_add`, `page_computed_set`) and is the last word; this one is the
 * names offered, so the module is not asked for one it refuses. The reserved names, the auto-imported functions and the names a page's
 * nodes declare (`on<Node><Event>`, `shown<Node>`) are the module's own, read from `@bildr/codegen/edit`. The composables (`use…`)
 * the generator and Nuxt auto-import are left out by shape, not listed: the names of the composables of the page's own uses need the
 * module, which is the last word on them.
 */

export type UseKind = 'state' | 'query' | 'api' | 'action' | 'computed'

const capital = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1)

/** The names the page's script declares for a use `as` of `kind`: the name, and what it derives from it. */
const declaredBy = (as: string, kind: UseKind): string[] => {
  if (kind === 'state') return [as, `set${capital(as)}`]
  if (kind === 'query') return [as, `${as}Loading`]
  if (kind === 'api') return [as, `${as}Status`]
  if (kind === 'action') return [as, `${as}Pending`, `${as}Error`]
  return [as]
}

/** What a List of the page calls its records. */
const itemNames = (node: ModelNode): string[] => [
  ...(node.type === 'List' && typeof node.props?.as === 'string' ? [node.props.as] : []),
  ...(node.children ?? []).flatMap(itemNames)
]

/** The names the page has: its uses and what they derive, its Lists' record names, the names its nodes declare and its route parameters. */
const takenBy = (page: PageFile): Set<string> => new Set([
  ...pageNodeNames(page),
  ...(page.uses?.state ?? []).flatMap(use => declaredBy(use.as, 'state')),
  ...(page.uses?.queries ?? []).flatMap(use => declaredBy(use.as, 'query')),
  ...(page.uses?.apis ?? []).flatMap(use => declaredBy(use.as, 'api')),
  ...(page.uses?.actions ?? []).flatMap(use => declaredBy(use.as, 'action')),
  ...(page.uses?.computed ?? []).flatMap(use => declaredBy(use.as, 'computed')),
  ...itemNames(page.root),
  ...routeParams(page)
])

/** A name the script uses itself or gets from Vue and Nuxt; `use…` is how a composable of theirs starts, so the name asked for is not that. */
const provided = (name: string): boolean => RESERVED_PAGE_NAMES.includes(name) || AUTO_IMPORTED_FUNCTION_NAMES.includes(name)

/** `base`, or `base2`, `base3`…: the first name of a use of `kind` the page can give, with the names it would derive. */
export function freeAlias(page: PageFile, base: string, kind: UseKind): string {
  const taken = takenBy(page)
  const composable = /^use[A-Z]/.test(base)
  for (let n = 1; ; n++) {
    const candidate = n === 1 && !composable ? base : `${base}${n === 1 ? 2 : n}`
    if (!declaredBy(candidate, kind).some(name => taken.has(name)) && !provided(candidate)) return candidate
  }
}
