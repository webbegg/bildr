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

  /** An edit that must succeed. */
  edit(name: EditName, input: unknown) {
    const outcome = applyEdit(this.files, name, input)
    expect(outcome.ok, `${name} ${JSON.stringify(input)}: ${JSON.stringify(outcome)}`).toBe(true)
    if (outcome.ok) this.files = applyChanges(this.files, outcome.changes)
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
