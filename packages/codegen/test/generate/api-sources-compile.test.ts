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
import { applyChanges } from '../edit/helpers'
import { fixtureModelFiles, fixtureRoot } from '../model/fixture'
import { fixtureSkip } from './fixture-install'

/**
 * Simple data S7 / P2 (verify B1–B4): every API source the `api_*` edits accept generates an app that typechecks, lints and passes
 * its generated unit tests (the edits run the generator, so a model it can build must also be valid code). Same harness as
 * new-items-compile.
 */
const fixtureModules = join(fixtureRoot, 'node_modules')
const bin = (name: string) => join(fixtureModules, '.bin', name)
// Without the install the suite skips, loudly (a console.warn, once); in CI it runs and fails if the install is missing.
const NEEDS_FIXTURE = fixtureSkip({ installed: existsSync(bin('nuxi')), ci: !!process.env.CI })

const run = promisify(execFile)
const hash = (content: string) => createHash('sha256').update(content).digest('hex')

/** A model being edited the way the editor does it. */
class Session {
  files = fixtureModelFiles()

  /** What the last edit answered (a created page's `pageId` and `nodeId`). */
  result: Record<string, unknown> = {}

  /** An edit that must succeed. */
  edit(name: EditName, input: unknown) {
    const outcome = applyEdit(this.files, name, input)
    expect(outcome.ok, `${name} ${JSON.stringify(input)}: ${JSON.stringify(outcome)}`).toBe(true)
    if (outcome.ok) {
      this.files = applyChanges(this.files, outcome.changes)
      this.result = outcome.result as Record<string, unknown>
    }
    return this
  }

  /** An edit a fix may refuse (the name is not one the generated code can take); when it is accepted, the app must still build. */
  maybe(name: EditName, input: unknown) {
    const outcome = applyEdit(this.files, name, input)
    if (outcome.ok) this.files = applyChanges(this.files, outcome.changes)
    return this
  }
}

/** The golden blog's files, copied without what the install and the tools make. */
const copyBlog = (to: string) => cpSync(fixtureRoot, to, {
  recursive: true,
  filter: source => !/\/(node_modules|\.nuxt|\.output|\.data|\.bildr)$/.test(source)
})

/** Writes what a sync writes and deletes over the golden blog's files for `files`. */
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

const ITEM = { name: 'Item', fields: [{ name: 'id', type: 'integer' }] }
const items = (name: string, model = 'Item') => ({ name, path: `/${name}`, params: [], result: { model, many: true } })

const GROUPS: Array<[string, (session: Session) => void]> = [
  ['an API source with no auth, and one whose secret is not apiKey', (session) => {
    session.edit('api_create', { name: 'open', baseUrl: 'https://open.example.com' })
    session.edit('api_model_set', { datasource: 'ds_open', model: ITEM })
    session.edit('api_query_set', { datasource: 'ds_open', query: items('items') })
    session.edit('api_create', { name: 'tok', baseUrl: 'https://tok.example.com', auth: { type: 'bearer', secret: 'token' } })
    session.edit('api_model_set', { datasource: 'ds_tok', model: ITEM })
    session.edit('api_query_set', { datasource: 'ds_tok', query: items('items') })
  }],
  ['reserved words as query, action and secret names', (session) => {
    session.maybe('api_create', { name: 'shop', baseUrl: 'https://shop.example.com', auth: { type: 'bearer', secret: 'class' } })
    session.maybe('api_model_set', { datasource: 'ds_shop', model: ITEM })
    session.maybe('api_query_set', { datasource: 'ds_shop', query: items('delete') })
    session.maybe('api_query_set', { datasource: 'ds_shop', query: items('constructor') })
    session.maybe('api_action_set', { datasource: 'ds_shop', action: { name: 'new', method: 'POST', path: '/new', params: [] } })
  }],
  ['names the generated files import or declare', (session) => {
    session.maybe('api_create', { name: 'shop', baseUrl: 'https://shop.example.com', auth: { type: 'bearer', secret: 'headers' } })
    session.maybe('api_model_set', { datasource: 'ds_shop', model: ITEM })
    session.maybe('api_model_set', { datasource: 'ds_shop', model: { name: 'Result', fields: [{ name: 'id', type: 'integer' }] } })
    for (const name of ['remoteFailed', 'useRuntimeConfig', 'httpShopRepository', 'fakeShopRepository']) session.maybe('api_query_set', { datasource: 'ds_shop', query: items(name) })
    session.maybe('api_query_set', { datasource: 'ds_shop', query: { ...items('invalidInput'), params: [{ name: 'q', in: 'query', type: 'text' }] } })
    session.maybe('api_query_set', { datasource: 'ds_shop', query: items('results', 'Result') })
    session.maybe('api_create', { name: 'cl', baseUrl: 'https://cl.example.com', auth: { type: 'bearer', secret: 'call' } })
    session.maybe('api_model_set', { datasource: 'ds_cl', model: ITEM })
    session.maybe('api_query_set', { datasource: 'ds_cl', query: items('items') })
  }],
  ['an API source named app', (session) => {
    session.maybe('api_create', { name: 'app', baseUrl: 'https://app.example.com' })
    session.maybe('api_model_set', { datasource: 'ds_app', model: ITEM })
    session.maybe('api_query_set', { datasource: 'ds_app', query: items('items') })
  }],
  ['a text path parameter, a datetime sent back, and fields named like reserved words', (session) => {
    session.edit('api_create', { name: 'blog', baseUrl: 'https://blog.example.com/v1', auth: { type: 'header', secret: 'token', header: 'X-Token' } })
    session.edit('api_model_set', { datasource: 'ds_blog', model: { name: 'Post', fields: [{ name: 'id', type: 'text' }, { name: 'at', type: 'datetime' }, { name: 'delete', type: 'boolean', optional: true }, { name: 'class', type: 'text', key: 'class-name' }] } })
    session.edit('api_query_set', { datasource: 'ds_blog', query: { name: 'post', path: '/posts/:id/reviews/:review', params: [{ name: 'id', in: 'path', type: 'text' }, { name: 'review', in: 'path', type: 'text' }], result: { model: 'Post', many: false } } })
    session.edit('api_action_set', { datasource: 'ds_blog', action: { name: 'savePost', method: 'PUT', path: '/posts/:id', params: [{ name: 'id', in: 'path', type: 'text' }], body: { model: 'Post' }, result: { model: 'Post', many: false } } })
  }],
  // P3: the browser runtime: composables over a browser client and the use-case, no route, no auth, no root.
  ['a server API source whose only operation answers nothing (no reporter, nothing thrown by its repository)', (session) => {
    session.edit('api_create', { name: 'tick', baseUrl: 'https://tick.example.com' })
    session.edit('api_action_set', { datasource: 'ds_tick', action: { name: 'pulse', method: 'POST', path: '/pulse', params: [] } })
  }],
  ['a browser API source: path and query parameters, a body, no result, a dashed name', (session) => {
    session.edit('api_create', { name: 'open-data', baseUrl: 'https://open.example.com/v1', runtime: 'browser' })
    session.edit('api_model_set', { datasource: 'ds_open_data', model: { name: 'Tag', fields: [{ name: 'label', type: 'text' }] } })
    session.edit('api_model_set', { datasource: 'ds_open_data', model: { name: 'Entry', fields: [{ name: 'id', type: 'text' }, { name: 'at', type: 'datetime', key: 'created-at' }, { name: 'score', type: 'number', optional: true }, { name: 'note', type: 'text', nullable: true }, { name: 'tags', type: 'model', model: 'Tag', list: true }] } })
    session.edit('api_query_set', { datasource: 'ds_open_data', query: { name: 'entries', path: '/entries', params: [{ name: 'tag', in: 'query', type: 'text' }, { name: 'page', in: 'query', type: 'integer', required: true }], result: { model: 'Entry', many: true, itemsPath: 'data.items' } } })
    session.edit('api_query_set', { datasource: 'ds_open_data', query: { name: 'entry', path: '/entries/:id', params: [{ name: 'id', in: 'path', type: 'text' }], result: { model: 'Entry', many: false } } })
    session.edit('api_query_set', { datasource: 'ds_open_data', query: items('everything', 'Entry') })
    session.edit('api_action_set', { datasource: 'ds_open_data', action: { name: 'saveEntry', method: 'PUT', path: '/entries/:id', params: [{ name: 'id', in: 'path', type: 'text' }], body: { model: 'Entry' }, result: { model: 'Entry', many: false } } })
    session.edit('api_action_set', { datasource: 'ds_open_data', action: { name: 'removeEntry', method: 'DELETE', path: '/entries/:id', params: [{ name: 'id', in: 'path', type: 'text' }] } })
    session.edit('api_action_set', { datasource: 'ds_open_data', action: { name: 'ping', method: 'POST', path: '/ping', params: [] } })
    // A source whose operations answer nothing: its repository has no reporter for an invalid answer to give.
    session.edit('api_create', { name: 'beat', baseUrl: 'https://beat.example.com', runtime: 'browser' })
    session.edit('api_action_set', { datasource: 'ds_beat', action: { name: 'pulse', method: 'POST', path: '/pulse', params: [] } })
  }],
  // P7a: pages that use API queries: the call with its args, the list keyed by id or by position, a one result, the error line.
  ['pages that use API queries: lists keyed by id and by position, a one result, args from the route and literals', (session) => {
    session.edit('api_create', { name: 'shop', baseUrl: 'https://shop.example.com/v1' })
    session.edit('api_model_set', { datasource: 'ds_shop', model: { name: 'Person', fields: [{ name: 'name', type: 'text' }] } })
    session.edit('api_model_set', { datasource: 'ds_shop', model: { name: 'Item', fields: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'text' }, { name: 'owner', type: 'model', model: 'Person', optional: true }, { name: 'tags', type: 'text', list: true }] } })
    session.edit('api_model_set', { datasource: 'ds_shop', model: { name: 'Note', fields: [{ name: 'text', type: 'text' }] } })
    session.edit('api_query_set', { datasource: 'ds_shop', query: { name: 'items', path: '/items', params: [{ name: 'category', in: 'query', type: 'text', required: true }, { name: 'page', in: 'query', type: 'integer' }], result: { model: 'Item', many: true } } })
    session.edit('api_query_set', { datasource: 'ds_shop', query: { name: 'item', path: '/items/:id', params: [{ name: 'id', in: 'path', type: 'integer' }], result: { model: 'Item', many: false } } })
    session.edit('api_query_set', { datasource: 'ds_shop', query: items('notes', 'Note') })
    // A list by id, from a route parameter and a literal; a row's handler takes the row typed from the data.
    session.edit('page_create', { name: 'shop-items', path: '/shop/:category', layout: 'lay_main' })
    const listing = session.result.pageId as string
    session.edit('page_use_add', { page: listing, as: 'found', api: { datasource: 'ds_shop', query: 'items' }, args: { category: { $route: 'category' }, page: 2 } })
    session.edit('node_insert', {
      file: listing,
      type: 'List',
      props: { items: { $bind: 'found' }, as: 'row', loading: 'Loading…', empty: 'Nothing here.' },
      children: [
        { type: 'Text', props: { text: { $template: '{row.name} by {row.owner.name}, {row.tags.length} tags' } } },
        { type: 'Button', props: { text: 'Open' }, interactions: [{ on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: { $bind: 'row.name' } } } }] }] }
      ]
    })
    // A one result: a guarded Page, read with optional chaining.
    session.edit('page_create', { name: 'shop-item', path: '/shop-item', layout: 'lay_main' })
    const detail = session.result.pageId as string
    const root = session.result.nodeId as string
    session.edit('page_use_add', { page: detail, as: 'first', api: { datasource: 'ds_shop', query: 'item' }, args: { id: 1 } })
    session.edit('node_update_props', { file: detail, nodeId: root, props: { when: { $bind: 'first' }, loading: 'Loading…', empty: 'No item.' } })
    session.edit('node_insert', { file: detail, parentId: root, type: 'Heading', props: { text: { $bind: 'first.name' } } })
    session.edit('node_insert', { file: detail, parentId: root, type: 'Text', props: { text: { $template: 'Owner {first.owner.name}' } } })
    // Rows with no id are keyed by their position; the list's length is bound too.
    session.edit('page_create', { name: 'shop-notes', path: '/shop-notes' })
    const notes = session.result.pageId as string
    session.edit('page_use_add', { page: notes, as: 'notes', api: { datasource: 'ds_shop', query: 'notes' } })
    session.edit('node_insert', { file: notes, type: 'Heading', props: { text: { $template: '{notes.length} notes' } } })
    session.edit('node_insert', { file: notes, type: 'List', props: { items: { $bind: 'notes' }, as: 'note', hideWhenEmpty: true }, children: [{ type: 'Text', props: { text: { $template: '{note.text}' } } }] })
  }],
  // Verify P7a B1: args bound to another API answer (undefined until it answers), to the use's own answer, or to a value of another type:
  // the edits refuse them, or the app still builds.
  ['an API use whose args read another API answer, itself and a state', (session) => {
    session.edit('api_create', { name: 'chain', baseUrl: 'https://chain.example.com' })
    session.edit('api_model_set', { datasource: 'ds_chain', model: { name: 'Item', fields: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'text' }] } })
    session.edit('api_query_set', { datasource: 'ds_chain', query: { name: 'item', path: '/items/:id', params: [{ name: 'id', in: 'path', type: 'integer' }], result: { model: 'Item', many: false } } })
    session.edit('api_query_set', { datasource: 'ds_chain', query: { name: 'items', path: '/items', params: [{ name: 'category', in: 'query', type: 'text', required: true }, { name: 'page', in: 'query', type: 'integer' }], result: { model: 'Item', many: true } } })
    session.edit('page_create', { name: 'chain', path: '/chain' })
    const page = session.result.pageId as string
    session.edit('page_use_add', { page, as: 'prefs', state: 'st_preferences' })
    session.edit('page_use_add', { page, as: 'first', api: { datasource: 'ds_chain', query: 'item' }, args: { id: 1 } })
    session.maybe('page_use_add', { page, as: 'second', api: { datasource: 'ds_chain', query: 'item' }, args: { id: { $bind: 'first.id' } } })
    session.maybe('node_insert', { file: page, type: 'Heading', props: { text: { $bind: 'second.name' } } })
    session.maybe('page_use_add', { page, as: 'me', api: { datasource: 'ds_chain', query: 'item' }, args: { id: { $bind: 'me.id' } } })
    session.maybe('node_insert', { file: page, type: 'Heading', props: { text: { $bind: 'me.name' } } })
    session.maybe('page_use_add', { page, as: 'found', api: { datasource: 'ds_chain', query: 'items' }, args: { category: { $bind: 'prefs.showDrafts' }, page: { $bind: 'first.name' } } })
    session.maybe('node_insert', { file: page, type: 'Heading', props: { text: { $template: '{found.length}' } } })
  }],
  ['a list under keys that are not identifiers', (session) => {
    session.edit('api_create', { name: 'hydra', baseUrl: 'https://hydra.example.com' })
    session.edit('api_model_set', { datasource: 'ds_hydra', model: ITEM })
    session.edit('api_query_set', { datasource: 'ds_hydra', query: { ...items('members'), result: { model: 'Item', many: true, itemsPath: 'hydra:member' } } })
    session.edit('api_query_set', { datasource: 'ds_hydra', query: { ...items('graph'), result: { model: 'Item', many: true, itemsPath: 'data.item-list' } } })
  }]
]

describe.skipIf(!!NEEDS_FIXTURE)(`API sources the edits accept: typecheck, lint and generated tests${NEEDS_FIXTURE}`, { timeout: 600_000 }, () => {
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'bildr-api-sources-compile-'))
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
