import { expect } from 'vitest'
import type { EditName } from '../../src/edit/index'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import type { ModelNode } from '../../src/model/schemas'
import { fixtureModelFiles } from '../model/fixture'
import { findNode, project } from './helpers'

/** What the app behaviour actions (B1) share in their tests. */
export type Project = ReturnType<typeof project>

export const INDEX = '.bildr/modules/blog/pages/index.json'
export const NEW_POST = '.bildr/modules/blog/pages/new-post.json'
export const PREFERENCES = '.bildr/modules/blog/state/preferences.json'
export const MAIN_LAYOUT = '.bildr/layouts/main.json'
export const POST_CARD = '.bildr/modules/blog/components/post-card.json'

/** The files generated for `files`: the model loads and the generator accepts it. Returns each generated file's text by path. */
export const generated = (files: Record<string, string>): Record<string, string> => {
  const loaded = loadModel(files)
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  return Object.fromEntries(generate(loaded.model).map(file => [file.path, file.content]))
}

export const expectGenerates = (p: Project) => {
  expect(() => generated(p.files)).not.toThrow()
}

/**
 * The golden blog without its drafts toggle: no `st_preferences`, no "Show drafts" checkbox (`n_toggle`), no computed `posts`, and the
 * page's list reading `featured`. The actions of B1 build all three back (drafts-toggle.test.ts, the compile test).
 */
export const withoutDraftsToggle = (files: Record<string, string>): Record<string, string> => {
  const next = Object.fromEntries(Object.entries(files).filter(([path]) => path !== PREFERENCES))
  const page = JSON.parse(next[INDEX]!) as { uses: Record<string, unknown>, root: ModelNode }
  delete page.uses.state
  delete page.uses.computed
  const head = findNode(page.root, 'n_head')!
  head.children = head.children!.filter(child => child.id !== 'n_toggle')
  findNode(page.root, 'n_list')!.props!.items = { $bind: 'featured' }
  next[INDEX] = `${JSON.stringify(page, null, 2)}\n`
  return next
}

/** The id the first Checkbox inserted into a page gets. */
export const TOGGLE_ID = 'n_checkbox_1'

/** The module actions that put the drafts toggle back on the blog without it, in the order the editor would run them. */
export const draftsToggleEdits = (edit: (name: EditName, input: unknown) => unknown) => {
  edit('state_create', { name: 'preferences', label: 'Blog preferences', persist: 'localStorage', fields: [{ name: 'showDrafts', type: 'boolean', default: false }] })
  edit('page_use_add', { page: 'pg_index', as: 'preferences', state: 'st_preferences' })
  edit('node_insert', { file: 'pg_index', parentId: 'n_head', index: 1, type: 'Checkbox', exact: true, props: { label: 'Show drafts', value: { $bind: 'preferences.showDrafts' } } })
  edit('node_interaction_add', { file: 'pg_index', nodeId: TOGGLE_ID, on: 'change', do: [{ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { $event: 'checked' } }] })
  edit('page_computed_set', { page: 'pg_index', as: 'posts', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'all' }, else: { $bind: 'featured' } })
  edit('node_update_props', { file: 'pg_index', nodeId: 'n_list', props: { items: { $bind: 'posts' } } })
}

/** The blog without its drafts toggle, with the toggle built back through the module actions (what the golden blog has, but for the minted node id). */
export const buildDraftsToggle = (): Project => {
  const p = project(withoutDraftsToggle(fixtureModelFiles()))
  draftsToggleEdits((name, input) => p.edit(name, input))
  return p
}

export const nodeOf = (p: Project, path: string, id: string): ModelNode => {
  const node = findNode(p.json(path).root, id)
  if (!node) throw new Error(`No node ${id} in ${path}`)
  return node as ModelNode
}
