// P3a (V2, V5, V6): the visual editing operations as module actions over HTTP, writing `.bildr/` files.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { regenerate } from '../src/node/regenerate'
import { createBildrHandler } from '../src/server/handler'

const TOKEN = 'a'.repeat(48)
const pagePath = '.bildr/modules/main/pages/index.json'
let root: string
let dir: string
let handle: ReturnType<typeof createBildrHandler>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-handler-editing-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App' })
  handle = createBildrHandler({ root: dir, token: TOKEN })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const act = (name: string, body: unknown = {}) => handle(new Request(`http://localhost:3000/__bildr/api/actions/${name}`, {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000', 'x-bildr-token': TOKEN, 'content-type': 'application/json' }
}), { remoteAddress: '127.0.0.1' })
const ok = async (name: string, body: unknown = {}): Promise<Json> => {
  const response = await act(name, body)
  const json = await response.json() as { ok: boolean, result?: Json }
  expect(json.ok, `${name}: ${JSON.stringify(json)}`).toBe(true)
  return json.result!
}
const failure = async (name: string, body: unknown, status: number, code: string) => {
  const response = await act(name, body)
  const json = await response.json() as { ok: boolean, code: string, message: string, problems?: unknown }
  expect(response.status, JSON.stringify(json)).toBe(status)
  expect(json.code).toBe(code)
  return json
}
const read = (path: string) => readFileSync(join(dir, path), 'utf8')
const json = (path: string) => JSON.parse(read(path)) as Json

describe('node and page actions', () => {
  it('write the changed .bildr/ files canonically and say which', async () => {
    const result = await ok('node_insert', { file: 'pg_index', type: 'Text', props: { text: 'Hello' } })
    expect(result).toEqual({ nodeId: 'n_text_1', changed: [pagePath] })
    expect(json(pagePath).root.children.at(-1)).toEqual({ id: 'n_text_1', type: 'Text', props: { text: 'Hello' } })
    expect(read(pagePath)).toMatch(/^\{\n {2}"id": "pg_index",/)
  })

  it('map edit failures to the action error codes, with the model problems', async () => {
    await failure('node_insert', { file: 'pg_index' }, 400, 'invalid_input')
    await failure('node_insert', { file: 'pg_nope', type: 'Text' }, 404, 'not_found')
    await failure('node_delete', { file: 'pg_index', nodeId: 'n_page' }, 403, 'forbidden')
    const broken = await failure('node_delete', { file: 'lay_main', nodeId: 'n_main' }, 422, 'invalid')
    expect(broken.problems).toEqual([{ path: '.bildr/layouts/main.json', message: 'slots.0.nodeId: Unknown node "n_main"' }])
    expect(json('.bildr/layouts/main.json').root.children.map((child: Json) => child.id)).toContain('n_main')
  })

  it('create and delete page files', async () => {
    const created = await ok('page_create', { name: 'About', layout: 'lay_main' })
    expect(created).toMatchObject({ pageId: 'pg_about', filePath: '.bildr/modules/main/pages/about.json', changed: ['.bildr/modules/main/pages/about.json'] })
    expect(json(created.filePath as string)).toMatchObject({ id: 'pg_about', path: '/about', layout: 'lay_main' })
    await failure('page_delete', { page: 'pg_index' }, 403, 'forbidden')
    await ok('page_delete', { page: 'pg_about' })
    expect(existsSync(join(dir, created.filePath as string))).toBe(false)
  })

  it('never write through a symlink that leaves the project', async () => {
    mkdirSync(join(root, 'outside'))
    writeFileSync(join(root, 'outside/about.json'), 'mine')
    // Not a model file (the loader skips symlinks), but where the new page would go.
    symlinkSync(join(root, 'outside/about.json'), join(dir, '.bildr/modules/main/pages/about.json'))
    await failure('page_create', { name: 'About' }, 403, 'forbidden')
    expect(readFileSync(join(root, 'outside/about.json'), 'utf8')).toBe('mine')
  })
})

describe('layout actions', () => {
  it('create a layout file, give a page that layout and fill its footer slot', async () => {
    const { layoutId, filePath } = await ok('layout_create', { name: 'Marketing' })
    expect(json(filePath as string)).toMatchObject({ id: 'lay_marketing', name: 'marketing' })
    await ok('page_set_layout', { page: 'pg_index', layout: layoutId })
    expect(json(pagePath).layout).toBe('lay_marketing')
    await failure('layout_delete', { layout: layoutId }, 403, 'forbidden')
    await ok('page_set_layout', { page: 'pg_index', layout: 'lay_main' })
    const { fillId } = await ok('page_set_slot', { page: 'pg_index', slot: 'footer', filled: true })
    await ok('node_insert', { file: 'pg_index', parentId: fillId, type: 'Text', props: { text: 'Page footer' } })
    const result = await regenerate(dir)
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(read('layers/main/app/pages/index.vue')).toContain('Page footer')
  })
})

describe('theme, project and catalog actions', () => {
  it('update the theme and project files; catalog_get and theme_presets_list are read-only', async () => {
    expect((await ok('theme_apply', { preset: 'forest' })).changed).toEqual(['.bildr/theme.json'])
    expect(json('.bildr/theme.json')).toMatchObject({ colors: { primary: 'emerald' }, font: 'DM Sans' })
    await ok('theme_update', { font: 'Inter' })
    expect(json('.bildr/theme.json').font).toBe('Inter')
    await ok('project_update', { name: 'Renamed' })
    expect(json('.bildr/bildr.json').name).toBe('Renamed')
    const catalog = await ok('catalog_get')
    expect(catalog.changed).toBeUndefined()
    expect(catalog.nodeTypes.map((entry: Json) => entry.type)).toContain('Heading')
    expect((await ok('theme_presets_list')).presets.length).toBeGreaterThan(1)
    const list = await (await handle(new Request('http://localhost:3000/__bildr/api/actions', { headers: { 'host': 'localhost:3000', 'x-bildr-token': TOKEN } }), { remoteAddress: '127.0.0.1' })).json() as Json[]
    const readOnly = Object.fromEntries(list.map(action => [action.name, action.readOnly]))
    expect(readOnly).toMatchObject({ catalog_get: true, theme_get: true, theme_presets_list: true, editor_context_get: true, node_insert: false, theme_apply: false })
  })
})

describe('editor context and navigate', () => {
  it('store what the editor shows in .bildr/.cache/session.json and read it back with the selected node', async () => {
    expect(await ok('editor_context_get')).toBeNull()
    const set = await ok('editor_context_set', { file: 'pg_index', nodeId: 'n_h1' })
    expect(set).toMatchObject({ file: 'pg_index', nodeId: 'n_h1', variant: null, updatedAt: expect.any(String) })
    expect(JSON.parse(read('.bildr/.cache/session.json'))).toEqual(set)
    const got = await ok('editor_context_get')
    expect(got).toMatchObject({ file: 'pg_index', kind: 'page', name: 'index', selected: { id: 'n_h1', type: 'Heading', props: { level: 1, text: 'Welcome to App' } } })
    await failure('editor_context_set', { file: 'pg_index', nodeId: 'n_nope' }, 404, 'not_found')
    await failure('editor_context_set', { file: 'pg_nope', nodeId: null }, 404, 'not_found')
  })

  it('editor_navigate checks and returns the target (no event stream yet)', async () => {
    expect(await ok('editor_navigate', { file: 'lay_main', nodeId: 'n_footer' })).toEqual({ file: 'lay_main', kind: 'layout', nodeId: 'n_footer', variant: null })
    await failure('editor_navigate', { file: 'pg_index', variant: 'var_x' }, 400, 'invalid_input')
    await failure('editor_navigate', { file: 'pg_index', nodeId: 'n_nope' }, 404, 'not_found')
  })
})

describe('building a page from scratch (end to end)', () => {
  it('page_create → node_insert → node_update_style → component_create + an instance, then the regenerated Vue page', async () => {
    const { pageId, nodeId: rootId } = await ok('page_create', { name: 'Landing', layout: 'lay_main' })
    const { nodeId: hero } = await ok('node_insert', { file: pageId, parentId: rootId, type: 'Container', props: { tag: 'section' } })
    await ok('node_insert', { file: pageId, parentId: hero, type: 'Heading', props: { text: 'Build faster', level: 1 } })
    await ok('node_insert', { file: pageId, parentId: hero, type: 'Text', props: { text: 'From a model to a Nuxt app.' } })
    const { nodeId: button } = await ok('node_insert', { file: pageId, parentId: hero, type: 'Button', props: { text: 'Start' } })
    await ok('node_update_style', { file: pageId, nodeId: hero, style: { bg: 'muted', p: '8' } })
    await ok('node_update_style', { file: pageId, nodeId: hero, breakpoint: 'md', style: { p: '16' } })
    const { componentId, nodeId: instance } = await ok('component_create', { file: pageId, nodeId: button, name: 'Cta' })
    expect(componentId).toBe('cmp_cta')
    const { nodeId: second } = await ok('node_insert', { file: pageId, parentId: hero, type: 'Instance', props: { component: componentId } })

    const page = json('.bildr/modules/main/pages/landing.json')
    expect(page.root.children[0].children.map((child: Json) => child.type)).toEqual(['Heading', 'Text', 'Instance', 'Instance'])
    expect(page.root.children[0].children[2]).toEqual({ id: instance, type: 'Instance', props: { component: 'cmp_cta' } })
    expect(json('.bildr/modules/main/components/cta.json').root).toEqual({ id: 'n_button_2', type: 'Button', props: { text: 'Start' } })
    expect(second).not.toBe(instance)

    const result = await regenerate(dir)
    expect(result.ok, JSON.stringify(result)).toBe(true)
    const vue = read('layers/main/app/pages/landing.vue')
    expect(vue).toContain('<section class="')
    expect(vue).toMatch(/bg-muted/)
    expect(vue).toMatch(/p-8 md:p-16|md:p-16/)
    expect(vue).toContain('Build faster')
    expect(vue).toContain('From a model to a Nuxt app.')
    expect(vue.match(/<MainCta \/>/g)).toHaveLength(2)
    expect(read('layers/main/app/components/main/Cta.vue')).toContain('Start')
  })
})
