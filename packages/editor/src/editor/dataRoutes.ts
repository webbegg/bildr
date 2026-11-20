/**
 * Where the two Data screens are (simple data, SD-1): the simple section at `/data` (a store or an API in `?item=state:<id>` /
 * `?item=api:<id>`) and today's workspace at `/data/advanced`, which keeps every query it had (`?item=collection:ent_post&tab=fields`,
 * `?item=files&file=…`). A link made before the simple section, or by something that only knows the workspace, still names `/data`:
 * `needsAdvanced` is what tells it apart, so the router sends it to the workspace with its query (`router.ts`).
 */

export const SIMPLE_PATH = '/data'
export const ADVANCED_PATH = '/data/advanced'

/** The `item` of the simple section's own links: a store or an API. */
const SIMPLE_ITEM = /^(state|api):./

/**
 * Whether a `/data` link names something only the workspace has: any item that is not a store or an API (a collection, a connection, a
 * query, an action, All model files, the migration), or a tab or a file (the simple section has neither).
 */
export function needsAdvanced(query: Record<string, unknown>): boolean {
  const { item, tab, file } = query
  if (tab !== undefined || file !== undefined) return true
  return item !== undefined && !(typeof item === 'string' && SIMPLE_ITEM.test(item))
}
