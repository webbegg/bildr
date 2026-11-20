import { Failure, mockActions, mountWithApp, settle } from '../helpers.ts'
import type { AppRoutes } from '../helpers.ts'
import DataView from '../../src/views/DataView.vue'
import { applyEdit } from '@bildr/codegen/edit'
import type { EditName } from '@bildr/codegen/edit'
import { loadModel, serializeModel } from '@bildr/codegen/model'
import { baseHandlers, indexPage, world } from '../design/harness.ts'
import type { Handlers } from '../design/harness.ts'

/**
 * What the Data screen's tests share (`data.test.ts`, `dataActionSteps.test.ts`): the DOM readers, the screen mounted over the
 * mocked actions, the module's query and action edits (the real ones) over the mocked model, and the tree's and the tabs' hooks.
 */

export const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
export const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)]
export const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

/** Mounts the Data screen (the workspace, `/data/advanced`) with the base handlers plus `extra`. */
export const open = async (extra: Handlers = {}, routes: AppRoutes = {}, path = '/data/advanced') => {
  const actions = mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), ...extra }, routes)
  const mounted = await mountWithApp(DataView, path)
  return { actions, ...mounted }
}
export type Mounted = Awaited<ReturnType<typeof open>>

export const inputs = (actions: Mounted['actions'], name: string) => actions.named(name).map(call => call.input)

/** How the module answers a refusal, by the code `applyEdit` gives it (`packages/nuxt/src/server`: invalid input is a 400, a missing item a 404). */
const REFUSAL_STATUS = { invalid_input: 400, not_found: 404, invalid: 422, conflict: 409 } as const

/**
 * The module's query and action edits over the mocked model, which are the real ones: each goes through `applyEdit` of
 * `@bildr/codegen/edit`, on the model's files as they are now (the fixture, and what the test changed in `world.model`), and what
 * it writes becomes the model the mocked `model_get` serves. So the editor's tests meet the module's own rules (names, uses,
 * refusals and their words), not a copy of them.
 */
export const moduleEdits = (names: EditName[]): Handlers => Object.fromEntries(names.map(name => [name, (input: Record<string, unknown>) => {
  const files = serializeModel(world.model)
  const outcome = applyEdit(files, name, input)
  if (!outcome.ok) return new Failure(REFUSAL_STATUS[outcome.code], outcome.code, outcome.message, undefined, outcome.field)
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

export const artifactModule = (): Handlers => moduleEdits(['query_create', 'query_update', 'query_rename', 'query_delete', 'action_create', 'action_update', 'action_rename', 'action_delete'])

/** The state actions (B2), the real ones over the mocked model, as `artifactModule`'s. */
export const stateModule = (): Handlers => moduleEdits(['state_create', 'state_update', 'state_rename', 'state_delete', 'page_use_add', 'page_use_remove'])

/** The API actions (simple data, P1), the real ones over the mocked model, as `artifactModule`'s: an API, its models, queries and actions, and deleting it. */
export const apiModule = (): Handlers => moduleEdits(['api_create', 'api_update', 'api_model_set', 'api_model_rename', 'api_model_delete', 'api_query_set', 'api_query_rename', 'api_query_delete', 'api_action_set', 'api_action_rename', 'api_action_delete', 'datasource_delete'])

/** The node interaction actions (B3), the real ones over the mocked model: what the inspector's Interactions write, and the module's own refusals of it. */
export const interactionModule = (): Handlers => moduleEdits(['node_interaction_add', 'node_interaction_update', 'node_interaction_remove'])

/**
 * What binding a prop to State and a List to a condition write (B4), the real ones over the mocked model: the state's use of a page, the
 * prop, the computed value, and the module's own refusals of them.
 */
export const behaviourModule = (): Handlers => moduleEdits(['node_update_props', 'page_use_add', 'page_use_remove', 'page_computed_set', 'page_computed_remove', 'query_create_for_list', 'query_update'])

/**
 * The module's undo over `handlers` (the mocked model): `history_undo` puts the model back as it was before the last edit that
 * changed it, one edit at a time, as the module's history does (every action is a step of its own). `history_get` counts the steps.
 */
export const withHistory = (handlers: Handlers): Handlers => {
  const steps: Array<typeof world.model> = []
  const recorded = Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, (input: Record<string, unknown>) => {
    const before = world.model
    const out = handler(input)
    if (!(out instanceof Failure) && world.model !== before) steps.push(before)
    return out
  }]))
  return {
    ...recorded,
    history_get: () => ({ undo: steps.map(() => ({ action: 'edit' })), redo: [] }),
    history_undo: () => {
      const before = steps.pop()
      if (!before) return new Failure(409, 'conflict', 'Nothing to undo')
      world.model = before
      return { action: 'edit', files: [] }
    }
  }
}

/** The sample-data actions (D4), the real ones over the mocked model: a cell saved here is the row the Rows tab shows next. */
export const fixtureModule = (): Handlers => moduleEdits(['fixture_row_create', 'fixture_row_update', 'fixture_rows_delete'])

/**
 * Adds to Post a field nothing uses: no query, action, page or component names it. The fixture's own fields are all used (the
 * title by the detail page, the slug by its query…), so a test that renames or removes a field and expects the change to go ahead
 * uses this one: a used field is blocked, with a warning (`usageWarnings.ts`). Returns its id.
 */
export const addUnusedField = (name = 'extra'): string => {
  const id = `fld_${name}`
  world.model.modules.blog!.entities[0]!.fields.push({ id, name, type: 'text' })
  return id
}

/** The fixture's index page shows the latest quotes, and a page that uses a collection keeps its connection: with that page's use of them gone, nothing outside uses the Quote collection. */
export const freeQuotes = (): void => {
  indexPage().uses!.queries = indexPage().uses!.queries!.filter(use => use.query !== 'q_latest_quotes')
  indexPage().root.children = indexPage().root.children!.filter(node => node.id !== 'n_quotes')
}

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
  preferences: 'state:st_preferences',
  files: 'files'
}
export const treeItem = (name: keyof typeof ITEMS) => q(`[data-tree-item="${ITEMS[name]}"]`)
export const tabNames = () => qa('[role="tab"][data-data-tab]').map(tab => tab.getAttribute('data-data-tab'))
export const activeTab = () => q('[role="tab"][aria-selected="true"]')?.getAttribute('data-data-tab')
export const tab = (name: string) => q(`[role="tab"][data-data-tab="${name}"]`)
/** What the open confirmation says. */
export const confirmText = () => text(q('[data-confirm]')?.closest('[role="dialog"]') ?? null)
export { settle }
