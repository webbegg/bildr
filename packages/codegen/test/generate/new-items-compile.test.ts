import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyEdit } from '../../src/edit/index'
import type { EditName } from '../../src/edit/index'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { ManifestFileSchema } from '../../src/model/schemas'
import { planSync } from '../../src/sync/plan'
import { draftsToggleEdits, withoutDraftsToggle } from '../edit/behaviour-helpers'
import { applyChanges } from '../edit/helpers'
import { fixtureModelFiles, fixtureRoot } from '../model/fixture'

/**
 * S10, "every new item is valid": what the module actions create or change gives an app that
 * typechecks, lints and passes its generated unit tests, not only a model that loads. Each group
 * applies its edits to the golden blog, regenerates the way a sync would (planSync refuses a
 * path generated twice) and runs the project's own tools. Tools come from the golden blog's
 * install (`pnpm --dir fixtures/codegen/blog install`), as in lint.test.ts.
 */
const fixtureModules = join(fixtureRoot, 'node_modules')
const bin = (name: string) => join(fixtureModules, '.bin', name)
const NEEDS_FIXTURE = existsSync(bin('nuxi')) || process.env.CI ? '' : ' (skipped: run `pnpm --dir fixtures/codegen/blog install` first)'

const run = promisify(execFile)
const hash = (content: string) => createHash('sha256').update(content).digest('hex')

/** A model being edited the way the editor does it: every edit must succeed. */
class Session {
  files = fixtureModelFiles()

  edit(name: EditName, input: unknown) {
    const outcome = applyEdit(this.files, name, input)
    expect(outcome.ok, `${name} ${JSON.stringify(input)}: ${JSON.stringify(outcome)}`).toBe(true)
    if (outcome.ok) this.files = applyChanges(this.files, outcome.changes)
    return this
  }

  /** Sample data are rows in a model file; no edit writes them yet. */
  fixtureRow(path: string, entity: string, row: Record<string, unknown>) {
    this.files = { ...this.files, [path]: `${JSON.stringify({ entity, rows: [row] }, null, 2)}\n` }
    return this
  }
}

/** The golden blog's files, copied without what the install and the tools make. */
const copyBlog = (to: string) => cpSync(fixtureRoot, to, {
  recursive: true,
  filter: source => !/\/(node_modules|\.nuxt|\.output|\.data|\.bildr)$/.test(source)
})

/** What a sync writes and deletes over the golden blog's files for `files`. Throws when a path is generated twice. */
const sync = (files: Record<string, string>, project: string) => {
  const loaded = loadModel(files)
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  const generated = generate(loaded.model)
  const manifest = ManifestFileSchema.parse(JSON.parse(readFileSync(join(fixtureRoot, '.bildr/manifest.json'), 'utf8'))).files
  const disk: Record<string, string | undefined> = {}
  for (const path of new Set([...generated.map(file => file.path), ...Object.keys(manifest)])) {
    disk[path] = existsSync(join(project, path)) ? hash(readFileSync(join(project, path), 'utf8')) : undefined
  }
  const plan = planSync({ generated, manifest, disk, hash })
  for (const write of plan.writes) {
    mkdirSync(dirname(join(project, write.path)), { recursive: true })
    writeFileSync(join(project, write.path), write.content)
  }
  for (const path of plan.deletes) rmSync(join(project, path), { force: true })
}

const GROUPS: Array<[string, (session: Session) => void]> = [
  ['the create, delete and blank templates and the query templates', (session) => {
    // The create template needs the route /posts, which act_create_post holds.
    session.edit('action_update', { action: 'act_create_post', http: { path: '/posts/legacy' } })
    session.edit('action_create', { entity: 'ent_post', template: 'create', name: 'draftPost' })
    session.edit('action_create', { entity: 'ent_post', template: 'delete', name: 'removePost' })
    session.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'tidyPosts' })
    session.edit('query_create', { entity: 'ent_post', result: 'many', name: 'recentPosts' })
    session.edit('query_create', { entity: 'ent_post', result: 'one', name: 'postById' })
  }],
  ['the update template, and the templates on an entity the app doesn\'t list', (session) => {
    session.edit('datasource_create', { name: 'scratch', kind: 'memory' })
    session.edit('entity_create', { name: 'note', source: 'ds_scratch', fields: [{ name: 'title', type: 'text', required: true }] })
    session.fixtureRow('.bildr/modules/blog/fixtures/note.json', 'ent_note', { id: '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9b01', title: 'First note' })
    session.edit('action_create', { entity: 'ent_note', template: 'update', name: 'editNote' })
    session.edit('action_create', { entity: 'ent_note', template: 'delete', name: 'removeNote' })
    session.edit('action_create', { entity: 'ent_note', template: 'blank', name: 'tidyNotes' })
    // Rows the app can't list: the entity's own create action, and the same templates.
    session.edit('entity_create', { name: 'secret', source: 'ds_scratch', expose: false, fields: [{ name: 'code', type: 'text', required: true }] })
    session.edit('action_create', { entity: 'ent_secret', template: 'delete', name: 'removeSecret' })
    session.edit('action_create', { entity: 'ent_secret', template: 'blank', name: 'tidySecrets' })
  }],
  ['renames of the queries and actions pages use', (session) => {
    session.edit('query_rename', { query: 'q_featured_posts', name: 'topPosts' })
    session.edit('query_rename', { query: 'q_post_by_slug', name: 'postFromSlug' })
    session.edit('action_rename', { action: 'act_create_post', name: 'addPost' })
    session.edit('action_rename', { action: 'act_publish_post', name: 'releasePost' })
  }],
  // B1: app behaviour. State, interactions and computed values are code too: the app they give builds, lints and tests.
  ['state of every persistence, used, updated and renamed', (session) => {
    session.edit('state_create', { name: 'reading', persist: 'session', fields: [{ name: 'dark', type: 'boolean', default: false }, { name: 'page', type: 'integer', default: 1 }, { name: 'title', type: 'text', default: 'Hello' }] })
    session.edit('state_create', { name: 'remembered', persist: 'localStorage', label: 'Remembered', fields: [{ name: 'zoom', type: 'number', default: 1.5 }, { name: 'since', type: 'date', default: '2026-01-01' }, { name: 'note', type: 'text' }] })
    session.edit('state_create', { name: 'unused' })
    session.edit('page_use_add', { page: 'pg_new_post', as: 'reading', state: 'st_reading' })
    session.edit('node_interaction_add', { file: 'pg_new_post', nodeId: 'n_cancel', on: 'mouseenter', do: [{ kind: 'setState', state: 'st_reading', field: 'page', value: 2 }] })
    session.edit('node_interaction_add', { file: 'pg_new_post', nodeId: 'n_published', on: 'change', do: [{ kind: 'setState', state: 'st_reading', field: 'dark', value: { $event: 'checked' } }] })
    session.edit('state_update', { state: 'st_remembered', label: 'Kept', persist: 'session', fields: [{ name: 'zoom', type: 'number', default: 2 }, { name: 'note', type: 'text', default: '' }, { name: 'count', type: 'integer', default: 0 }] })
    session.edit('state_rename', { state: 'st_reading', name: 'progress' })
    session.edit('state_create', { name: 'scratch' })
    session.edit('state_delete', { state: 'st_scratch' })
  }],
  ['interactions of every step kind, on a page, a layout and a component', (session) => {
    const uuid = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9b01'
    session.edit('state_create', { name: 'reading', fields: [{ name: 'dark', type: 'boolean', default: false }, { name: 'page', type: 'integer', default: 1 }] })
    session.edit('page_use_add', { page: 'pg_index', as: 'reading', state: 'st_reading' })
    session.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'Next' } })
    session.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'Go' } })
    session.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Checkbox', props: { label: 'Dark', value: { $bind: 'reading.dark' } } })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'page', value: 2 }] })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'mouseenter', do: [{ kind: 'setState', state: 'st_reading', field: 'dark', value: { not: { $bind: 'reading.dark' } } }] })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'mouseleave', do: [{ kind: 'toast', title: 'Bye', description: { $template: 'Page {reading.page}' }, color: 'info', icon: 'i-lucide-check' }] })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_2', on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: 'welcome' } } }] })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_2', on: 'mouseenter', do: [{ kind: 'runAction', action: 'act_publish_post', args: { id: uuid } }] })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_2', on: 'mouseleave', do: [
      { kind: 'runAction', action: 'act_publish_post', args: { id: uuid } },
      { kind: 'toast', when: 'success', title: 'Published' },
      { kind: 'navigate', when: 'success', to: { page: 'pg_new_post' } }
    ] })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_checkbox_1', on: 'change', do: [{ kind: 'setState', state: 'st_reading', field: 'dark', value: { $event: 'checked' } }] })
    session.edit('node_interaction_update', { file: 'pg_new_post', nodeId: 'n_form', index: 0, do: [
      { kind: 'runAction', action: 'act_create_post', args: { $form: true } },
      { kind: 'toast', when: 'success', title: 'Saved', color: 'success' },
      { kind: 'navigate', when: 'success', to: { page: 'pg_post_detail', params: { slug: { $form: 'slug' } } } }
    ] })
    session.edit('node_insert', { file: 'lay_main', parentId: 'n_nav', type: 'Button', props: { text: 'Write' } })
    session.edit('node_interaction_add', { file: 'lay_main', nodeId: 'n_button_3', on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_new_post' } }] })
    session.edit('node_interaction_add', { file: 'lay_main', nodeId: 'n_button_3', on: 'mouseenter', do: [{ kind: 'toast', title: { $bind: 'site.name' } }] })
    session.edit('node_insert', { file: 'cmp_post_card', parentId: 'n_actions', type: 'Button', props: { text: 'Hi' } })
    session.edit('node_interaction_add', { file: 'cmp_post_card', nodeId: 'n_button_4', on: 'click', do: [{ kind: 'toast', title: { $bind: 'draftLabel' } }] })
    session.edit('component_variant_add', { component: 'cmp_post_card', name: 'pressed' })
    session.edit('component_interaction_add', { component: 'cmp_post_card', variant: '', on: 'mouseenter', to: 'var_pressed' })
    session.edit('node_interaction_remove', { file: 'pg_index', nodeId: 'n_button_1', index: 1 })
  }],
  // B1 verification: steps of a List row go through the handler's parameters, and each value is the type its place takes.
  ['a List row\'s steps (a page to go to, a toast) and values typed into state', (session) => {
    session.edit('state_create', { name: 'reading', fields: [{ name: 'dark', type: 'boolean', default: false }, { name: 'page', type: 'integer', default: 1 }, { name: 'title', type: 'text', default: 'Hello' }, { name: 'note', type: 'text' }] })
    session.edit('page_use_add', { page: 'pg_index', as: 'reading', state: 'st_reading' })
    session.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'Count' } })
    session.edit('node_insert', { file: 'pg_index', parentId: 'n_list', type: 'Button', props: { text: 'Open' } })
    session.edit('node_insert', { file: 'pg_index', parentId: 'n_card_actions', type: 'Button', props: { text: 'Preview' } })
    // A number from a list's length, text from a template, the opposite of true or false, text from a row's field with a fallback.
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'page', value: { $bind: 'featured.length' } }] })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'mouseenter', do: [{ kind: 'setState', state: 'st_reading', field: 'title', value: { $template: 'Page {reading.page}' } }] })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'mouseleave', do: [{ kind: 'setState', state: 'st_reading', field: 'dark', value: { not: { $bind: 'reading.dark' } } }] })
    // Go to a page from a row: one step, and several (a toast reading the row, then the page); a step inline in the row.
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_2', on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: { $bind: 'post.slug' } } } }] })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_2', on: 'mouseenter', do: [{ kind: 'setState', state: 'st_reading', field: 'title', value: { $bind: 'post.title' } }] })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_2', on: 'mouseleave', do: [{ kind: 'toast', title: { $bind: 'post.title' } }, { kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: { $bind: 'post.slug' } } } }] })
    // The Button in the card's slot is in the row too.
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_3', on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: { $bind: 'post.slug' } } } }] })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_3', on: 'mouseenter', do: [{ kind: 'toast', title: { $bind: 'reading.note', fallback: 'No note' }, color: 'info' }] })
  }],
  // B7: an action with neither parameters nor a collection input is run with nothing, inline and from a script handler.
  ['an action that takes no input, run with no args', (session) => {
    session.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'tidyPosts' })
    session.edit('action_update', { action: 'act_tidy_posts', input: {} })
    session.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'Tidy' } })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'click', do: [{ kind: 'runAction', action: 'act_tidy_posts' }] })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'mouseenter', do: [
      { kind: 'runAction', action: 'act_tidy_posts' },
      { kind: 'toast', when: 'success', title: 'Tidied' },
      { kind: 'navigate', when: 'success', to: { page: 'pg_new_post' } }
    ] })
    session.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'Tidy and say' } })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_2', on: 'click', do: [{ kind: 'runAction', action: 'act_tidy_posts' }, { kind: 'toast', when: 'success', title: 'Done' }] })
  }],
  // An action with no optimistic update calls the server itself (fix/action-server-call): the update, a delete on an entity the app doesn't
  // list and a blank action over an entity, each run from a page (the first two from a Button, the last from the form).
  ['actions with no optimistic update, run from a page', (session) => {
    const uuid = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9b01'
    session.edit('datasource_create', { name: 'scratch', kind: 'memory' })
    session.edit('entity_create', { name: 'note', source: 'ds_scratch', fields: [{ name: 'title', type: 'text', required: true }] })
    session.fixtureRow('.bildr/modules/blog/fixtures/note.json', 'ent_note', { id: uuid, title: 'First note' })
    session.edit('action_create', { entity: 'ent_note', template: 'update', name: 'editNote' })
    session.edit('entity_create', { name: 'secret', source: 'ds_scratch', expose: false, fields: [{ name: 'code', type: 'text', required: true }] })
    session.edit('action_create', { entity: 'ent_secret', template: 'delete', name: 'removeSecret' })
    session.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'tidyPosts' })
    session.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'Edit' } })
    session.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'Remove' } })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'click', do: [
      { kind: 'runAction', action: 'act_edit_note', args: { id: uuid } },
      { kind: 'toast', when: 'success', title: 'Edited' }
    ] })
    session.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_2', on: 'click', do: [{ kind: 'runAction', action: 'act_remove_secret', args: { id: uuid } }] })
    session.edit('node_interaction_update', { file: 'pg_new_post', nodeId: 'n_form', index: 0, do: [
      { kind: 'runAction', action: 'act_tidy_posts', args: { $form: true } },
      { kind: 'navigate', when: 'success', to: { page: 'pg_index' } }
    ] })
  }],
  ['computed values that read each other, and a List that shows one', (session) => {
    session.edit('page_computed_set', { page: 'pg_index', as: 'label', if: { not: { $bind: 'preferences.showDrafts' } }, then: 'Featured posts', else: 'All posts' })
    session.edit('page_computed_set', { page: 'pg_index', as: 'heading', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'label' }, else: 'Posts' })
    session.edit('node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { text: { $bind: 'heading' } } })
    // `shown` reads `posts`, which only it reads: both are declared, `posts` first.
    session.edit('page_computed_set', { page: 'pg_index', as: 'shown', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'posts' }, else: { $bind: 'featured' } })
    session.edit('node_update_props', { file: 'pg_index', nodeId: 'n_list', props: { items: { $bind: 'shown' } } })
  }],
  ['the drafts toggle, built back through the module actions, and a computed value', (session) => {
    session.files = withoutDraftsToggle(session.files)
    draftsToggleEdits((name, input) => session.edit(name, input))
    session.edit('page_computed_set', { page: 'pg_index', as: 'heading', if: { not: { $bind: 'preferences.showDrafts' } }, then: 'Featured posts', else: 'All posts' })
    session.edit('node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { text: { $bind: 'heading' } } })
    session.edit('page_computed_set', { page: 'pg_index', as: 'posts', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'featured' }, else: { $bind: 'all' } })
  }],
  // Field types S3: every SaaS type on a stored entity (its zod, column, repository, actions and their tests) and on a store.
  ['every SaaS field type, on an entity and a store', (session) => {
    session.edit('entity_create', { name: 'deal', source: 'ds_main', fields: [
      { name: 'mail', type: 'email', required: true },
      { name: 'site', type: 'url' },
      { name: 'phone', type: 'phone' },
      { name: 'tint', type: 'color' },
      { name: 'price', type: 'money', currency: 'EUR', required: true },
      { name: 'discount', type: 'percent' },
      { name: 'stage', type: 'select', options: ['lead', 'won', 'it\'s lost'], required: true }
    ] })
    // Optional fields are either: not nullable (an empty column reads as unset) or nullable.
    session.edit('entity_field_add', { entity: 'ent_deal', name: 'size', type: 'select', options: ['s', 'm'], nullable: true })
    session.edit('entity_field_add', { entity: 'ent_deal', name: 'note', type: 'text' })
    session.fixtureRow('.bildr/modules/blog/fixtures/deal.json', 'ent_deal', { id: '6f1c2d3e-4b5a-4c6d-8e7f-000000000009', mail: 'ana@example.com', site: 'https://ana.example.com', phone: '+34 600 123 456', price: 9.99, stage: 'won', size: null })
    // A form of the create action: a select's Input is a dropdown of its options (USelect), beside a text type's and money's.
    session.edit('node_insert', { file: 'pg_index', parentId: 'n_page', type: 'Form', props: { action: 'act_create_deal', fields: ['fld_stage', 'fld_mail', 'fld_price'] } })
    for (const field of ['fld_stage', 'fld_mail', 'fld_price']) session.edit('node_insert', { file: 'pg_index', parentId: 'n_form_1', type: 'Input', props: { field, ...(field === 'fld_stage' ? { placeholder: 'Pick a stage' } : {}) } })
    session.edit('action_create', { entity: 'ent_deal', template: 'update', name: 'editDeal' })
    session.edit('action_create', { entity: 'ent_deal', template: 'delete', name: 'removeDeal' })
    session.edit('query_create', { entity: 'ent_deal', result: 'many', name: 'openDeals' })
    session.edit('state_create', { name: 'dealFilters', persist: 'session', fields: [
      { name: 'stage', type: 'select', options: ['lead', 'won'], default: 'lead' },
      { name: 'budget', type: 'money', currency: 'USD', default: 100 },
      { name: 'contact', type: 'email' }
    ] })
  }]
]

describe.skipIf(!!NEEDS_FIXTURE)(`new queries and actions: typecheck, lint and generated tests${NEEDS_FIXTURE}`, { timeout: 600_000 }, () => {
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'bildr-new-items-'))
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  describe.each(GROUPS)('%s', (name, build) => {
    let project: string
    beforeAll(() => {
      project = join(root, name.replace(/\W+/g, '-').slice(0, 40))
      copyBlog(project)
      const session = new Session()
      build(session)
      sync(session.files, project)
      // Standalone (S2): the app checks without the dev-only editor module.
      const config = join(project, 'nuxt.config.ts')
      writeFileSync(config, readFileSync(config, 'utf8').replace(', \'@bildr/nuxt\'', ''))
      symlinkSync(fixtureModules, join(project, 'node_modules'), 'dir')
    })

    const exec = (command: string, args: string[]) => run(command, args, { cwd: project, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NUXT_TELEMETRY_DISABLED: '1', NO_COLOR: '1', FORCE_COLOR: '0' } })
      .then(({ stdout, stderr }) => ({ code: 0, output: `${stdout}\n${stderr}` }), (error: { code?: number, stdout?: string, stderr?: string }) => ({ code: error.code ?? 1, output: `${error.stdout ?? ''}\n${error.stderr ?? ''}` }))

    it('typechecks (nuxi typecheck)', async () => {
      const { code, output } = await exec(bin('nuxi'), ['typecheck'])
      expect(code, output.slice(-4000)).toBe(0)
    })

    it('passes its eslint', async () => {
      // `nuxi typecheck` ran `nuxt prepare`, which wrote .nuxt/eslint.config.mjs for this project.
      expect(existsSync(join(project, '.nuxt/eslint.config.mjs'))).toBe(true)
      const { output } = await exec(process.execPath, [join(fixtureModules, 'eslint/bin/eslint.js'), '.', '--format', 'json'])
      const reports = JSON.parse(output.slice(output.indexOf('['), output.lastIndexOf(']') + 1)) as Array<{ filePath: string, messages: Array<{ line: number, ruleId: string | null, message: string }> }>
      const findings = reports.flatMap(report => report.messages.map(message => `${report.filePath.slice(project.length + 1)}:${message.line} ${message.ruleId}: ${message.message}`))
      expect(findings).toEqual([])
      expect(reports.length).toBeGreaterThan(10)
    })

    it('passes its generated unit tests (vitest run)', async () => {
      const { code, output } = await exec(bin('vitest'), ['run', '--project', 'unit', '--reporter', 'verbose'])
      expect(code, output.slice(-4000)).toBe(0)
      expect(output).toMatch(/Tests\s+\d+ passed/)
    })
  })
})
