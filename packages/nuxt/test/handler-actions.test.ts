import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { updateHealth } from '../src/node/health'
import type { CheckName, CheckResult } from '../src/node/health'
import { PENDING_FILE } from '../src/node/migrations'
import { sha256 } from '../src/node/sync'
import { createBildrHandler } from '../src/server/handler'

const TOKEN = 'a'.repeat(48)
const pagePath = '.bildr/modules/main/pages/index.json'
const pageVue = 'layers/main/app/pages/index.vue'
let root: string
let dir: string
let asked: CheckName[][]
let confirmed: string[]
let handle: ReturnType<typeof createBildrHandler>

const checkResult = (name: CheckName): CheckResult => ({ name, ok: true, startedAt: '2026-11-13T10:00:00.000Z', durationMs: 5, summary: 'fine', findings: [] })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-handler-actions-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App' })
  asked = []
  confirmed = []
  handle = createBildrHandler({
    root: dir,
    token: TOKEN,
    runHealth: async (checks) => {
      asked.push(checks)
      return checks.map(checkResult)
    },
    confirmMigration: async (hash) => {
      confirmed.push(hash)
      return { kind: 'written', tag: '0001_bildr', statements: ['ALTER TABLE `t` DROP COLUMN `c`;'] }
    }
  })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

type Init = RequestInit & { token?: string | false, origin?: string }
const request = (path: string, init: Init = {}, target = handle) => {
  const { token = TOKEN, origin = 'http://localhost:3000', ...rest } = init
  const headers = new Headers(rest.headers)
  headers.set('host', 'localhost:3000')
  headers.set('origin', origin)
  if (token) headers.set('x-bildr-token', token)
  return target(new Request(`http://localhost:3000${path}`, { ...rest, headers }), { remoteAddress: '127.0.0.1' })
}
const act = (name: string, body: unknown = {}, init: Init = {}, target = handle) =>
  request(`/__bildr/api/actions/${name}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' }, ...init }, target)
const result = async (response: Response) => {
  const body = await response.json() as { ok: boolean, result?: unknown, code?: string }
  expect(body.ok, JSON.stringify(body)).toBe(true)
  return body.result as Record<string, unknown>
}
const failure = async (response: Response, status: number, code: string) => {
  expect(response.status).toBe(status)
  const body = await response.json() as { ok: boolean, code: string, message: string, problems?: unknown }
  expect(body.ok).toBe(false)
  expect(body.code).toBe(code)
  expect(body.message).toEqual(expect.any(String))
  return body
}
const page = () => JSON.parse(readFileSync(join(dir, pagePath), 'utf8')) as Record<string, unknown> & { seo: { title: string }, layout: string }

const NAMES = [
  'code_view', 'health_get', 'health_run', 'migration_confirm', 'migration_pending_get', 'model_file_delete', 'model_file_put', 'model_get',
  // P3a: the visual editing operations.
  'node_insert', 'node_update_props', 'node_update_style', 'node_rename', 'node_set_locked', 'node_move', 'node_move_many', 'node_delete', 'node_duplicate', 'node_wrap',
  'page_create', 'page_update', 'page_delete',
  'component_create', 'component_rename', 'component_duplicate', 'component_delete', 'component_property_add', 'component_property_update', 'component_property_remove',
  'component_variant_add', 'component_variant_rename', 'component_variant_delete', 'component_variant_set_override', 'component_state_add',
  'component_interaction_add', 'component_interaction_update', 'component_interaction_remove', 'component_transition_set',
  'instance_set_values', 'instance_set_slot', 'instance_detach', 'instance_replace',
  'layout_create', 'layout_create_from_selection', 'layout_rename', 'layout_duplicate', 'layout_delete', 'layout_slot_add', 'layout_slot_update', 'layout_slot_remove',
  'layout_variable_add', 'layout_variable_update', 'layout_variable_remove', 'page_set_layout', 'page_set_layout_values', 'page_set_slot',
  'theme_get', 'theme_update', 'theme_presets_list', 'theme_apply', 'project_update', 'catalog_get',
  'editor_context_get', 'editor_context_set', 'editor_navigate',
  // P3b: undo/redo and the model version.
  'history_get', 'history_undo', 'history_redo', 'model_version_get',
  // P3c: data sources, entities and fields; previews and env status.
  'datasource_create', 'datasource_update', 'datasource_delete', 'entity_create', 'entity_update', 'entity_delete',
  'entity_field_add', 'entity_field_update', 'entity_field_move', 'entity_field_remove',
  'datasource_preview', 'repository_endpoint_test', 'env_status',
  // P5: a list's query and what a page uses.
  'query_create_for_list', 'query_update', 'page_use_add', 'page_use_update', 'page_use_remove',
  // D10a: queries and actions of their own.
  'query_create', 'query_rename', 'query_delete', 'action_create', 'action_update', 'action_rename', 'action_delete',
  // D4: sample-data rows.
  'fixture_row_create', 'fixture_row_update', 'fixture_rows_delete',
  // B1: app behaviour: state, interactions on any node, computed values.
  'state_create', 'state_update', 'state_rename', 'state_delete',
  'node_interaction_add', 'node_interaction_update', 'node_interaction_remove',
  'page_computed_set', 'page_computed_remove',
  // Simple data P1: API data sources.
  'api_create', 'api_update', 'api_model_set', 'api_model_rename', 'api_model_delete',
  'api_query_set', 'api_query_rename', 'api_query_delete', 'api_action_set', 'api_action_rename', 'api_action_delete',
  // Simple data P4: try a call of an API data source and propose its models.
  'api_try'
].sort()

// T10a (S11, D12): every editor operation is an action, callable over HTTP.
describe('action list', () => {
  it('lists every action with its description, read-only flag and JSON schema', async () => {
    const response = await request('/__bildr/api/actions')
    expect(response.status).toBe(200)
    const list = await response.json() as { name: string, description: string, readOnly: boolean, inputSchema: { type: string } }[]
    expect(list.map(action => action.name).sort()).toEqual(NAMES)
    for (const action of list) {
      expect(action.description.length, action.name).toBeGreaterThan(10)
      expect(typeof action.readOnly).toBe('boolean')
      expect(action.inputSchema.type, action.name).toBe('object')
    }
    const byName = Object.fromEntries(list.map(action => [action.name, action]))
    expect(byName.model_get!.readOnly).toBe(true)
    expect(byName.code_view!.readOnly).toBe(true)
    expect(byName.model_file_put!.readOnly).toBe(false)
    expect(byName.migration_confirm!.readOnly).toBe(false)
    // A confirmed api_try sends writes to the remote API: never advertised read-only to MCP clients (verify P4).
    expect(byName.api_try!.readOnly).toBe(false)
    expect(byName.model_file_put!.inputSchema).toMatchObject({ properties: { path: { type: 'string' } }, required: ['path', 'content'] })
  })

  // D10a: additive contracts, each with a description and an input schema that says what it takes.
  it('lists the queries and actions of their own with the input each takes', async () => {
    const list = await (await request('/__bildr/api/actions')).json() as { name: string, description: string, readOnly: boolean, inputSchema: { required?: string[], properties: Record<string, { enum?: string[], type?: string }> } }[]
    const byName = Object.fromEntries(list.map(action => [action.name, action]))
    expect(byName.query_create!.inputSchema.required).toEqual(['entity', 'result', 'name'])
    expect(byName.query_create!.inputSchema.properties.result!.enum).toEqual(['one', 'many'])
    expect(byName.query_rename!.inputSchema.required).toEqual(['query', 'name'])
    expect(byName.query_delete!.inputSchema.required).toEqual(['query'])
    expect(byName.action_create!.inputSchema.required).toEqual(['entity', 'template', 'name'])
    expect(byName.action_create!.inputSchema.properties.template!.enum).toEqual(['create', 'update', 'delete', 'blank'])
    expect(byName.action_update!.inputSchema.required).toEqual(['action'])
    expect(Object.keys(byName.action_update!.inputSchema.properties)).toEqual(['action', 'label', 'description', 'input', 'steps', 'http', 'errors', 'client'])
    expect(byName.action_rename!.inputSchema.required).toEqual(['action', 'name'])
    expect(byName.action_delete!.inputSchema.required).toEqual(['action'])
    expect(Object.keys(byName.query_update!.inputSchema.properties)).toEqual(expect.arrayContaining(['inPlace', 'result', 'params', 'description']))
    for (const name of ['query_create', 'query_rename', 'query_delete', 'action_create', 'action_update', 'action_rename', 'action_delete']) expect(byName[name]!.readOnly, name).toBe(false)
  })
})

describe('action calls', () => {
  it('need the session token and a same-origin request', async () => {
    expect((await request('/__bildr/api/actions', { token: false })).status).toBe(401)
    expect((await act('model_get', {}, { token: false })).status).toBe(401)
    expect((await act('model_get', {}, { origin: 'http://evil.example' })).status).toBe(403)
    expect((await act('health_run', { checks: ['lint'] }, { origin: 'http://evil.example' })).status).toBe(403)
    expect(asked).toEqual([])
  })

  it('refuses a NUL in a model path with 4xx, never 500 (verification B1)', async () => {
    for (const name of ['model_file_delete', 'model_file_put', 'code_view']) {
      for (const bad of ['\u0000', '\u007f', '\\']) {
        const response = await act(name, { path: `.bildr/datasources/x${bad}.json`, content: {} })
        expect(response.status, `${name} ${JSON.stringify(bad)}`).toBeGreaterThanOrEqual(400)
        expect(response.status, `${name} ${JSON.stringify(bad)}`).toBeLessThan(500)
      }
    }
  })

  it('answer unknown actions, bad JSON, non-JSON bodies and bad input with error codes', async () => {
    await failure(await act('nope'), 404, 'not_found')
    await failure(await act('model_get', '{ not json'), 400, 'invalid_input')
    expect((await act('model_get', {}, { headers: { 'content-type': 'text/plain' } })).status).toBe(415)
    await failure(await act('model_file_put', { path: 1, content: {} }), 400, 'invalid_input')
    await failure(await act('model_file_put', { path: pagePath }), 400, 'invalid_input')
  })

  it('limit the body size', async () => {
    expect((await act('model_get', { x: 'x'.repeat(3_000_000) })).status).toBe(413)
  })
})

describe('model_get', () => {
  it('returns the model and its files as JSON, without the manifest', async () => {
    const got = await result(await act('model_get'))
    expect(got.ok).toBe(true)
    expect((got.model as { project: { name: string } }).project.name).toBe('App')
    const files = got.files as Record<string, unknown>
    expect(files[pagePath]).toEqual(page())
    expect(Object.keys(files)).toContain('.bildr/bildr.json')
    expect(Object.keys(files)).not.toContain('.bildr/manifest.json')
  })

  it('says whether the project has a database (a sqlite data source)', async () => {
    expect((await result(await act('model_get'))).database).toBe(true)
    rmSync(join(dir, '.bildr/datasources/main.json'))
    expect((await result(await act('model_get'))).database).toBe(false)
  })

  it('returns the problems of an invalid model', async () => {
    writeFileSync(join(dir, pagePath), JSON.stringify({ ...page(), layout: 'lay_nope' }))
    const got = await result(await act('model_get'))
    expect(got.ok).toBe(false)
    expect(got.problems).toEqual([{ path: pagePath, message: 'layout: Unknown layout "lay_nope"' }])
    expect(got.model).toBeUndefined()
  })

  it('lists a file that is not valid JSON too, with its text, so it can be opened and fixed', async () => {
    const about = '.bildr/modules/main/pages/about.json'
    writeFileSync(join(dir, about), '{ "id": ')
    const got = await result(await act('model_get'))
    expect(got.ok).toBe(false)
    expect(got.invalid).toEqual({ [about]: '{ "id": ' })
    expect(Object.keys(got.files as Record<string, unknown>)).not.toContain(about)
    expect(got.problems).toEqual([{ path: about, message: expect.stringMatching(/^Invalid JSON/) }])
  })

  it('has no invalid files when every file parses', async () => {
    expect((await result(await act('model_get'))).invalid).toEqual({})
  })
})

describe('model_file_put', () => {
  it('writes the file canonically when the model stays valid', async () => {
    const changed = page()
    changed.seo.title = 'Changed'
    const got = await result(await act('model_file_put', { path: pagePath, content: changed }))
    const text = readFileSync(join(dir, pagePath), 'utf8')
    expect(JSON.parse(text).seo.title).toBe('Changed')
    expect(text).toMatch(/^\{\n {2}"id": "pg_index",/)
    expect(got).toEqual({ sha256: sha256(text) })
  })

  it('refuses a change that breaks the model, with the problems', async () => {
    const body = await failure(await act('model_file_put', { path: pagePath, content: { ...page(), layout: 'lay_nope' } }), 422, 'invalid')
    expect(body.problems).toEqual([{ path: pagePath, message: 'layout: Unknown layout "lay_nope"' }])
    expect(page().layout).toBe('lay_main')
  })

  it('refuses the fix of one of two broken files, names the other file\'s problem, and writes nothing', async () => {
    const about = '.bildr/modules/main/pages/about.json'
    const contact = '.bildr/modules/main/pages/contact.json'
    const broken = (name: string) => ({ ...page(), id: `pg_${name}`, name, path: `/${name}`, layout: 'lay_nope' })
    writeFileSync(join(dir, about), JSON.stringify(broken('about')))
    writeFileSync(join(dir, contact), JSON.stringify(broken('contact')))
    const body = await failure(await act('model_file_put', { path: about, content: { ...broken('about'), layout: 'lay_main' } }), 422, 'invalid')
    expect(body.problems).toEqual([{ path: contact, message: 'layout: Unknown layout "lay_nope"' }])
    expect(JSON.parse(readFileSync(join(dir, about), 'utf8')).layout).toBe('lay_nope')
  })

  describe('with a base (the file the edit started from)', () => {
    it('writes when the file is still the base, and when no base is given', async () => {
      const changed = page()
      changed.seo.title = 'Mine'
      await result(await act('model_file_put', { path: pagePath, content: changed, base: page() }))
      expect(page().seo.title).toBe('Mine')
      changed.seo.title = 'Again'
      await result(await act('model_file_put', { path: pagePath, content: changed }))
      expect(page().seo.title).toBe('Again')
    })

    it('refuses to overwrite a file that changed since, with a clear message, and writes nothing', async () => {
      const opened = page()
      const external = { ...page(), seo: { title: 'Someone else' } }
      writeFileSync(join(dir, pagePath), JSON.stringify(external))
      const mine = { ...opened, seo: { title: 'Mine' } }
      const body = await failure(await act('model_file_put', { path: pagePath, content: mine, base: opened }), 409, 'conflict')
      expect(body.message).toBe(`${pagePath} changed since it was opened, so it was not saved`)
      expect(page().seo.title).toBe('Someone else')
    })

    it('refuses a file that was removed or that appeared since', async () => {
      const about = '.bildr/modules/main/pages/about.json'
      await failure(await act('model_file_put', { path: pagePath, content: page(), base: null }), 409, 'conflict')
      await failure(await act('model_file_put', { path: about, content: { ...page(), id: 'pg_about', name: 'about', path: '/about' }, base: page() }), 409, 'conflict')
      expect(existsSync(join(dir, about))).toBe(false)
      await result(await act('model_file_put', { path: about, content: { ...page(), id: 'pg_about', name: 'about', path: '/about' }, base: null }))
      expect(existsSync(join(dir, about))).toBe(true)
    })

    it('takes the text of a file that was not valid JSON as its base', async () => {
      const about = '.bildr/modules/main/pages/about.json'
      writeFileSync(join(dir, about), '{ "id": ')
      const fixed = { ...page(), id: 'pg_about', name: 'about', path: '/about' }
      await failure(await act('model_file_put', { path: about, content: fixed, base: '{ "id": "x"' }), 409, 'conflict')
      await result(await act('model_file_put', { path: about, content: fixed, base: '{ "id": ' }))
      expect(JSON.parse(readFileSync(join(dir, about), 'utf8')).id).toBe('pg_about')
    })
  })

  it('only writes model files', async () => {
    for (const path of ['.bildr/manifest.json', '.bildr/.cache/health.json', 'nuxt.config.ts', '../x.json', '.bildr/../package.json', '.bildr/modules/main/notes/x.json', '.bildr/modules/../entities/quote.json']) {
      await failure(await act('model_file_put', { path, content: {} }), 403, 'forbidden')
    }
    expect(existsSync(join(root, 'x.json'))).toBe(false)
  })

  it('never writes through a symlinked folder that points outside the project', async () => {
    mkdirSync(join(root, 'outside'))
    symlinkSync(join(root, 'outside'), join(dir, '.bildr/modules/main/entities'))
    const entity = JSON.parse(readFileSync(join(__dirname, '../../../fixtures/codegen/blog/.bildr/modules/blog/entities/quote.json'), 'utf8'))
    await failure(await act('model_file_put', { path: '.bildr/modules/main/entities/quote.json', content: entity }), 403, 'forbidden')
    expect(existsSync(join(root, 'outside/quote.json'))).toBe(false)
  })
})

describe('model_file_delete', () => {
  it('deletes an artifact file when the rest of the model stays valid', async () => {
    const about = '.bildr/modules/main/pages/about.json'
    await result(await act('model_file_put', { path: about, content: { ...page(), id: 'pg_about', name: 'about', path: '/about' } }))
    expect(await result(await act('model_file_delete', { path: about }))).toEqual({})
    expect(existsSync(join(dir, about))).toBe(false)
  })

  it('refuses to delete a page the layout links to', async () => {
    const body = await failure(await act('model_file_delete', { path: pagePath }), 422, 'invalid')
    expect(body.problems).toEqual([{ path: '.bildr/layouts/main.json', message: expect.stringMatching(/Unknown page "pg_index"$/) }])
    expect(existsSync(join(dir, pagePath))).toBe(true)
  })

  it('refuses when the rest of the model would break, with the problems', async () => {
    const body = await failure(await act('model_file_delete', { path: '.bildr/layouts/main.json' }), 422, 'invalid')
    expect(body.problems).toEqual([{ path: pagePath, message: 'layout: Unknown layout "lay_main"' }])
    expect(existsSync(join(dir, '.bildr/layouts/main.json'))).toBe(true)
  })

  it('refuses to delete a broken file while another is broken, names the other\'s problems, and keeps the file', async () => {
    const about = '.bildr/modules/main/pages/about.json'
    const contact = '.bildr/modules/main/pages/contact.json'
    writeFileSync(join(dir, about), '{ "id": ')
    writeFileSync(join(dir, contact), JSON.stringify({ ...page(), id: 'pg_contact', name: 'contact', path: '/contact', layout: 'lay_nope' }))
    const body = await failure(await act('model_file_delete', { path: about }), 422, 'invalid')
    expect(body.problems).toEqual([{ path: contact, message: 'layout: Unknown layout "lay_nope"' }])
    expect(existsSync(join(dir, about))).toBe(true)
  })

  it('never deletes the project, theme, manifest or module file, or anything outside the model', async () => {
    for (const path of ['.bildr/bildr.json', '.bildr/theme.json', '.bildr/manifest.json', '.bildr/modules/main/module.json', 'package.json', '.bildr/.cache/health.json', '.bildr/modules/main/pages/../module.json']) {
      await failure(await act('model_file_delete', { path }), 403, 'forbidden')
    }
    for (const path of ['.bildr/bildr.json', '.bildr/theme.json', '.bildr/manifest.json', '.bildr/modules/main/module.json', 'package.json']) {
      expect(existsSync(join(dir, path)), path).toBe(true)
    }
  })

  it('answers not_found for a missing file', async () => {
    await failure(await act('model_file_delete', { path: '.bildr/modules/main/pages/nope.json' }), 404, 'not_found')
  })

  it('never deletes through a symlink', async () => {
    mkdirSync(join(root, 'outside'))
    writeFileSync(join(root, 'outside/quote.json'), '{}')
    symlinkSync(join(root, 'outside'), join(dir, '.bildr/modules/main/entities'))
    await failure(await act('model_file_delete', { path: '.bildr/modules/main/entities/quote.json' }), 403, 'forbidden')
    symlinkSync(join(root, 'outside/quote.json'), join(dir, '.bildr/modules/main/pages/about.json'))
    await failure(await act('model_file_delete', { path: '.bildr/modules/main/pages/about.json' }), 403, 'forbidden')
    expect(existsSync(join(root, 'outside/quote.json'))).toBe(true)
  })
})

describe('code_view', () => {
  it('lists the generated files of a model file with their state and content', async () => {
    const got = await result(await act('code_view', { path: pagePath }))
    expect(got).toEqual({ files: [{ path: pageVue, state: 'managed', content: readFileSync(join(dir, pageVue), 'utf8') }] })
  })

  it('takes the state and diff from the Health drift', async () => {
    writeFileSync(join(dir, pageVue), 'mine\n')
    updateHealth(dir, { drift: { files: [{ path: pageVue, state: 'detached', diff: '--- a\n+++ b\n' }], missingManifest: false } })
    const got = await result(await act('code_view', { path: pagePath }))
    expect(got).toEqual({ files: [{ path: pageVue, state: 'detached', content: 'mine\n', diff: '--- a\n+++ b\n' }] })
  })

  it('never reads a generated path that resolves outside the project', async () => {
    writeFileSync(join(root, 'secret.txt'), 'secret')
    rmSync(join(dir, pageVue))
    symlinkSync(join(root, 'secret.txt'), join(dir, pageVue))
    const got = await result(await act('code_view', { path: pagePath }))
    expect(got).toEqual({ files: [{ path: pageVue, state: 'managed', content: null }] })
  })

  it('refuses paths that are not model files, and model files that do not exist', async () => {
    await failure(await act('code_view', { path: 'nuxt.config.ts' }), 400, 'invalid_input')
    await failure(await act('code_view', { path: '.bildr/modules/main/pages/nope.json' }), 404, 'not_found')
  })
})

describe('health actions', () => {
  it('health_get returns the stored report', async () => {
    expect(await result(await act('health_get'))).toEqual({ updatedAt: '', checks: {} })
    const stored = updateHealth(dir, { migration: null, checks: { lint: checkResult('lint') } })
    expect(await result(await act('health_get'))).toEqual(stored)
  })

  it('health_run runs the requested checks through the module', async () => {
    expect(await result(await act('health_run', { checks: ['lint', 'types'] }))).toEqual({ results: [checkResult('lint'), checkResult('types')] })
    expect(asked).toEqual([['lint', 'types']])
  })

  it('health_run refuses empty, unknown or repeated checks', async () => {
    for (const checks of [[], ['format'], ['lint', 'lint'], 'lint']) await failure(await act('health_run', { checks }), 400, 'invalid_input')
    expect(asked).toEqual([])
  })

  it('health_run is unavailable without a check runner', async () => {
    await failure(await act('health_run', { checks: ['lint'] }, {}, createBildrHandler({ root: dir, token: TOKEN })), 501, 'unavailable')
  })
})

describe('migration actions', () => {
  it('migration_pending_get returns the pending plan or null', async () => {
    expect(await result(await act('migration_pending_get'))).toEqual({ pending: null, database: true })
    const plan = { hash: 'h1', destructive: ['DROP TABLE `t`;'], statements: ['DROP TABLE `t`;'] }
    mkdirSync(join(dir, '.bildr/.cache'), { recursive: true })
    writeFileSync(join(dir, PENDING_FILE), JSON.stringify(plan))
    expect(await result(await act('migration_pending_get'))).toEqual({ pending: plan, database: true })
  })

  it('migration_pending_get returns none without a database, even with a stale plan', async () => {
    mkdirSync(join(dir, '.bildr/.cache'), { recursive: true })
    writeFileSync(join(dir, PENDING_FILE), JSON.stringify({ hash: 'h1', destructive: [], statements: [] }))
    rmSync(join(dir, '.bildr/datasources/main.json'))
    expect(await result(await act('migration_pending_get'))).toEqual({ pending: null, database: false })
  })

  it('migration_confirm confirms by hash through the module', async () => {
    expect(await result(await act('migration_confirm', { hash: 'h1' }))).toEqual({ migration: { kind: 'written', tag: '0001_bildr', statements: ['ALTER TABLE `t` DROP COLUMN `c`;'] } })
    expect(confirmed).toEqual(['h1'])
  })

  it('migration_confirm needs a hash and a regenerator', async () => {
    await failure(await act('migration_confirm', {}), 400, 'invalid_input')
    await failure(await act('migration_confirm', { hash: '' }), 400, 'invalid_input')
    await failure(await act('migration_confirm', { hash: 'h1' }, {}, createBildrHandler({ root: dir, token: TOKEN })), 501, 'unavailable')
    expect(confirmed).toEqual([])
  })
})
