import { pascal } from './text.ts'

/**
 * The identifiers the generated code derives from model names. One place for each rule: the generator writes them and the edits and
 * the model's load check (`edit/page-uses.ts`, `edit/reserved-names.ts`) refuse a name that would meet one, so the two never disagree.
 * Pure, and free of the edit machinery.
 */

// ── Composables ─────────────────────────────────────────────────────────

/** The client composable a query or action named `name` generates. */
export const composableOf = (name: string): string => `use${pascal(name)}`

/** The composable a state of `module` generates (generate/client.ts): the module's name comes first, so two modules' states never meet. */
export const stateComposableOf = (module: string, name: string): string => `use${pascal(module)}${pascal(name)}`

/** The composable a query or an action of an API source generates (auto-imported by name, so unique across the app). */
export const apiComposableName = (sourceName: string, operationName: string) => `use${pascal(sourceName)}${pascal(operationName)}`

/** A module's composition root (`useBlog`). */
export const moduleRootOf = (module: string): string => composableOf(module)

// ── A page's script ─────────────────────────────────────────────────────

/** What a page's script derives from a use `as`: a state's setter, a query's loading flag, an action's pending flag, an error. */
export const useNames = (as: string) => ({
  set: `set${pascal(as)}`,
  loading: `${as}Loading`,
  pending: `${as}Pending`,
  error: `${as}Error`
})

/** A node id as the part of a name: `n_post_card` → `PostCard`. */
const nodePart = (nodeId: string) => pascal(nodeId.replace(/^n_/, ''))

/** The script handler of a node's interaction: `onSaveClick`. */
export const handlerName = (nodeId: string, on: string): string => `on${nodePart(nodeId)}${pascal(on)}`

/** The counter of a List that loads more: `shownPosts`. */
export const loadMoreCounter = (nodeId: string): string => `shown${nodePart(nodeId)}`

/** The parameter a handler takes a List's item `as` as: the script has no `post`, only what the template passes. */
export const itemParam = (as: string): string => `${as}Item`

/** The position of a List's item, its key when the rows have no `id`. */
export const itemPosition = (as: string): string => `${as}Index`
