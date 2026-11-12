import { sep } from 'node:path'
import { generate } from '@bildr/codegen/generate'
import { loadModel } from '@bildr/codegen/model'
import type { ModelProblem } from '@bildr/codegen/model'
import type { SyncReport } from '@bildr/codegen/sync'
import { readModelFiles } from './project.ts'
import { syncProject } from './sync.ts'

export type RegenerateResult
  = | { ok: true, report: SyncReport }
    | { ok: false, problems: ModelProblem[] }
    | { ok: false, error: string }

/**
 * One regeneration (T7d): load `.bildr/`, generate the whole app and sync it
 * (decision D1: untouched managed files are rewritten, hand-edited ones are
 * detached and kept). An invalid model or a model the generator can't handle
 * yet writes nothing, so the app keeps its last good state.
 */
export const regenerate = (root: string): RegenerateResult => {
  const loaded = loadModel(readModelFiles(root))
  if (!loaded.ok) return { ok: false, problems: loaded.problems }
  let files
  try {
    files = generate(loaded.model)
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
  return { ok: true, report: syncProject(root, files).report }
}

/**
 * Whether a change the `.bildr/` watcher saw (a path relative to `.bildr/`)
 * should regenerate. The manifest a sync writes, atomic-write temp files and
 * the cache never do, or every sync would trigger the next one.
 */
export const isModelChange = (file: string | undefined): boolean => {
  if (!file) return false
  const path = file.split(sep).join('/')
  return path.endsWith('.json') && path !== 'manifest.json' && path !== '.cache' && !path.startsWith('.cache/')
}
