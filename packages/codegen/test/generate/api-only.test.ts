import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { serializeModel } from '../../src/model/serialize'
import { starterKit } from '../../src/starter/index'
import type { GeneratedFile } from '../../src/sync/plan'
import { fixtureRoot } from '../model/fixture'

/**
 * Golden API-only project (V7, E2): one REST data source and no database. Entities,
 * repositories, queries, actions and pages are the same clean-architecture model; only
 * the adapter differs. The generated project typechecks, passes its lint (boundary rules)
 * and its generated tests, with no Drizzle or libSQL anywhere. The model is
 * fixtures/codegen/api-only/.bildr on top of `starterKit({ database: 'none' })`; tools come
 * from the golden blog fixture's install (`pnpm --dir fixtures/codegen/blog install`), as in lint.test.ts.
 */
const apiOnlyRoot = fileURLToPath(new URL('../../../../fixtures/codegen/api-only', import.meta.url))
const fixtureModules = join(fixtureRoot, 'node_modules')
const bin = (name: string) => join(fixtureModules, '.bin', name)
const NEEDS_FIXTURE = existsSync(bin('nuxi')) || process.env.CI ? '' : ' (skipped: run `pnpm --dir fixtures/codegen/blog install` first)'

const run = promisify(execFile)
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])

const IMPORTS_DATABASE = /(from|import\(|require\()\s*['"](drizzle-orm|drizzle-kit|@libsql)/

const apiOnlyProject = (): GeneratedFile[] => {
  const kit = starterKit({ name: 'Tasks', database: 'none' })
  const added = Object.fromEntries(walk(join(apiOnlyRoot, '.bildr')).map(path => [relative(apiOnlyRoot, path), readFileSync(path, 'utf8')]))
  const files = { ...kit.model, ...added }
  const loaded = loadModel(files)
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems, null, 2))
  const generated = generate(loaded.model)
  const scaffold = kit.files.filter(file => file.owner === 'scaffold')
  return [...generated, ...scaffold, ...Object.entries(files).map(([path, content]) => ({ path, content, owner: 'scaffold' as const }))]
}

describe('golden API-only project: the generated files', () => {
  const files = apiOnlyProject()
  const paths = files.map(file => file.path)

  it('the fixture model files are in canonical form (as model_file_put saves them)', () => {
    const added = Object.fromEntries(walk(join(apiOnlyRoot, '.bildr')).map(path => [relative(apiOnlyRoot, path), readFileSync(path, 'utf8')]))
    const loaded = loadModel({ ...starterKit({ name: 'Tasks', database: 'none' }).model, ...added })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const canonical = serializeModel(loaded.model)
    for (const [path, text] of Object.entries(added)) expect(canonical[path], path).toBe(text)
  })

  it('has the REST adapter, its in-memory twin and the clean-architecture layers', () => {
    expect(paths).toEqual(expect.arrayContaining([
      'layers/main/shared/domain/task.ts',
      'layers/main/server/application/ports/task-repository.ts',
      'layers/main/server/application/actions/create-task.ts',
      'layers/main/server/infrastructure/repositories/task.rest.ts',
      'layers/main/server/infrastructure/repositories/task.memory.ts',
      'layers/main/server/api/main/tasks/index.get.ts',
      'layers/main/server/api/main/tasks/index.post.ts',
      'layers/main/app/data/tasks.collection.ts',
      'layers/main/app/pages/index.vue',
      'layers/main/app/pages/tasks/new.vue',
      'layers/main/app/pages/tasks/[id].vue'
    ]))
  })

  it('has no database layer, no Drizzle or libSQL import, and no database dependency', () => {
    expect(paths.filter(path => /drizzle|\/db\/|server\/database|plugins\/migrate/.test(path))).toEqual([])
    expect(files.filter(file => IMPORTS_DATABASE.test(file.content)).map(file => file.path)).toEqual([])
    const pkg = JSON.parse(files.find(file => file.path === 'package.json')!.content) as { dependencies: object, devDependencies: object }
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(name => /drizzle|libsql/.test(name))).toEqual([])
    expect(files.find(file => file.path === 'layers/main/server/utils/main.ts')!.content).toContain('restTaskRepository(useRemote(\'api\'))')
  })

  it('has a memory data source: the in-memory adapter wired for real, seeded from the fixtures, no REST or database code', () => {
    expect(paths).toEqual(expect.arrayContaining([
      'layers/main/shared/domain/note.ts',
      'layers/main/server/application/ports/note-repository.ts',
      'layers/main/server/infrastructure/repositories/note.memory.ts',
      'layers/main/server/infrastructure/memory/seed.ts',
      'layers/main/server/api/main/notes/index.get.ts',
      'layers/main/server/api/main/notes/index.post.ts',
      'layers/main/app/data/notes.collection.ts',
      'layers/main/app/composables/main/useNotes.ts',
      'layers/main/app/composables/main/useNoteById.ts'
    ]))
    expect(paths.filter(path => /note\.(rest|drizzle)/.test(path))).toEqual([])
    const seed = files.find(file => file.path === 'layers/main/server/infrastructure/memory/seed.ts')!.content
    expect(seed).toContain('export const noteSeed: Note[] = [')
    expect(seed).toContain('Seeded from the model fixtures')
    const root = files.find(file => file.path === 'layers/main/server/utils/main.ts')!.content
    // One store per server process (outside the composition root's function): rows live until it stops.
    expect(root).toMatch(/^const notes = memoryNoteRepository\(noteSeed\)$/m)
    expect(root).toContain('import { noteSeed } from \'../infrastructure/memory/seed\'')
    expect(root).toContain('the "local" memory data source')
    const nuxtConfig = files.find(file => file.path === 'layers/core/nuxt.config.ts')!.content
    expect(nuxtConfig).not.toContain('local')
  })
})

describe.skipIf(!!NEEDS_FIXTURE)(`golden API-only project: typecheck, lint and generated tests${NEEDS_FIXTURE}`, { timeout: 600_000 }, () => {
  let root: string
  let project: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'bildr-api-only-'))
    project = join(root, 'tasks')
    for (const file of apiOnlyProject()) {
      mkdirSync(dirname(join(project, file.path)), { recursive: true })
      writeFileSync(join(project, file.path), file.content)
    }
    // Standalone (S2): the app checks without the dev-only editor module.
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

  it('passes its eslint, boundary rules included', async () => {
    // `nuxi typecheck` ran `nuxt prepare`, which wrote .nuxt/eslint.config.mjs for this project.
    expect(existsSync(join(project, '.nuxt/eslint.config.mjs'))).toBe(true)
    const { output } = await exec(process.execPath, [join(fixtureModules, 'eslint/bin/eslint.js'), '.', '--format', 'json'])
    const reports = JSON.parse(output.slice(output.indexOf('['), output.lastIndexOf(']') + 1)) as Array<{ filePath: string, messages: Array<{ line: number, ruleId: string | null, message: string }> }>
    const findings = reports.flatMap(report => report.messages.map(message => `${report.filePath.slice(project.length + 1)}:${message.line} ${message.ruleId}: ${message.message}`))
    expect(findings).toEqual([])
    expect(reports.length).toBeGreaterThan(10)
  })

  it('passes its generated tests (vitest run)', async () => {
    const { code, output } = await exec(bin('vitest'), ['run', '--project', 'unit', '--reporter', 'verbose'])
    expect(code, output.slice(-4000)).toBe(0)
    expect(output).toMatch(/Tests\s+\d+ passed/)
    expect(output).toContain('task.rest.test.ts')
    expect(output).toContain('create-task.test.ts')
    expect(output).toContain('create-note.test.ts')
  })

  it('the typecheck is real: a type error in a layer fails it', async () => {
    const broken = join(project, 'layers/main/server/utils/broken.ts')
    writeFileSync(broken, 'export const broken: number = \'not a number\'\n')
    try {
      const { code, output } = await exec(bin('nuxi'), ['typecheck'])
      expect(code).not.toBe(0)
      expect(output).toContain('broken.ts')
    } finally {
      rmSync(broken)
    }
  })
})
