import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { generate } from '@bildr/codegen/generate'
import { MANIFEST_FILE, loadModel } from '@bildr/codegen/model'
import type { ModelProblem } from '@bildr/codegen/model'
import { diskProblem, isModelFilePath, writeChangeSet } from './editor-io.ts'
import type { ModelFileChange } from './editor-io.ts'
import { readModelFiles, resolvesInside } from './project.ts'
import { sha256, writeAtomically } from './sync.ts'

/**
 * Undo and redo of the module actions (P3b, mapping §5): each action that
 * changes the model records one step, the file-level change set it wrote
 * with every file's content before and after. Hand edits on disk are not
 * steps; a step whose files changed since is refused (`conflict`).
 *
 * Storage, all in `.bildr/.cache` (V2, V6):
 * - `history.jsonl`: the undo stack, one step per JSON line, oldest first,
 *   at most `HISTORY_CAP` steps;
 * - `history-redo.jsonl`: the redo stack, same format, the next redo last.
 *
 * Each file is rewritten whole and atomically. A new step empties the redo
 * stack. Lines that don't read as a step are skipped.
 *
 * Every accepted model change is undoable: the model files are written
 * first, then the stacks; when the stacks can't be written the model files
 * are put back (`keepUndoable`).
 */

export const HISTORY_FILE = '.bildr/.cache/history.jsonl'
export const REDO_FILE = '.bildr/.cache/history-redo.jsonl'
export const HISTORY_CAP = 200

export interface HistoryChange {
  path: string
  /** The file's text before the step; null when it didn't exist. */
  before: string | null
  /** The file's text the step wrote; null when the step deleted it. */
  after: string | null
  /** sha256 of `after` (null with it): an undo needs the file on disk to still be this. */
  afterSha: string | null
}

export interface HistoryStep {
  id: string
  /** The action that made the change. */
  action: string
  /** ISO time of the change. */
  time: string
  changes: HistoryChange[]
}

/** A step without the file contents (what `history_get` shows). */
export interface StepInfo {
  id: string
  action: string
  time: string
  files: string[]
}

export const stepInfo = (step: HistoryStep): StepInfo => ({ id: step.id, action: step.action, time: step.time, files: step.changes.map(change => change.path) })

/** The step for `changes` written by `action` over the model files `before` (path → text as on disk before the write). */
export const stepOf = (action: string, before: Record<string, string>, changes: readonly ModelFileChange[], now = new Date()): HistoryStep => ({
  id: randomUUID(),
  action,
  time: now.toISOString(),
  changes: changes.map(({ path, content }) => ({
    path,
    before: Object.hasOwn(before, path) ? before[path]! : null,
    after: content,
    afterSha: content === null ? null : sha256(content)
  }))
})

const isChange = (value: unknown): value is HistoryChange => {
  const change = value as HistoryChange | null
  return typeof change === 'object' && change !== null && typeof change.path === 'string'
    && (change.before === null || typeof change.before === 'string')
    && (change.after === null || typeof change.after === 'string')
    && (change.afterSha === null || typeof change.afterSha === 'string')
}

const isStep = (value: unknown): value is HistoryStep => {
  const step = value as HistoryStep | null
  return typeof step === 'object' && step !== null && typeof step.id === 'string' && typeof step.action === 'string'
    && typeof step.time === 'string' && Array.isArray(step.changes) && step.changes.every(isChange)
}

/** Why the history can't be read or written here: `.bildr/.cache` or one of its files leaves the project (symlink), isn't a file, or can't be read. */
export class HistoryUnavailable extends Error {}

const cacheSafe = (root: string) => {
  const cache = join(root, '.bildr/.cache')
  // Same boundary as the session and editor context files: a committed symlink can't send the history elsewhere.
  if (!resolvesInside(root, cache)) throw new HistoryUnavailable('.bildr/.cache resolves outside the project (symlink)')
  for (const file of [HISTORY_FILE, REDO_FILE]) {
    const stat = lstatSync(join(root, file), { throwIfNoEntry: false })
    if (stat?.isSymbolicLink()) throw new HistoryUnavailable(`${file} is a symlink`)
    if (stat && !stat.isFile()) throw new HistoryUnavailable(`${file} is not a file`)
  }
  return cache
}

const readStack = (root: string, file: string): HistoryStep[] => {
  const path = join(root, file)
  if (!lstatSync(path, { throwIfNoEntry: false })) return []
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new HistoryUnavailable(`${diskProblem(file, error)}: the history can't be read`)
  }
  const steps: HistoryStep[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const step = JSON.parse(line) as unknown
      if (isStep(step)) steps.push(step)
    } catch {
      // A torn or hand-edited line: skipped.
    }
  }
  return steps
}

/** The history stack file could not be written; the message names it. */
class HistoryWriteFailed extends Error {}

const writeStack = (root: string, file: string, steps: readonly HistoryStep[]) => {
  const cache = cacheSafe(root)
  try {
    mkdirSync(cache, { recursive: true })
    writeAtomically(join(root, file), steps.map(step => `${JSON.stringify(step)}\n`).join(''))
  } catch (error) {
    throw new HistoryWriteFailed(diskProblem(file, error))
  }
}

/** The undo stack (oldest first) and the redo stack (the next redo last). */
export const readHistory = (root: string): { undo: HistoryStep[], redo: HistoryStep[] } => {
  cacheSafe(root)
  return { undo: readStack(root, HISTORY_FILE), redo: readStack(root, REDO_FILE) }
}

/** Appends `step` to the undo stack (keeping the last `cap`) and empties the redo stack: a new change. */
export const recordStep = (root: string, step: HistoryStep, cap = HISTORY_CAP): void => {
  writeStack(root, HISTORY_FILE, [...readStack(root, HISTORY_FILE), step].slice(-cap))
  writeStack(root, REDO_FILE, [])
}

/**
 * The history couldn't be written after the model files were. `unsettled`: the model
 * files couldn't be put back either, so these may hold the change that isn't undoable.
 */
export interface Unkept { ok: false, message: string, unsettled?: string[] }

/** The text of each stack file (undefined when absent or unreadable), to put back after a half-written update. */
const stackTexts = (root: string) => [HISTORY_FILE, REDO_FILE].map((file) => {
  try {
    return { file, text: lstatSync(join(root, file), { throwIfNoEntry: false })?.isFile() ? readFileSync(join(root, file), 'utf8') : undefined }
  } catch {
    return { file, text: undefined }
  }
})

/**
 * Runs `writeStacks` after a model write. When it fails, the stack files are put back
 * (best effort) and so are the model files, with `rollback` (each file as it was before
 * the write) through the same atomic path: a change that can't be undone isn't kept.
 */
const keepUndoable = (root: string, rollback: readonly ModelFileChange[], writeStacks: () => void): { ok: true } | Unkept => {
  const stacks = stackTexts(root)
  try {
    writeStacks()
    return { ok: true }
  } catch (error) {
    if (!(error instanceof HistoryWriteFailed || error instanceof HistoryUnavailable)) throw error
    try {
      cacheSafe(root)
      for (const { file, text } of stacks) {
        try {
          if (text === undefined) rmSync(join(root, file), { force: true })
          else writeAtomically(join(root, file), text)
        } catch {
          // The stack that failed to write is still as it was.
        }
      }
    } catch {
      // The cache left the project meanwhile: nothing is written there.
    }
    const restored = writeChangeSet(root, rollback)
    return restored.ok
      ? { ok: false, message: `bildr could not record the change in the history (${error.message}), so it was not kept: nothing changed` }
      : { ok: false, message: `bildr could not record the change in the history (${error.message}) nor put the model files back (${restored.message}): the model may have changed`, unsettled: rollback.map(change => change.path) }
  }
}

/** Records `step`, already written over the files its `before` holds; when that fails the files are put back. */
export const recordChange = (root: string, step: HistoryStep): { ok: true } | Unkept =>
  keepUndoable(root, step.changes.map(change => ({ path: change.path, content: change.before })), () => recordStep(root, step))

export type ReplayOutcome
  = | { ok: true, step: HistoryStep }
    | { ok: false, reason: 'empty' | 'conflict' | 'refused' | 'unavailable', message: string }
    | (Unkept & { reason: 'disk' })
    | { ok: false, reason: 'invalid', message: string, problems: ModelProblem[] }

/** The model's problems, or the generator's error as a problem of the file it names; undefined when the model loads and generates. */
const modelProblems = (files: Record<string, string>): ModelProblem[] | undefined => {
  const loaded = loadModel(files)
  if (!loaded.ok) return loaded.problems
  try {
    generate(loaded.model)
    return undefined
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [{ path: /^(\.bildr\/[^\s:]+)/.exec(message)?.[1] ?? MANIFEST_FILE, message }]
  }
}

const shaOf = (text: string | undefined | null) => (text === undefined || text === null ? null : sha256(text))

/**
 * Writes one side of the last step of a stack and moves it to the other stack.
 * Refused, writing nothing, when a file on disk is no longer what the step left
 * (`conflict`), or when the model generated and wouldn't any more (`invalid`).
 */
const replay = (root: string, direction: 'undo' | 'redo'): ReplayOutcome => {
  let stacks: { undo: HistoryStep[], redo: HistoryStep[] }
  try {
    stacks = readHistory(root)
  } catch (error) {
    if (error instanceof HistoryUnavailable) return { ok: false, reason: 'unavailable', message: error.message }
    throw error
  }
  const from = direction === 'undo' ? stacks.undo : stacks.redo
  const step = from.at(-1)
  if (!step) return { ok: false, reason: 'empty', message: direction === 'undo' ? 'Nothing to undo' : 'Nothing to redo' }

  // A hand-edited history may name any path: only model files are ever written back.
  const foreign = step.changes.find(change => !isModelFilePath(change.path))
  if (foreign) return { ok: false, reason: 'refused', message: `${foreign.path} is not a model file bildr may write (the history was edited by hand): nothing was ${direction === 'undo' ? 'undone' : 'redone'}` }

  const files = readModelFiles(root)
  const onDisk = (path: string) => (Object.hasOwn(files, path) ? files[path] : undefined)
  const changed = step.changes.filter(change => shaOf(onDisk(change.path)) !== (direction === 'undo' ? change.afterSha : shaOf(change.before)))
  if (changed.length) {
    const paths = changed.map(change => change.path).join(', ')
    return direction === 'undo'
      ? { ok: false, reason: 'conflict', message: `${paths} changed since ${step.action} (edited outside the editor's history): nothing was undone` }
      : { ok: false, reason: 'conflict', message: `${paths} changed since ${step.action} was undone (edited outside the editor's history): nothing was redone` }
  }

  const writes: ModelFileChange[] = step.changes.map(change => ({ path: change.path, content: direction === 'undo' ? change.before : change.after }))
  const written = new Map(writes.map(({ path, content }) => [path, content]))
  const next: Record<string, string> = Object.fromEntries(Object.entries(files).filter(([path]) => !written.has(path)))
  for (const [path, content] of written) if (content !== null) next[path] = content
  // Like an edit (P3a): refused only when it would break a model that generates now.
  const problems = modelProblems(next)
  if (problems && !modelProblems(files)) {
    return { ok: false, reason: 'invalid', message: `The ${direction} would leave a model the generator can't build: ${problems.map(problem => problem.message).join('; ')}`, problems }
  }

  const outcome = writeChangeSet(root, writes)
  if (!outcome.ok) return { ok: false, reason: outcome.reason, message: outcome.message }
  // What the files were before this write (the conflict check made sure of it).
  const rollback = step.changes.map(change => ({ path: change.path, content: direction === 'undo' ? change.after : change.before }))
  const kept = keepUndoable(root, rollback, () => {
    if (direction === 'undo') {
      writeStack(root, HISTORY_FILE, stacks.undo.slice(0, -1))
      writeStack(root, REDO_FILE, [...stacks.redo, step])
    } else {
      writeStack(root, REDO_FILE, stacks.redo.slice(0, -1))
      writeStack(root, HISTORY_FILE, [...stacks.undo, step].slice(-HISTORY_CAP))
    }
  })
  if (!kept.ok) return { ...kept, reason: 'disk' }
  return { ok: true, step }
}

/** Puts back the files of the last step as they were before it. */
export const undoStep = (root: string): ReplayOutcome => replay(root, 'undo')

/** Writes again the files of the last undone step. */
export const redoStep = (root: string): ReplayOutcome => replay(root, 'redo')
