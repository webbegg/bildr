import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { starterKit } from '../../src/starter/index'
import { fixtureModelFiles, fixtureRoot } from '../model/fixture'

// S4: generated code passes the project's own eslint, also for partial models (a model is
// built up one artifact at a time in the editor). eslint and the Nuxt eslint config come from
// the golden fixture's install: `pnpm --dir fixtures/codegen/blog install` once (its postinstall
// runs `nuxt prepare`, which writes `.nuxt/eslint.config.mjs`).
const fixtureModules = join(fixtureRoot, 'node_modules')
const nuxtEslintConfig = join(fixtureRoot, '.nuxt/eslint.config.mjs')
const eslintBin = join(fixtureModules, 'eslint/bin/eslint.js')
// In CI the install is required: a missing one fails these tests instead of skipping them.
const NEEDS_FIXTURE = (existsSync(eslintBin) && existsSync(nuxtEslintConfig)) || process.env.CI ? '' : ' (skipped: run `pnpm --dir fixtures/codegen/blog install` first)'

const run = promisify(execFile)
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const note = {
  entity: { id: 'ent_note', name: 'Note', plural: 'notes', idStrategy: 'uuid', timestamps: true, fields: [{ id: 'fld_n_title', name: 'title', type: 'text', required: true }], relations: [], client: { sync: 'eager' } },
  repository: { id: 'repo_note', entity: 'ent_note', datasource: 'ds_main', operations: ['list', 'get', 'create'] },
  query: { id: 'q_all_notes', name: 'allNotes', label: 'All notes', from: 'ent_note', params: [], result: 'many' },
  action: { id: 'act_create_note', name: 'createNote', label: 'Create note', http: { method: 'POST', path: '/notes' }, input: { entity: 'ent_note' }, output: { entity: 'ent_note' }, errors: [], steps: [{ kind: 'validate' }, { kind: 'repository', repository: 'repo_note', op: 'create' }], client: { invalidates: ['ent_note'] } }
}

const starter = starterKit({ name: 'Notes' }).model
const dir = '.bildr/modules/main'
/** Partial models, as the editor builds them up artifact by artifact. */
const MODELS: Array<[string, Record<string, string>]> = [
  ['the starter kit (a module with nothing)', starter],
  ['an entity without a repository', { ...starter, [`${dir}/entities/note.json`]: json(note.entity) }],
  ['a repository no use-case consumes', { ...starter, [`${dir}/entities/note.json`]: json(note.entity), [`${dir}/repositories/note.json`]: json(note.repository) }],
  ['an exposed list with a query and no page', { ...starter, [`${dir}/entities/note.json`]: json(note.entity), [`${dir}/repositories/note.json`]: json({ ...note.repository, expose: { list: true } }), [`${dir}/queries/all-notes.json`]: json(note.query) }],
  ['an action without errors or optimistic update', { ...starter, [`${dir}/entities/note.json`]: json(note.entity), [`${dir}/repositories/note.json`]: json({ ...note.repository, expose: { list: true } }), [`${dir}/actions/create-note.json`]: json(note.action) }],
  ['the golden fixture', fixtureModelFiles()]
]

describe.skipIf(!!NEEDS_FIXTURE)(`generated code passes the project's eslint${NEEDS_FIXTURE}`, { timeout: 120_000 }, () => {
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'bildr-codegen-lint-'))
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it.each(MODELS)('%s', async (name, modelFiles) => {
    const loaded = loadModel(modelFiles)
    expect(loaded.ok ? [] : loaded.problems).toEqual([])
    if (!loaded.ok) return
    const project = join(root, name.replace(/\W+/g, '-'))
    for (const file of generate(loaded.model)) {
      mkdirSync(dirname(join(project, file.path)), { recursive: true })
      writeFileSync(join(project, file.path), file.content)
    }
    // The fixture's Nuxt eslint config, with its page/component dirs pointed at this model's module.
    const module = loaded.model.project.defaultModule
    mkdirSync(join(project, '.nuxt'))
    writeFileSync(join(project, '.nuxt/eslint.config.mjs'), readFileSync(nuxtEslintConfig, 'utf8').replaceAll('layers/blog/', `layers/${module}/`).replaceAll('app/composables/blog"', `app/composables/${module}"`))
    symlinkSync(fixtureModules, join(project, 'node_modules'), 'dir')
    const output = await run(process.execPath, [eslintBin, '.', '--format', 'json'], { cwd: project, maxBuffer: 64 * 1024 * 1024 })
      .then(({ stdout }) => stdout, (error: { stdout?: string }) => error.stdout ?? String(error))
    const reports = JSON.parse(output) as Array<{ filePath: string, messages: Array<{ line: number, ruleId: string | null, message: string }> }>
    const findings = reports.flatMap(report => report.messages.map(message => `${report.filePath.slice(project.length + 1)}:${message.line} ${message.ruleId}: ${message.message}`))
    expect(findings).toEqual([])
    expect(reports.length).toBeGreaterThan(10)
  })
})
