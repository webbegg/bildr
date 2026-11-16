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
