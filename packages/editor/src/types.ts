/**
 * The shapes the editor reads through the action contract (T10). They mirror
 * `@bildr/codegen` (model, drift) and `@bildr/nuxt` (health, migrations); the
 * editor keeps its own copy because it only talks to them over HTTP.
 */

export interface ModelProblem {
  /** The `.bildr/…` file. */
  path: string
  message: string
}

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }

export interface ModuleModel {
  module: JsonObject & { name?: string, label?: string }
  entities: JsonObject[]
  repositories: JsonObject[]
  queries: JsonObject[]
  actions: JsonObject[]
  [part: string]: unknown
}

export interface Model {
  project: JsonObject
  datasources: JsonObject[]
  modules: Record<string, ModuleModel>
  /** Artifact id → the `.bildr/` file it was loaded from. */
  paths: Record<string, string>
}

/** `files` are the model files that are valid JSON; `invalid` is the text of the ones that are not (a model with problems has them). */
export type ModelGetResult
  = | { ok: true, model: Model, files: Record<string, Json>, invalid?: Record<string, string> }
    | { ok: false, problems: ModelProblem[], files?: Record<string, Json>, invalid?: Record<string, string> }

export type FileState = 'managed' | 'scaffold' | 'detached' | 'deleted' | 'orphaned' | 'pending' | (string & {})

export interface CodeFile {
  path: string
  state: FileState
  content?: string
  diff?: string
}

export interface DriftFile {
  path: string
  state: FileState
  diff?: string
}

export interface DriftReport {
  files: DriftFile[]
  missingManifest: boolean
}

export type CheckName = 'lint' | 'types' | 'tests' | 'build'
export const CHECK_NAMES: readonly CheckName[] = ['lint', 'types', 'tests', 'build']

export interface CheckFinding {
  file?: string
  line?: number
  message: string
  rule?: string
  boundary?: boolean
}

export interface CheckResult {
  name: CheckName
  ok: boolean
  startedAt: string
  durationMs: number
  summary: string
  findings: CheckFinding[]
  output?: string
}

/** A destructive migration plan waiting for confirmation (`.bildr/.cache/pending-migration.json`). */
export interface PendingMigration {
  hash: string
  destructive: string[]
  /** What confirming loses, in the user's words. */
  losing: string[]
  statements: string[]
}

export interface HealthReport {
  updatedAt: string
  drift?: DriftReport | { error: string }
  migration?: unknown
  model?: { ok: true } | { ok: false, problems: ModelProblem[] }
  checks: Partial<Record<CheckName, CheckResult>>
}

/** `migrateProject`'s result, as `migration_confirm` returns it. */
export type MigrationResult
  = | { kind: 'none' }
    | { kind: 'written', tag: string, statements: string[], applied?: true }
    | { kind: 'pending', hash: string, destructive: string[], losing: string[], statements: string[], written?: { tag: string, statements: string[], applied?: true } }
    | { kind: 'failed', error: string, statements: string[], tag?: string }
