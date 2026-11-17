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
 * D4 (S4), B1: whatever a series of sample-data edits does (a create with nothing, a null on every kind of field, updates,
 * deletes), the generated seed still has every key its type (`Post[]`, `Note[]`) requires: the app typechecks and its
 * generated tests run. Tools come from the golden blog's install (`pnpm --dir fixtures/codegen/blog install`).
 */
const fixtureModules = join(fixtureRoot, 'node_modules')
const bin = (name: string) => join(fixtureModules, '.bin', name)
const NEEDS_FIXTURE = existsSync(bin('nuxi')) || process.env.CI ? '' : ' (skipped: run `pnpm --dir fixtures/codegen/blog install` first)'
const run = promisify(execFile)
const hash = (content: string) => createHash('sha256').update(content).digest('hex')
const FIRST = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a01'
const SECOND = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a02'

type FieldSpec = readonly [string, string, boolean?]
const FIELDS: FieldSpec[] = [
  ['label', 'text', true], ['note', 'text'], ['count', 'integer'], ['ratio', 'number'], ['flag', 'boolean'], ['day', 'date'], ['at', 'datetime'], ['ref', 'uuid'],
  ['maybeText', 'text'], ['maybeInt', 'integer'], ['maybeFlag', 'boolean'], ['maybeDay', 'date'], ['maybeAt', 'datetime'], ['maybeRef', 'uuid'], ['plain', 'text'], ['plainInt', 'integer']
]
const DEFAULTS: Record<string, unknown> = { note: 'none', count: 3, ratio: 1.5, flag: true, day: '2026-01-01', at: '2026-01-01T00:00:00Z', ref: '00000000-0000-4000-8000-000000000001' }
const FILLED: Record<string, unknown> = { note: 'x', count: 9, ratio: 2, flag: false, day: '2026-02-02', at: '2026-02-02T10:00:00Z', ref: '00000000-0000-4000-8000-000000000002', maybeText: 't', maybeInt: 1, maybeFlag: true, maybeDay: '2026-03-03', maybeAt: '2026-03-03T00:00:00Z', maybeRef: '00000000-0000-4000-8000-000000000003', plain: 'p', plainInt: 4 }

describe.skipIf(!!NEEDS_FIXTURE)(`sample-data edits: the app still typechecks and runs its tests${NEEDS_FIXTURE}`, { timeout: 600_000 }, () => {
  let files = fixtureModelFiles()
  let root: string
  let project: string
  const edit = (name: EditName, input: unknown) => {
    const outcome = applyEdit(files, name, input)
    expect(outcome.ok, `${name} ${JSON.stringify(input)}: ${JSON.stringify(outcome)}`).toBe(true)
    if (outcome.ok) files = applyChanges(files, outcome.changes)
    return outcome.ok ? outcome.result as Record<string, unknown> : {}
  }

  beforeAll(() => {
    edit('fixture_row_create', { entity: 'ent_post' })
    edit('fixture_row_create', { entity: 'ent_post', values: { title: 'N', slug: 'n-two', body: null, published: null } })
    edit('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { body: null } })
    edit('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { published: null } })
    edit('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { title: 'Edited', published: true } })
    expect(applyEdit(files, 'fixture_row_update', { entity: 'ent_post', row: FIRST, values: { title: null } }).ok).toBe(false)
    edit('fixture_rows_delete', { entity: 'ent_post', rows: [SECOND] })
    edit('datasource_create', { name: 'scratch', kind: 'memory' })
    // A sqlite entity leaves out the optional fields with no default and no null: their Drizzle repository has a type mismatch of its own (L10).
    for (const [name, source] of [['tag', 'ds_main'], ['note', 'ds_scratch']] as const) {
      const fields = FIELDS.filter(([field]) => source === 'ds_scratch' || !field.startsWith('plain'))
      edit('entity_create', { name, source, fields: fields.map(([field, type, required]) => ({ name: field, type, ...(required ? { required: true } : {}) })) })
      const path = `.bildr/modules/blog/entities/${name}.json`
      const entity = JSON.parse(files[path]!) as { fields: Array<Record<string, unknown>> }
      for (const field of entity.fields) {
        const fieldName = field.name as string
        if (fieldName in DEFAULTS) field.default = DEFAULTS[fieldName]
        if (fieldName.startsWith('maybe')) field.nullable = true
      }
      files = { ...files, [path]: `${JSON.stringify(entity, null, 2)}\n` }
      const entityId = `ent_${name}`
      const others = fields.map(([field]) => field).filter(field => field !== 'label')
      const a = edit('fixture_row_create', { entity: entityId }).rowId as string
      const b = edit('fixture_row_create', { entity: entityId, values: { label: 'b', ...Object.fromEntries(others.map(field => [field, null])) } }).rowId as string
      const c = edit('fixture_row_create', { entity: entityId, values: { label: 'c', ...Object.fromEntries(others.map(field => [field, FILLED[field]])) } }).rowId as string
      for (const field of others) edit('fixture_row_update', { entity: entityId, row: c, values: { [field]: null } })
      edit('fixture_row_update', { entity: entityId, row: a, values: { label: 'a edited' } })
      edit('fixture_rows_delete', { entity: entityId, rows: [b] })
    }

    root = mkdtempSync(join(tmpdir(), 'bildr-sample-edits-'))
    project = join(root, 'blog')
    cpSync(fixtureRoot, project, { recursive: true, filter: source => !/\/(node_modules|\.nuxt|\.output|\.data|\.bildr)$/.test(source) })
    const loaded = loadModel(files)
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    const generated = generate(loaded.model)
    const manifest = ManifestFileSchema.parse(JSON.parse(readFileSync(join(fixtureRoot, '.bildr/manifest.json'), 'utf8'))).files
    const disk: Record<string, string | undefined> = {}
    for (const path of new Set([...generated.map(file => file.path), ...Object.keys(manifest)])) disk[path] = existsSync(join(project, path)) ? hash(readFileSync(join(project, path), 'utf8')) : undefined
    const plan = planSync({ generated, manifest, disk, hash })
    for (const write of plan.writes) {
      mkdirSync(dirname(join(project, write.path)), { recursive: true })
      writeFileSync(join(project, write.path), write.content)
    }
    for (const path of plan.deletes) rmSync(join(project, path), { force: true })
    const config = join(project, 'nuxt.config.ts')
    writeFileSync(config, readFileSync(config, 'utf8').replace(', \'@bildr/nuxt\'', ''))
    symlinkSync(fixtureModules, join(project, 'node_modules'), 'dir')
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const exec = (command: string, args: string[]) => run(command, args, { cwd: project, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NUXT_TELEMETRY_DISABLED: '1', NO_COLOR: '1', FORCE_COLOR: '0' } })
    .then(({ stdout, stderr }) => ({ code: 0, output: `${stdout}\n${stderr}` }), (error: { code?: number, stdout?: string, stderr?: string }) => ({ code: error.code ?? 1, output: `${error.stdout ?? ''}\n${error.stderr ?? ''}` }))

  it('typechecks (nuxi typecheck)', async () => {
    const { code, output } = await exec(bin('nuxi'), ['typecheck'])
    expect(code, output.slice(-4000)).toBe(0)
  })

  it('passes its generated unit tests', async () => {
    const { code, output } = await exec(bin('vitest'), ['run', '--project', 'unit'])
    expect(code, output.slice(-4000)).toBe(0)
  })
})
