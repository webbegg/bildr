import { Failure, mockActions, mountWithApp, settle } from '../helpers.ts'
import type { AppRoutes } from '../helpers.ts'
import DataView from '../../src/views/DataView.vue'
import { applyEdit } from '@bildr/codegen/edit'
import type { EditName } from '@bildr/codegen/edit'
import { loadModel, serializeModel } from '@bildr/codegen/model'
import { baseHandlers, world } from '../design/harness.ts'
import type { Handlers } from '../design/harness.ts'

/**
 * What the Data screen's tests share (`data.test.ts`, `dataActionSteps.test.ts`): the DOM readers, the screen mounted over the
 * mocked actions, the module's query and action edits (the real ones) over the mocked model, and the tree's and the tabs' hooks.
 */

export const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
export const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)]
export const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

/** Mounts the Data screen with the base handlers plus `extra`. */
export const open = async (extra: Handlers = {}, routes: AppRoutes = {}, path = '/data') => {
  const actions = mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), ...extra }, routes)
  const mounted = await mountWithApp(DataView, path)
  return { actions, ...mounted }
}
export type Mounted = Awaited<ReturnType<typeof open>>

export const inputs = (actions: Mounted['actions'], name: string) => actions.named(name).map(call => call.input)

/** How the module answers a refusal, by the code `applyEdit` gives it (`packages/nuxt/src/server`: invalid input is a 400, a missing item a 404). */
const REFUSAL_STATUS = { invalid_input: 400, not_found: 404, invalid: 422 } as const

/**
 * The module's query and action edits over the mocked model, which are the real ones: each goes through `applyEdit` of
 * `@bildr/codegen/edit`, on the model's files as they are now (the fixture, and what the test changed in `world.model`), and what
 * it writes becomes the model the mocked `model_get` serves. So the editor's tests meet the module's own rules (names, uses,
 * refusals and their words), not a copy of them.
 */
export const artifactModule = (): Handlers => Object.fromEntries((['query_create', 'query_update', 'query_rename', 'query_delete', 'action_create', 'action_update', 'action_rename', 'action_delete'] as EditName[]).map(name => [name, (input: Record<string, unknown>) => {
  const files = serializeModel(world.model)
  const outcome = applyEdit(files, name, input)
  if (!outcome.ok) return new Failure(REFUSAL_STATUS[outcome.code], outcome.code, outcome.message)
  const next = { ...files }
  for (const change of outcome.changes) {
    if (change.content === null) Reflect.deleteProperty(next, change.path)
    else next[change.path] = change.content
  }
  const loaded = loadModel(next)
  if (!loaded.ok) throw new Error(`applyEdit left a model that does not load: ${JSON.stringify(loaded.problems)}`)
  world.model = loaded.model
  return { ...outcome.result, changed: outcome.changes.map(change => change.path) }
}]))

/** The tree's items by name: `data-tree-item` is the item's key (`collection:<id>`, `connection:<id>`). */
export const ITEMS = {
  post: 'collection:ent_post',
  quote: 'collection:ent_quote',
  quotes: 'connection:ds_quotes',
  allPosts: 'query:q_all_posts',
  featured: 'query:q_featured_posts',
  latestQuotes: 'query:q_latest_quotes',
  bySlug: 'query:q_post_by_slug',
  createPost: 'action:act_create_post',
  publishPost: 'action:act_publish_post',
  files: 'files'
}
export const treeItem = (name: keyof typeof ITEMS) => q(`[data-tree-item="${ITEMS[name]}"]`)
export const tabNames = () => qa('[role="tab"][data-data-tab]').map(tab => tab.getAttribute('data-data-tab'))
export const activeTab = () => q('[role="tab"][aria-selected="true"]')?.getAttribute('data-data-tab')
export const tab = (name: string) => q(`[role="tab"][data-data-tab="${name}"]`)
/** What the open confirmation says. */
export const confirmText = () => text(q('[data-confirm]')?.closest('[role="dialog"]') ?? null)
export { settle }
