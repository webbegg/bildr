import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { generate } from '@bildr/codegen/generate'
import { loadModel } from '@bildr/codegen/model'
import { createProject } from '../../create-bildr/src/create'
import { createHealthRunner, HEALTH_FILE, projectDrift, readHealth, runCheck, updateHealth } from '../src/node/health'
import type { CheckName, CheckResult } from '../src/node/health'
import { readModelFiles } from '../src/node/project'
import { syncProject } from '../src/node/sync'

// nuxt, eslint, vitest and vue-tsc come from the golden fixture's install, as a project would have them.
// The fixture is not part of the workspace: `pnpm --dir fixtures/codegen/blog install` once (review RELIABILITY-001).
const fixtureModules = fileURLToPath(new URL('../../../fixtures/codegen/blog/node_modules', import.meta.url))
// In CI the install is required: a missing one fails these tests instead of skipping them.
const NEEDS_FIXTURE = ['nuxt', 'eslint', 'vitest', 'vue-tsc'].every(name => existsSync(join(fixtureModules, name))) || process.env.CI ? '' : ' (skipped: run `pnpm --dir fixtures/codegen/blog install` first)'

const page = 'layers/main/app/pages/index.vue'
const check = (name: CheckResult['name'], ok = true): CheckResult => ({ name, ok, startedAt: '2026-11-13T10:00:00.000Z', durationMs: 5, summary: ok ? 'fine' : 'broken', findings: [] })

/** Generates the app from its `.bildr/` model and syncs it, as `regenerate` does. */
const generated = (dir: string) => {
  const loaded = loadModel(readModelFiles(dir))
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  return generate(loaded.model)
}

describe('health report', () => {
  let root: string
  let dir: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bildr-health-'))
    dir = join(root, 'app')
    createProject(dir, { name: 'App' })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('reads an empty report when the file is missing, unparsable or of another shape', () => {
    expect(readHealth(dir)).toEqual({ updatedAt: '', checks: {} })
    mkdirSync(join(dir, '.bildr/.cache'), { recursive: true })
    for (const garbage of ['{ not json', '[]', '{"updatedAt": 3, "checks": {}}', '{"updatedAt": "x", "checks": 3}']) {
      writeFileSync(join(dir, HEALTH_FILE), garbage)
      expect(readHealth(dir)).toEqual({ updatedAt: '', checks: {} })
    }
  })

  it('merges each update into the report, check by check, and stamps it', () => {
    const first = updateHealth(dir, { checks: { lint: check('lint', false) } })
    expect(Date.parse(first.updatedAt)).not.toBeNaN()
    const drift = { files: [], missingManifest: false }
    const second = updateHealth(dir, { drift, migration: null, checks: { tests: check('tests') } })
    expect(second.checks).toEqual({ lint: check('lint', false), tests: check('tests') })
    expect(second.drift).toEqual(drift)
    expect(second.migration).toBeNull()
    const third = updateHealth(dir, { checks: { lint: check('lint') } })
    expect(third.checks).toEqual({ lint: check('lint'), tests: check('tests') })
    expect(third.drift).toEqual(drift)
    expect(readHealth(dir)).toEqual(third)
    expect(JSON.parse(readFileSync(join(dir, HEALTH_FILE), 'utf8'))).toEqual(third)
    expect(readdirSync(join(dir, '.bildr/.cache'))).toEqual(['health.json'])
  })

  it('writes through a temporary file: a failed write leaves the previous report as it was', () => {
    updateHealth(dir, { checks: { lint: check('lint') } })
    const before = readFileSync(join(dir, HEALTH_FILE), 'utf8')
    // A folder where the temporary file goes makes the write fail before the rename.
    mkdirSync(join(dir, `${HEALTH_FILE}.tmp`))
    expect(() => updateHealth(dir, { checks: { lint: check('lint', false) } })).toThrow()
    expect(readFileSync(join(dir, HEALTH_FILE), 'utf8')).toBe(before)
  })

  it('refuses to write when .bildr/.cache resolves outside the project', () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(dir, '.bildr/.cache'), 'dir')
    expect(() => updateHealth(dir, { checks: { lint: check('lint') } })).toThrow(/outside the project/)
    expect(readdirSync(outside)).toEqual([])
  })

  it('lists no drift for a synced project, and an edited generated file as detached with its diff', () => {
    syncProject(dir, generated(dir))
    expect(projectDrift(dir, generated(dir))).toEqual({ files: [], missingManifest: false })
    writeFileSync(join(dir, page), `${readFileSync(join(dir, page), 'utf8')}<!-- mine -->\n`)
    const drift = projectDrift(dir, generated(dir))
    expect(drift.files.map(file => [file.path, file.state])).toEqual([[page, 'detached']])
    expect(drift.files[0]!.diff).toContain(`+++ ${page} (on disk)`)
    expect(drift.files[0]!.diff).toContain('+<!-- mine -->')
  })

  it('never reads a generated path through a symlink that leaves the project', () => {
    syncProject(dir, generated(dir))
    const outside = join(root, 'outside.vue')
    writeFileSync(outside, 'secret outside the project\n')
    rmSync(join(dir, page))
    symlinkSync(outside, join(dir, page))
    const drift = projectDrift(dir, generated(dir))
    expect(drift.files).toEqual([{ path: page, state: 'deleted' }])
  })

  it('reports lint as not ok until .nuxt/eslint.config.mjs exists', async () => {
    const result = await runCheck(dir, 'lint')
    expect(result).toMatchObject({ name: 'lint', ok: false })
    expect(result.summary).toMatch(/nuxt dev/)
  })
})

// T9c: checks of one project run one at a time; a check already waiting its turn is not queued twice.
describe('createHealthRunner', () => {
  let root: string
  let dir: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bildr-health-runner-'))
    dir = join(root, 'app')
    createProject(dir, { name: 'App' })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  /** A check whose runs finish when the test says so. */
  const controlled = () => {
    const started: CheckName[] = []
    const finish: Array<() => void> = []
    let active = 0
    let maxActive = 0
    let count = 0
    const run = (_root: string, name: CheckName) => new Promise<CheckResult>((resolve) => {
      started.push(name)
      active++
      maxActive = Math.max(maxActive, active)
      const ok = ++count % 2 === 1
      finish.push(() => {
        active--
        resolve({ ...check(name, ok), summary: `run ${count}` })
      })
    })
    return { run, started, finish, maxActive: () => maxActive }
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))

  it('runs checks one at a time, in order, and writes each result into the report', async () => {
    const fake = controlled()
    const runner = createHealthRunner(dir, { check: fake.run })
    const first = runner.run(['lint', 'types'])
    const second = runner.run(['tests'])
    for (let step = 0; step < 3; step++) {
      await settle()
      expect(fake.started).toHaveLength(step + 1)
      fake.finish[step]!()
    }
    const [results, more] = await Promise.all([first, second])
    expect(fake.started).toEqual(['lint', 'types', 'tests'])
    expect(fake.maxActive()).toBe(1)
    expect(results.map(result => result.name)).toEqual(['lint', 'types'])
    expect(more.map(result => result.name)).toEqual(['tests'])
    expect(readHealth(dir).checks).toEqual({ lint: results[0], types: results[1], tests: more[0] })
  })

  it('coalesces a check that is already queued: it runs once and every caller gets that result', async () => {
    const fake = controlled()
    const runner = createHealthRunner(dir, { check: fake.run })
    const types = runner.run(['types'])
    await settle()
    const lintA = runner.run(['lint'])
    const lintB = runner.run(['lint', 'tests'])
    fake.finish[0]!()
    await settle()
    fake.finish[1]!()
    await settle()
    fake.finish[2]!()
    const [, [a], [b, tests]] = await Promise.all([types, lintA, lintB])
    expect(fake.started).toEqual(['types', 'lint', 'tests'])
    expect(b).toBe(a)
    expect(tests!.name).toBe('tests')
  })

  it('runs a check again when it is asked for while it is already running', async () => {
    const fake = controlled()
    const runner = createHealthRunner(dir, { check: fake.run })
    const first = runner.run(['lint'])
    await settle()
    expect(fake.started).toEqual(['lint'])
    const second = runner.run(['lint'])
    fake.finish[0]!()
    await settle()
    fake.finish[1]!()
    const [[a], [b]] = await Promise.all([first, second])
    expect(fake.started).toEqual(['lint', 'lint'])
    expect(a!.summary).not.toBe(b!.summary)
    expect(readHealth(dir).checks.lint).toEqual(b)
  })

  it('keeps running later checks after one throws', async () => {
    const runner = createHealthRunner(dir, {
      check: async (_root, name) => {
        if (name === 'lint') throw new Error('boom')
        return check(name)
      }
    })
    await expect(runner.run(['lint'])).rejects.toThrow('boom')
    expect(await runner.run(['tests'])).toEqual([check('tests')])
  })
})

/** Environment of a child that runs the project's tools: not the test runner's. */
const childEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_ENV' && key !== 'TEST' && !key.startsWith('VITEST')))

/** Every file under `path` with its mtime and size; empty when the folder doesn't exist. */
const snapshot = (base: string, skip: string[] = []): string[] => {
  if (!existsSync(base)) return []
  const walk = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (skip.includes(relative(base, path))) return []
    const stat = statSync(path)
    const line = `${relative(base, path)} ${stat.mtimeMs} ${stat.size}`
    return entry.isDirectory() ? [line, ...walk(path)] : [line]
  })
  return walk(base).sort()
}

// Each check starts the project's own tools in a child process (types and build load Nuxt): allow for a busy machine.
describe.skipIf(!!NEEDS_FIXTURE)(`runCheck${NEEDS_FIXTURE}`, { timeout: 300_000 }, () => {
  let root: string
  let dir: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'bildr-health-checks-'))
    dir = join(root, 'app')
    createProject(dir, { name: 'App' })
    symlinkSync(fixtureModules, join(dir, 'node_modules'), 'dir')
    // What nuxt dev keeps in .nuxt/ (the eslint config among it); the checks must leave it alone.
    const nuxt = join(dirname(createRequire(join(dir, 'package.json')).resolve('nuxt/package.json')), 'bin/nuxt.mjs')
    execFileSync(process.execPath, [nuxt, 'prepare'], { cwd: dir, env: childEnv(), stdio: 'pipe' })
    writeFileSync(join(dir, '.nuxt/bildr-sentinel'), 'nuxt dev owns this folder\n')
  }, 120_000)
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const put = (path: string, content: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  /** The project as nuxt dev sees it: everything but node_modules and bildr's cache. */
  const projectTree = () => snapshot(dir, ['node_modules', '.bildr/.cache'])

  it('lint reports an app file importing server code as a boundary violation, and is ok once it is gone', async () => {
    const bad = 'layers/main/app/utils/reach.ts'
    put(bad, `import { useMain } from '../../server/utils/main'\n\nexport const reach = useMain\n`)
    const failing = await runCheck(dir, 'lint')
    expect(failing).toMatchObject({ name: 'lint', ok: false })
    expect(failing.findings).toContainEqual(expect.objectContaining({ file: bad, line: 1, rule: 'no-restricted-imports', boundary: true }))
    expect(failing.summary).toMatch(/^1 boundary violation\b/)
    expect(failing.output).toBeDefined()
    expect(Date.parse(failing.startedAt)).not.toBeNaN()
    expect(failing.durationMs).toBeGreaterThan(0)

    rmSync(join(dir, bad))
    const passing = await runCheck(dir, 'lint')
    expect(passing).toMatchObject({ name: 'lint', ok: true, findings: [] })
    expect(passing.output).toBeUndefined()
  })

  it('tests passes with the project\'s tests green and reports a failing one', async () => {
    const file = 'layers/main/test/application/sample.test.ts'
    const green = `import { describe, expect, it } from 'vitest'\n\ndescribe('math', () => {\n  it('adds', () => {\n    expect(1 + 1).toBe(2)\n  })\n})\n`
    put(file, green)
    const passing = await runCheck(dir, 'tests')
    expect(passing).toMatchObject({ name: 'tests', ok: true, summary: '1 test passed', findings: [] })

    put(file, green.replace('})\n})\n', '})\n  it(\'fails\', () => {\n    expect(1 + 1).toBe(3)\n  })\n})\n'))
    const failing = await runCheck(dir, 'tests')
    expect(failing).toMatchObject({ name: 'tests', ok: false, summary: '1 test failed, 1 passed' })
    expect(failing.findings).toEqual([{ file, line: 8, message: 'math fails: AssertionError: expected 2 to be 3 // Object.is equality' }])
    rmSync(join(dir, file))
  })

  it('types finds a deliberate type error without touching .nuxt or .output', async () => {
    const bad = 'layers/main/shared/domain/wrong.ts'
    put(bad, `export const count: number = 'three'\n`)
    const before = projectTree()
    const failing = await runCheck(dir, 'types')
    expect(projectTree()).toEqual(before)
    expect(failing).toMatchObject({ name: 'types', ok: false, summary: '1 type error' })
    expect(failing.findings).toEqual([{ file: bad, line: 1, rule: 'TS2322', message: 'Type \'string\' is not assignable to type \'number\'.' }])

    rmSync(join(dir, bad))
    const passing = await runCheck(dir, 'types')
    expect(passing).toMatchObject({ name: 'types', ok: true, findings: [] })
    expect(existsSync(join(dir, '.nuxt/bildr-sentinel'))).toBe(true)
  })

  it('build succeeds into bildr\'s cache, without touching .nuxt or .output', async () => {
    const before = projectTree()
    const result = await runCheck(dir, 'build')
    expect(result).toMatchObject({ name: 'build', ok: true, findings: [] })
    expect(projectTree()).toEqual(before)
    expect(existsSync(join(dir, '.output'))).toBe(false)
    expect(existsSync(join(dir, '.bildr/.cache/health/build/.output/server/index.mjs'))).toBe(true)
  })

  it('a check past its time limit is killed and reported, not thrown', async () => {
    const result = await runCheck(dir, 'build', { timeoutMs: 500 })
    expect(result).toMatchObject({ name: 'build', ok: false, summary: 'did not finish within 0.5s' })
  })
})
