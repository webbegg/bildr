import { existsSync, lstatSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MANIFEST_FILE, fileKind, loadModel, serializeModel } from '@bildr/codegen/model'
import type { ModelProblem } from '@bildr/codegen/model'
import type { DriftFile } from '@bildr/codegen/sync'
import { readHealth } from './health.ts'
import { PENDING_FILE } from './migrations.ts'
import { readModelFiles, readProjectFile, resolvesInside } from './project.ts'
import { readManifest, sha256, writeAtomically } from './sync.ts'

/**
 * What the editor's surfaces (the `/api/*` routes and the actions) read and
 * write on disk, so both keep the same rules: only `.bildr/` model files, the
 * whole model stays valid, canonical atomic writes, no symlink escapes.
 */

/** A `.bildr/` model file the editor may write: never the manifest, the cache or project files. Paths must be normalized. */
/** NUL, other control characters and backslashes are never part of a model path (fs throws on NUL). */
// eslint-disable-next-line no-control-regex
const UNSAFE_PATH = /[\u0000-\u001f\\]/

export const isModelFilePath = (path: string): boolean => !UNSAFE_PATH.test(path) && path !== MANIFEST_FILE && fileKind(path) !== undefined

export type SaveOutcome
  = | { ok: true, sha256: string }
    | { ok: false, reason: 'json' | 'outside', message: string }
    | { ok: false, reason: 'invalid', problems: ModelProblem[] }

/** Saves one model file (`isModelFilePath`), only if the whole model stays valid. Written canonically and atomically. */
export const saveModelFile = (root: string, path: string, text: string): SaveOutcome => {
  try {
    JSON.parse(text)
  } catch {
    return { ok: false, reason: 'json', message: 'Invalid JSON' }
  }
  const result = loadModel({ ...readModelFiles(root), [path]: text })
  if (!result.ok) return { ok: false, reason: 'invalid', problems: result.problems }
  const target = join(root, path)
  if (!resolvesInside(join(root, '.bildr'), target)) return { ok: false, reason: 'outside', message: `${path} resolves outside .bildr/ (symlink)` }
  const canonical = serializeModel(result.model)[path]!
  writeAtomically(target, canonical)
  return { ok: true, sha256: sha256(canonical) }
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
  = | { ok: true }
    | { ok: false, reason: 'missing' | 'outside', message: string }
    | { ok: false, reason: 'invalid', problems: ModelProblem[] }

/** Deletes one artifact file (`isDeletableModelPath`), only if the rest of the model stays valid. Never through a symlink. */
export const deleteModelFile = (root: string, path: string): DeleteOutcome => {
  const target = join(root, path)
  if (!resolvesInside(join(root, '.bildr'), dirname(target))) return { ok: false, reason: 'outside', message: `${path} resolves outside .bildr/ (symlink)` }
  const stat = lstatSync(target, { throwIfNoEntry: false })
  if (stat?.isSymbolicLink()) return { ok: false, reason: 'outside', message: `${path} is a symlink: bildr only deletes model files it can read` }
  if (!stat?.isFile()) return { ok: false, reason: 'missing', message: `${path} doesn't exist` }
  const result = loadModel(Object.fromEntries(Object.entries(readModelFiles(root)).filter(([file]) => file !== path)))
  if (!result.ok) return { ok: false, reason: 'invalid', problems: result.problems }
  rmSync(target)
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
