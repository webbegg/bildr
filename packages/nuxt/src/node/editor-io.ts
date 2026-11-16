import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MANIFEST_FILE, PROJECT_FILE, fileKind, loadModel, serializeModel, stringifyModelFile } from '@bildr/codegen/model'
import type { Model, ModelProblem } from '@bildr/codegen/model'
import type { DriftFile } from '@bildr/codegen/sync'
import { readHealth } from './health.ts'
import { PENDING_FILE } from './migrations.ts'
import { readModelFiles, readProjectFile, resolvesInside } from './project.ts'
import { readManifest, sha256, writeAtomically } from './sync.ts'

/**
 * What the editor's surfaces (the `/api/*` routes and the actions) read and
 * write on disk, so both keep the same rules: only `.bildr/` model files, the
 * model gets no new problem (`judge`), canonical atomic writes, no symlink escapes.
 */

/** A `.bildr/` model file the editor may write: never the manifest, the cache or project files. Paths must be normalized. */
/** NUL, other control characters and backslashes are never part of a model path (fs throws on NUL). */
// eslint-disable-next-line no-control-regex
const UNSAFE_PATH = /[\u0000-\u001f\u007f\\]/

export const isModelFilePath = (path: string): boolean => !UNSAFE_PATH.test(path) && path !== MANIFEST_FILE && fileKind(path) !== undefined

const parses = (text: string): boolean => {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

const problemKey = (problem: ModelProblem): string => `${problem.path}\n${problem.message}`

/**
 * The problems of `files` with none of them hiding another: the loader reports files that are not JSON before any
 * schema problem, and schema problems before the references between files, so the files that are not JSON are left
 * out here (they are problems of their own, kept in the loader's own report).
 */
const visibleProblems = (files: Record<string, string>): ModelProblem[] => {
  const result = loadModel(Object.fromEntries(Object.entries(files).filter(([, text]) => parses(text))))
  return result.ok ? [] : result.problems
}

/**
 * The write rule, for a change from `before` to `after` (path → text) that writes `written` (a path) or deletes a file
 * (`written` null). The change is accepted when:
 * - the model is valid after it; or
 * - the model had problems, and the file written has none of its own (it parses, and no problem names it), and no
 *   problem exists that the model did not already have: a problem is the same when its file and message are.
 * Otherwise the problems that stop it are returned. A model that is valid stays valid: it had no problems, so none may appear.
 * The problems are compared with the files that are not JSON left out (`visibleProblems`), so a file that is still
 * broken does not hide that another is sound. The file written can only be judged with a project file that parses.
 */
const judge = (before: Record<string, string>, after: Record<string, string>, written: string | null): { ok: true, model: Model | undefined, remaining: ModelProblem[] } | { ok: false, blocking: ModelProblem[] } => {
  const loaded = loadModel(after)
  if (loaded.ok) return { ok: true, model: loaded.model, remaining: [] }
  const shown = visibleProblems(after)
  const project = after[PROJECT_FILE]
  if (written !== null && written !== PROJECT_FILE && !(project !== undefined && parses(project))) return { ok: false, blocking: shown }
  const had = new Set(visibleProblems(before).map(problemKey))
  const blocking = shown.filter(problem => problem.path === written || !had.has(problemKey(problem)))
  return blocking.length ? { ok: false, blocking } : { ok: true, model: undefined, remaining: loaded.problems }
}

export type SaveOutcome
  = | { ok: true, sha256: string, /** What is still wrong with the model, in other files; none when it is valid. */ problems?: ModelProblem[] }
    | { ok: false, reason: 'json' | 'outside', message: string }
    | { ok: false, reason: 'invalid', problems: ModelProblem[] }

/**
 * Saves one model file (`isModelFilePath`) under the write rule (`judge`): a valid model stays valid; one with problems takes
 * a file that is sound and adds none elsewhere, and the problems that remain are returned. Written canonically and atomically.
 */
export const saveModelFile = (root: string, path: string, text: string): SaveOutcome => {
  if (!parses(text)) return { ok: false, reason: 'json', message: 'Invalid JSON' }
  const before = readModelFiles(root)
  const verdict = judge(before, { ...before, [path]: text }, path)
  if (!verdict.ok) return { ok: false, reason: 'invalid', problems: verdict.blocking }
  const target = join(root, path)
  if (!resolvesInside(join(root, '.bildr'), target)) return { ok: false, reason: 'outside', message: `${path} resolves outside .bildr/ (symlink)` }
  // The model's own serialization applies the schema; while the model has problems the file is only reformatted.
  const canonical = verdict.model ? serializeModel(verdict.model)[path]! : stringifyModelFile(JSON.parse(text))
  writeAtomically(target, canonical)
  return { ok: true, sha256: sha256(canonical), ...(verdict.remaining.length ? { problems: verdict.remaining } : {}) }
}

/** The project, theme, manifest and module files hold the model together: deleting them is never an artifact edit. */
const KEPT_KINDS = new Set(['project', 'theme', 'manifest', 'module'])

/** An artifact file (data source, layout, or one under a module's folders) the editor may delete. */
export const isDeletableModelPath = (path: string): boolean => {
  if (UNSAFE_PATH.test(path)) return false
  const kind = fileKind(path)
  return kind !== undefined && !KEPT_KINDS.has(kind)
}

export type DeleteOutcome
  = | { ok: true, problems?: ModelProblem[] }
    | { ok: false, reason: 'missing' | 'outside', message: string }
    | { ok: false, reason: 'invalid', problems: ModelProblem[] }

/** Deletes one artifact file (`isDeletableModelPath`) under the write rule (`judge`): it may add no problem to the rest of the model. Never through a symlink. */
export const deleteModelFile = (root: string, path: string): DeleteOutcome => {
  const target = join(root, path)
  if (!resolvesInside(join(root, '.bildr'), dirname(target))) return { ok: false, reason: 'outside', message: `${path} resolves outside .bildr/ (symlink)` }
  const stat = lstatSync(target, { throwIfNoEntry: false })
  if (stat?.isSymbolicLink()) return { ok: false, reason: 'outside', message: `${path} is a symlink: bildr only deletes model files it can read` }
  if (!stat?.isFile()) return { ok: false, reason: 'missing', message: `${path} doesn't exist` }
  const before = readModelFiles(root)
  const verdict = judge(before, Object.fromEntries(Object.entries(before).filter(([file]) => file !== path)), null)
  if (!verdict.ok) return { ok: false, reason: 'invalid', problems: verdict.blocking }
  rmSync(target)
  return { ok: true, ...(verdict.remaining.length ? { problems: verdict.remaining } : {}) }
}

/**
 * Whether a file is still what an edit started from (`base`): its parsed JSON when the file was valid JSON, its text when it
 * was not, null when it did not exist. `disk` is the file's text now, undefined when it does not exist.
 */
export const matchesBase = (disk: string | undefined, base: Record<string, unknown> | string | null): boolean => {
  if (base === null || disk === undefined) return base === null && disk === undefined
  if (typeof base === 'string') return disk === base
  try {
    return JSON.stringify(JSON.parse(disk)) === JSON.stringify(base)
  } catch {
    return false
  }
}

/** One file of an edit's change set (`@bildr/codegen/edit`): its canonical text, or null to delete it. */
export interface ModelFileChange {
  path: string
  content: string | null
}

/** `refused`: a path bildr may not write; `disk`: the file system failed (permissions, a folder in the way, a full disk). */
export type ChangeSetOutcome = { ok: true } | { ok: false, reason: 'refused' | 'disk', message: string }

const DISK_ERRORS: Record<string, (path: string) => string> = {
  EACCES: path => `${path}: permission denied`,
  EPERM: path => `${path}: permission denied`,
  EISDIR: path => `${path} is a folder`,
  ENOTDIR: path => `a parent of ${path} is a file, not a folder`,
  ENOSPC: () => 'the disk is full',
  EDQUOT: () => 'the disk quota is used up',
  EROFS: () => 'the file system is read-only'
}

/** What went wrong writing `path`, in words (permission denied, a folder in the way, a full disk…). */
export const diskProblem = (path: string, error: unknown): string => {
  const code = (error as NodeJS.ErrnoException).code
  return code && DISK_ERRORS[code] ? DISK_ERRORS[code](path) : `${path}: ${(error as Error).message}`
}

/** The outermost folder of `dir` that doesn't exist yet (what `mkdirSync(dir, { recursive: true })` creates), or undefined. */
const firstMissing = (dir: string): string | undefined => {
  let missing: string | undefined
  for (let current = dir; !existsSync(current); current = dirname(current)) {
    missing = current
    if (dirname(current) === current) break
  }
  return missing
}

/**
 * Writes an edit's change set: every path is checked first (model files only,
 * deletes only of artifact files, nothing through a symlink that leaves
 * `.bildr/`), then each file is written atomically; a failure part-way puts
 * back what was already written and removes the folders it created. The
 * caller validated the model.
 */
export const writeChangeSet = (root: string, changes: readonly ModelFileChange[]): ChangeSetOutcome => {
  const base = join(root, '.bildr')
  for (const { path, content } of changes) {
    if (content === null ? !isDeletableModelPath(path) : !isModelFilePath(path)) return { ok: false, reason: 'refused', message: `${path} is not a model file bildr may ${content === null ? 'delete' : 'write'}` }
    const target = join(root, path)
    if (!resolvesInside(base, content === null ? dirname(target) : target)) return { ok: false, reason: 'refused', message: `${path} resolves outside .bildr/ (symlink)` }
    if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) return { ok: false, reason: 'refused', message: `${path} is a symlink: bildr only writes model files it can read` }
  }
  const undo: Array<{ target: string, previous: Buffer | undefined }> = []
  const createdFolders: string[] = []
  let current = ''
  try {
    for (const { path, content } of changes) {
      current = path
      const target = join(root, path)
      undo.push({ target, previous: existsSync(target) ? readFileSync(target) : undefined })
      if (content === null) {
        rmSync(target, { force: true })
      } else {
        const missing = firstMissing(dirname(target))
        mkdirSync(dirname(target), { recursive: true })
        if (missing) createdFolders.push(missing)
        writeAtomically(target, content)
      }
    }
  } catch (error) {
    for (const { target, previous } of undo.reverse()) {
      if (previous === undefined) rmSync(target, { force: true })
      else writeFileSync(target, previous)
    }
    // Only the folders this write created: none of them existed before it.
    for (const folder of createdFolders.reverse()) rmSync(folder, { recursive: true, force: true })
    return { ok: false, reason: 'disk', message: `bildr could not write the edit, nothing changed: ${diskProblem(current, error)}` }
  }
  return { ok: true }
}

/** The destructive migration waiting for confirmation, or null. */
export const pendingMigration = (root: string): unknown => {
  const target = join(root, PENDING_FILE)
  return existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) as unknown : null
}

export interface GeneratedFileView {
  path: string
  /** The manifest owner, or the state the last Health drift gave it. */
  state: string
  /** The file on disk; null when it is missing or not safely readable. */
  content: string | null
  /** For detached files: generated version → disk, from Health. */
  diff?: string
}

/** The generated files whose manifest `source` is `modelPath`, with their content and Health state. */
export const codeView = (root: string, modelPath: string): GeneratedFileView[] => {
  const drift = readHealth(root).drift
  const drifted = new Map<string, DriftFile>(drift && 'files' in drift ? drift.files.map(file => [file.path, file]) : [])
  return Object.entries(readManifest(root))
    .filter(([, entry]) => entry.source === modelPath)
    .map(([path, entry]) => {
      const found = drifted.get(path)
      return { path, state: found?.state ?? entry.owner, content: readProjectFile(root, path) ?? null, ...(found?.diff === undefined ? {} : { diff: found.diff }) }
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
