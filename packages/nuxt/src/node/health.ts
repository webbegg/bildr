import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { driftReport, isSafeProjectPath } from '@bildr/codegen/sync'
import type { DriftReport, GeneratedFile } from '@bildr/codegen/sync'
import { resolvesInside } from './project.ts'
import { readManifest, sha256, writeAtomically } from './sync.ts'

/**
 * Health of a bildr project (T9, RA §7, S6): drift against what bildr
 * generates, and the project's own checks (lint with its architecture
 * boundaries, types, tests, build), each run with the project's tools in a
 * child process. Results land in `HEALTH_FILE`, which the editor reads.
 * Health reports and never blocks: a failing check is a result, not an error.
 *
 * nuxt dev owns `.nuxt/` and `.output/`, so types and build run Nuxt with
 * their build, types and output folders redirected under
 * `.bildr/.cache/health/<check>/` (`buildDir`, `typesDir`, `nitro.output.dir`,
 * `vite.cacheDir`) and type-check the tsconfigs Nuxt writes there.
 */

export const HEALTH_FILE = '.bildr/.cache/health.json'
const CACHE_DIR = '.bildr/.cache'
/** Scratch space of the checks: build folders, reports. */
const WORK_DIR = '.bildr/.cache/health'

export type CheckName = 'lint' | 'types' | 'tests' | 'build'

export interface CheckFinding {
  /** Relative to the project, with `/`. */
  file?: string
  line?: number
  message: string
  rule?: string
  /** A clean-architecture boundary violation (the generated eslint config encodes them as `no-restricted-imports`). */
  boundary?: boolean
}

export interface CheckResult {
  name: CheckName
  ok: boolean
  /** ISO time the check started. */
  startedAt: string
  durationMs: number
  /** One line, e.g. "2 boundary violations, 1 other lint error" or "24 tests passed". */
  summary: string
  findings: CheckFinding[]
  /** The last 4000 characters of the tools' stdout and stderr, when not ok. */
  output?: string
}

export interface HealthReport {
  updatedAt: string
  drift?: DriftReport
  /** The pending migration plan, or null when there is none. */
  migration?: unknown
  checks: Partial<Record<CheckName, CheckResult>>
}

export type HealthPatch = Partial<Omit<HealthReport, 'updatedAt' | 'checks'>> & { checks?: Partial<Record<CheckName, CheckResult>> }

const emptyReport = (): HealthReport => ({ updatedAt: '', checks: {} })

/** The stored report; an empty one when it is missing or unreadable. */
export const readHealth = (root: string): HealthReport => {
  try {
    const report = JSON.parse(readFileSync(join(root, HEALTH_FILE), 'utf8')) as unknown
    if (typeof report !== 'object' || report === null || Array.isArray(report)) return emptyReport()
    const { updatedAt, checks } = report as Record<string, unknown>
    if (typeof updatedAt !== 'string' || typeof checks !== 'object' || checks === null || Array.isArray(checks)) return emptyReport()
    return report as HealthReport
  } catch {
    return emptyReport()
  }
}

/** Merges `patch` into the stored report (checks one by one), stamps it and writes it atomically. */
export const updateHealth = (root: string, patch: HealthPatch): HealthReport => {
  // Same boundary as the file sync: a committed symlink can't send the report elsewhere.
  if (!resolvesInside(root, join(root, CACHE_DIR))) throw new Error(`${CACHE_DIR} resolves outside the project (symlink): bildr won't write the health report there`)
  const current = readHealth(root)
  const { checks, ...rest } = patch
  const next: HealthReport = { ...current, ...rest, updatedAt: new Date().toISOString(), checks: { ...current.checks, ...checks } }
  mkdirSync(join(root, CACHE_DIR), { recursive: true })
  writeAtomically(join(root, HEALTH_FILE), `${JSON.stringify(next, null, 2)}\n`)
  return next
}

/** Drift of the project against `generated`. Only safe paths that stay inside the project are read; anything else counts as missing. */
export const projectDrift = (root: string, generated: GeneratedFile[]): DriftReport => {
  const manifest = readManifest(root)
  const disk: Record<string, string | undefined> = {}
  for (const path of new Set([...generated.map(file => file.path), ...Object.keys(manifest)])) {
    const target = join(root, path)
    const readable = isSafeProjectPath(path) && existsSync(target) && resolvesInside(root, target) && statSync(target).isFile()
    disk[path] = readable ? readFileSync(target, 'utf8') : undefined
  }
  return driftReport({ generated, manifest, disk, hash: sha256 })
}

// ── Checks ────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS: Record<CheckName, number> = { lint: 120_000, types: 300_000, tests: 300_000, build: 600_000 }
const OUTPUT_LIMIT = 4000
const run = promisify(execFile)

interface Ran { code: number, stdout: string, stderr: string, timedOut: boolean }

/**
 * The environment of a child running the project's tools: the caller's,
 * without what would make them think they run inside a test runner or in a
 * given mode (vitest's and Nuxt's own markers, NODE_ENV).
 */
const childEnv = (extra: Record<string, string> = {}) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_ENV' && key !== 'TEST' && !key.startsWith('VITEST') && !key.startsWith('__NUXT') && key !== 'FORCE_COLOR')),
  NO_COLOR: '1',
  ...extra
})

/** Runs Node with `args` in the project; a run past `timeoutMs` is killed. Never throws. */
const node = async (root: string, args: string[], timeoutMs: number, env: Record<string, string> = {}): Promise<Ran> => {
  try {
    const { stdout, stderr } = await run(process.execPath, args, { cwd: root, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, env: childEnv(env) })
    return { code: 0, stdout, stderr, timedOut: false }
  } catch (error) {
    const failure = error as { code?: number | string, killed?: boolean, stdout?: string, stderr?: string, message: string }
    const timedOut = failure.killed === true && failure.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? (typeof failure.code === 'string' ? failure.message : ''),
      timedOut
    }
  }
}

/** The project's own copy of a tool's bin script (never bildr's), or undefined when it isn't installed. */
const projectBin = (root: string, pkg: string, bin: string): string | undefined => {
  try {
    const manifestPath = createRequire(join(root, 'package.json')).resolve(`${pkg}/package.json`)
    const field = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin?: string | Record<string, string> }).bin
    const script = typeof field === 'string' ? field : field?.[bin]
    return script ? join(dirname(manifestPath), script) : undefined
  } catch {
    return undefined
  }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`
const firstLine = (text: string) => text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
const toProjectPath = (root: string, file: string) => {
  const path = isAbsolute(file) ? relative(root, file) : file
  return path.split(sep).join('/')
}

type Outcome = Omit<CheckResult, 'name' | 'startedAt' | 'durationMs' | 'output'> & { output?: string }

const fail = (summary: string, output = '', findings: CheckFinding[] = []): Outcome => ({ ok: false, summary, findings, output })
const timedOut = (timeoutMs: number) => fail(`did not finish within ${timeoutMs / 1000}s`)
const missing = (pkg: string) => fail(`${pkg} is not installed in the project: install its dependencies first`)

/** Runs one check of the project with its own tools. A failing (or stuck) check gives `ok: false`; it never throws. */
export const runCheck = async (root: string, name: CheckName, options: { timeoutMs?: number } = {}): Promise<CheckResult> => {
  const startedAt = new Date()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS[name]
  let outcome: Outcome
  try {
    outcome = await CHECKS[name](root, Date.now() + timeoutMs, timeoutMs)
  } catch (error) {
    outcome = fail(`${name} could not run: ${firstLine((error as Error).message)}`, (error as Error).stack ?? '')
  }
  const { output, ...rest } = outcome
  return {
    name,
    ...rest,
    startedAt: startedAt.toISOString(),
    durationMs: Math.max(1, Date.now() - startedAt.getTime()),
    ...(!outcome.ok && output ? { output: output.slice(-OUTPUT_LIMIT) } : {})
  }
}

/** A clean scratch folder for one check, refused when it would resolve outside the project. */
const workDir = (root: string, name: string) => {
  const target = join(root, WORK_DIR, name)
  if (!resolvesInside(root, target)) throw new Error(`${WORK_DIR} resolves outside the project (symlink): bildr won't run checks there`)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  return target
}

type Check = (root: string, deadline: number, timeoutMs: number) => Promise<Outcome>

// ── lint ──

interface EslintFile { filePath: string, messages: Array<{ ruleId: string | null, severity: number, message: string, line?: number }> }

const lint: Check = async (root, _deadline, timeoutMs) => {
  if (!existsSync(join(root, '.nuxt/eslint.config.mjs'))) {
    return fail('Lint needs .nuxt/eslint.config.mjs: start `nuxt dev` (or run `nuxt prepare`) first')
  }
  const eslint = projectBin(root, 'eslint', 'eslint')
  if (!eslint) return missing('eslint')
  const ran = await node(root, [eslint, '.', '--format', 'json'], timeoutMs)
  if (ran.timedOut) return timedOut(timeoutMs)
  let files: EslintFile[]
  try {
    files = JSON.parse(ran.stdout) as EslintFile[]
  } catch {
    return fail(`ESLint could not run: ${firstLine(ran.stderr) || `exit code ${ran.code}`}`, ran.stdout + ran.stderr)
  }
  const findings: CheckFinding[] = []
  let boundaryErrors = 0
  let errors = 0
  let warnings = 0
  for (const file of files) {
    for (const message of file.messages) {
      const boundary = message.ruleId === 'no-restricted-imports'
      if (message.severity === 2) {
        if (boundary) boundaryErrors++
        else errors++
      } else {
        warnings++
      }
      findings.push({
        file: toProjectPath(root, file.filePath),
        ...(message.line ? { line: message.line } : {}),
        message: message.message,
        ...(message.ruleId ? { rule: message.ruleId } : {}),
        ...(boundary ? { boundary: true } : {})
      })
    }
  }
  const parts = [
    ...(boundaryErrors ? [plural(boundaryErrors, 'boundary violation')] : []),
    ...(errors ? [plural(errors, boundaryErrors ? 'other lint error' : 'lint error')] : []),
    ...(warnings ? [plural(warnings, 'lint warning')] : [])
  ]
  const ok = boundaryErrors + errors === 0 && ran.code === 0
  return { ok, summary: parts.join(', ') || 'No lint problems', findings, output: ran.stdout + ran.stderr }
}

// ── tests ──

interface VitestReport {
  success: boolean
  numPassedTests: number
  numFailedTests: number
  testResults: Array<{
    name: string
    status: string
    message?: string
    assertionResults: Array<{ fullName: string, status: string, failureMessages?: string[] }>
  }>
}

const tests: Check = async (root, _deadline, timeoutMs) => {
  const vitest = projectBin(root, 'vitest', 'vitest')
  if (!vitest) return missing('vitest')
  const report = join(workDir(root, 'tests'), 'report.json')
  const ran = await node(root, [vitest, 'run', '--reporter=json', `--outputFile=${report}`], timeoutMs)
  if (ran.timedOut) return timedOut(timeoutMs)
  if (!existsSync(report)) return fail(`Vitest could not run: ${firstLine(ran.stderr) || `exit code ${ran.code}`}`, ran.stdout + ran.stderr)
  const result = JSON.parse(readFileSync(report, 'utf8')) as VitestReport
  const findings: CheckFinding[] = []
  for (const suite of result.testResults) {
    const file = toProjectPath(root, suite.name)
    const failed = suite.assertionResults.filter(test => test.status === 'failed')
    for (const test of failed) {
      const failure = test.failureMessages?.[0] ?? ''
      // The first stack frame in the test file gives the line.
      const line = new RegExp(`${escapeRegExp(suite.name)}:(\\d+):\\d+`).exec(failure)?.[1]
      findings.push({ file, ...(line ? { line: Number(line) } : {}), message: `${test.fullName}: ${firstLine(failure)}` })
    }
    // A file that failed to load has no test results of its own.
    if (suite.status === 'failed' && !failed.length) findings.push({ file, message: firstLine(suite.message ?? '') || 'The test file failed to run' })
  }
  const failedFiles = findings.length - result.numFailedTests
  const summary = result.numFailedTests || failedFiles
    ? [
        ...(result.numFailedTests ? [`${plural(result.numFailedTests, 'test')} failed`] : []),
        ...(failedFiles > 0 ? [`${plural(failedFiles, 'test file')} failed to run`] : []),
        `${result.numPassedTests} passed`
      ].join(', ')
    : result.numPassedTests ? `${plural(result.numPassedTests, 'test')} passed` : 'No tests'
  return { ok: result.success && ran.code === 0, summary, findings, output: ran.stdout + ran.stderr }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ── types and build ──

/**
 * Prepares (types) or builds (build) the project with the project's own Nuxt,
 * every folder Nuxt writes redirected under `dir`. Nuxt's own `typesDir`
 * defaults to `.nuxt/` independently of `buildDir`, so both are set.
 */
const NUXT_SCRIPT = `
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const [root, mode, dir] = process.argv.slice(1)
const kit = await import(pathToFileURL(createRequire(root + '/package.json').resolve('nuxt/kit')).href)
const buildDir = dir + '/.nuxt'
const overrides = {
  buildDir,
  typesDir: buildDir,
  vite: { cacheDir: dir + '/vite' },
  nitro: { output: { dir: dir + '/.output' } },
  ...(mode === 'types' ? { _prepare: true } : {})
}
const nuxt = await kit.loadNuxt({ cwd: root, ready: false, dotenv: { cwd: root }, overrides })
await nuxt.ready()
try {
  if (mode === 'types') {
    await kit.buildNuxt(nuxt)
    await kit.writeTypes(nuxt)
  } else {
    await kit.writeTypes(nuxt)
    await kit.buildNuxt(nuxt)
  }
} finally {
  await nuxt.close()
}
`

const nuxtIn = async (root: string, mode: 'types' | 'build', dir: string, timeoutMs: number) => {
  if (!projectBin(root, 'nuxt', 'nuxt')) return undefined
  return node(root, ['--input-type=module', '--no-warnings', '-e', NUXT_SCRIPT, root, mode, dir], timeoutMs, { NODE_ENV: 'production' })
}

const GENERATED_TSCONFIGS = ['tsconfig.app.json', 'tsconfig.server.json', 'tsconfig.shared.json', 'tsconfig.node.json']
const TS_ERROR = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/

const types: Check = async (root, deadline, timeoutMs) => {
  const vueTsc = projectBin(root, 'vue-tsc', 'vue-tsc')
  if (!vueTsc) return missing('vue-tsc')
  const dir = workDir(root, 'types')
  const prepared = await nuxtIn(root, 'types', dir, timeoutMs)
  if (!prepared) return missing('nuxt')
  if (prepared.timedOut) return timedOut(timeoutMs)
  if (prepared.code !== 0) return fail(`Nuxt could not prepare the types: ${firstLine(prepared.stderr) || `exit code ${prepared.code}`}`, prepared.stdout + prepared.stderr)
  // The project's tsconfig.json points at .nuxt/: check the same configs from where Nuxt just wrote them.
  const references = GENERATED_TSCONFIGS.filter(file => existsSync(join(dir, '.nuxt', file))).map(file => ({ path: `./.nuxt/${file}` }))
  const solution = join(dir, 'tsconfig.json')
  writeFileSync(solution, `${JSON.stringify({ files: [], references }, null, 2)}\n`)
  const remaining = deadline - Date.now()
  if (remaining <= 0) return timedOut(timeoutMs)
  const ran = await node(root, [vueTsc, '-b', '--noEmit', '--pretty', 'false', solution], remaining)
  if (ran.timedOut) return timedOut(timeoutMs)
  const findings: CheckFinding[] = []
  for (const line of `${ran.stdout}\n${ran.stderr}`.split('\n')) {
    const match = TS_ERROR.exec(line.trim())
    if (match) findings.push({ file: toProjectPath(root, match[1]!), line: Number(match[2]), rule: match[4]!, message: match[5]! })
  }
  const ok = ran.code === 0
  const summary = findings.length ? plural(findings.length, 'type error') : ok ? 'No type errors' : `Type check failed: ${firstLine(ran.stderr) || `exit code ${ran.code}`}`
  return { ok, summary, findings, output: prepared.stdout + prepared.stderr + ran.stdout + ran.stderr }
}

const build: Check = async (root, _deadline, timeoutMs) => {
  const dir = workDir(root, 'build')
  const ran = await nuxtIn(root, 'build', dir, timeoutMs)
  if (!ran) return missing('nuxt')
  if (ran.timedOut) return timedOut(timeoutMs)
  if (ran.code !== 0) {
    const error = `${ran.stderr}\n${ran.stdout}`.split('\n').map(line => line.trim()).find(line => /error/i.test(line))
    return fail(`Build failed: ${(error ?? `exit code ${ran.code}`).slice(0, 200)}`, ran.stdout + ran.stderr)
  }
  return { ok: true, summary: 'Build succeeded', findings: [] }
}

const CHECKS: Record<CheckName, Check> = { lint, types, tests, build }
